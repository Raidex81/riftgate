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
│   (~7,200 lines:            supabase.js   http.js           │
│    window/app lifecycle,    steam.js      tvmaze.js         │
│    ~163 ipcMain handlers,   books.js      github.js         │
│    IPC validation, CSP,     content-filters.js              │
│    local HTTP server)                                       │
│                                                               │
│   Serves the UI over http://127.0.0.1:<random port>/         │
└───────────────────────────┬───────────────────────────────────┘
                             │ preload.js (contextBridge, channel allowlists)
┌───────────────────────────▼───────────────────────────────────┐
│  Renderer (sandboxed, contextIsolation: true, nodeIntegration: │
│  false) — index.html + renderer.js (~10,900 lines), the UI     │
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
  media-proxy Edge Function                     itch.io/GamerPower)
  (TMDB, RAWG, SteamGridDB,
  YouTube — vendor keys live
  here, never in the client)
```

**Why a local HTTP server instead of `file://`.** Electron's default
`file://` loading breaks YouTube's iframe embeds (they reject the
`file://` origin outright), so `startLocalServer()` spins up a
`127.0.0.1` server on a random port at launch and the app is loaded from
there instead. That server also serves locally-cached cover art from the
user's `userData/covers` folder, and sets `Cache-Control: no-store`
everywhere so a stale cached response never masks a real update.

**Codebase layout**, roughly in the order you'd want to read it:

- `main.js` — app/window lifecycle, IPC handler wiring (~163
  `ipcMain.handle` calls), the local server, CSP and IPC-sender
  validation. Still the largest file by a wide margin; see
  [Roadmap](#roadmap).
- `preload.js` — the only bridge between the two; see
  [IPC architecture](#ipc-architecture).
- `renderer.js` + `index.html` — the UI itself. No direct network
  access; everything goes through IPC.
- `services/*.js` — pure, dependency-light modules holding the actual
  external API calls (`supabase.js`, `http.js`, `steam.js`, `tvmaze.js`,
  `books.js`, `github.js`, `content-filters.js`), extracted out of
  `main.js` so each data source's logic can be read (and changed) on its
  own. `main.js` still owns caching, orchestration, and all IPC wiring —
  these modules only know how to call an API and shape its response.

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

1. **`preload.js`** exposes exactly three allowlists via
   `contextBridge.exposeInMainWorld` — `INVOKABLE_CHANNELS`,
   `LISTENABLE_CHANNELS`, `SENDABLE_CHANNELS` — each a `Set` of exact
   channel names. Calling `window.api.invoke("something-not-on-the-
   list")` throws before it ever reaches the main process.
2. **`main.js`** wraps `ipcMain.handle`/`on`/`once` themselves, so
   *every* handler — all ~163 of them — is checked without having to
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

A handful of sensitive handlers add a third layer on top of both of the
above: The Vault's file preview/download re-verifies the caller's
username/password against the server before returning anything (see
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
7. **Server-side re-authentication for sensitive actions** — see Vault,
   below.

This list reflects what's actually been built and verified so far, not a
claim that everything is covered — see
[Known limitations](#known-limitations).

## Vault security

The Vault (private, invite-only file/link sharing with expiration) is
the most sensitive surface in the app, so it gets the most layers:

- Files live in Supabase Storage (bucket `riftgate-shares`); links and
  metadata live in Postgres.
- Admin/account-sensitive operations — login, password changes, role
  changes, adding items to the Vault's access allowlist, and so on — go
  through Postgres RPC functions (`callAdminRpc`) rather than direct
  table access. Each of those functions re-verifies the caller's
  username/password *inside the database* on every single call. The
  Electron app itself never holds or checks a password hash — it just
  passes credentials through and trusts the RPC's yes/no answer.
- Downloading or previewing a shared file gets a short-lived **signed
  URL** from Supabase Storage rather than a permanent public link, and
  that signed URL is only issued after `isAuthorizedForSharedFile`
  confirms the requesting user is actually on that file's access list.
  This check was added after a real gap was found where the
  preview/download path wasn't checking authorization at all — anyone
  who knew (or guessed) a storage path could have pulled a file without
  being on the allowlist. It's fixed now, but it's a good example of why
  this section exists instead of just asserting "it's secure."
- Shared files and links expire automatically (cleanup handlers run on
  schedule and on-demand), so nothing shared into the Vault lingers
  indefinitely by default.

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
downloaded cover art, downloaded eBooks, app settings, and a
description-diagnostic log. None of this is synced or backed up by
Riftgate itself; `export-backup-data` / `import-backup-data` exist for
the user to do that manually.

**Cloud** (Supabase) — anything inherently shared or cross-device:
accounts and login, The Vault's files/links and access lists, community
Applications submissions, and the suggestions/admin-moderation system.
Access is governed by Postgres Row-Level Security policies and the
RPC-based re-authentication described above, not by anything the client
enforces.

## Build & release process

```
npm start     # electron .                          — run from source
npm run dist  # electron-builder                     — build only, no publish
npm run release  # electron-builder --publish always  — build + publish to GitHub Releases
```

`electron-builder` (24.13.3, currently paired with Electron 44.4.3)
produces a Windows NSIS installer (`oneClick`, per-user, desktop +
Start Menu shortcuts) and, for `release`, publishes it straight to a
GitHub Release matching whatever version is in `package.json`, using a
`GH_TOKEN` environment variable with `repo` scope. Installed copies use
`electron-updater` to check that same Releases feed and self-update —
no manual redownload needed after the first install.

The installer is **not code-signed** — see
[Known limitations](#known-limitations).

## Screenshots

_(to be added)_

## Roadmap

Reflects the active backlog, roughly in priority order:

- **Architecture** — split `main.js`'s remaining ~7,200 lines by
  subsystem (`ipc/`, `windows/`, `games/`, `free-games/`, `media/`,
  `vault/`, `auth/`, `system/`, alongside the existing `services/`)
  rather than one large file. The services extraction above is the first
  step of this, done; the IPC/window/domain split is not.
- **Testing & CI** — no automated test suite yet; a GitHub Actions
  pipeline (lint/build/smoke-test on push) is planned.
- **Error visibility** — structured error logging/reporting, beyond the
  existing description-diagnostic log.
- **Product** — global search across sections, a proper "Surprise Me"
  experience, general UX polish.
- **Code signing** — the installer isn't signed (see below); a
  certificate has an ongoing cost, so this is on hold pending a decision
  on whether it's worth it for a personal project at this stage.

## Known limitations

- **Unsigned installer.** Windows SmartScreen shows a "protected your
  PC" warning on first run. Fixable with a code-signing certificate
  (real ongoing cost — not free, not one-time), currently not purchased.
- **No automated tests.** Correctness currently rests on manual
  click-through testing per release (see `RELEASE.md`), not CI.
- **`main.js` is still large** (~7,200 lines) despite the services
  extraction — IPC wiring, window/app lifecycle, and per-feature logic
  are still interleaved in one file. See [Roadmap](#roadmap).
- **Windows-only build target.** `package.json`'s `build.win` is the
  only platform configured; no macOS/Linux builds exist.
- **Not open to external contributions.** Proprietary, all-rights-
  reserved (see [README.md](README.md)) — this is a deliberate choice,
  not an oversight, but worth stating plainly for anyone evaluating it
  as a potential open-source dependency or contribution target.
