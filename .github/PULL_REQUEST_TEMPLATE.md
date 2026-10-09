## What does this change?

<!-- A short description. Link the issue it fixes, e.g. "Fixes #12". -->

## How did you test it?

<!-- Which system(s) you ran it on with `npm start`, and what you checked. Screenshots welcome for anything visual. -->

- [ ] Tested on Windows
- [ ] Tested on Mac

## Checklist

- [ ] Network calls stay in the main process; any new IPC channel is in the `preload.js` allowlist and its handler validates its input
- [ ] Text from outside Riftgate is shown with `textContent`, not `innerHTML`
- [ ] No API keys, tokens or personal data are included
- [ ] I didn't change the version number or the changelog
- [ ] My contribution can be released under the project's license (GPL-3.0-or-later)
