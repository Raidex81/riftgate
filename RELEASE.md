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
- Releases are built on GitHub (step 5) — no personal token needed.
  Never save a GitHub token permanently on the PC.
- On Windows PowerShell, always type `npm.cmd` instead of `npm` (plain
  `npm` can open a "Select an app" dialog instead of running).

## 1. Get the latest code

Always start here, especially now that two people are working on this:

```
cd C:\Riftgate
git pull
```

## 2. Install dependencies

Only needed the first time, or any time `package.json` changes:

```
npm.cmd install
```

## 3. Test it locally

Runs the app straight from source — no installer needed:

```
npm.cmd start
```

If Riftgate is already open (including the installed version), close it
completely first (⏻ → Close Completely) — only one copy can run at a
time, so a second start just brings the old window back.

Quick pass on what changed this round (v1.6.2):

- **Card heights** — in Installed, Free Games, Reading Room, Upcoming
  Games and every other row or grid, cards on the same line end at the
  same height, with the buttons lined up.
- **My Library covers** — a book without a cover of its own gets its real
  cover from Open Library / Google Books within a few seconds.
- **The Vault** — cancel the password prompt: it stays closed and an
  Unlock button appears; coming back to The Vault later asks again.

Then a quick general check that nothing else broke: log in, open Free
Games (covers load), open an ebook in the Reading Room, and open Theatre.

Close the app (just close the window, or Ctrl+C in the terminal) when
you're done.

## 4. Commit and push

```
git status
git add <the files you changed>
git commit -m "Describe what changed here"
git push
```

Check `git status` first and only add the files you actually meant to
change — the folder also holds private notes and big media files that
don't belong on GitHub.

This is also the point where the other person should `git pull` to get
these changes on their own machine.

## 5. Build and publish the release

Before publishing:

- Set the new version number in `package.json` (`"version"`) and make
  sure `renderer.js`'s `CHANGELOG` has an entry for it — that's what the
  🔔 button shows. Push that commit.
- Make sure the Supabase side for this version is live. For 1.6.x that's
  database migrations up to `20260926000800` and the Edge Functions
  `media-proxy`, `account-email`, `verify-email` and `vault` — all
  already done. See `supabase/README.md`.

Then, all on GitHub — no token or local build needed:

1. **Create the release first** (so the builds can't create it twice):
   go to https://github.com/Raidex81/Riftgate/releases/new, type the tag
   `v` + the version (e.g. `v1.6.2`) and choose **Create new tag**, set
   the title to the version number, paste that version's notes from the
   🔔 changelog, keep **Latest** selected, and click **Publish release**.
2. **Windows:** https://github.com/Raidex81/Riftgate/actions/workflows/release-windows.yml
   → **Run workflow** → **Run workflow**. It builds the installer on
   GitHub's own Windows machine and uploads it (plus `latest.yml`) into
   that release.
3. **Mac:** do the same with "Publish macOS Release" (5b below).

**Fallback — building Windows on your own PC** (if the Windows workflow
is ever unavailable): create a fine-grained token (only
Raidex81/Riftgate, **Contents: Read and write**, 7-day expiry), then in a
new PowerShell window: `$env:GH_TOKEN = Read-Host "Paste GitHub token"`,
paste it, and run `npm.cmd run release`. Never save the token
permanently (no `setx`), and delete it afterwards.

## 5b. Build and publish the macOS release

Riftgate has no Mac build hardware, so the Mac installer is built by
GitHub Actions instead of on anyone's own machine. Do this after step 5
above (or before — order doesn't matter, they publish to the same
release):

1. Go to https://github.com/Raidex81/Riftgate/actions/workflows/release-mac.yml
2. Click **Run workflow** → **Run workflow** (defaults to the `main`
   branch, which is what you want). It can run at the same time as the
   Windows one.
3. Wait for it to finish (a few minutes — it's building a real dmg/zip
   on an actual macOS runner). It publishes straight into the same
   GitHub Release as the Windows files, even if that release is more
   than 2 hours old.

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

Check https://github.com/Raidex81/Riftgate/releases and confirm there's
exactly **one** release for the new version, marked **Latest**, and that
its Assets include:

- Windows: `Riftgate-Setup-<version>.exe`, its `.blockmap`, and
  `latest.yml` (installed copies use `latest.yml` to find the update)
- Mac (after 5b): `.dmg` and `.zip` files for Intel and Apple Silicon,
  their `.blockmap` files, and `latest-mac.yml`

## 7. Get the update onto a running install

- Already have Riftgate installed on Windows? Just leave it running (it
  checks for updates every few hours) or reopen it — it'll prompt you to
  update.
- On a Mac, updates don't install themselves yet (the app isn't signed):
  download the new `.dmg` and drag it over the old copy in Applications.
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
- Only one of you should run `npm.cmd run release` for a given version —
  agree who's doing it before you both build the same version.
- Agree who bumps the version number in `package.json` for a given
  release, so you don't both bump it differently at the same time.
