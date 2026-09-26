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

On Windows PowerShell, type `npm.cmd` instead of `npm` (plain `npm` can
open a "Select an app" dialog instead of running).

Quick pass on what actually changed this round (v1.6.0):

- **Login stays signed in without a stored password** — log in, close
  and reopen the app: you should still be logged in. Open The Vault or an
  admin tool: it asks for your password once, then not again until you
  restart.
- **Forgot password / email confirmation** — both emails arrive (while
  Riftgate still uses Resend's test sender they only reach the Resend
  account owner's address); the confirmation link shows a plain
  "Email confirmed!" page.
- **The Vault (admins)** — upload a small image, hover to preview,
  download it, remove it, then use **Clean Vault now**.
- **Free Games** — covers load; Epic's "Get It Free" opens the real
  store page; no duplicate entries.
- **New-install detection** — about 20 seconds after launch, the
  PowerShell window prints an `[installer-detect]` line. A new program
  shortcut on the Desktop/Start Menu triggers the "New Install Detected"
  popup (at launch, then hourly).
- **Reading Room** — open an ebook; cover and title load.

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

Before publishing, make sure the Supabase side for this version is live
(for v1.6.0: database migrations up to `20260926000800`, and the Edge
Functions `account-email`, `verify-email` and `vault` — all already done).

Publishing needs a GitHub token that can create releases on the repo.
**Don't store it permanently** (no `setx`) — set it only for the
PowerShell window you're releasing from, so it disappears when the
window closes:

1. Go to https://github.com/settings/personal-access-tokens → **Generate
   new token** (fine-grained) → Repository access: **only
   Raidex81/Riftgate** → Permissions: **Contents: Read and write** →
   set an expiry (e.g. 7 days) → **Generate** → copy it.
2. In the PowerShell window you'll release from:
   ```
   $env:GH_TOKEN = Read-Host "Paste GitHub token"
   ```
   (paste it when asked — it won't be saved anywhere.)

3. **Create the release on GitHub first** (otherwise the build tool can
   create it twice at the same moment, splitting the files between two
   copies): go to https://github.com/Raidex81/Riftgate/releases/new, type
   the tag `v` + the version in `package.json` (e.g. `v1.6.1`) and choose
   **Create new tag**, set the title to the version number, paste that
   version's notes from the 🔔 changelog, and click **Publish release**.
   Then run the next command within 2 hours — the build tool only adds
   files to a release that's less than 2 hours old.

Then, from inside `C:\Riftgate`, in that same window:

```
npm.cmd run release
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
   GitHub Release `npm.cmd run release` created for the current
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
- Only one of you should run `npm.cmd run release` for a given version —
  agree who's doing it before you both build the same version.
- Agree who bumps the version number in `package.json` for a given
  release, so you don't both bump it differently at the same time.
