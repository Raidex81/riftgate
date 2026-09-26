# Mac testing checklist

Riftgate's Mac support (`services/platform/mac.js`, plus the mac target
in `package.json`) was written and unit-tested without access to any
actual Mac hardware — there's none in this project. Everything below is
believed correct based on documented macOS/Electron behavior, but
"believed correct" isn't the same as "verified," which is what this
checklist is for. Please work through it on real macOS hardware before
treating the Mac build as trustworthy the way the Windows build already
is, and report back anything that doesn't match what's described.

Get the build from the [Releases page](https://github.com/Raidex81/Riftgate/releases/latest)
— under **Assets**, download `Riftgate-<version>-arm64.dmg` for a Mac with
an Apple chip (M1/M2/M3/M4…) or `Riftgate-<version>.dmg` for an Intel Mac
(Apple menu → About This Mac shows which). Open it, drag Riftgate into
Applications, and note that **first launch needs a right-click → Open**,
not a double-click — the build is unsigned (see below), so Gatekeeper
blocks a plain double-click the first time. On newer macOS versions you
may instead need System Settings → Privacy & Security → **Open Anyway**,
and if macOS claims the app "is damaged", run
`xattr -cr /Applications/Riftgate.app` in Terminal and open it again.
All of that is expected for an unsigned app, not a bug.

## 1. Basic launch & window behavior

- App launches, window opens at a reasonable size, UI renders correctly
  (fonts, layout, no obviously broken images).
- Closing the window offers the "Minimize to Background / Close
  Completely / Cancel" dialog, same as Windows. "Minimize to Background"
  hides the window but Riftgate keeps running (check the menu bar for
  its tray icon).
- **Menu bar tray icon** — likely to look wrong. It's Riftgate's regular
  app icon, not a proper macOS "template" (black/transparent,
  auto-inverting) menu bar icon, since no one's made that asset yet.
  Note how bad it looks (oversized, wrong colors, etc.) so it can be
  prioritized correctly — this is a known gap, not a surprise.
- Quitting from the tray icon's right-click menu, and from Cmd+Q,
  both actually quit (check the process is gone, not just the window).

## 2. Detecting installed games/apps

- **Steam**: with Steam for Mac installed and at least one game
  installed, open Riftgate's game-import flow. Confirm Steam games are
  found and their names are correct. (Behind the scenes: this reads
  `~/Library/Application Support/Steam/steamapps/*.acf` files — same
  manifest format as Windows, just one fixed library path instead of
  Windows' two-candidate/multi-library search.)
- **Everything else (generic apps)**: install a few ordinary Mac apps
  into `/Applications` (and, if you use it, `~/Applications`) — ideally
  including at least one actual game if you have one. Run the "Scan for
  Apps & Games" flow and confirm real apps/games show up, named
  correctly, and that obvious non-apps (uninstallers, readmes, etc.)
  aren't dragged in as junk entries. Note anything found that
  *shouldn't* have been (Mac system utilities, weird `.app` bundles
  that aren't really user apps), and anything real that's missing.
- **Battle.net / GOG Galaxy / Riot**, if you have any of them installed
  on Mac — confirm they turn up via the generic scan above (there's no
  manifest-based detection for these the way there is for Steam, so
  they should appear as a plain detected `.app`, same as any other
  app).
- **Epic Games Store** — has no Mac client at all, so Riftgate
  correctly doesn't look for it on Mac. Nothing to test here, just
  confirming the absence is intentional.

## 3. Launching

- Launch a regular app/game from Riftgate's library (double-click or
  the Play button) — confirm it actually opens. (Uses `open -a
  <App>.app` under the hood.)
- Launch a Steam-imported game — confirm it hands off to Steam
  correctly (uses `shell.openExternal("steam://rungameid/...")`, same
  as Windows).
- While something non-Steam is running, check that Riftgate shows it as
  "Running" and that playtime accrues, then confirm it flips back to
  "not running" a few seconds after you quit the app. (Uses `ps -axo
  pid=,comm=` polling every few seconds — if this misbehaves, playtime
  tracking will be visibly wrong: stuck on "Running" forever, or never
  triggering at all.)

## 4. Detecting a fresh install

Riftgate compares the contents of `/Applications` and `~/Applications`
with the list it saved last time — about 20 seconds after it opens, then
once an hour. The very first check only records what's already there.

- Open Riftgate, wait about 30 seconds, then quit it completely.
- Install a brand-new app (drag something new into `/Applications`, or
  run a real installer).
- Open Riftgate again. Within about 20 seconds it should show the "New
  Install Detected" popup for that app — and nothing else. Report any
  missed install, or any popup for something you didn't just install.

## 5. Removing a game

- Use Riftgate's "Remove" on a library entry — confirms it just drops
  the entry from Riftgate's list (should feel identical to Windows).
- Use Riftgate's "Uninstall" (the one that's supposed to actually
  remove the program, not just the list entry) on something in
  `/Applications`. Confirm the app actually ends up in the **Trash**
  (Finder's Trash, not silently deleted) — this uses Electron's
  `shell.trashItem`, not a Windows-style uninstaller lookup, since Mac
  apps generally don't have one.
- Confirm Riftgate correctly reports when something genuinely can't be
  uninstalled this way (e.g. try it on something outside
  `/Applications` if you have an example) rather than silently doing
  nothing or crashing.

## 6. Missing-game detection

- Manually move or rename an app Riftgate has in its library (e.g. drag
  it out of `/Applications` into a subfolder, or delete it entirely via
  Finder). Run Riftgate's "check for missing games" flow and confirm it
  correctly flags the entry as missing.
- Note: Mac apps don't get the Discord/Slack/VS-Code-style
  auto-relocation Windows watches for (`app-1.2.3` versioned folders —
  not a thing on Mac), so a moved-but-still-installed Mac app should
  always show as "missing" rather than being silently relocated. That's
  intentional, not a bug — just confirm it doesn't do something worse,
  like crash or point at the wrong file.

## 7. Auto-update — expect this to NOT fully work yet

This is the one item where a failure is **expected**, not a bug to
report as broken: macOS's own update mechanism (which `electron-updater`
uses under the hood) requires the app to be **code-signed** to actually
apply an update — an unsigned build can check for and even download an
update, but applying it will likely fail or silently do nothing. This
will start working once Alfredo has an Apple Developer account and the
app is signed (see `.github/workflows/release-mac.yml` for what that
adds). Until then: please still check that "Check for Updates" doesn't
*crash* or show a broken error message, but don't expect an actual
in-place update to succeed — for now, getting a new version means
downloading the new `.dmg` from GitHub Releases each time.

## 8. General polish

- The header at the top (gem logo, RIFTGATE lettering and portal
  artwork) should look crisp and follow the chosen theme's colors when
  you switch themes in Options.

- App icon in the Dock and in Finder — should be Riftgate's real icon,
  not a generic placeholder. (Built from `build/icon.png` automatically
  by electron-builder; flag it if it looks blurry or wrong, since the
  source image is 575×575 rather than the ideal 1024×1024 macOS wants.)
- Anything about the overall look/feel that's obviously "a Windows app
  running on Mac" rather than feeling native — window traffic-light
  buttons, keyboard shortcuts (Cmd vs Ctrl for things like copy/paste
  in text fields), etc. Riftgate doesn't customize window chrome, so
  this should mostly be fine by default, but worth a glance.

---

Please report back anything from this list that doesn't match, plus
anything that seems broken but isn't listed above — this checklist is a
starting point based on what changed for Mac, not a guarantee it covers
everything.
