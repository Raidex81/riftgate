// Noticing games and apps you install or uninstall, while Riftgate runs.
// Process tracking and the freshly-installed-app watcher themselves live in
// services/platform/{windows,mac}.js (startInstallWatcher, scanStoreManifests).
// Both platforms compare snapshots once an hour: Desktop/Start Menu shortcut
// targets on Windows, /Applications on Mac. The watcher also reacts within
// seconds to shortcut / Steam library changes, and every check also looks for
// store installs (Steam, Epic manifests) and for library items that were
// uninstalled. Coming back to Riftgate looks again (at most every 10 min).
//
// Needs from the Library (given by main.js): findMissingGames().
"use strict";
const { app } = require("electron");
const platform = require("../services/platform");
const data = require("./core/data");
const settings = require("./core/settings");
const windowRef = require("./core/window");

function register({ findMissingGames }) {
    const gamesFile = () => data.file("games.json");

    function storeInstallCheck() {
        try {
            const snapFile = data.file("r2-store-snapshot.json");
            const found = platform.scanStoreManifests() || [];
            const before = data.readJson(snapFile, null);
            const previous = Array.isArray(before) ? new Set(before.map((p) => String(p).toLowerCase())) : null;
            data.writeJson(snapFile, found.map((g) => g.path));
            if (!previous) return; // first run: this is the baseline
            const library = data.readJson(gamesFile(), []);
            const inLibrary = new Set((Array.isArray(library) ? library : []).map((g) => String(g.path || "").toLowerCase()));
            const dismissed = new Set((settings.read().dismissedImports || []).map((p) => String(p).toLowerCase()));
            const fresh = found.filter((g) => g.path && !previous.has(g.path.toLowerCase()) && !inLibrary.has(g.path.toLowerCase()) && !dismissed.has(g.path.toLowerCase()))
                .map((g) => ({ name: g.name, path: g.path, source: g.source, category: "game" }));
            if (fresh.length) windowRef.send("new-install-detected", fresh);
        } catch (err) {
            console.error("[r2-install-detect]", err.message || err);
        }
    }

    let missingBusy = false;
    async function missingCheck() {
        if (missingBusy) return;
        missingBusy = true;
        try {
            const missing = await findMissingGames();
            if (missing.length) windowRef.send("r2-missing-detected", missing);
        } finally { missingBusy = false; }
    }

    const watcher = platform.startInstallWatcher(
        gamesFile,
        (candidates) => windowRef.send("new-install-detected", candidates),
        () => { storeInstallCheck(); missingCheck(); }
    );
    setTimeout(() => { storeInstallCheck(); missingCheck(); }, 25 * 1000);
    setInterval(() => { storeInstallCheck(); missingCheck(); }, 3600000);

    let lastFocusCheck = 0;
    app.on("browser-window-focus", () => {
        if (Date.now() - lastFocusCheck < 10 * 60 * 1000) return;
        lastFocusCheck = Date.now();
        if (watcher && watcher.checkNow) watcher.checkNow();
        storeInstallCheck(); missingCheck();
    });
}

module.exports = { register };
