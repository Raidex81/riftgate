# Riftgate — Architecture

This is the technical companion to [README.md](README.md). The README is
the pitch; this is how it actually works — for anyone evaluating the
codebase, picking this project back up after time away, or curious what's
underneath a nine-theme game launcher.

Riftgate is an [Electron](https://www.electronjs.org/) desktop app: a
Node.js main process, a sandboxed Chromium renderer, and a small backend
on [Supabase](https://supabase.com/) for the data that needs to be shared
or persisted centrally (accounts, The Vault, community Applications,
suggestions).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Main process (Node.js)                                     │
│                                                               │
│   main.js  ──requires──▶  services/                         │
│   (~7,400 lines:            supabase.js   http.js           │
│    window/app lifecycle,    steam.js      tvmaze.js         │
│    ~170 ipcMain handlers,   books.js      github.js         │
│    IPC validation, CSP,     tmdb.js       free-games.js     │
│    local HTTP server)       content-filters.js              │
│                             platform/ (windows.js, mac.js)  │
│                                                               │
│   Serves the UI over http://127.0.0.1:<random port>/         │
└───────────────────────────┬───────────────────────────────────┘
                             │ preload.js (contextBridge, channel allowlists)
┌───────────────────────────▼───────────────────────────────────┐
│  Renderer (sandboxed, contextIsolation: true, nodeIntegration: │
│  false) — index.html + renderer.js (~12,700 lines), the UI     │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼ (all external calls happen in the
                               main process, not the renderer)
        ┌────────────────────┴─────────────────────┐
        ▼                                            ▼
  Supabase (accounts, Vault,                   Direct HTTP APIs
  Applications, suggestions —                  (Steam/SteamSpy,
  Postgres + RLS + RPC + Storage)               Gutenberg, Open
        │                                       Library, TVMaze,
        ▼                                       GitHub, Epic/GOG/
  Edge Functions:                               itch.io/GamerPower,
   media-proxy (TMDB, RAWG,                     CheapShark)
    SteamGridDB, YouTube —
    vendor keys live here)
   account-email + verify-email
    (password reset / email
    confirmation, via Resend)
   vault (signed file links)
```

**Why a local HTTP server instead of `file://`.** Electron's default
`file://` loading breaks YouTube's iframe embeds (they reject the
`file://` origin outright), so `startLocalServer()` spins up a
`127.0.0.1` server on a random port at launch and the app is loaded from
there instead. That server also serves locally-cached cover art from the
user's `userData/covers` folder, and sets `Cache-Control: no-store`
everywhere so a stale cached response never masks a real update.

**`covercache://`** is a small custom protocol that downloads Free
Games/Store cover art once and serves it from disk afterwards. Because the
page decides which URL to ask for, every download (and every redirect it
follows) must be `http(s)`, must resolve only to public internet
addresses — never this computer, the local network or cloud metadata
addresses, checked at connect time so a DNS name pointing at `127.0.0.1`
is refused too — must answer with an image, and is capped at 15 MB and
20 seconds.

**Codebase layout**, roughly in the order you'd want to read it:

- `main.js` — app/window lifecycle, IPC handler wiring (~170
  `ipcMain.handle` calls), the local server, CSP and IPC-sender
  validation. Still the largest file by a wide margin; see
  [Roadmap](#roadmap).
- `preload.js` — the only bridge between the two; see
  [IPC architecture](#ipc-architecture).
- `renderer.js` + `index.html` — the UI itself. No direct network
  access; everything goes through IPC.
- `services/*.js` — pure, dependency-light modules holding the actual
  external API calls (`supabase.js`, `http.js`, `steam.js`, `tvmaze.js`,
  `tmdb.js`, `free-games.js`, `books.js`, `github.js`,
  `content-filters.js`), extracted out of
  `main.js` so each data source's logic can be read (and changed) on its
  own. `main.js` still owns caching, orchestration, and all IPC wiring —
  these modules only know how to call an API and shape its response.
- `services/platform/` — the one place OS-specific code lives.
  `index.js` picks `windows.js` or `mac.js` by `process.platform` at
  require time; every OS-integration call in `main.js` (installed-app
  detection, launching, uninstalling, process tracking, install
  detection) goes through this module instead of branching inline.
  Everything else in the app — UI, `services/*.js`, ebook handling,
  settings — is a single shared codebase with zero platform branching,
  so a change there applies to Windows and Mac identically. See
  [Known limitations](#known-limitations) for the Mac side's testing
  status.
- `supabase/` — the backend as code: numbered database migrations (with
  a rollback script for each), a local test harness for them, and the
  source of every Edge Function. See [Supabase backend](#supabase-backend).

## Electron architecture

The renderer window is created with the hardened combination Electron
recommends and doesn't always get by default:

```js
webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: path.join(__dirname, "preload.js")
}
```

That means the UI's JavaScript has no access to Node, no access to
Electron internals, and runs in an OS-level sandboxed process — the same
isolation Chrome itself gives a random website. Everything the UI is
allowed to do goes through `preload.js`'s `contextBridge`, and only
through it (see [IPC architecture](#ipc-architecture)).

**Content-Security-Policy** is applied at the network layer —
`session.defaultSession.webRequest.onHeadersReceived`, rewriting the
response header — rather than a `<meta>` tag, so it can't be stripped or
overridden by anything that ends up injected into the page. It's scoped
to `{ urls: ["http://127.0.0.1/*"] }` plus an exact-port runtime check,
specifically so it only ever touches Riftgate's own page and never
rewrites the CSP on third-party content loaded inside it (the YouTube
trailer iframe, mainly) — get that filter wrong and you silently break
whatever's embedded, which is exactly what shipped briefly in 1.4.1
before being caught and fixed (YouTube's own player was being blocked
from fetching video by a CSP meant only for Riftgate's own page).

Current policy: `script-src 'self'` (no remote or inline script ever
runs), `style-src 'self' 'unsafe-inline'` (the UI uses inline `style=""`
attributes), `img-src` open to `https:`/`data:`/`covercache:` (cover art
comes from dozens of unpredictable CDNs with no fixed list to
allowlist), `frame-src https://www.youtube.com` only, `connect-src
'self'` (the renderer never calls `fetch`/`XHR` itself — see below),
`object-src 'none'`.

**Window and navigation guards.** Only one copy of Riftgate can run at a
time (a second launch just focuses the first window). No window can be
navigated away from Riftgate's own page: links that try to open a new
window go to the user's real browser (https only), and in-page
navigations or redirects to anywhere else are blocked. Launching an item
is limited to what's actually in the user's library (plus `steam:` links),
and opening an eBook to `.epub`/`.pdf` files in the library.

**Electron fuses** are flipped on the packaged app at build time
(`build.electronFuses` in `package.json`): the installed `Riftgate.exe`
can't be started as a plain Node.js runtime (`ELECTRON_RUN_AS_NODE`), and
ignores `NODE_OPTIONS` and `--inspect` switches, so it can't be used to
run other code; it only loads its own `app.asar`, whose integrity is
checked at startup; and cookies are stored encrypted.

**Permission requests** (camera, microphone, geolocation, notifications,
MIDI, clipboard, screen/device capture, etc.) are denied by default via
`setPermissionRequestHandler`/`setPermissionCheckHandler` — Electron's
own default is to *allow* anything nobody explicitly handles, which is
the wrong posture for an app that loads real third-party content. The
one exception is `fullscreen`, needed for the YouTube player's own
fullscreen button.

## IPC architecture

Everything the renderer can do to the outside world goes through IPC,
and it's checked at both ends:

1. **`preload.js`** exposes a single `window.riftgate` object via
   `contextBridge.exposeInMainWorld`, guarded by three allowlists —
   `INVOKABLE_CHANNELS`, `LISTENABLE_CHANNELS`, `SENDABLE_CHANNELS` —
   each a `Set` of exact channel names. Calling
   `window.riftgate.invoke("something-not-on-the-list")` throws before it
   ever reaches the main process.
2. **`main.js`** wraps `ipcMain.handle`/`on`/`once` themselves, so
   *every* handler — all ~170 of them — is checked without having to
   remember to add a check inside each one individually
   (`isTrustedIpcSender`, below). This is a second, independent layer:
   even a channel that's legitimately allowlisted in step 1 gets
   re-verified in step 2.

```js
function isTrustedIpcSender(event) {
    const senderURL = new URL(event.senderFrame.url);
    return senderURL.protocol === "http:"
        && senderURL.hostname === "127.0.0.1"
        && senderURL.port === String(localServerPort);
}
```

That check exists for a narrow but real reason: the renderer's
`contextIsolation`/`sandbox` settings stop the *page's own* JS from
reaching Node, but they don't stop a *different* frame or window that
somehow ended up in the same process from calling IPC — this closes that
gap by rejecting any sender whose origin isn't Riftgate's own local
server on its own randomized port, full stop.

A handful of sensitive actions add a third layer on top of both of the
above: anything touching accounts, admin tools or The Vault is re-checked
by the server itself against the account password (see
[Accounts & sessions](#accounts--sessions) and
[Vault security](#vault-security)).

## Security model

Putting the pieces above together, the model is defense in depth rather
than any single control doing all the work:

1. **Sandboxed renderer** — no Node, no Electron internals, OS-level
   process sandbox.
2. **`contextBridge` allowlists** — the renderer can only reach the
   specific IPC channels `preload.js` explicitly exposes.
3. **IPC sender validation** — every handler independently re-checks
   that the call actually came from Riftgate's own page.
4. **Scoped CSP** — no remote script, no inline script, and a narrow
   `frame-src`, without breaking the one piece of legitimate third-party
   content (YouTube embeds) that needs to keep working.
5. **Deny-by-default permissions** — camera/mic/geolocation/etc. are off
   unless a feature explicitly needs them (none currently do).
6. **No vendor API keys in the client** — TMDB, RAWG, SteamGridDB, and
   YouTube keys used to live in a local `secrets.local.js` file, which
   meant every packaged `.exe` shipped them in plain text (anyone could
   unzip the installer and read them out). They've since moved to
   Supabase secrets behind the `media-proxy` Edge Function; the client
   only ever holds Supabase's public URL and a "publishable" key, which
   are meant to be public — Supabase's own security model is RLS
   policies, not keeping that key secret.
7. **Server-side re-authentication for sensitive actions** — see
   Accounts & sessions and Vault, below.
8. **Hardened packaged app** — Electron fuses (above), updated
   dependencies, and only the app's real files in the installer (no
   private notes, database scripts or old backup copies).

This list reflects what's actually been built and verified so far, not a
claim that everything is covered — see
[Known limitations](#known-limitations).

## Accounts & sessions

Riftgate uses its own username accounts (not Supabase Auth), so all
account logic lives in Postgres functions called over RPC:

- **Password storage.** Password hashes, emails and reset/verification
  tokens live in a `private` schema that the app's public key can't read
  at all; only the database's own functions can. Hashes use bcrypt
  (cost 12, upgraded automatically on the next successful login).
- **Lockout.** 10 wrong passwords lock that username for 15 minutes,
  doubling on each further lockout (up to 24 hours).
- **Staying logged in.** The app never stores the password. After login it
  stores a random session token in `userData/session.dat`, encrypted with
  the operating system's own key store (`safeStorage`). The server keeps
  only a hash of that token; sessions last 30 days (extended on use, up to
  10 per account) and are all revoked on a real password change. The
  password itself is asked for once per launch, the first time The Vault
  or an admin tool needs it, and kept only in memory.
- **Password reset and email confirmation** are handled entirely by the
  `account-email` Edge Function: it creates the reset code or confirmation
  token in the database and emails it via Resend, so neither ever passes
  through the app. The confirmation link lands on `verify-email`, which
  replies with a plain-text page.
- **Feature detection.** `get_backend_info()` returns the backend's
  `schema_version`; the app checks it before using newer server features,
  so an older backend or an older app keeps working during an upgrade.

## Vault security

The Vault (private, invite-only file/link sharing with expiration) is
the most sensitive surface in the app, so it gets the most layers:

- Files live in the private Supabase Storage bucket `riftgate-shares`
  (50 MB per file). It has **no** public storage rules, so the app's
  public key can't list, read or write it directly.
- Every file transfer goes through the `vault` Edge Function. It checks
  the account password with the database first, then hands out a
  short-lived **signed** upload or download link (5 minutes, or 1 hour
  for image previews). The storage name of each upload is generated by
  the server, and the upload is only recorded after the server confirms
  the file really exists and is within the size limit, so nobody can
  point a Vault entry at someone else's file.
- Deleting a file, the expiry clean-up and the admin "Clean Vault now"
  remove the database entry and the stored file together, inside the
  function — the database functions that delete Vault entries can only
  be called by that function, so entries and stored files can't drift
  apart. Uploads that were started but never finished are removed too.
- Shared files and links expire automatically (1–24 hours for files, 90
  days for links).
- In the app, The Vault is currently shown to admins only while it's
  being reworked.

## Data sources

| Source | Used for | How it's reached |
|---|---|---|
| TMDB | Movie/TV metadata, posters, trailers | `media-proxy` (key server-side) |
| RAWG | Game metadata | `media-proxy` (key server-side) |
| SteamGridDB | Cover art | `media-proxy` (key server-side) |
| YouTube Data API | Trailer search | `media-proxy` (key server-side) |
| Steam Store / SteamSpy | Owned-game data, free-to-play listings, delisting checks | Direct — both are public, no-key APIs |
| Project Gutenberg (via Gutendex) | Free eBooks | Direct — public, no-key API |
| Open Library | Buy Books / Manga / Comics browsing | Direct — public, no-key API |
| TVMaze | TV episode/air-date data | Direct — public, no-key API |
| GitHub | Repo descriptions for community Applications | Direct — public API |
| CheapShark | Store deals across many resellers | Direct — public, no-key API |
| Resend | Password-reset and email-confirmation emails | `account-email` Edge Function (key server-side) |
| Epic Games Store, GOG, itch.io, GamerPower | Free Games aggregation | Direct — public endpoints/undocumented storefront APIs, scraped/parsed where no formal API exists (itch.io in particular has no public discovery API) |

The line that decides "direct" vs. "`media-proxy`" isn't arbitrary: the
four proxied sources are the ones that require a paid/rate-limited API
key, so routing them server-side keeps that key out of every user's
installed copy of the app. The direct sources are all genuinely public,
keyless APIs where there's nothing to protect.

## Local vs. cloud data

**Local** (in the OS's per-user app data folder, via
`app.getPath("userData")`) — installed game/app library entries, all
caches (free games, upcoming releases, ebook lists, etc.), locally
downloaded cover art, downloaded eBooks, app settings, the encrypted
login session token (`session.dat`), the shortcut snapshot used for
new-install detection (`shortcut-snapshot.json`), and a
description-diagnostic log. None of this is synced or backed up by
Riftgate itself; `export-backup-data` / `import-backup-data` exist for
the user to do that manually.

**Cloud** (Supabase) — anything inherently shared or cross-device:
accounts and login, The Vault's files/links and access lists, community
Applications submissions, and the suggestions/admin-moderation system.
Access is governed by Postgres Row-Level Security policies, the
RPC-based re-authentication and the Edge Functions described above, not
by anything the client enforces.

## Supabase backend

Everything on the Supabase side is kept in [`supabase/`](supabase/):

- `migrations/` — numbered SQL changes, applied in order in the Supabase
  SQL Editor. Production is currently at **schema version 7** (migrations
  `0001`–`0008` applied). Each file's header explains what it does, how
  it affects older app versions, and how to verify it.
- `rollback/` — an undo script for each migration.
- `tests/` — a local test harness (`run.sh`) that applies every migration
  to a throwaway Postgres database with a stand-in for Supabase's own
  setup and checks the results. It's never pointed at production.
- `functions/` — source of the Edge Functions: `media-proxy` (media APIs,
  allowlisted endpoints only), `account-email`, `verify-email` and
  `vault`. `media-proxy`, `account-email` and `vault` require the app's
  publishable key ("Verify JWT" on); `verify-email` doesn't, because it's
  opened straight from an email link.

Two older functions, `send-password-reset-email` and
`send-verification-email`, are still deployed only for app versions
before 1.6.0 and will be switched off once everyone has updated.

## Build & release process

```
npm start          # electron .                                   — run from source
npm run dist       # electron-builder --publish never             — build the installer locally
npm run release    # electron-builder --publish always            — build + publish to GitHub Releases
```

(In Windows PowerShell, use `npm.cmd` instead of `npm`.)

`electron-builder` (26.15.3, with Electron 44.4.3) produces a Windows NSIS
installer (`oneClick`, per-user, desktop + Start Menu shortcuts), flips the
Electron fuses described above, and packs only the app's real files —
`build.files` in `package.json` leaves out private notes, `supabase/`,
docs, old backup copies and the retired banner video. `release` publishes
to the GitHub Release matching the version in `package.json`, using a
short-lived `GH_TOKEN` set only in the terminal window doing the release;
the release itself is created on GitHub first (see `RELEASE.md` for why).
Installed Windows copies use `electron-updater` to check that same
Releases feed and update themselves.

The installer is **not code-signed** — see
[Known limitations](#known-limitations).

**macOS** builds (dmg + zip, Intel and Apple Silicon) are configured the
same way under `build.mac` in `package.json`, but built by GitHub Actions
rather than locally — there's no Mac hardware in this project. A manually
triggered workflow (`.github/workflows/release-mac.yml`) builds and
publishes into the same GitHub Release the Windows build went to, even if
that release is more than 2 hours old; a second workflow
(`build-check.yml`) builds both platforms on every push without
publishing, as a canary for changes that accidentally break either side.
See `RELEASE.md` for the actual release steps.

## Screenshots

_(to be added)_

## Roadmap

Reflects the active backlog, roughly in priority order:

- **Architecture** — split `main.js`'s remaining ~7,400 lines by
  subsystem (`ipc/`, `windows/`, `games/`, `free-games/`, `media/`,
  `vault/`, `auth/`, `system/`, alongside the existing `services/`)
  rather than one large file. The services extraction above is the first
  step of this, done; the IPC/window/domain split is not.
- **Testing & CI** — a GitHub Actions build check now runs on every push
  (see [Build & release process](#build--release-process)), but it only
  proves the app *builds* on both platforms, not that it *works*; an
  actual test suite (lint, unit tests, smoke tests) is still not
  started.
- **Error visibility** — structured error logging/reporting, beyond the
  existing description-diagnostic log.
- **Product** — global search across sections, a proper "Surprise Me"
  experience, general UX polish.
- **Code signing** — neither installer is signed (see below). Windows
  is on hold pending a decision on whether a certificate's ongoing cost
  is worth it for a personal project; Mac signing/notarization needs an
  Apple Developer account (also a paid, recurring cost) before it can
  even start — the CI groundwork for it (hardened runtime, entitlements,
  where the secrets go) is already in place in
  `.github/workflows/release-mac.yml`.
- **Mac build verification** — `services/platform/mac.js` has been
  syntax-checked and unit-tested against real filesystem fixtures, but
  never run on actual macOS hardware (this project has none). It needs
  a real-hardware pass before the Mac build should be trusted the way
  the Windows side already is — see [Known limitations](#known-limitations)
  and `MAC_TESTING.md` for the checklist.

## Known limitations

- **Unsigned installers.** Windows SmartScreen shows a "protected your
  PC" warning on first run, and the Mac build needs a right-click →
  Open the first time instead of a plain double-click. On the Mac this
  also means automatic updates can't install — Mac users download each
  new `.dmg` by hand. Both are fixable with paid developer
  accounts/certificates (real ongoing cost, neither currently purchased).
- **Account emails only reach the owner for now.** Emails are sent with
  Resend's test sender, which only delivers to the Resend account
  owner's own address until a real sending domain is set up.
- **No automated tests.** Correctness currently rests on manual
  click-through testing per release (see `RELEASE.md`) — CI now builds
  both platforms on every push, but that only catches build breakage,
  not behavioral bugs.
- **`main.js` is still large** (~7,400 lines) despite the services
  extraction — IPC wiring, window/app lifecycle, and per-feature logic
  are still interleaved in one file. See [Roadmap](#roadmap).
- **Mac build unverified on real hardware.** `services/platform/mac.js`
  (Applications-folder scanning, process tracking via `ps`, launching
  via `open -a`, uninstall via `shell.trashItem`, the hourly
  install-detection check) was written and unit-tested without any Mac to actually run
  it on. It needs a real-hardware pass before being trusted the way the
  Windows side already is — see `MAC_TESTING.md` for exactly what to
  check.
- **Not open to external contributions.** Proprietary, all-rights-
  reserved (see [README.md](README.md)) — this is a deliberate choice,
  not an oversight, but worth stating plainly for anyone evaluating it
  as a potential open-source dependency or contribution target.
