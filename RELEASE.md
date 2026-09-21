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

Quick pass on what actually changed this round (v1.5.0):

- **Store (new section)** — open the new Store tab. Confirm deals load,
  the platform filter and store quick-link buttons work, sorting (incl.
  "Most Popular") works, and cards show a review-score badge, a working
  trailer (enlarge) button, and a sound toggle. Click a card's buy link
  and confirm it opens the actual storefront listing.
- **Sign-up — email verification** — create a new account and confirm
  the optional email verification step appears and completes correctly.
  Existing accounts should be unaffected.
- **Theatre — Streaming Providers** — open Theatre and confirm the
  Streaming Providers block now shows a separate row per service
  (Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Paramount+,
  Peacock, Crunchyroll) instead of one dropdown-driven row. Click a
  card's "Watch on <Provider>" button and confirm it opens that title on
  the provider's own site. The "🔍 Find Where to Watch" search below the
  rows should still work for titles outside those providers.
- **Theatre — My Shows / Recently Released sync** — track a show, wait
  for (or fake) it to appear in Recently Released, then remove it from
  My Shows. Confirm its card disappears from Recently Released too
  instead of lingering.
- **New tab — New Anime row** — confirm a "New Anime" row appears
  alongside New Series, and that it can be dragged to reorder among the
  other New tab sections — including dragging the *first* section onto
  its immediate neighbor, which used to silently fail to swap.
- **New tab & other carousels — card sizing** — scroll through New tab
  rows (and Reading Room's carousels) and confirm cards are all the same
  size and none are visibly cut off at the right edge.
- **Hero banner** — open the app and confirm the banner's background no
  longer visibly mismatches the video playing inside it.
- **🔔 Notifications (changelog)** — click the bell icon and confirm
  v1.5.0 shows real patch notes instead of the list stopping at v1.4.2.

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

## 6. Verify

Check https://github.com/Raidex81/Riftgate/releases and confirm the new
version's release exists with the `.exe` attached.

## 7. Get the update onto a running install

- Already have Riftgate installed? Just leave it running (it checks for
  updates automatically) or reopen it — it'll prompt you to update.
- Testing a totally fresh install instead? Download the `.exe` from the
  Releases page above.

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
