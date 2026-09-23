# Testing & releasing a new Riftgate version

A step-by-step checklist for building, testing, and publishing a new
version — written so either of you can follow it.

## One-time setup (each of you, once)

- Node.js installed (https://nodejs.org)
- Git installed, with your name/email set:
  ```
  git config --global user.name "Your Name"
  git config --global user.email "you@example.com"
  ```
- Push access to https://github.com/Raidex81/Riftgate (ask Alfredo to add
  you as a collaborator if you don't have it)
- Only needed by whoever will actually publish a release: a GitHub
  Personal Access Token with the `repo` scope, saved as the `GH_TOKEN`
  environment variable (see step 5 below)

## 1. Get the latest code

Always start here, especially now that two people are working on this:

```
cd C:\Riftgate
git pull
```

## 2. Install dependencies

Only needed the first time, or any time `package.json` changes:

```
npm install
```

## 3. Test it locally

Runs the app straight from source — no installer needed:

```
npm start
```

Quick pass on what actually changed this round (v1.5.2):

- **Region setting (new)** — go to Options → Region, change the country,
  and confirm Theatre showtimes/streaming availability, New tab's
  upcoming movies/shows, and Store's pricing and currency all update to
  match.
- **Forgot password (new)** — from the login prompt, click "Forgot
  password?", confirm a reset code arrives by email (if the account has
  a verified email on file), enter it with a new password, and confirm
  it logs you in.
- **Store seller labels (new)** — open Store and confirm each deal
  card shows a seller-type label (official / key reseller / key
  marketplace) with a working tooltip.
- **Store/Free Games cover & trailer accuracy (fix)** — spot-check a
  few Store and Free Games cards, especially any you remember being
  wrong before, and confirm the cover art, title, and trailer all match
  the actual game.
- **Card sizing / cover frames (fix)** — scroll through Reading Room,
  Free Games, Store, and book carousels and confirm every card in a row
  is the same size, with no widened or landscape-shaped cards.
- **Grid density (fix)** — turn on Options → compact Grid density and
  confirm Installed shrinks to match every other carousel row, not just
  itself.
- **Carousel resize snapping (fix)** — scroll partway into a carousel
  row (e.g. Upcoming Games), resize the window (or toggle the sidebar),
  and confirm the row re-snaps cleanly instead of leaving a card cut in
  half.
- **New Anime filtering (fix)** — confirm New Anime shows genuinely new
  series, not a returning show's new season.
- **Window maximized on launch (change)** — close and reopen the app
  and confirm it opens maximized to your screen instead of a small
  fixed window.
- **Changelog no longer auto-opens (change)** — update or relaunch and
  confirm the 🔔 changelog modal does NOT pop open by itself; clicking
  the bell still opens it.

Close the app (just close the window, or Ctrl+C in the terminal) when
you're done.

## 4. Commit and push

```
git add -A
git commit -m "Describe what changed here"
git push
```

This is also the point where the other person should `git pull` to get
these changes on their own machine.

## 5. Build and publish the release

This step needs a GitHub token that can publish releases to the repo,
set as an environment variable named `GH_TOKEN`. If this machine hasn't
been set up for that yet:

1. Go to https://github.com/settings/tokens → **Generate new token
   (classic)** → check the **repo** scope → **Generate token** → copy it
   (GitHub only shows it once).
2. In PowerShell, save it for your Windows user account:
   ```
   setx GH_TOKEN "paste_your_token_here"
   ```
3. Close and reopen your terminal so it picks up the new variable.

Then, from inside `C:\Riftgate`:

```
npm run release
```

This builds the Windows installer and publishes it straight to a new
GitHub Release matching whatever version is in `package.json` right
now. It can take a few minutes — it's building and uploading the whole
installer.

## 5b. Build and publish the macOS release

Riftgate has no Mac build hardware, so the Mac installer is built by
GitHub Actions instead of on anyone's own machine. Do this after step 5
above (or before — order doesn't matter, they publish to the same
release):

1. Go to https://github.com/Raidex81/Riftgate/actions/workflows/release-mac.yml
2. Click **Run workflow** → **Run workflow** (defaults to the `main`
   branch, which is what you want).
3. Wait for it to finish (a few minutes — it's building a real dmg/zip
   on an actual macOS runner). It publishes straight into the same
   GitHub Release `npm run release` created for the current
   `package.json` version.

No token setup needed for this one — it uses the token GitHub Actions
provides automatically. This produces an **unsigned** Mac build (same
situation as the unsigned Windows installer today): first launch on a
Mac needs a right-click → Open instead of a plain double-click, until
Alfredo has an Apple Developer account and code signing is set up. Once
that happens, the certificate/notarization secrets it needs are
documented right in `.github/workflows/release-mac.yml`.

There's also a `Build Check` workflow that runs automatically on every
push — it builds both Windows and Mac from the same commit (without
publishing anything) so a change that breaks the Mac build gets caught
right away instead of only being noticed at release time. Check
https://github.com/Raidex81/Riftgate/actions if you want to see its
results for the commit you just pushed.

## 6. Verify

Check https://github.com/Raidex81/Riftgate/releases and confirm the new
version's release exists with the `.exe` attached (and the `.dmg`/`.zip`
too, once 5b has run).

## 7. Get the update onto a running install

- Already have Riftgate installed? Just leave it running (it checks for
  updates automatically) or reopen it — it'll prompt you to update.
- Testing a totally fresh install instead? Download the `.exe` (or, on
  a Mac, the `.dmg`) from the Releases page above.

---

## Working together on the same repo

Since you're both pushing to the same `main` branch:

- Always `git pull` before you start working, and again right before
  you push, in case the other person pushed something while you worked.
- If `git push` is rejected ("non-fast-forward" / "updates were
  rejected"), run `git pull` first — Git will usually merge it
  automatically. If it can't, it'll tell you exactly which file has a
  conflict to resolve by hand.
- Only one of you should run `npm run release` for a given version —
  agree who's doing it before you both build the same version.
- Agree who bumps the version number in `package.json` for a given
  release, so you don't both bump it differently at the same time.
