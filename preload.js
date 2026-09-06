// Riftgate preload script.
//
// This is the ONLY file that runs with Node/Electron access on the renderer
// side. It exposes a narrow, explicitly allow-listed API on `window.riftgate`
// via contextBridge, instead of handing the renderer raw `ipcRenderer` (which
// is what `nodeIntegration: true` / `contextIsolation: false` used to do).
//
// Why an allowlist and not just a passthrough: even with contextIsolation on,
// a passthrough `invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a)` would let
// any script running in the page (e.g. injected via a future XSS bug in
// third-party HTML/text we render from an API) call ANY ipcMain.handle
// channel, including ones never meant to be reachable from the UI. Checking
// every call against the exact set of channels renderer.js actually uses
// keeps that blast radius at zero.

const { contextBridge, ipcRenderer, clipboard } = require("electron");

// Renderer -> main, request/response. Every ipcRenderer.invoke(...) channel
// renderer.js calls.
const INVOKABLE_CHANNELS = new Set([
    "add-admin-reply",
    "add-ebook-to-library",
    "add-shared-link",
    "add-to-share-allowlist",
    "add-to-watchlist",
    "admin-account-exists",
    "apply-suggestion",
    "check-allowlist-only",
    "check-for-updates",
    "check-missing-ebooks",
    "check-missing-games",
    "check-username-available",
    "cleanup-expired-shared-files",
    "cleanup-expired-shared-links",
    "clear-login-session",
    "delete-reply",
    "delete-shared-file",
    "delete-shared-link",
    "delete-suggestion",
    "dismiss-import",
    "download-free-ebook",
    "download-shared-file",
    "export-suggestions-txt",
    "fetch-description",
    "fetch-online-cover",
    "fetch-trailer",
    "find-cover",
    "force-clean-shared-folder",
    "force-clean-shared-links",
    "force-stop-tracking",
    "get-admin-list-detailed",
    "get-all-usernames",
    "get-app-version",
    "get-cached-free-games",
    "get-cached-openlibrary-most-sold",
    "get-cached-openlibrary-new-releases",
    "get-cached-openlibrary-popular",
    "get-cached-popular-ebooks",
    "get-cached-recommended-ebooks",
    "get-cached-top-downloaded-ebooks",
    "get-device-id",
    "get-ebook-metadata",
    "get-ebooks",
    "get-exe-description",
    "get-free-games",
    "get-latest-episodes",
    "get-movie-trailer",
    "get-new-tv-shows",
    "get-now-playing-movies",
    "get-openlibrary-description",
    "get-openlibrary-most-sold",
    "get-openlibrary-new-releases",
    "get-openlibrary-popular",
    "get-override",
    "get-popular-ebooks",
    "get-recommended-ebooks",
    "get-share-allowlist",
    "get-shared-file-preview-url",
    "get-shared-files",
    "get-shared-links",
    "get-show-trailer",
    "get-suggestions",
    "get-top-downloaded-ebooks",
    "get-tv-show-trailer",
    "get-upcoming-games",
    "get-upcoming-movies",
    "get-watchlist",
    "launch-app",
    "launch-ebook",
    "load-games",
    "load-login-session",
    "load-settings",
    "login-needs-password-setup",
    "mark-ebook-opened",
    "open-description-diagnostic-log",
    "open-dropzone-folder",
    "open-external",
    "quit-and-install-update",
    "refresh-metadata",
    "register-username",
    "reject-suggestion",
    "remove-ebook",
    "remove-from-share-allowlist",
    "remove-from-watchlist",
    "remove-game",
    "resolve-shortcut",
    "save-ebook",
    "save-game",
    "save-login-session",
    "save-override",
    "save-settings",
    "scan-dropzone-folder",
    "scan-new-games",
    "search-gutenberg-books",
    "search-openlibrary-books",
    "search-tv-shows",
    "select-cover-image",
    "select-ebook-cover-image",
    "select-ebook-file",
    "select-exe",
    "send-ebook-to-device",
    "set-app-icon",
    "set-launch-at-startup",
    "set-own-login-password",
    "set-run-in-background",
    "start-update-download",
    "submit-suggestion",
    "super-add-admin",
    "super-remove-admin",
    "super-set-role",
    "super-trigger-password-reset",
    "toggle-ebook-favorite",
    "toggle-fullscreen",
    "update-ebook-cover",
    "update-game",
    "update-watchlist-item",
    "upload-shared-file",
    "verify-login",
    "window-close",
    "window-maximize-toggle",
    "window-minimize"
]);

// Main -> renderer, push events (autoupdater status, window state, etc.).
const LISTENABLE_CHANNELS = new Set([
    "app-exited",
    "dropzone-file-detected",
    "fullscreen-changed",
    "maximize-changed",
    "new-install-detected",
    "update-available",
    "update-download-progress",
    "update-downloaded",
    "update-error",
    "update-not-available"
]);

// Renderer -> main, fire-and-forget.
const SENDABLE_CHANNELS = new Set([
    "renderer-ready-for-updates"
]);

contextBridge.exposeInMainWorld("riftgate", {
    invoke: (channel, ...args) => {
        if (!INVOKABLE_CHANNELS.has(channel)) {
            throw new Error(`Blocked: "${channel}" is not an allowed invoke channel`);
        }
        return ipcRenderer.invoke(channel, ...args);
    },

    on: (channel, callback) => {
        if (!LISTENABLE_CHANNELS.has(channel)) {
            throw new Error(`Blocked: "${channel}" is not an allowed listen channel`);
        }
        // Strip the raw IpcRendererEvent before handing off — it's an
        // internal Electron object that isn't meant to cross the
        // context-isolation boundary, and renderer.js never used it anyway.
        const listener = (_event, ...args) => callback(...args);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },

    send: (channel, ...args) => {
        if (!SENDABLE_CHANNELS.has(channel)) {
            throw new Error(`Blocked: "${channel}" is not an allowed send channel`);
        }
        ipcRenderer.send(channel, ...args);
    },

    writeText: (text) => clipboard.writeText(text)
});
