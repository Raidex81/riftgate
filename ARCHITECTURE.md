# Riftgate — Architecture

This is the technical companion to [README.md](README.md). The README
explains what Riftgate is; this page explains how it works. It's for
anyone evaluating the codebase, picking the project back up after time
away, or curious what's underneath an entertainment hub for games, films,
series, anime, books, apps, free games and deals.

Riftgate is an [Electron](https://www.electronjs.org/) desktop app with
three parts:

- a Node.js main process (the "engine"),
- a sandboxed Chromium renderer (the interface),
- a small backend on [Supabase](https://supabase.com/) for data that has
  to be shared or kept centrally: accounts, suggestions, community
  Applications, shared themes and the Vault.

Version 2.0 rebuilt the interface from scratch as small ES modules. The
engine, its security model and the backend carried over from 1.x and
were extended. 1.x stays available on the `v1` branch.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Main process (Node.js), the engine                          │
│                                                              │
│   main.js: start, window, tray, IPC validation, CSP, local   │
│   │        server, and wiring the sections together          │
│   ├─▶ engine/  one section each: alerts, account, themes,    │
│   │            apps, cinemas, install-watch, pictures, usage │
│   ├─▶ engine/providers.js  outside sources: health, backing  │
│   │            off, saved copies                             │
│   ├─▶ engine/core/  shared: data folder, settings, window,   │
│   │            account session                               │
│   └─▶ services/  one outside API each: supabase, http, steam,│
│                tvmaze, books, github, tmdb, free-games,      │
│                cinemas, alerts, r2-store, platform/          │
│                                                              │
│   Serves the UI over http://127.0.0.1:<random port>/         │
└───────────────────────────┬──────────────────────────────────┘
                            │ preload.js (contextBridge, channel allowlists)
┌───────────────────────────▼──────────────────────────────────┐
│  Renderer (sandboxed, contextIsolation, no Node)             │
│  index.html + src/: ES modules and CSS, no framework,        │
│  no bundler, no build step                                   │
│    src/app/         state, data, engine bridge, themes       │
│    src/components/  cards, rows, details, palette, rift…     │
│    src/views/       one module per section                   │
│    src/styles/      design tokens and stylesheets            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼ (every external call happens in the
                              main process, never in the renderer)
        ┌───────────────────┴──────────────────────┐
        ▼                                          ▼
  Supabase (accounts, sessions,              Direct HTTP APIs
  suggestions, Applications, themes,         (Steam, SteamSpy,
  Vault: Postgres + RLS + RPC + Storage)     Gutendex, Open Library,
        │                                    TVMaze, GitHub, Epic,
        ▼                                    GOG, itch.io, GamerPower,
  Edge Functions:                            CheapShark, OpenStreetMap)
   media-proxy (TMDB, RAWG, SteamGridDB,
     YouTube; vendor keys live here)
   account-email + verify-email
     (password reset / email confirmation, via Resend)
   vault (signed file links)
```

**Why a local HTTP server instead of `file://`.** Electron's default
`file://` loading breaks YouTube's embedded players, which reject the
`file://` origin outright. So `startLocalServer()` starts a `127.0.0.1`
server on a random port at launch, and the app is loaded from there.
That server also serves cached cover art from the user's
`userData/covers` folder. It sets `Cache-Control: no-store` everywhere so
a stale cached response never hides a real update.

**`covercache://`** is a small custom protocol that downloads cover art
once and serves it from disk afterwards. Because the page decides which
URL to ask for, every download (and every redirect it follows) has to
pass these checks:

- It must be `http(s)`.
- It must resolve only to public internet addresses, never this
  computer, the local network or cloud metadata addresses. This is
  checked at connect time, so a DNS name pointing at `127.0.0.1` is
  refused too.
- It must answer with an image.
- It's capped at 15 MB and 20 seconds.

### Codebase layout

Roughly in the order you'd want to read it:

- `main.js`: the app and window lifecycle, the local server, CSP and
  IPC-sender validation, wiring the engine's sections together, and the
  sections not moved out yet (free games, deals, theatre, books, the
  library, the Vault, updates).
- `engine/*.js`: one section of the engine each (`alerts.js`,
  `account.js`, `themes.js`, `apps.js`, `cinemas.js`,
  `install-watch.js`, `pictures.js`, `usage.js`, `achievements.js`). Each exports
  `register(ipcMain, deps)` and owns its IPC channels and timers.
  Sections never require each other: what one needs from another is
  passed in by `main.js` when it registers it, so every link between
  sections is visible in one place. See [Section boundaries](#section-boundaries).
- `engine/core/`: what every section shares. `data.js` is the data
  folder (atomic writes), `settings.js` the settings and their defaults,
  `window.js` the window, `session.js` the account session.
- `engine/providers.js`: every outside source and how the engine behaves
  when one fails. See [When a source fails](#when-a-source-fails).
- `preload.js`: the only bridge between the engine and the interface. See
  [IPC architecture](#ipc-architecture).
- `services/*.js`: dependency-light modules that hold the actual external
  API calls (`supabase.js`, `http.js`, `steam.js`, `tvmaze.js`, `tmdb.js`,
  `free-games.js`, `books.js`, `github.js`, `cinemas.js`,
  `content-filters.js`). `main.js` owns caching, orchestration and IPC
  wiring. These modules only know how to call an API and shape its
  response.
- `services/r2-store.js`: the Journal and interface preferences
  (`r2-data.json`), your own themes (`r2-themes.json`) and the one-time
  import used by the 2.0 preview. Writes are atomic: a temp file, then a
  rename.
- `services/platform/`: the one place OS-specific code lives. `index.js`
  picks `windows.js` or `mac.js` at require time. Every OS integration
  goes through it: installed-app detection, launching, uninstalling,
  process tracking, and install and uninstall watching.
- `index.html` + `src/`: the interface.
  - `src/app/main.js` is the entry point. It builds the title bar and
    the menu, routes between sections (`#nexus`, `#library`…) and wires
    shortcuts.
  - `api.js` is the bridge to the engine. It memoises answers for the
    session; `{ fresh: true }` skips the memo.
  - `data.js` loads each source and turns it into one `Item` shape
    (`items.js`), so every card, row, detail panel, search result and
    Journal entry works the same for every kind of content.
  - `store.js` is the Journal, `theme.js` the theme engine (a theme is
    plain data turned into CSS custom properties) and `mature.js` the
    age gate and moderation lists.
  - `src/components/` holds the shared pieces: the card, rows, the
    detail panel, the command palette, Surprise me, the rift (a canvas
    portal) and the opening animation.
  - `src/views/` has one module per section. Each exports
    `render(root)` and returns a cleanup function.
  - `src/styles/tokens.css` is the single source of truth for colour,
    type, space, shape and motion. Views only use its variables.
- `supabase/`: the backend as code. It has numbered database migrations
  (each with a rollback script), a local test harness, and the source of
  every Edge Function. See [Supabase backend](#supabase-backend).

The interface has no build step: the files in `src/` are exactly what
runs. That keeps the project approachable and makes every change
reviewable as plain source.

## Electron architecture

The window is created with the hardened settings Electron recommends:

```js
webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: path.join(__dirname, "preload.js")
}
```

The interface's JavaScript has no access to Node or to Electron
internals, and it runs in an OS-level sandboxed process, with the same
isolation Chrome gives any website. Everything it may do goes through
`preload.js`'s `contextBridge`, and only through it.

The window is frameless. Riftgate draws its own title bar (search, the
GitHub star, What's new, and the window buttons), which talk to the
engine through `window-minimize`, `window-maximize-toggle` and
`window-close`.

**Content-Security-Policy** is applied at the network layer, by
rewriting the response header in
`session.defaultSession.webRequest.onHeadersReceived`. A `<meta>` tag
could be stripped or overridden by anything injected into the page; the
header can't. The filter is scoped to `{ urls: ["http://127.0.0.1/*"] }`
plus an exact-port check, so it only touches Riftgate's own page and
never the third-party content embedded in it (mainly the YouTube trailer
player).

The current policy:

- `script-src 'self'`: no remote or inline script ever runs.
- `style-src 'self' 'unsafe-inline'`: the interface sets styles inline.
- `img-src` allows `https:`, `data:` and `covercache:`, because cover
  art comes from too many CDNs to allowlist.
- `frame-src https://www.youtube.com` only.
- `connect-src 'self'`: the renderer never calls `fetch`/`XHR` itself.
- `object-src 'none'`.

**Window and navigation guards:**

- Only one copy of Riftgate can run at a time. A second launch focuses
  the first window.
- No window can navigate away from Riftgate's own page. Links that open
  a new window go to the user's real browser (https only), and other
  navigations are blocked.
- Launching is limited to what's actually in the user's library (plus
  `steam:` links).
- Opening an eBook is limited to `.epub` and `.pdf` files in the library.

**Electron fuses** are flipped on the packaged app at build time
(`build.electronFuses` in `package.json`):

- The installed app can't be started as a plain Node.js runtime and
  ignores `NODE_OPTIONS` and `--inspect` switches.
- It only loads its own `app.asar`, whose integrity is checked at
  startup.
- Cookies are stored encrypted.

**Permission requests** (camera, microphone, geolocation, notifications
and so on) are denied by default. The only exception is `fullscreen`,
for the trailer player.

## IPC architecture

Everything the interface can do to the outside world goes through IPC,
and it's checked at both ends:

1. **`preload.js`** exposes a single `window.riftgate` object, guarded by
   three allowlists of exact channel names: `INVOKABLE_CHANNELS`,
   `LISTENABLE_CHANNELS` and `SENDABLE_CHANNELS`. Anything not on a list
   throws before it reaches the engine.
2. **`main.js`** wraps `ipcMain.handle`/`on`/`once` themselves, so every
   handler is checked without having to remember to add a check inside
   each one:

```js
function isTrustedIpcSender(event) {
    const senderURL = new URL(event.senderFrame.url);
    return senderURL.protocol === "http:"
        && senderURL.hostname === "127.0.0.1"
        && senderURL.port === String(localServerPort);
}
```

`contextIsolation` and `sandbox` stop the page's own scripts from
reaching Node. This check closes a different gap: it rejects any other
frame or window that ends up calling IPC unless its origin is Riftgate's
own local server on its own random port.

Sensitive actions add a third layer. Anything touching accounts, admin
tools or the Vault is re-checked by the server itself against the
account password (see [Accounts & sessions](#accounts--sessions)).

When the interface is newer than the engine still running in the tray
(the window reloads from disk, the engine only on a real restart), a
call to a channel the engine doesn't know fails cleanly. The interface
then says once that Riftgate needs a full restart.

## Security model

The model is defense in depth rather than any single control:

1. **Sandboxed renderer**: no Node, no Electron internals, an OS process
   sandbox.
2. **`contextBridge` allowlists**: only the channels `preload.js`
   exposes.
3. **IPC sender validation**: every handler re-checks the caller.
4. **Scoped CSP**: no remote or inline script, and a narrow `frame-src`.
5. **Deny-by-default permissions.**
6. **No vendor API keys in the app.** TMDB, RAWG, SteamGridDB and YouTube
   keys live in Supabase secrets behind the `media-proxy` Edge Function.
   The app only holds Supabase's public URL and publishable key, which
   are meant to be public; the database is protected by Row-Level
   Security, not by keeping that key secret.
7. **Server-side re-authentication** for sensitive actions.
8. **Hardened packaged app**: Electron fuses, current dependencies, and
   only the app's real files in the installer.
9. **Outside text is never treated as markup.** The interface builds
   every element with `h()` (`src/app/dom.js`) and puts outside text in
   with text nodes, never `innerHTML`.

This list reflects what's been built and verified, not a claim that
everything is covered. See [Known limitations](#known-limitations).

## Accounts & sessions

Riftgate uses its own username accounts (not Supabase Auth), so all
account logic lives in Postgres functions called over RPC:

- **Password storage.** Password hashes, emails and reset/verification
  tokens live in a `private` schema that the public key can't read. Only
  the database's own functions can. Hashes use bcrypt (cost 12, upgraded
  automatically at the next successful login).
- **Lockout.** 10 wrong passwords lock that username for 15 minutes. The
  lock doubles on each further lockout, up to 24 hours.
- **Staying signed in.** Riftgate never stores the password. After you
  sign in, it stores a random session token in `userData/session.dat`,
  encrypted with the operating system's key store (`safeStorage`). The
  server keeps only a hash of that token.
  - Sessions last 30 days, are extended on use, and an account can have
    up to 10.
  - A real password change revokes all of them.
  - Admin tools and the Vault ask for the password once per launch and
    keep it in memory only.
- **Password reset and email confirmation** happen entirely in the
  `account-email` Edge Function. It creates the code or token in the
  database and emails it via Resend, so neither passes through the app.
- **Feature detection.** `get_backend_info()` returns the backend's
  `schema_version`. The app checks it before using newer server features,
  so an older backend or an older app keeps working during an upgrade.

## Mature titles and moderation

Titles the engine's keyword check flags as mature, and titles an admin
marked as mature, show only to adults who turned them on (or to admins):

- "Adult" is 18 or over, from the date of birth on the Riftgate account.
  An account with no date of birth is treated as under 18.
- The choice is saved with the account, so it follows the user to other
  computers.
- Items an admin removed are hidden for everyone.
- Something already in the user's Journal is never hidden from them.

Both lists (`mature_overrides`, `removed_items`) are public to read and
only written through admin RPCs. 1.x and 2.0 share them. This is a
content filter based on a self-declared date of birth, not ID-based age
verification.

## The Vault

The Vault is private file and link sharing with automatic expiry. It's
admin-only in the app for now, and it's the most sensitive surface, so
it gets the most layers:

- Files live in the private Supabase Storage bucket `riftgate-shares`
  (50 MB per file). The bucket has no public storage rules, so the public
  key can't list, read or write it.
- Every file transfer goes through the `vault` Edge Function. It checks
  the account password with the database first, then hands out a
  short-lived **signed** upload or download link (5 minutes, or 1 hour
  for image previews).
  - The server generates each upload's storage name.
  - An upload is only recorded after the server confirms the file exists
    and is within the size limit.
- Deleting, the expiry clean-up and the admin "Clean now" remove the
  database entry and the stored file together, inside the function.
- Files expire after 1, 2, 4, 8, 12 or 24 hours, and links after 90
  days.
- Access is an allowlist managed by admins in **Admin → Vault access**.
  Other users can ask to be let in.

## Data sources

| Source | Used for | How it's reached |
|---|---|---|
| TMDB | Film and series data, posters, backdrops, trailers, streaming providers | `media-proxy` (key server-side) |
| RAWG | Game data, upcoming games | `media-proxy` (key server-side) |
| SteamGridDB | Cover art, wide banner art | `media-proxy` (key server-side) |
| YouTube Data API | Trailer search | `media-proxy` (key server-side) |
| Steam Store / SteamSpy / Steam Web API | Free-to-play listings, app details, VR flags, achievement rarity | Direct |
| Steam Web API (keyed) | Your playtime, your achievements and each game's achievement list | `media-proxy` (key server-side) |
| Gutendex (Project Gutenberg) | Free eBooks | Direct |
| Open Library | Books, manga, comics | Direct |
| TVMaze | Episodes and air dates | Direct |
| GitHub | Applications' project details, the star count | Direct |
| CheapShark | Deals across many stores | Direct |
| Epic Games Store, GOG, itch.io, GamerPower | Free games | Direct (public endpoints, parsed where there's no formal API) |
| OpenStreetMap (Overpass) | Cinemas near your city | Direct, cached two weeks per city |
| Resend | Account emails | `account-email` Edge Function (key server-side) |

The four proxied sources are the ones that need a paid or rate-limited
key, so routing them server-side keeps the key out of everyone's
installed copy. The direct sources are public, keyless APIs.

**Keeping API use low.** Lists are cached on disk and refreshed in the
background only when they're old:

- free games, deals and books by age,
- episodes for 6 hours per show,
- streaming services' trending lists for 12 hours,
- the GitHub star count for 10 minutes.

A cover found for a title is kept for good, and a miss is retried after
a week. The interface also memoises every answer for the session.

## Steam achievements

`engine/achievements.js` reads three things from Steam: the game's
achievement list (names, descriptions, icons, hidden or not; through
`media-proxy`, kept 30 days), yours (through `media-proxy`, kept an hour)
and how many players have each one (public, kept a week). It needs the
SteamID64 in Settings and the profile's "Game details" set to Public,
like Steam playtime. A summary of every game (`achievements-summary.json`)
is refreshed in the background, but only for games whose Steam playtime
changed since the last look, so idle games cost nothing.

`src/app/achievements.js` decides the order everywhere: Next up (what
you haven't got, the most-earned first), Recent (by day), Rarest, All,
with rarity tiers from Common to Legendary. They show in a Steam game's
details, the Journal's Trophy room, Nexus (Almost 100%), as a trophy on
perfect games' cards, and in two Seals.

## When a source fails

Any of the sources above can be offline, slow, rate-limited or down.
Riftgate handles all of them the same way (`engine/providers.js`,
`src/app/sources.js`):

- **Every request is watched.** `providers.install()` wraps Node's
  `http`/`https` once at start, so every request, from any section or
  service, is attributed to its provider by host (media-proxy requests
  by vendor, through `providers.track()`). A provider's health (last
  answered, last failed and why: offline, timed out, busy, down) is kept
  in `cache-provider-health.json`.
- **A failing host is left alone for a while.** After three network
  failures in a row (not a 404), requests to that host fail at once for
  90 seconds, doubling up to 10 minutes, instead of waiting for a
  timeout each time. One success, or Try again, resets it.
- **Saved copies beat empty rows.** Every list keeps its last good copy.
  When a refresh fails, the saved copy is served (`withDailyRefresh`,
  free games, deals, episodes, trending lists, cinemas, streaming
  services), and a failed refresh never overwrites a good copy. The
  section calls `providers.servedSaved(savedAt)` when it does.
- **The interface is told, beside the answer.** Each IPC call runs in
  its own async context. When a provider failed during it, or a saved
  copy was served, the answer travels as
  `{ __riftgateMeta: { failed, savedAt, offline }, value }`; preload.js
  unwraps it, so `invoke()` always returns the usual value and only
  `invokeMeta()` (used by `api.js`) sees the meta. Return shapes never
  change.
- **One look everywhere.** `sources.js` turns that into three states. A
  row showing a saved copy gets a "Saved 3 h ago" chip beside its title.
  A row with nothing to show says which source didn't answer and why,
  with Try again. Neither applies when all is well. Sections fed by one
  source (Free games, Deals) show the chip once beside their title. A
  small notice under the title bar names the sources that aren't
  answering, and Settings → Sources lists every source's health. Try
  again (anywhere) stops the engine backing off, forgets the session's
  answers and draws the section again; coming back online does that by
  itself.
- **Timeouts everywhere.** Every HTTP helper has one (8 to 15 seconds),
  so no source can hold a row up forever.

`tests/providers.test.js` covers the engine side without a network.

## Section boundaries

New features shouldn't quietly depend on other sections.
`scripts/check-deps.js` enforces the rules in `scripts/deps-rules.js`,
in CI (Build Check) on every push:

- **Engine layers:** `services/` → `engine/core/` → `engine/providers.js`
  → `engine/*.js` sections → `main.js`. A module only requires layers
  below it, and sections never require each other.
- **Interface layers:** `src/app/` (logic, state) → `src/components/`
  (shared pieces) → `src/views/` (sections) → `src/app/main.js`.
  Sections never import each other. The few deliberate exceptions are
  listed with their reason.
- **IPC:** every channel is handled once; everything the interface calls
  is allowed by preload.js and handled; everything the engine sends the
  window can be heard; a new handler that nothing calls is flagged.
- **Messages no import shows:** window events (`CustomEvent`) and
  storage keys shared between files have to be declared, with what they
  connect.

`scripts/engine-surface.js` loads the engine with a stand-in Electron
and records every IPC channel, app event and module it wires up; with
`--call` it also calls each handler with the network cut off and records
the shape of each answer. Comparing two runs proves an engine refactor
changed nothing the interface sees (`--cases` compares answers for given
arguments; `--check` is what CI runs).

## Local vs. cloud data

**Local** data lives in the operating system's per-user app data folder
(`app.getPath("userData")`, `%APPDATA%\Riftgate` on Windows). 1.x and
2.0 use the same folder, so installing 2.0 over 1.x keeps everything:

- the library (`games.json`), tracked shows, eBooks and settings,
- the Journal and interface preferences (`r2-data.json`), your themes
  and their pictures (`r2-themes.json`),
- all caches, downloaded covers and eBooks,
- the encrypted session token,
- the snapshots used to notice installs and uninstalls.

Riftgate doesn't sync any of this. **Settings → Open data folder** shows
where it is.

People who used the 2.0 preview (installed as "Riftgate 2", with its own
folder) get their newer data brought over once on the first start of
2.0. Any 1.x file it replaces is first copied to a
`backup-before-2.0-<date>` folder, and the preview's folder is left as
it was.

**Cloud** (Supabase) holds anything shared or cross-device: accounts and
sessions, the date of birth and mature-title choice, suggestions,
community Applications, shared themes, moderation lists, and the Vault.
Access is governed by Row-Level Security, the RPC re-authentication and
the Edge Functions, not by anything the app enforces.

## Supabase backend

Everything on the Supabase side lives in [`supabase/`](supabase/):

- `migrations/`: numbered SQL changes, applied in order in the Supabase
  SQL Editor. Each file's header explains what it does, how it affects
  older app versions, and how to verify it. `0009` (`r2_themes`) adds the
  shared theme gallery.
- `rollback/`: an undo script for each migration.
- `tests/`: a local harness (`run.sh`) that applies every migration to a
  throwaway Postgres database and checks the results. It's never pointed
  at production.
- `functions/`: the Edge Functions: `media-proxy` (media APIs, allowlisted
  endpoints only), `account-email`, `verify-email` and `vault`.

## Build & release process

```
npm start          # electron .                              — run from source
npm run dist       # electron-builder --publish never        — build the installer locally
npm run release    # electron-builder --publish always       — build + publish (fallback only)
```

(In Windows PowerShell, use `npm.cmd` instead of `npm`.)

`electron-builder` produces a Windows NSIS installer: one-click,
per-user, with desktop and Start Menu shortcuts. It flips the Electron
fuses described above and packs only the app's real files (`build.files`
in `package.json` leaves out docs, `supabase/`, screenshots and local
leftovers).

Releases are built by GitHub Actions, so no token or local build is
needed:

- **Publish Windows Release** (`release-windows.yml`) and **Publish
  macOS Release** (`release-mac.yml`) build on GitHub's own machines and
  upload into the GitHub Release for the version in `package.json`.
- **Build Check** builds both platforms on every push, without
  publishing.
- **Mac Smoke Test** installs a release (or the current code) on GitHub's
  Macs, opens every section and saves screenshots.

Installed Windows copies use `electron-updater` against the same Releases
feed. They check at start and every few hours, and always ask before
downloading. 2.0 keeps 1.x's app identity (`com.riftgate.app`), so 1.x
installs are offered 2.0 as a normal update, and it installs over them.

The installers aren't code-signed. See
[Known limitations](#known-limitations). [`RELEASE.md`](RELEASE.md) has
the actual steps.

## Roadmap

- **Finish splitting `main.js`** into `engine/` sections. Done: core
  (data folder, settings, window, session), alerts, account, themes,
  apps, cinemas, install watching, pictures, usage. Next: free games,
  deals, theatre, books, the library, the Vault, updates.
- **Retire the 1.x-only IPC handlers.** 67 handlers aren't called by
  the 2.x interface (old login and admin flows, the old eBook manager).
  `check-deps.js` keeps that number from growing.
- **Automated tests in CI.** The interface has a Playwright harness
  against a mocked engine, used during development. Running it on every
  push, plus a launch-and-click-through smoke test on Windows, is next.
- **The Vault for everyone** (it's admin-only while it's reworked).
- **Code signing.** It's on hold for Windows over the certificate's
  ongoing cost. Mac signing and notarisation need an Apple Developer
  account, and the CI groundwork is already in `release-mac.yml`.
- **Mac verification** on real hardware (see `MAC_TESTING.md`).

## Known limitations

- **Unsigned installers.** Windows SmartScreen shows a "protected your
  PC" warning on first run, and on a Mac the first launch needs
  right-click → Open. On the Mac this also means automatic updates can't
  install, so Mac users download each new `.dmg`.
- **Account emails only reach the owner for now.** Emails go through
  Resend's test sender until a real sending domain is set up.
- **`main.js` is still large** (~8,800 lines). See [Roadmap](#roadmap).
- **The Mac build is only partly verified.** The Mac Smoke Test checks
  that it installs, launches and loads every section on GitHub's Apple
  silicon and Intel Macs. The hands-on parts of
  `services/platform/mac.js` still need a pass on a real Mac (see
  `MAC_TESTING.md`).
- **Licence.** Open source under GPL-3.0-or-later ([LICENSE](LICENSE)).
  Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
