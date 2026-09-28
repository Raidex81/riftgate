# Contributing to Riftgate

Thanks for wanting to help! Riftgate is a personal entertainment hub
(games, movies, TV, anime, books, apps, free content and deals) built with
Electron for Windows and macOS. Bug reports, ideas, fixes and new features
are all welcome.

By contributing, you agree that your contribution is licensed under the
project's license, the [GNU GPL v3.0 or later](LICENSE).

## Ways to help

- **Report a bug** — open an [issue](../../issues/new/choose) with the bug
  template. Include your Riftgate version (bottom-right corner of the app),
  Windows or Mac, and the steps to make it happen.
- **Suggest a feature** — open an issue with the feature template, or use
  Suggestions inside the app.
- **Test on a Mac** — Mac support is the least tested part; working
  through [MAC_TESTING.md](MAC_TESTING.md) on real hardware is a big help.
- **Send code** — see below. For anything bigger than a small fix, open an
  issue first so we can agree on the approach before you spend time on it.

## Running Riftgate from source

You need [Node.js](https://nodejs.org/) 20 or newer and Git.

```
git clone https://github.com/Raidex81/Riftgate.git
cd Riftgate
npm install
npm start
```

On Windows PowerShell, use `npm.cmd install` and `npm.cmd start` if
`npm` is blocked by the execution policy.

No API keys are needed: movie, TV and game data (TMDB, RAWG, SteamGridDB,
YouTube) go through Riftgate's own server-side proxy. The Supabase key in
the code is a publishable key, made to ship inside apps; the database is
protected by its own server-side rules.

Only one copy of Riftgate can run at a time. If you also have the
installed app, quit it completely first (⏻ → Close Completely, and Quit
from the tray/menu-bar icon), or `npm start` will just bring the installed
window back. The version in the bottom-right corner tells you which one
you're looking at.

To build an installer: `npm run dist` on Windows, or
`npx electron-builder --mac --dir` on a Mac (unsigned, for local testing).

## How the code is organised

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it explains the whole
thing. In short:

| File | What it is |
|---|---|
| `main.js` | Electron main process: windows, IPC handlers, all network calls |
| `services/` | Main-process helpers (free games, Steam, TMDB, books, platform-specific code for Windows/Mac) |
| `preload.js` | The bridge between UI and main process, with an allowlist of IPC channels |
| `renderer.js`, `index.html`, `style.css` | The whole UI (plain JavaScript, no framework or bundler) |
| `supabase/` | Database migrations, Edge Functions and their tests |
| `.github/` | Build check, release and Mac test workflows |

## Rules that keep Riftgate safe

These are checked in review, so please follow them:

- **Network calls happen in the main process only.** The UI asks for data
  through `window.riftgate.invoke(...)`.
- **New IPC channels** must be added to the allowlist in `preload.js`, and
  their handler in `main.js` must validate every argument it receives.
- **Text from outside Riftgate** (game names, descriptions, anything from
  an API or a web page) goes into the page with `textContent`, never
  `innerHTML`.
- **No secrets in the repository.** Never commit API keys or tokens.
- Don't loosen the Content Security Policy, the Electron fuses in
  `package.json`, or the window's security settings (`sandbox`,
  `contextIsolation`) without discussing it in an issue first.

## Style

- Match the code around you: plain modern JavaScript, 4-space indent,
  double quotes, semicolons.
- Comments explain *why*, not *what*.
- Files use LF line endings (set `git config core.autocrlf input` on
  Windows if your editor converts them).
- Keep the UI consistent with the rest of the app: the theme colors
  (`--accent-1`, `--bg-primary`, …), card styles and the same wording
  style ("Free Games", "See all →").

## Sending a pull request

1. Fork the repository and create a branch from `main`
   (`fix/card-heights`, `feature/see-all-books`, …).
2. Make your change and try it with `npm start` on your system. If it
   touches something platform-specific, say which platforms you tested.
3. Don't change the version number or the changelog — that happens when a
   release is made.
4. Open the pull request and fill in the template. The **Build Check**
   workflow builds Riftgate on Windows and macOS automatically; it must
   pass.
5. Be patient with review — this is a spare-time project. Changes may be
   asked for; that's normal and not a judgement of your work.

### Database changes

Changes to the Supabase backend go in a new, numbered file in
`supabase/migrations/` with a matching rollback in `supabase/rollback/`
and a test in `supabase/tests/`. They are applied to the live server by
the maintainer after review — never against production from a pull
request.

## Code of conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Security problems are reported
privately — see [SECURITY.md](SECURITY.md).

## Contact

Anything that doesn't fit in an issue or pull request: email the Riftgate
team at [riftgateappdev@zohomail.eu](mailto:riftgateappdev@zohomail.eu).
