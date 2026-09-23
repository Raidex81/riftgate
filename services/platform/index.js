// Single entry point for every OS-integration call in main.js. Picks the
// real implementation by process.platform once, at require time, so every
// caller just does `platform.scanGenericApps()` etc. without ever checking
// the OS itself.
//
// This is the seam that makes "change the Windows version, it changes the
// Mac version too" true for the rest of the app: everything outside this
// module — the UI, services/free-games.js, services/tmdb.js, ebook
// handling, settings, the whole renderer — is a single shared codebase
// with zero platform branching, and runs identically on both. Only the
// functions listed below differ per OS, and each one has an exact
// counterpart in windows.js and mac.js.
const impl = process.platform === "darwin" ? require("./mac") : require("./windows");

module.exports = impl;
