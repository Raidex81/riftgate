# Signing Riftgate's Windows installer (free, through SignPath Foundation)

Unsigned installers make Windows show "Windows protected your PC" on the
first install. The [SignPath Foundation](https://signpath.org) signs
open-source projects' releases for free, with its own certificate, from a
build that runs on GitHub Actions. Riftgate is ready for it: the release
workflow signs as soon as the secrets below exist, and keeps releasing
unsigned until then.

## 1. Before applying

Already done in this repository:

- **Code signing policy** page: [docs/code-signing.html](docs/code-signing.html)
  (linked from the home page's menu, the download section and the
  footer, from README.md, and from every release's notes).
- **Privacy** page: [docs/privacy.html](docs/privacy.html).
- GPL-3.0 license, all source public, built only on GitHub Actions
  ([release-windows.yml](.github/workflows/release-windows.yml)).
- The installer's product name is "Riftgate" and its version is the
  release's version (electron-builder sets both).

To do by you:

- Push these pages so they're live on the website.
- If anyone else can push to the repository, add them to the team roles
  on docs/code-signing.html (as an author), and they need two-factor
  authentication too.
- Turn on two-factor authentication on GitHub (Settings → Password and
  authentication) if it isn't on yet. SignPath requires it for everyone
  who can change the code or approve signing.

## 2. Apply

On [signpath.org](https://signpath.org), use the application for open
source projects. Answers you can use:

| Question | Answer |
|---|---|
| Project name | Riftgate |
| Repository | https://github.com/Raidex81/riftgate |
| Homepage / download page | https://raidex81.github.io/riftgate/ |
| Code signing policy | https://raidex81.github.io/riftgate/code-signing.html |
| Privacy policy | https://raidex81.github.io/riftgate/privacy.html |
| License | GNU GPL v3.0 or later (OSI-approved, no dual licensing) |
| Description | A free desktop entertainment hub for Windows and Mac: your games, films, series, anime, books, free games and deals in one app, with a Journal to track what you play, watch and read. Built with Electron. |
| What to sign | The Windows NSIS installer `Riftgate-Setup-<version>.exe`, one per release |
| Build system | GitHub Actions on GitHub-hosted Windows runners (`.github/workflows/release-windows.yml`), started by hand for each release |
| Team / roles | Raidex81: author, reviewer and approver (the project's only maintainer) |
| Third-party code | Electron, electron-updater and adm-zip from npm, unmodified; no proprietary components |
| Release history | Every version on GitHub Releases, with automatic updates on Windows |

## 3. After you're accepted

SignPath sets up an organisation and a project for Riftgate. In it:

1. **Trusted build system:** connect GitHub (SignPath's "GitHub.com"
   trusted build system) to the project, for the repository
   `Raidex81/riftgate`.
2. **Artifact configuration** (what to sign inside the artifact GitHub
   uploads, which is a zip holding the installer). SignPath may give you
   theirs; this is the shape:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Riftgate-Setup-*.exe" product-name="Riftgate">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

3. **Signing policy** slug: `release-signing` (with you as approver), and
   the project slug `riftgate`. Other names work too: put them in the
   repository variables `SIGNPATH_PROJECT_SLUG` and `SIGNPATH_POLICY_SLUG`.
4. In SignPath, create an **API token** for a CI user that may submit
   signing requests.
5. On GitHub, in the repository's Settings → Secrets and variables →
   Actions:
   - secret `SIGNPATH_API_TOKEN`: that token;
   - variable `SIGNPATH_ORGANIZATION_ID`: your organisation's ID from
     SignPath.

From the next release on, **Publish Windows Release** builds the
installer, sends it to SignPath and waits (up to 4 hours) for you to
approve the request on signpath.io. Then it puts the signed installer in
place, rebuilds `latest.yml` and the `.blockmap` so automatic updates
accept it (`scripts/refresh-update-files.js`), checks the signature and
uploads all three to the release.

Once the first signed release is out, update the "Windows first install"
notes in README.md, docs/index.html and `scripts/release-notes.js`, and
the first lines of docs/code-signing.html, which now say signing has been
applied for.

## Only the installer

The installer is what you download, so it's what Windows checks. The
program inside it (Riftgate.exe) stays unsigned for now; signing it too
would mean signing during the build, with an approval for every file.
