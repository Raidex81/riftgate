const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// GAMES_FILE, COVERS_FOLDER and SETTINGS_FILE point into the user's writable
// AppData folder, not the app's own install directory (which is read-only
// once installed via the Windows installer). Assigned in initUserData().
let GAMES_FILE;
let COVERS_FOLDER;
let SETTINGS_FILE;
let OVERRIDES_FILE;
let WATCHLIST_FILE;
let FREEGAMES_SEEN_FILE;

let tray = null;
let runInBackgroundSetting = false;
let isQuitting = false;

const DEFAULT_SETTINGS = {
    uiSounds: true,
    startupSound: true,
    hoverTrailers: true,
    ambientBackground: true,
    lightTheme: false,
    colorTheme: "riftgate",
    lastSeenVersion: null,
    launchAtStartup: false,
    defaultCategory: "ask",
    confirmBeforeRemove: true,
    gridDensity: "comfortable",
    trailerVolume: 50,
    runInBackground: false,
    dismissedImports: [],
    categoryOrder: ["game", "app", "vr", "other"],
    movieCountry: "US",
    startupSection: "new",
    movieCity: "",
    startupAnimation: true
};

// Tracks currently-running launched processes so the UI can show
// "Running" instead of "Launch", and flips back when the process exits.
const runningProcesses = new Map();

// Real keys live in secrets.local.js, which is gitignored and never
// committed — see that file's comments for why. Falls back to the
// placeholder template if it's ever missing (e.g. a fresh clone from
// GitHub before the developer has set up their own secrets.local.js).
let secrets;
try {
    secrets = require("./secrets.local.js");
} catch (err) {
    secrets = require("./secrets.example.js");
}

// Get a free API key at https://www.steamgriddb.com/profile/preferences/api
// Without a key, online cover lookup is skipped and the app falls straight
// to the manual file picker.
const STEAMGRIDDB_API_KEY = secrets.STEAMGRIDDB_API_KEY;

// Get a free key at https://console.cloud.google.com/apis/credentials after
// enabling "YouTube Data API v3" for a project. Without a key, hovering a
// card just won't show a trailer (cover art stays put, no error).
const YOUTUBE_API_KEY = secrets.YOUTUBE_API_KEY;

// Get a free key at https://www.themoviedb.org/settings/api (just sign up,
// no payment info needed). Without a key, the "In Theaters" movies section
// just won't show any results.
const TMDB_API_KEY = secrets.TMDB_API_KEY;

function httpsGetJson(url, headers) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                file.close();
                fs.unlink(destPath, () => {});
                reject(new Error(`Failed to download image: ${res.statusCode}`));
                return;
            }
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
        }).on("error", (err) => {
            file.close();
            fs.unlink(destPath, () => {});
            reject(err);
        });
    });
}

function safeFileName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// --- Detecting installed games from Steam / Epic ---------------------------

// Extremely small VDF (Valve's key-value format) value extractor — good
// enough for the flat "key" "value" pairs used in libraryfolders.vdf and
// appmanifest_*.acf, without needing a full VDF parser dependency.
function extractVdfValue(content, key) {
    const match = content.match(new RegExp(`"${key}"\\s*"([^"]*)"`, "i"));
    return match ? match[1] : null;
}

function findSteamLibraryPaths() {
    const candidates = [
        "C:\\Program Files (x86)\\Steam",
        "C:\\Program Files\\Steam"
    ];

    const steamRoot = candidates.find((p) => fs.existsSync(p));
    if (!steamRoot) return [];

    const libraryPaths = [path.join(steamRoot, "steamapps")];

    const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");

    try {
        if (fs.existsSync(vdfPath)) {
            const content = fs.readFileSync(vdfPath, "utf8");
            const pathMatches = content.matchAll(/"path"\s*"([^"]*)"/gi);

            for (const m of pathMatches) {
                const libPath = path.join(m[1].replace(/\\\\/g, "\\"), "steamapps");
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

function scanEpicGames() {
    const games = [];
    const manifestDir = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

    try {
        if (!fs.existsSync(manifestDir)) return games;

        const itemFiles = fs.readdirSync(manifestDir)
            .filter((f) => f.toLowerCase().endsWith(".item"));

        for (const file of itemFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(manifestDir, file), "utf8"));

                if (data.DisplayName && data.InstallLocation && data.LaunchExecutable) {
                    const exePath = path.join(data.InstallLocation, data.LaunchExecutable);

                    if (fs.existsSync(exePath)) {
                        games.push({
                            name: data.DisplayName,
                            path: exePath,
                            source: "Epic Games"
                        });
                    }
                }
            } catch (err) {
                // skip unreadable/malformed manifest, keep scanning the rest
            }
        }
    } catch (err) {
        console.error("[import] Epic scan failed:", err.message || err);
    }

    return games;
}

ipcMain.handle("scan-new-games", async () => {

    try {
        const existingGames = fs.existsSync(GAMES_FILE)
            ? JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"))
            : [];

        const existingPaths = new Set(existingGames.map((g) => g.path));

        let dismissed = [];
        if (fs.existsSync(SETTINGS_FILE)) {
            const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
            dismissed = s.dismissedImports || [];
        }
        const dismissedSet = new Set(dismissed);

        const found = [...scanSteamGames(), ...scanEpicGames()];

        return found.filter((g) => !existingPaths.has(g.path) && !dismissedSet.has(g.path));

    } catch (err) {
        console.error("[import] scan-new-games failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("dismiss-import", async (event, gamePath) => {

    let current = { ...DEFAULT_SETTINGS };

    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
        } catch (err) {
            // fall back to defaults
        }
    }

    const dismissedImports = current.dismissedImports || [];

    if (!dismissedImports.includes(gamePath)) {
        dismissedImports.push(gamePath);
    }

    const updated = { ...current, dismissedImports };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));

    return true;
});

// Cover/trailer overrides are keyed by normalized name and stored separate
// from games.json, so a manual correction survives removing and later
// re-adding the same game (e.g. after uninstalling and reinstalling it).
function normalizeOverrideName(name) {
    return name.toLowerCase().trim();
}

function readOverrides() {
    try {
        return JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

ipcMain.handle("get-override", async (event, name) => {
    const overrides = readOverrides();
    return overrides[normalizeOverrideName(name)] || null;
});

ipcMain.handle("save-override", async (event, { name, image, trailerId }) => {
    const overrides = readOverrides();
    const key = normalizeOverrideName(name);

    overrides[key] = { ...(overrides[key] || {}) };
    if (image !== undefined) overrides[key].image = image;
    if (trailerId !== undefined) overrides[key].trailerId = trailerId;

    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
    return true;
});

// Resolves short names/abbreviations (e.g. "bf6") to a game's full official
// title (e.g. "Battlefield 6") using SteamGridDB's fuzzy game search.
async function resolveCanonicalName(gameName) {

    if (!STEAMGRIDDB_API_KEY || STEAMGRIDDB_API_KEY === "PUT_YOUR_STEAMGRIDDB_API_KEY_HERE") {
        return null;
    }

    try {
        for (const variant of generateNameVariants(gameName)) {
            const match = await searchSteamGridDb(variant);
            if (match) return match.name || null;
        }
        return null;

    } catch (err) {
        return null;
    }
}

async function getWikipediaSummary(title) {

    try {
        const encodedTitle = encodeURIComponent(title.trim());
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;

        const summary = await httpsGetJson(url, {
            "User-Agent": "GameLauncherApp/1.0 (personal desktop app)"
        });

        if (!summary || summary.type === "disambiguation" || !summary.extract) {
            return null;
        }

        // Full text is kept (no hard cutoff here) so the hover popup can
        // show the complete description — the card itself only shows a
        // few lines via CSS line-clamp, this doesn't need its own limit.
        return summary.extract.trim();

    } catch (err) {
        return null;
    }
}

let win;

const MIME_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
};

// Electron's default file:// loading breaks YouTube embeds (their player
// rejects the origin, producing error 153). Serving the app over a local
// http:// server instead gives the page a real origin YouTube accepts.
//
// Cover images are served from the writable COVERS_FOLDER (AppData), since
// new covers get downloaded/saved there at runtime. Everything else (html,
// js, css) is served from the app's own bundled, read-only install folder.
function startLocalServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {

            let urlPath = decodeURIComponent(req.url.split("?")[0]);

            if (urlPath === "/") {
                urlPath = "/index.html";
            }

            let filePath;

            if (urlPath.startsWith("/covers/")) {
                filePath = path.join(COVERS_FOLDER, urlPath.replace("/covers/", ""));
            } else {
                filePath = path.join(__dirname, urlPath);
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }

                const ext = path.extname(filePath).toLowerCase();

                res.writeHead(200, {
                    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
                });

                res.end(data);
            });
        });

        server.listen(0, "127.0.0.1", () => {
            resolve(server.address().port);
        });
    });
}

// Sets up (or reuses) a writable data folder in the OS's per-user AppData
// area. This is what makes the installed app work: Program Files is
// read-only for a normal user, so games.json and downloaded covers can't
// live there. A brand-new install starts with an empty library, which is
// exactly what the intro screen is for.
function initUserData() {

    const userDataDir = app.getPath("userData");

    GAMES_FILE = path.join(userDataDir, "games.json");
    COVERS_FOLDER = path.join(userDataDir, "covers");
    SETTINGS_FILE = path.join(userDataDir, "settings.json");
    OVERRIDES_FILE = path.join(userDataDir, "overrides.json");
    WATCHLIST_FILE = path.join(userDataDir, "watchlist.json");
    FREEGAMES_SEEN_FILE = path.join(userDataDir, "freegames-seen.json");

    if (!fs.existsSync(COVERS_FOLDER)) {
        fs.mkdirSync(COVERS_FOLDER, { recursive: true });
    }

    // Seed the placeholder cover once, copied from the app's bundled assets
    const seedDefault = path.join(__dirname, "covers", "default.jpg");
    const userDefault = path.join(COVERS_FOLDER, "default.jpg");

    if (!fs.existsSync(userDefault) && fs.existsSync(seedDefault)) {
        fs.copyFileSync(seedDefault, userDefault);
    }

    if (!fs.existsSync(GAMES_FILE)) {
        fs.writeFileSync(GAMES_FILE, "[]");
    }

    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    }

    if (!fs.existsSync(OVERRIDES_FILE)) {
        fs.writeFileSync(OVERRIDES_FILE, "{}");
    }

    if (!fs.existsSync(WATCHLIST_FILE)) {
        fs.writeFileSync(WATCHLIST_FILE, "[]");
    }

    if (!fs.existsSync(FREEGAMES_SEEN_FILE)) {
        fs.writeFileSync(FREEGAMES_SEEN_FILE, "{}");
    }
}

async function createWindow() {

    initUserData();

    // Keep the OS's own startup-item setting in sync with what the user
    // last chose in the sidebar, in case it drifted (e.g. removed via
    // Windows' own Startup Apps settings).
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
            app.setLoginItemSettings({ openAtLogin: !!savedSettings.launchAtStartup });
        }
    } catch (err) {
        console.error("[startup] failed to sync launch-at-startup setting:", err.message || err);
    }

    const port = await startLocalServer();

    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: "Riftgate",
        autoHideMenuBar: true,
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadURL(`http://127.0.0.1:${port}`);

    win.on("enter-full-screen", () => {
        win.webContents.send("fullscreen-changed", true);
    });

    win.on("leave-full-screen", () => {
        win.webContents.send("fullscreen-changed", false);
    });

    win.on("maximize", () => {
        win.webContents.send("maximize-changed", true);
    });

    win.on("unmaximize", () => {
        win.webContents.send("maximize-changed", false);
    });

    win.on("close", (event) => {
        if (!runInBackgroundSetting || isQuitting) {
            return;
        }

        event.preventDefault();

        const choice = dialog.showMessageBoxSync(win, {
            type: "question",
            buttons: ["Minimize to Background", "Close Completely", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            title: "Close Riftgate",
            message: "Keep Riftgate running in the background, or close it completely?"
        });

        if (choice === 0) {
            win.hide();
        } else if (choice === 1) {
            isQuitting = true;
            app.quit();
        }
        // choice === 2 (Cancel): do nothing, stay open
    });

    // The tray icon is always present while Riftgate is running, so there's
    // always a right-click way to quit — regardless of the "run in
    // background" setting, which only controls what closing the window does.
    createTray();

    // Apply the saved "run in background" preference at startup
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
            runInBackgroundSetting = !!savedSettings.runInBackground;
        }
    } catch (err) {
        console.error("[startup] failed to apply run-in-background setting:", err.message || err);
    }
}

function createTray() {
    if (tray) return;

    tray = new Tray(path.join(__dirname, "build", "icon.ico"));
    tray.setToolTip("Riftgate");

    const menu = Menu.buildFromTemplate([
        { label: "Show Riftgate", click: () => { win.show(); } },
        { type: "separator" },
        { label: "Quit", click: () => { isQuitting = true; app.quit(); } }
    ]);

    tray.setContextMenu(menu);
    tray.on("click", () => win.show());
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

ipcMain.handle("set-run-in-background", async (event, enabled) => {
    // The tray icon itself always stays — this setting only controls
    // whether closing the window asks to minimize vs. quit outright.
    runInBackgroundSetting = enabled;
    return true;
});

// Recolors the running app's icon (taskbar, title bar, alt-tab) to match
// the chosen theme. This can only change the icon WHILE the app is
// running — the static .exe file's own icon (what you see in Explorer
// before launching it) is baked into the binary at build time and can't
// be rewritten by the app itself.
ipcMain.handle("set-app-icon", async (event, themeName) => {
    try {
        const iconPath = path.join(__dirname, "build", "icons", `${themeName}.ico`);
        if (fs.existsSync(iconPath) && win && !win.isDestroyed()) {
            win.setIcon(iconPath);
            if (tray) tray.setImage(iconPath);
        }
        return true;
    } catch (err) {
        console.error("[icon] failed to set theme icon:", err.message || err);
        return false;
    }
});

ipcMain.handle("toggle-fullscreen", async () => {
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
});

// Frameless windows have no OS-drawn title bar, so these back a custom
// one built in the UI (minimize/maximize/close buttons + a drag region).
ipcMain.handle("window-minimize", async () => {
    win.minimize();
});

ipcMain.handle("window-maximize-toggle", async () => {
    if (win.isMaximized()) {
        win.unmaximize();
    } else {
        win.maximize();
    }
    return win.isMaximized();
});

ipcMain.handle("window-close", async () => {
    win.close();
});

ipcMain.handle("get-app-version", async () => {
    return app.getVersion();
});

ipcMain.handle("set-launch-at-startup", async (event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return true;
});

ipcMain.handle("open-external", async (event, url) => {
    shell.openExternal(url);
    return true;
});

// Resolves a Windows .lnk shortcut to its real target executable, so a
// shortcut dragged in from the desktop/Start Menu works the same as
// dragging the actual .exe. Non-shortcut paths pass through unchanged.
ipcMain.handle("resolve-shortcut", async (event, filePath) => {
    if (!filePath.toLowerCase().endsWith(".lnk")) {
        return filePath;
    }

    try {
        const shortcut = shell.readShortcutLink(filePath);
        return shortcut.target || filePath;
    } catch (err) {
        console.error("[shortcut] failed to resolve .lnk:", err.message || err);
        return filePath;
    }
});

// --- TV show tracking (TVMaze — free, public, no API key/login needed) ---
// This only reads air-date metadata, never anything related to downloading
// or streaming episodes.

function httpsGetJsonPlain(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "RiftgateApp/1.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);

        // Without this, one hanging request (rate-limited API, dead
        // endpoint, etc.) can stall an entire feature indefinitely with no
        // fallback ever kicking in.
        req.setTimeout(timeoutMs || 8000, () => {
            req.destroy(new Error("Request timed out"));
        });
    });
}

ipcMain.handle("search-tv-shows", async (event, query) => {
    try {
        const results = await httpsGetJsonPlain(
            `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`
        );

        return results.slice(0, 10).map((r) => ({
            id: r.show.id,
            name: r.show.name,
            image: r.show.image ? r.show.image.medium : null,
            premiered: r.show.premiered
        }));
    } catch (err) {
        console.error("[tv] search failed:", err.message || err);
        return [];
    }
});

function readWatchlist() {
    try {
        return JSON.parse(fs.readFileSync(WATCHLIST_FILE, "utf8"));
    } catch (err) {
        return [];
    }
}

function writeWatchlist(list) {
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2));
}

ipcMain.handle("get-watchlist", async () => {
    return readWatchlist();
});

ipcMain.handle("add-to-watchlist", async (event, show) => {
    const list = readWatchlist();

    if (!list.some((s) => s.id === show.id)) {
        list.push({ ...show, addedAt: Date.now(), lastSeenAirstamp: null });
        writeWatchlist(list);
    }

    return list;
});

ipcMain.handle("remove-from-watchlist", async (event, showId) => {
    const list = readWatchlist().filter((s) => s.id !== showId);
    writeWatchlist(list);
    return list;
});

ipcMain.handle("update-watchlist-item", async (event, { id, description, trailerId }) => {
    const list = readWatchlist();
    const show = list.find((s) => s.id === id);

    if (show) {
        if (description !== undefined) show.description = description;
        if (trailerId !== undefined) show.trailerId = trailerId;
        writeWatchlist(list);
    }

    return list;
});

// Checks every watched show for episodes that aired recently (last 14
// days) and haven't been shown before, without needing to track "new" vs
// "already seen" per-episode manually — the newest aired airstamp per show
// is remembered, so only genuinely new episodes surface next time.
ipcMain.handle("check-new-episodes", async () => {
    const list = readWatchlist();
    const recentlyReleased = [];
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;

    for (const show of list) {
        try {
            const episodes = await httpsGetJsonPlain(
                `https://api.tvmaze.com/shows/${show.id}/episodes`
            );

            const aired = episodes.filter((ep) => {
                if (!ep.airstamp) return false;
                const airedTime = new Date(ep.airstamp).getTime();
                return airedTime <= Date.now() && airedTime >= cutoff;
            });

            const lastSeen = show.lastSeenAirstamp
                ? new Date(show.lastSeenAirstamp).getTime()
                : 0;

            const newOnes = aired.filter(
                (ep) => new Date(ep.airstamp).getTime() > lastSeen
            );

            if (newOnes.length > 0) {
                const latest = newOnes.reduce((a, b) =>
                    new Date(a.airstamp) > new Date(b.airstamp) ? a : b
                );

                recentlyReleased.push({
                    showId: show.id,
                    showName: show.name,
                    showImage: show.image,
                    season: latest.season,
                    number: latest.number,
                    episodeName: latest.name,
                    airdate: latest.airdate
                });

                show.lastSeenAirstamp = latest.airstamp;
            }
        } catch (err) {
            console.error(`[tv] episode check failed for "${show.name}":`, err.message || err);
        }
    }

    writeWatchlist(list);

    return recentlyReleased;
});

// Shows the latest AIRED episode for every tracked show — a persistent
// status view, not a one-time "new since last visit" notification like
// check-new-episodes above.
ipcMain.handle("get-latest-episodes", async () => {
    const list = readWatchlist();
    const latest = [];

    for (const show of list) {
        try {
            const episodes = await httpsGetJsonPlain(
                `https://api.tvmaze.com/shows/${show.id}/episodes`
            );

            const aired = episodes.filter(
                (ep) => ep.airstamp && new Date(ep.airstamp).getTime() <= Date.now()
            );

            if (aired.length === 0) continue;

            const latestEp = aired.reduce((a, b) =>
                new Date(a.airstamp) > new Date(b.airstamp) ? a : b
            );

            latest.push({
                showId: show.id,
                showName: show.name,
                showImage: show.image,
                season: latestEp.season,
                number: latestEp.number,
                episodeName: latestEp.name,
                airdate: latestEp.airdate
            });
        } catch (err) {
            console.error(`[tv] latest episode fetch failed for "${show.name}":`, err.message || err);
        }
    }

    latest.sort((a, b) => new Date(b.airdate) - new Date(a.airdate));

    return latest;
});

// Reads the embedded FileDescription from an .exe's Windows version info
// (e.g. chrome.exe's real description is "Google Chrome", not "Chrome") —
// this is what fixes wrong covers/descriptions/trailers caused by using
// just the filename.
ipcMain.handle("get-exe-description", async (event, exePath) => {
    return new Promise((resolve) => {
        const escapedPath = exePath.replace(/'/g, "''");
        const psCommand = `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.FileDescription`;

        execFile(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psCommand],
            { timeout: 5000 },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const desc = stdout.trim();
                resolve(desc || null);
            }
        );
    });
});

// MyMemory is a free, public, keyless translation API — used only for
// translating dynamic content (descriptions pulled from external sources),
// since Riftgate's own UI text is translated from the static dictionary
// in renderer.js instead.
// Epic's own public promotions endpoint — the same one their launcher and
// many community tools use to show the current free games.
async function fetchEpicFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
        );

        const elements = data.data.Catalog.searchStore.elements || [];

        return elements
            .filter((el) => {
                const offers = el.promotions && el.promotions.promotionalOffers;
                return offers && offers.length > 0;
            })
            .map((el) => {
                const image = (el.keyImages || []).find(
                    (img) => img.type === "OfferImageWide" || img.type === "Thumbnail"
                );

                return {
                    id: `epic-${el.id}`,
                    name: el.title,
                    description: el.description || null,
                    image: image ? image.url : null,
                    url: `https://store.epicgames.com/en-US/p/${(el.productSlug || el.urlSlug || "").replace(/\/home$/, "")}`,
                    source: "Epic Games",
                    tags: (el.tags || []).map((t) => t.name).filter(Boolean)
                };
            });
    } catch (err) {
        console.error("[free-games] Epic fetch failed:", err.message || err);
        return [];
    }
}

// SteamSpy aggregates public Steam catalog data specifically for bulk
// tag-based queries like this — unlike Steam's own storesearch (which is a
// search-box autocomplete API, not a catalog browser, and only ever
// returned a handful of results for an empty search term).
async function fetchSteamFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://steamspy.com/api.php?request=tag&tag=Free+to+Play", 10000
        );

        const entries = Object.values(data || {}).filter((item) => item.name);

        // SteamSpy's "Free to Play" tag can include games that AREN'T
        // actually priced at $0 right now (community tagging drifts, or the
        // tag reflects a base game that has paid DLC) — cross-check against
        // SteamSpy's own live price field so "free" is actually accurate.
        const genuinelyFree = entries.filter((item) => {
            const price = parseInt(item.price, 10);
            return !isNaN(price) && price === 0;
        });

        console.log(`[free-games] SteamSpy: ${entries.length} tagged free, ${genuinelyFree.length} confirmed $0 right now.`);

        return genuinelyFree.map((item) => ({
            id: `steam-${item.appid}`,
            name: item.name,
            description: null,
            image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
            url: `https://store.steampowered.com/app/${item.appid}`,
            source: "Steam",
            // No genre data available for Steam entries anymore (removed
            // along with the genre cross-referencing) — leave tags empty so
            // the category filter falls back to the store name ("Steam")
            // instead of the confusing, non-genre label "Free to Play".
            tags: []
        }));
    } catch (err) {
        console.error("[free-games] SteamSpy fetch failed:", err.message || err);
        return [];
    }
}

function readFreeGamesSeenCache() {
    try {
        return JSON.parse(fs.readFileSync(FREEGAMES_SEEN_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

ipcMain.handle("get-free-games", async () => {
    // allSettled instead of all — one store's fetch failing outright must
    // never take the other down with it.
    const results = await Promise.allSettled([
        fetchEpicFreeGames(),
        fetchSteamFreeGames()
    ]);

    results.forEach((r, i) => {
        if (r.status === "rejected") {
            const storeName = ["Epic", "Steam"][i];
            console.error(`[free-games] ${storeName} fetch rejected entirely:`, r.reason);
        }
    });

    const [epicGames, steamGames] = results.map((r) =>
        r.status === "fulfilled" ? r.value : []
    );

    const allFree = [...epicGames, ...steamGames];

    // Track when Riftgate first saw each one, so the "Newly Added" row can
    // show items discovered within the last 7 days, regardless of the
    // store's own promotion dates.
    const seenCache = readFreeGamesSeenCache();
    const now = Date.now();

    allFree.forEach((game) => {
        if (!seenCache[game.id]) {
            seenCache[game.id] = now;
        }
        game.firstSeenAt = seenCache[game.id];
    });

    fs.writeFileSync(FREEGAMES_SEEN_FILE, JSON.stringify(seenCache, null, 2));

    return allFree;
});

// --- Movies currently in theaters (TMDB — free public movie database) ---

ipcMain.handle("get-now-playing-movies", async (event, countryCode) => {

    if (!TMDB_API_KEY || TMDB_API_KEY === "PUT_YOUR_TMDB_API_KEY_HERE") {
        console.log("[movies] No TMDB API key set, skipping.");
        return [];
    }

    try {
        const url =
            `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}` +
            `&region=${encodeURIComponent(countryCode)}&language=en-US&page=1`;

        const data = await httpsGetJsonPlain(url);

        return (data.results || []).map((m) => ({
            id: m.id,
            title: m.title,
            description: m.overview,
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
            releaseDate: m.release_date
        }));
    } catch (err) {
        console.error("[movies] now_playing fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-movie-trailer", async (event, movieId) => {

    if (!TMDB_API_KEY || TMDB_API_KEY === "PUT_YOUR_TMDB_API_KEY_HERE") {
        return null;
    }

    try {
        const url = `https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${TMDB_API_KEY}`;
        const data = await httpsGetJsonPlain(url);

        const trailer = (data.results || []).find(
            (v) => v.site === "YouTube" && v.type === "Trailer"
        );

        return trailer ? trailer.key : null;
    } catch (err) {
        console.error("[movies] trailer fetch failed:", err.message || err);
        return null;
    }
});

// --- "NEW" section: upcoming movies, new TV shows, upcoming games ---------

ipcMain.handle("get-upcoming-movies", async (event, countryCode) => {
    if (!TMDB_API_KEY || TMDB_API_KEY === "PUT_YOUR_TMDB_API_KEY_HERE") {
        return [];
    }

    try {
        const url =
            `https://api.themoviedb.org/3/movie/upcoming?api_key=${TMDB_API_KEY}` +
            `&region=${encodeURIComponent(countryCode)}&language=en-US&page=1`;

        const data = await httpsGetJsonPlain(url);

        return (data.results || []).map((m) => ({
            id: m.id,
            title: m.title,
            description: m.overview,
            poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
            releaseDate: m.release_date
        }));
    } catch (err) {
        console.error("[new] upcoming movies fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-new-tv-shows", async () => {
    if (!TMDB_API_KEY || TMDB_API_KEY === "PUT_YOUR_TMDB_API_KEY_HERE") {
        return [];
    }

    try {
        const url =
            `https://api.themoviedb.org/3/discover/tv?api_key=${TMDB_API_KEY}` +
            `&sort_by=first_air_date.desc&air_date.lte=${new Date().toISOString().slice(0, 10)}` +
            `&vote_count.gte=5&language=en-US&page=1`;

        const data = await httpsGetJsonPlain(url);

        return (data.results || []).map((s) => ({
            id: s.id,
            name: s.name,
            description: s.overview,
            image: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null,
            firstAirDate: s.first_air_date
        }));
    } catch (err) {
        console.error("[new] new TV shows fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-tv-show-trailer", async (event, tmdbId) => {
    if (!TMDB_API_KEY || TMDB_API_KEY === "PUT_YOUR_TMDB_API_KEY_HERE") {
        return null;
    }

    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}/videos?api_key=${TMDB_API_KEY}`;
        const data = await httpsGetJsonPlain(url);

        const trailer = (data.results || []).find(
            (v) => v.site === "YouTube" && v.type === "Trailer"
        );

        return trailer ? trailer.key : null;
    } catch (err) {
        console.error("[new] TV trailer fetch failed:", err.message || err);
        return null;
    }
});

// Steam's own "featuredcategories" endpoint genuinely includes a
// "coming_soon" bucket — unlike storesearch, this one is meant for
// browsing, not text search, so it actually works for this.
ipcMain.handle("get-upcoming-games", async () => {
    try {
        const data = await httpsGetJsonPlain(
            "https://store.steampowered.com/api/featuredcategories/?cc=us&l=en"
        );

        const comingSoon = (data.coming_soon && data.coming_soon.items) || [];

        return comingSoon.map((item) => ({
            id: `steam-${item.id}`,
            name: item.name,
            image: item.header_image || null,
            url: `https://store.steampowered.com/app/${item.id}`,
            releaseDate: item.release_date || null
        }));
    } catch (err) {
        console.error("[new] upcoming games fetch failed:", err.message || err);
        return [];
    }
});

// Tries common mod-folder naming conventions relative to a game's install
// directory. Covers the most frequent patterns without needing per-game
// knowledge; returns the first real match, or null if nothing was found.
ipcMain.handle("find-mods-folder", async (event, exePath) => {

    const exeDir = path.dirname(exePath);

    const candidates = [
        path.join(exeDir, "Mods"),
        path.join(exeDir, "mods"),
        path.join(exeDir, "Data", "Mods"),
        path.join(exeDir, "..", "Mods"),
        path.join(exeDir, "..", "mods"),
        path.join(exeDir, "..", "..", "Mods"),
        path.join(exeDir, "..", "..", "mods")
    ];

    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (err) {
            // ignore and keep checking other candidates
        }
    }

    return null;
});

ipcMain.handle("select-mods-folder", async (event, exePath) => {

    const result = await dialog.showOpenDialog(win, {
        title: "Choose (or create) the mods folder for this game",
        defaultPath: path.dirname(exePath),
        properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    return result.filePaths[0];
});

ipcMain.handle("open-mods-folder", async (event, folderPath) => {
    shell.openPath(folderPath);
    return true;
});

ipcMain.handle("select-exe", async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [
            { name: "Applications", extensions: ["exe"] }
        ]
    });

    if (result.canceled) return null;

    return result.filePaths[0];
});

// Checks whether any process with the given image name (e.g. "BF6.exe")
// is currently running, using Windows' tasklist. Used instead of watching
// the initially-spawned process directly, since many games/launchers spawn
// a short-lived bootstrapper that exits immediately while the real app
// keeps running (Steam, Battle.net, and anti-cheat wrappers all do this).
function isProcessRunning(imageName) {
    return new Promise((resolve) => {
        execFile(
            "tasklist",
            ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
            (error, stdout) => {
                if (error) {
                    resolve(false);
                    return;
                }
                resolve(stdout.toLowerCase().includes(imageName.toLowerCase()));
            }
        );
    });
}

ipcMain.handle("launch-app", async (event, exePath) => {

    if (runningProcesses.has(exePath)) {
        return { started: true, alreadyRunning: true, launches: null };
    }

    // Steam-imported entries use a steam:// protocol URI rather than a real
    // file path (Steam manifests don't reliably expose the actual game exe).
    // Those need shell.openExternal, and there's no sensible image name to
    // poll for "Running" state, so we skip that tracking for these.
    const isProtocolLaunch = exePath.includes("://");
    const startTime = Date.now();

    if (isProtocolLaunch) {
        shell.openExternal(exePath);
    } else {

        const imageName = path.basename(exePath);

        execFile(exePath, (error) => {
            if (error) {
                console.error(error);
            }
        });

        runningProcesses.set(exePath, { startTime });

        // Give the process a moment to actually appear in the process list
        // before we start polling, and require a few consecutive "not found"
        // results before declaring it exited — avoids a false "stopped" blip
        // right at startup or from a single missed poll.
        let missCount = 0;

        setTimeout(() => {

            const pollInterval = setInterval(async () => {

                if (!runningProcesses.has(exePath)) {
                    clearInterval(pollInterval);
                    return;
                }

                const stillRunning = await isProcessRunning(imageName);

                if (stillRunning) {
                    missCount = 0;
                    return;
                }

                missCount++;

                if (missCount >= 2) {
                    clearInterval(pollInterval);
                    runningProcesses.delete(exePath);

                    const sessionSeconds = Math.round((Date.now() - startTime) / 1000);
                    let totalPlaytimeSeconds = null;

                    try {
                        if (fs.existsSync(GAMES_FILE)) {
                            const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
                            const g = games.find((game) => game.path === exePath);

                            if (g) {
                                g.playtimeSeconds = (g.playtimeSeconds || 0) + sessionSeconds;
                                totalPlaytimeSeconds = g.playtimeSeconds;
                                fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));
                            }
                        }
                    } catch (err) {
                        console.error("[launch] failed to update playtime:", err.message || err);
                    }

                    if (win && !win.isDestroyed()) {
                        win.webContents.send("app-exited", { path: exePath, playtimeSeconds: totalPlaytimeSeconds });
                    }
                }

            }, 3000);

        }, 2500);
    }

    // Bump the launch counter and lastPlayed timestamp (best-effort, doesn't
    // block the launch itself)
    let newCount = null;

    try {
        if (fs.existsSync(GAMES_FILE)) {
            const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
            const g = games.find((game) => game.path === exePath);

            if (g) {
                g.launches = (g.launches || 0) + 1;
                g.lastPlayed = startTime;
                newCount = g.launches;
                fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));
            }
        }
    } catch (err) {
        console.error("[launch] failed to update launch count:", err.message || err);
    }

    return { started: true, alreadyRunning: false, launches: newCount };
});

ipcMain.handle("find-cover", async (event, gameName) => {

    if (!fs.existsSync(COVERS_FOLDER)) {
        return "covers/default.jpg";
    }

    const files = fs.readdirSync(COVERS_FOLDER);

    const normalizedName =
        gameName
            .toLowerCase()
            .replace(".exe", "")
            .trim();

    for (const file of files) {

        const fileName =
            path.parse(file)
                .name
                .toLowerCase();

        if (fileName === normalizedName) {
            return `covers/${file}`;
        }
    }

    return "covers/default.jpg";
});

// Builds a handful of alternative search terms to try when the exact name
// doesn't turn up anything — strips trailing edition/version markers, tries
// just the first word (often the franchise name), and a plain acronym.
function generateNameVariants(name) {
    const variants = [name];

    const stripped = name
        .replace(/\s+(\d+|[IVXLCDM]{2,}|HD|Remastered|Remake|Definitive Edition|Deluxe Edition|Game of the Year Edition|GOTY|Enhanced Edition)\s*$/i, "")
        .trim();

    if (stripped && stripped !== name) variants.push(stripped);

    const words = name.split(/\s+/).filter(Boolean);

    if (words.length > 1) {
        variants.push(words[0]);

        const acronym = words.map((w) => w[0]).join("").toUpperCase();
        if (acronym.length >= 2) variants.push(acronym);
    }

    return [...new Set(variants)];
}

async function searchSteamGridDb(term) {
    const searchUrl =
        `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(term)}`;

    const searchResult = await httpsGetJson(searchUrl, {
        Authorization: `Bearer ${STEAMGRIDDB_API_KEY}`
    });

    if (!searchResult.success || !searchResult.data || searchResult.data.length === 0) {
        return null;
    }

    return searchResult.data[0];
}

ipcMain.handle("fetch-online-cover", async (event, gameName) => {

    console.log(`[cover] Looking up "${gameName}" on SteamGridDB...`);

    if (!STEAMGRIDDB_API_KEY || STEAMGRIDDB_API_KEY === "PUT_YOUR_STEAMGRIDDB_API_KEY_HERE") {
        console.log("[cover] No API key set, skipping online lookup.");
        return null;
    }

    try {
        const variants = generateNameVariants(gameName);
        let match = null;

        for (const variant of variants) {
            console.log(`[cover] Trying "${variant}"...`);
            match = await searchSteamGridDb(variant);
            if (match) {
                console.log(`[cover] Match found via "${variant}": ${match.name} (id ${match.id})`);
                break;
            }
        }

        if (!match) {
            console.log(`[cover] No search results for "${gameName}" after trying: ${variants.join(", ")}`);
            return null;
        }

        const gameId = match.id;

        const gridsUrl =
            `https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900`;

        const gridsResult = await httpsGetJson(gridsUrl, {
            Authorization: `Bearer ${STEAMGRIDDB_API_KEY}`
        });

        if (!gridsResult.success || !gridsResult.data || gridsResult.data.length === 0) {
            console.log(`[cover] No grid images found for game id ${gameId}.`);
            return null;
        }

        const imageUrl = gridsResult.data[0].url;
        console.log(`[cover] Downloading: ${imageUrl}`);
        const ext = path.extname(imageUrl).split("?")[0] || ".jpg";

        if (!fs.existsSync(COVERS_FOLDER)) {
            fs.mkdirSync(COVERS_FOLDER);
        }

        const fileName = `${safeFileName(gameName)}${ext}`;
        const destPath = path.join(COVERS_FOLDER, fileName);

        await downloadImage(imageUrl, destPath);

        console.log(`[cover] Saved to ${destPath}`);

        return `covers/${fileName}`;

    } catch (err) {
        console.error("[cover] fetch-online-cover failed:", err.message || err);
        return null;
    }
});

ipcMain.handle("select-cover-image", async (event, gameName) => {

    const result = await dialog.showOpenDialog(win, {
        title: "Choose a cover image",
        properties: ["openFile"],
        filters: [
            { name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }
        ]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }

    const chosenPath = result.filePaths[0];
    const ext = path.extname(chosenPath);

    if (!fs.existsSync(COVERS_FOLDER)) {
        fs.mkdirSync(COVERS_FOLDER);
    }

    const fileName = `${safeFileName(gameName)}${ext}`;
    const destPath = path.join(COVERS_FOLDER, fileName);

    fs.copyFileSync(chosenPath, destPath);

    const relativePath = `covers/${fileName}`;

    const overrides = readOverrides();
    const key = normalizeOverrideName(gameName);
    overrides[key] = { ...(overrides[key] || {}), image: relativePath };
    fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));

    return relativePath;
});

ipcMain.handle("fetch-description", async (event, gameName) => {

    console.log(`[desc] Looking up description for "${gameName}"...`);

    try {
        let text = await getWikipediaSummary(gameName);

        if (text) {
            console.log(`[desc] Found description for "${gameName}".`);
            return text;
        }

        console.log(`[desc] No direct match for "${gameName}", trying to resolve full name...`);

        const canonicalName = await resolveCanonicalName(gameName);

        if (!canonicalName || canonicalName.toLowerCase() === gameName.toLowerCase()) {
            console.log(`[desc] Could not resolve a fuller name for "${gameName}".`);
            return null;
        }

        console.log(`[desc] Resolved "${gameName}" -> "${canonicalName}", retrying...`);

        text = await getWikipediaSummary(canonicalName);

        if (text) {
            console.log(`[desc] Found description for "${gameName}" via "${canonicalName}".`);
        } else {
            console.log(`[desc] Still no description found for "${canonicalName}".`);
        }

        return text;

    } catch (err) {
        console.error("[desc] fetch-description failed:", err.message || err);
        return null;
    }
});

ipcMain.handle("fetch-trailer", async (event, gameName, type, description) => {

    console.log(`[trailer] Looking up trailer for "${gameName}" (type: ${type || "game"})...`);

    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === "PUT_YOUR_YOUTUBE_API_KEY_HERE") {
        console.log("[trailer] No YouTube API key set, skipping trailer lookup.");
        return null;
    }

    // Biases the search toward the right kind of result, so a show/app/game
    // that happens to share a name with something else doesn't pull in the
    // wrong trailer.
    const TYPE_QUALIFIERS = {
        game: "video game official trailer",
        vr: "VR game official trailer",
        app: "app official trailer",
        other: "official trailer",
        show: "TV series official trailer"
    };

    async function youtubeSearch(query, orderByViews) {
        const params = new URLSearchParams({
            part: "snippet",
            maxResults: "1",
            type: "video",
            q: query,
            key: YOUTUBE_API_KEY
        });
        if (orderByViews) params.set("order", "viewCount");

        const searchUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
        const result = await httpsGetJson(searchUrl, {});

        if (!result.items || result.items.length === 0) return null;
        return (result.items[0].id && result.items[0].id.videoId) || null;
    }

    try {
        const canonicalName = await resolveCanonicalName(gameName);
        const typePhrase = TYPE_QUALIFIERS[type] || TYPE_QUALIFIERS.game;

        // Layered fallback — each step is a little less strict than the
        // last, so a generic or ambiguous name still ends up with SOMETHING
        // related rather than nothing, while still preferring an official
        // trailer whenever one can be found.
        const attempts = [];

        if (canonicalName && canonicalName !== gameName) {
            attempts.push({ query: `${canonicalName} ${typePhrase}`, views: false, label: "canonical+official" });
        }
        attempts.push({ query: `${gameName} ${typePhrase}`, views: false, label: "raw+official" });

        // A distinguishing word from the description helps disambiguate a
        // generic or very short name (e.g. a one-word indie game title)
        // that alone might match something completely unrelated.
        if (description) {
            const keyword = description.split(/\s+/).find((w) => w.length > 5) || "";
            if (keyword) {
                attempts.push({ query: `${gameName} ${keyword} trailer`, views: false, label: "description-assisted" });
            }
        }

        attempts.push({ query: `${gameName} trailer`, views: false, label: "plain-relevance" });
        attempts.push({ query: `${gameName} trailer`, views: true, label: "plain-most-watched" });

        // All fallback attempts fire in PARALLEL rather than one-at-a-time —
        // running them sequentially meant a game with no obvious official
        // trailer (very common for not-yet-released titles) could take
        // several YouTube round-trips before finding anything, easily
        // outlasting how long someone's mouse rests on a card while hovering.
        const results = await Promise.all(
            attempts.map((attempt) =>
                youtubeSearch(attempt.query, attempt.views)
                    .then((videoId) => ({ videoId, label: attempt.label }))
                    .catch(() => ({ videoId: null, label: attempt.label }))
            )
        );

        // Still prefer the most "official" result available, in the same
        // priority order the attempts were defined in — just found
        // concurrently instead of one after another.
        for (let i = 0; i < attempts.length; i++) {
            if (results[i].videoId) {
                console.log(`[trailer] Found trailer for "${gameName}" via ${results[i].label}: ${results[i].videoId}`);
                return results[i].videoId;
            }
        }

        console.log(`[trailer] No trailer found for "${gameName}" after all fallbacks.`);
        return null;

    } catch (err) {
        console.error("[trailer] fetch-trailer failed:", err.message || err);
        return null;
    }
});

// Lets the UI manually clear a stuck "Running" state (some launchers hand
// off to a differently-named process, which our by-image-name polling
// can't always follow) — without this, a stale entry would block the next
// real launch attempt.
ipcMain.handle("force-stop-tracking", async (event, exePath) => {
    runningProcesses.delete(exePath);
    return true;
});

ipcMain.handle("update-game", async (event, updatedFields) => {

    if (!fs.existsSync(GAMES_FILE)) {
        return false;
    }

    const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));

    const index = games.findIndex(g => g.path === updatedFields.path);

    if (index === -1) {
        return false;
    }

    games[index] = { ...games[index], ...updatedFields };

    // A field explicitly set to null means "clear this" (e.g. force a
    // trailer to be re-fetched next time) rather than "store null" —
    // delete it entirely so it reads back as genuinely absent.
    Object.keys(updatedFields).forEach((key) => {
        if (updatedFields[key] === null) {
            delete games[index][key];
        }
    });

    fs.writeFileSync(
        GAMES_FILE,
        JSON.stringify(games, null, 2)
    );

    return true;
});

ipcMain.handle("save-game", async (event, game) => {

    let games = [];

    if (fs.existsSync(GAMES_FILE)) {
        games = JSON.parse(
            fs.readFileSync(
                GAMES_FILE,
                "utf8"
            )
        );
    }

    const exists =
        games.find(
            g => g.path === game.path
        );

    if (!exists) {

        game.addedAt = Date.now();

        games.push(game);

        fs.writeFileSync(
            GAMES_FILE,
            JSON.stringify(
                games,
                null,
                2
            )
        );
    }

    return true;
});

ipcMain.handle("load-games", async () => {

    if (!fs.existsSync(GAMES_FILE)) {
        return [];
    }

    return JSON.parse(
        fs.readFileSync(
            GAMES_FILE,
            "utf8"
        )
    );
});

ipcMain.handle("remove-game", async (event, gamePath) => {

    if (!fs.existsSync(GAMES_FILE)) {
        return true;
    }

    const games = JSON.parse(
        fs.readFileSync(
            GAMES_FILE,
            "utf8"
        )
    );

    const updatedGames =
        games.filter(
            game =>
                game.path !== gamePath
        );

    fs.writeFileSync(
        GAMES_FILE,
        JSON.stringify(
            updatedGames,
            null,
            2
        )
    );

    return true;
});

ipcMain.handle("load-settings", async () => {

    if (!fs.existsSync(SETTINGS_FILE)) {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
        return { ...DEFAULT_SETTINGS, ...saved };
    } catch (err) {
        return { ...DEFAULT_SETTINGS };
    }
});

ipcMain.handle("save-settings", async (event, partialSettings) => {

    let current = { ...DEFAULT_SETTINGS };

    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
        } catch (err) {
            // fall back to defaults if the file is somehow corrupt
        }
    }

    const updated = { ...current, ...partialSettings };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));

    return updated;
});

ipcMain.handle("open-data-folder", async () => {
    shell.openPath(app.getPath("userData"));
    return true;
});

// Clears cached description + trailer for every saved game, so the next
// time each card is viewed/hovered it looks everything up fresh.
ipcMain.handle("refresh-metadata", async () => {

    if (!fs.existsSync(GAMES_FILE)) {
        return [];
    }

    const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));

    games.forEach((g) => {
        delete g.description;
        delete g.trailerId;
    });

    fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));

    return games;
});

app.on("before-quit", () => {
    isQuitting = true;
});

app.on("window-all-closed", () => {
    app.quit();
});

// --- Auto-updates via GitHub Releases ---------------------------------
// autoDownload is off on purpose — the user sees what's in the update
// first and explicitly chooses to install it, per the required flow.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function sendToRenderer(channel, payload) {
    if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
    }
}

autoUpdater.on("update-available", (info) => {
    sendToRenderer("update-available", {
        version: info.version,
        releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null
    });
});

autoUpdater.on("update-not-available", () => {
    sendToRenderer("update-not-available");
});

autoUpdater.on("error", (err) => {
    console.error("[updater] error:", err.message || err);
    sendToRenderer("update-error", err.message || String(err));
});

autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update-download-progress", Math.round(progress.percent));
});

autoUpdater.on("update-downloaded", () => {
    sendToRenderer("update-downloaded");
});

ipcMain.handle("check-for-updates", async () => {
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.error("[updater] check failed:", err.message || err);
    }
});

ipcMain.handle("start-update-download", async () => {
    try {
        await autoUpdater.downloadUpdate();
    } catch (err) {
        console.error("[updater] download failed:", err.message || err);
    }
});

ipcMain.handle("quit-and-install-update", async () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
});

app.whenReady().then(async () => {
    await createWindow();

    // Give the window a moment to finish loading before checking, so the
    // update popup isn't racing the app's own startup animation.
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            console.error("[updater] initial check failed:", err.message || err);
        });
    }, 4000);
});

console.log("=====================================");
console.log("Game Launcher started");
console.log("Online cover fetch (SteamGridDB): ENABLED, key ending in " + STEAMGRIDDB_API_KEY.slice(-4));
console.log("=====================================");