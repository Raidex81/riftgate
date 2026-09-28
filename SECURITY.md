# Security Policy

## Supported versions

Only the [latest release](https://github.com/Raidex81/Riftgate/releases/latest)
receives security fixes. Windows installs update themselves; on a Mac,
download the newest version.

## Reporting a vulnerability

**Please don't open a public issue for security problems.** Report them
privately through GitHub instead:
[**Report a vulnerability**](https://github.com/Raidex81/Riftgate/security/advisories/new),
or by email to [riftgateappdev@zohomail.eu](mailto:riftgateappdev@zohomail.eu).

Please include what you found, how to reproduce it, and what an attacker
could do with it. You'll get a reply as soon as possible, and credit in
the release notes once it's fixed, if you'd like.

Areas where reports are especially useful: the IPC bridge between the UI
and main process (`preload.js`, `main.js`), anything that loads or opens
external content, the auto-updater, and the Supabase backend
(`supabase/`).
