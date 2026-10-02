// --- macOS platform integration ---------------------------------------------
// Mac counterpart to windows.js — same exported interface (see
// platform/index.js), different mechanism per function since macOS has no
// registry, no Start Menu, no .lnk shortcuts, and no tasklist. Every
// function here maps to the closest real macOS equivalent:
//   Start Menu shortcuts      -> scanning /Applications + ~/Applications
//   tasklist                  -> `ps`
//   registry Uninstall keys   -> moving the .app bundle to the Trash
//   .exe FileDescription      -> the .app bundle's Info.plist
//   installer-process watch   -> polling /Applications for new .app bundles
//
// Epic Games has no macOS client at all, so scanStoreManifests() here only
// ever looks at Steam. Everything else (Battle.net, GOG Galaxy, Riot,
// standalone installs, ...) is picked up the same way it is on Windows —
// through the generic app sweep plus the shared SteamGridDB classification
// step in main.js, unchanged.
//
// IMPORTANT: this file has not been run on an actual Mac yet (this session
// has no Mac hardware). It's written against documented macOS/Node
// behavior and mirrors the Windows implementation's logic and edge cases
// as closely as that platform allows, but it needs real-world testing
// before being trusted the way the Windows side already is. See the "Mac
// test checklist" note for what to check first.

const { shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const platformName = "mac";

const APP_SKIP_WORDS = ["uninstall", "read me", "readme", "help", "website", "license", "support", "changelog", "documentation", "faq", "setup", "install"];

function extractVdfValue(content, key) {
    const match = content.match(new RegExp(`"${key}"\\s*"([^"]*)"`, "i"));
    return match ? match[1] : null;
}

// Steam on Mac always installs per-user under ~/Library/Application
// Support/Steam — there's no "Program Files (x86)" equivalent, so unlike
// Windows there's only ever one possible root to check. Extra library
// folders the user added themselves still show up the same way, via
// libraryfolders.vdf.
function findSteamLibraryPaths() {
    const steamRoot = path.join(os.homedir(), "Library", "Application Support", "Steam");
    if (!fs.existsSync(steamRoot)) return [];

    const libraryPaths = [path.join(steamRoot, "steamapps")];
    const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");

    try {
        if (fs.existsSync(vdfPath)) {
            const content = fs.readFileSync(vdfPath, "utf8");
            const pathMatches = content.matchAll(/"path"\s*"([^"]*)"/gi);

            for (const m of pathMatches) {
                const libPath = path.join(m[1], "steamapps");
                if (fs.existsSync(libPath) && !libraryPaths.includes(libPath)) {
                    libraryPaths.push(libPath);
                }
            }
        }
    } catch (err) {
        console.error("[import] failed to parse Steam libraryfolders.vdf:", err.message || err);
    }

    return libraryPaths;
}

function scanSteamGames() {
    const games = [];

    try {
        for (const steamapps of findSteamLibraryPaths()) {
            if (!fs.existsSync(steamapps)) continue;

            const manifestFiles = fs.readdirSync(steamapps)
                .filter((f) => /^appmanifest_\d+\.acf$/i.test(f));

            for (const file of manifestFiles) {
                try {
                    const content = fs.readFileSync(path.join(steamapps, file), "utf8");
                    const appid = extractVdfValue(content, "appid");
                    const name = extractVdfValue(content, "name");

                    if (appid && name) {
                        games.push({
                            name,
                            path: `steam://rungameid/${appid}`,
                            source: "Steam"
                        });
                    }
                } catch (err) {
                    // skip unreadable manifest, keep scanning the rest
                }
            }
        }
    } catch (err) {
        console.error("[import] Steam scan failed:", err.message || err);
    }

    return games;
}

function isSteamAppStillInstalled(appid) {
    try {
        for (const steamapps of findSteamLibraryPaths()) {
            if (fs.existsSync(path.join(steamapps, `appmanifest_${appid}.acf`))) {
                return true;
            }
        }
        return false;
    } catch (err) {
        return true;
    }
}

// Epic Games Store has never shipped a macOS client, so there's nothing to
// scan for it here — Steam is the only store Mac can identify from its own
// manifest files.
function scanStoreManifests() {
    return scanSteamGames();
}

function scanAppsDir(dir, depth, results) {
    if (depth > 2) return;

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        return; // permission-restricted or gone, skip
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.name.toLowerCase().endsWith(".app")) {
            const displayName = entry.name.replace(/\.app$/i, "");
            const nameLower = displayName.toLowerCase();
            if (APP_SKIP_WORDS.some((w) => nameLower.includes(w))) continue;
            results.push({ name: displayName, path: fullPath, source: "Detected" });
        } else {
            // Not an app bundle itself — a vendor subfolder some
            // installers create (e.g. /Applications/SomeCompany/), so
            // look one level deeper for the real .app inside it.
            scanAppsDir(fullPath, depth + 1, results);
        }
    }
}

// Mac equivalent of the Windows Start Menu shortcut sweep — /Applications
// and ~/Applications are where virtually every installed Mac app/game
// ends up as a .app bundle, the same way virtually every Windows installer
// creates a Start Menu shortcut. This is what covers Battle.net, GOG
// Galaxy, Riot, and anything else without its own manifest scanner.
function scanGenericApps() {
    return new Promise((resolve) => {
        const dirs = ["/Applications", path.join(os.homedir(), "Applications")];
        const results = [];

        for (const dir of dirs) {
            if (fs.existsSync(dir)) scanAppsDir(dir, 0, results);
        }

        const seen = new Set();
        const deduped = [];
        for (const item of results) {
            const key = item.path.toLowerCase() + "|" + item.name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
        }

        resolve(deduped);
    });
}

// No shortcut/.lnk concept on macOS — a dragged-in path is already the
// real thing.
function resolveShortcut(filePath) {
    return filePath;
}

// Reads CFBundleDisplayName (falling back to CFBundleName) from a .app
// bundle's Info.plist — the Mac equivalent of an .exe's FileDescription.
// `defaults read` handles both the old XML plist format and the modern
// binary one transparently, so there's no plist parsing to get wrong here.
function getExeDescription(exePath) {
    return new Promise((resolve) => {
        if (!exePath || !exePath.toLowerCase().endsWith(".app")) {
            resolve(null);
            return;
        }

        const infoPlistBase = path.join(exePath, "Contents", "Info");

        execFile("defaults", ["read", infoPlistBase, "CFBundleDisplayName"], { timeout: 5000 }, (error, stdout) => {
            const displayName = (stdout || "").trim();
            if (!error && displayName) {
                resolve(displayName);
                return;
            }

            execFile("defaults", ["read", infoPlistBase, "CFBundleName"], { timeout: 5000 }, (error2, stdout2) => {
                const name = (stdout2 || "").trim();
                resolve(name || null);
            });
        });
    });
}

// `ps` on macOS, parsed the same shape as Windows' tasklist output
// (getAllProcesses) — [{ name, pid }]. `comm` gives the full path to the
// running binary, so `name` is reduced to just its basename to match what
// getLaunchImageName hands back for a launched app.
function getAllProcesses() {
    return new Promise((resolve) => {
        execFile("ps", ["-axo", "pid=,comm="], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                resolve([]);
                return;
            }
            const processes = (stdout || "")
                .split("\n")
                .map((line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return null;
                    const firstSpace = trimmed.indexOf(" ");
                    if (firstSpace === -1) return null;
                    const pid = trimmed.slice(0, firstSpace);
                    const comm = trimmed.slice(firstSpace + 1).trim();
                    return { name: path.basename(comm), pid };
                })
                .filter(Boolean);
            resolve(processes);
        });
    });
}

// Used instead of watching the initially-spawned process directly, for the
// same reason as Windows: some launchers (Battle.net, Steam) spawn a
// short-lived bootstrapper before the real app takes over.
async function isProcessRunning(imageName) {
    const processes = await getAllProcesses();
    return processes.some((p) => p.name === imageName);
}

// The name a launched app will actually show up as in `ps` — for a .app
// bundle this is CFBundleExecutable (the binary inside Contents/MacOS/),
// which doesn't always match the bundle's display name (e.g. a client
// called "Riot Client.app" can run a differently-named internal binary).
// Falls back to the bundle name itself if the plist lookup fails.
function getLaunchImageName(exePath) {
    return new Promise((resolve) => {
        if (!exePath || !exePath.toLowerCase().endsWith(".app")) {
            resolve(path.basename(exePath));
            return;
        }

        const infoPlistBase = path.join(exePath, "Contents", "Info");

        execFile("defaults", ["read", infoPlistBase, "CFBundleExecutable"], { timeout: 5000 }, (error, stdout) => {
            const execName = (stdout || "").trim();
            resolve(execName || path.basename(exePath, ".app"));
        });
    });
}

// `open -a` is the correct, idiomatic way to launch a .app bundle on
// macOS — it respects Gatekeeper/translocation the way double-clicking in
// Finder does, unlike trying to exec the internal binary directly. A
// manually-added non-bundle executable (a script, a CLI tool) still gets
// exec'd directly, the same way Windows launches a plain .exe.
function spawnApp(exePath, onExit) {
    if (exePath && exePath.toLowerCase().endsWith(".app")) {
        execFile("open", ["-a", exePath], (error) => {
            if (error) console.error(error);
            if (onExit) onExit(error);
        });
    } else {
        execFile(exePath, (error) => {
            if (error) console.error(error);
            if (onExit) onExit(error);
        });
    }
}

// Detecting a freshly-installed app: most Mac installs are just a .app
// dragged into /Applications, with nothing running throughout. So this
// compares a snapshot of /Applications + ~/Applications with the previous
// one, shortly after launch and then once an hour (same schedule as
// Windows). The snapshot is saved next to games.json, so an app installed
// while Riftgate was closed is still noticed on the next launch. The very
// first run only records a baseline, so the user's existing collection
// isn't reported as "newly installed".
const APP_SNAPSHOT_FILE = "applications-snapshot.json";

async function checkForNewApps(getGamesFilePath, onDetected) {
    const gamesFile = getGamesFilePath();
    if (!gamesFile) return;
    const snapshotFile = path.join(path.dirname(gamesFile), APP_SNAPSHOT_FILE);

    const current = await scanGenericApps();
    const currentPaths = current.map((a) => a.path);

    let previous = null;
    try {
        const parsed = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
        if (Array.isArray(parsed)) previous = new Set(parsed);
    } catch (err) {
        previous = null;
    }
    try {
        fs.writeFileSync(snapshotFile, JSON.stringify(currentPaths));
    } catch (err) {
        console.error("[installer-detect] couldn't save app snapshot:", err.message || err);
    }
    if (previous === null) {
        console.log(`[installer-detect] First check: recorded ${currentPaths.length} app(s) as the baseline.`);
        return;
    }

    let existingPaths = new Set();
    try {
        const games = JSON.parse(fs.readFileSync(gamesFile, "utf8"));
        existingPaths = new Set(games.map((g) => (g.path || "").toLowerCase()));
    } catch (err) {
        // if this fails, just proceed without the extra check
    }

    const candidates = current
        .filter((a) => !previous.has(a.path) && !existingPaths.has(a.path.toLowerCase()))
        .map((a) => ({ path: a.path, name: a.name }));

    console.log(`[installer-detect] Checked ${currentPaths.length} app(s); ${candidates.length} new.`);
    if (candidates.length > 0) onDetected(candidates);
}

function startInstallWatcher(getGamesFilePath, onDetected) {
    const run = () => {
        checkForNewApps(getGamesFilePath, onDetected).catch((err) => {
            console.error("[installer-detect] check failed:", err.message || err);
        });
    };
    setTimeout(run, 20 * 1000);   // shortly after launch
    setInterval(run, 3600000);    // then once an hour
}

// Mac apps update in place inside the same .app bundle rather than the
// Squirrel-style versioned-folder scheme some Windows/Electron apps use,
// so there's no relocated-path case to recover here — a missing .app
// really is missing.
function findRelocatedApp(originalPath) {
    return null;
}

// No registry, no uninstaller string to look up — on macOS the app *is*
// its own uninstaller: removing it is just moving the .app bundle to the
// Trash (what Finder's own "Move to Trash" does), leaving it fully
// recoverable until the user empties the Trash themselves.
async function uninstallApp(gamePath, gameName) {
    if (!gamePath || !gamePath.toLowerCase().endsWith(".app")) {
        return {
            success: false,
            reason: "not_found",
            error: "This isn't a standard macOS app bundle, so Riftgate doesn't know how to uninstall it automatically. You can still remove it from Riftgate's list, or delete it yourself in Finder."
        };
    }

    try {
        await shell.trashItem(gamePath);
        return {
            success: true,
            displayName: gameName || path.basename(gamePath, ".app"),
            confidence: "high"
        };
    } catch (err) {
        return {
            success: false,
            reason: "error",
            error: "Couldn't move this app to the Trash: " + (err.message || err)
        };
    }
}

module.exports = {
    platformName,
    scanStoreManifests,
    scanGenericApps,
    isSteamAppStillInstalled,
    resolveShortcut,
    getExeDescription,
    isProcessRunning,
    getAllProcesses,
    getLaunchImageName,
    spawnApp,
    startInstallWatcher,
    findRelocatedApp,
    uninstallApp,
    _internal: {
        extractVdfValue,
        findSteamLibraryPaths,
        scanSteamGames
    }
};
