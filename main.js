const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, safeStorage } = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

// GAMES_FILE, COVERS_FOLDER and SETTINGS_FILE point into the user's writable
// AppData folder, not the app's own install directory (which is read-only
// once installed via the Windows installer). Assigned in initUserData().
let GAMES_FILE;
let COVERS_FOLDER;
let SETTINGS_FILE;
let OVERRIDES_FILE;
let WATCHLIST_FILE;
let FREEGAMES_SEEN_FILE;
let TRAILER_CACHE_FILE;
let SESSION_FILE;
let EBOOKS_FILE;
let EBOOKS_DROPZONE_FOLDER;

// --- Generic on-disk cache for online data (Free Games, Discover Online,
// Buy Books) — so the app can show the last successful result instantly
// on launch instead of an empty section while a fresh fetch is still in
// flight, and never blanks out to "nothing" just because one refresh
// attempt happened to fail.
function loadDataCache(cacheFileName) {
    const cachePath = path.join(app.getPath("userData"), cacheFileName);
    if (!fs.existsSync(cachePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } catch (err) {
        return null;
    }
}

function saveDataCache(cacheFileName, data) {
    const cachePath = path.join(app.getPath("userData"), cacheFileName);
    try {
        fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`[cache] failed to save ${cacheFileName}:`, err.message || err);
    }
}

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
    lastReadingRoomTab: "buyfree",
    movieCity: "",
    startupAnimation: true,
    deviceId: null,
    username: null
};

// Tracks currently-running launched processes so the UI can show
// "Running" instead of "Launch", and flips back when the process exits.
const runningProcesses = new Map();

// SteamGridDB / YouTube / TMDB / RAWG keys used to live here (loaded from
// secrets.local.js), which meant they shipped in plain text inside every
// packaged .exe — anyone could unzip the installer and read them straight
// out. They now live as Supabase secrets on the media-proxy Edge Function
// (see mediaProxyGetJson/mediaProxyGetJsonPlain below): this app only ever
// holds the public Supabase URL + publishable key, which are meant to be
// public — Supabase's security model protects data with RLS policies, not
// by keeping that key secret.

// TMDB's poster/metadata association can be locale-specific — a movie
// releasing in a given region sometimes only has its poster properly
// indexed under that region's own language context. The region
// parameter was already dynamic (following the user's selected
// country), but language was hardcoded to en-US regardless, which is
// very likely why films specific to a non-English region (Portuguese
// titles releasing in Portugal, for example) were missing their cover
// art — requesting English-locale data for a Portugal-region query.
const TMDB_LANGUAGE_BY_COUNTRY = {
    US: "en-US",
    GB: "en-GB",
    PT: "pt-PT",
    CA: "en-CA",
    AU: "en-AU",
    DE: "de-DE",
    FR: "fr-FR",
    ES: "es-ES",
    BR: "pt-BR"
};

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

// --- Third-party media API proxy (Supabase Edge Function) -----------------
//
// Posts to the "media-proxy" Edge Function deployed on this app's own
// Supabase project, which attaches the real vendor key server-side and
// forwards the request. SUPABASE_URL/SUPABASE_KEY are declared further
// down this file (with the rest of the Supabase code) — safe to reference
// here since these functions are only ever called later, at runtime, well
// after the whole file has finished loading.

function httpsPostJson(url, headers, bodyObj) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(bodyObj);
        const req = https.request(
            new URL(url),
            {
                method: "POST",
                headers: {
                    ...headers,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(bodyStr)
                }
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
            }
        );
        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

async function mediaProxyRaw(vendor, proxyPath, query) {
    const { statusCode, body } = await httpsPostJson(
        `${SUPABASE_URL}/functions/v1/media-proxy`,
        { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        { vendor, path: proxyPath, query: query || {} }
    );
    return { statusCode, parsed: JSON.parse(body) };
}

// Mirrors the old httpsGetJson(vendorUrl, ...) call sites: returns the
// parsed body regardless of status code, since some callers (the YouTube
// quota check) need to inspect an error body that comes back on a non-2xx
// status rather than have it thrown away.
async function mediaProxyGetJson(vendor, proxyPath, query) {
    const { parsed } = await mediaProxyRaw(vendor, proxyPath, query);
    return parsed;
}

// Mirrors the old httpsGetJsonPlain(vendorUrl) call sites: throws on
// non-2xx, surfacing the vendor's own error message when there is one.
async function mediaProxyGetJsonPlain(vendor, proxyPath, query) {
    const { statusCode, parsed } = await mediaProxyRaw(vendor, proxyPath, query);
    if (statusCode < 200 || statusCode >= 300) {
        const apiMessage = (parsed && parsed.error && (parsed.error.message || parsed.error)) || (parsed && parsed.status_message);
        throw new Error(apiMessage || `HTTP ${statusCode}`);
    }
    return parsed;
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

// Same shape as downloadImage but follows redirects — Gutenberg's actual
// EPUB download links commonly redirect at least once before reaching
// the real file.
function downloadFileFollowingRedirects(url, destPath, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                downloadFileFollowingRedirects(res.headers.location, destPath, redirectsLeft - 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Download failed: ${res.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(destPath);
            res.pipe(file);
            file.on("finish", () => file.close(resolve));
            file.on("error", (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on("error", reject);
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

            // Reject anything trying to climb out of its root (../, a
            // smuggled Windows drive letter, or backslashes) before it ever
            // touches the filesystem — this server only ever needs to serve
            // files that live directly under one of the two roots below.
            if (urlPath.includes("..") || urlPath.includes("\\") || /^\/[a-zA-Z]:/.test(urlPath)) {
                res.writeHead(400);
                res.end("Bad request");
                return;
            }

            let root;
            let relativePath;

            if (urlPath.startsWith("/covers/")) {
                root = COVERS_FOLDER;
                relativePath = urlPath.replace("/covers/", "");
            } else {
                root = __dirname;
                relativePath = urlPath;
            }

            const resolvedRoot = path.resolve(root) + path.sep;
            const resolvedFile = path.resolve(path.join(root, relativePath));

            // Belt-and-braces: even after the check above, confirm the
            // resolved path is still inside its root before reading it.
            if (!resolvedFile.startsWith(resolvedRoot)) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }

            fs.readFile(resolvedFile, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end("Not found");
                    return;
                }

                const ext = path.extname(resolvedFile).toLowerCase();

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
    TRAILER_CACHE_FILE = path.join(userDataDir, "trailer-cache.json");
    SESSION_FILE = path.join(userDataDir, "session.dat");
    EBOOKS_FILE = path.join(userDataDir, "ebooks.json");
    EBOOKS_DROPZONE_FOLDER = path.join(userDataDir, "Reading Room Dropzone");

    if (!fs.existsSync(EBOOKS_DROPZONE_FOLDER)) {
        fs.mkdirSync(EBOOKS_DROPZONE_FOLDER, { recursive: true });
    }

    if (!fs.existsSync(COVERS_FOLDER)) {
        fs.mkdirSync(COVERS_FOLDER, { recursive: true });
    }

    // Seed the placeholder covers once, copied from the app's bundled assets
    const seedDefault = path.join(__dirname, "covers", "default.jpg");
    const userDefault = path.join(COVERS_FOLDER, "default.jpg");

    if (!fs.existsSync(userDefault) && fs.existsSync(seedDefault)) {
        fs.copyFileSync(seedDefault, userDefault);
    }

    const seedNoCover = path.join(__dirname, "covers", "no-cover-book.jpg");
    const userNoCover = path.join(COVERS_FOLDER, "no-cover-book.jpg");

    if (!fs.existsSync(userNoCover) && fs.existsSync(seedNoCover)) {
        fs.copyFileSync(seedNoCover, userNoCover);
    }

    if (!fs.existsSync(GAMES_FILE)) {
        fs.writeFileSync(GAMES_FILE, "[]");
    }

    if (!fs.existsSync(SETTINGS_FILE)) {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    }

    if (!fs.existsSync(TRAILER_CACHE_FILE)) {
        fs.writeFileSync(TRAILER_CACHE_FILE, "{}");
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
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, "preload.js")
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
    // Only ever hand off real web links here — shell.openExternal will
    // happily open file:// URLs or custom protocol URIs too, which is far
    // more capability than any "visit this website" / "watch trailer"
    // button needs, and safer if a poisoned third-party API response
    // (a game/movie/book link) ever slipped through with something
    // unexpected in its url field.
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            console.warn("[open-external] blocked non-http(s) URL:", url);
            return false;
        }
    } catch (err) {
        console.warn("[open-external] blocked malformed URL:", url);
        return false;
    }
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
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (err) {
                    reject(err);
                    return;
                }

                // The response can be valid JSON while still representing
                // an error (rate limiting, quota exceeded, etc.) — many
                // APIs, including Google's, return a normal JSON body like
                // {"error": {...}} alongside a non-2xx status. Without this
                // check, that was silently parsed as "success" with no
                // matching data, producing an empty result with no error
                // ever surfacing anywhere.
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const apiMessage = parsed && parsed.error && (parsed.error.message || parsed.error);
                    reject(new Error(apiMessage || `HTTP ${res.statusCode}`));
                    return;
                }

                resolve(parsed);
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
        // The path never gets interpolated into the PowerShell command
        // string — it's passed through an environment variable and read
        // back with $env:, so there's no escaping to get right and no
        // injection surface regardless of what characters the path
        // contains (quotes, $(...), backticks, etc. all included).
        const psCommand = "(Get-Item -LiteralPath $env:RIFTGATE_EXE_PATH).VersionInfo.FileDescription";

        execFile(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psCommand],
            { timeout: 5000, env: { ...process.env, RIFTGATE_EXE_PATH: exePath } },
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
        const now = Date.now();

        // Epic's structure is nested: each element has a list of "promotion
        // windows", and each window has its own inner list of offers with
        // a start/end date and a discount setting. The previous version
        // only checked whether the OUTER list was non-empty, which missed
        // games sitting in a shape it didn't expect and could just as
        // easily include one whose window had already ended — this checks
        // the actual dates and discount percentage, so it only includes
        // games that are genuinely free RIGHT NOW, and shouldn't miss any
        // that legitimately are.
        function isCurrentlyFree(el) {
            const windows = (el.promotions && el.promotions.promotionalOffers) || [];
            for (const promoWindow of windows) {
                for (const offer of promoWindow.promotionalOffers || []) {
                    const start = new Date(offer.startDate).getTime();
                    const end = new Date(offer.endDate).getTime();
                    const pct = offer.discountSetting && offer.discountSetting.discountPercentage;
                    if (pct === 0 && now >= start && now <= end) return true;
                }
            }
            return false;
        }

        return elements
            .filter(isCurrentlyFree)
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

// Specific genres to cross-reference against the free-to-play set, so
// categories are real genres (RTS, MMORPG, etc.) instead of a single
// generic bucket. Each lookup has its own timeout and is wrapped in
// Promise.allSettled below — a slow or failed genre lookup can only ever
// cost that one genre's labels, never the actual game list.
const STEAM_GENRE_TAGS = [
    "MMORPG", "MMO", "RTS", "FPS", "Battle Royale", "Survival",
    "Strategy", "Action", "Adventure", "RPG"
];

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

        const freeIds = new Set(genuinelyFree.map((item) => String(item.appid)));
        const genreMap = {};

        // Best-effort genre categorization — allSettled means one slow or
        // failing genre tag can never take down the others or the actual
        // game list, it just leaves those specific games as "Other".
        try {
            const genreResults = await Promise.allSettled(
                STEAM_GENRE_TAGS.map((tag) =>
                    httpsGetJsonPlain(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`, 6000)
                        .then((genreData) => ({ tag, genreData }))
                )
            );

            genreResults.forEach((result) => {
                if (result.status !== "fulfilled") return;
                const { tag, genreData } = result.value;
                Object.values(genreData || {}).forEach((item) => {
                    const idStr = String(item.appid);
                    if (freeIds.has(idStr) && !genreMap[idStr]) {
                        genreMap[idStr] = tag;
                    }
                });
            });
        } catch (err) {
            console.error("[free-games] Steam genre lookup failed entirely:", err.message || err);
        }

        // Verify each game is still actually available on the store —
        // SteamSpy's data can lag behind a title that's since been
        // delisted ("Notice: X is no longer available on the Steam
        // store."). A network hiccup checking this shouldn't remove a
        // game that's genuinely fine, so anything that fails to verify is
        // kept rather than dropped — only a confirmed "unavailable"
        // response excludes it.
        const availabilityResults = await Promise.allSettled(
            genuinelyFree.map((item) =>
                httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${item.appid}&filters=basic`, 6000)
                    .then((detail) => ({
                        appid: item.appid,
                        available: !!(detail && detail[item.appid] && detail[item.appid].success)
                    }))
            )
        );

        const unavailable = new Set();
        availabilityResults.forEach((result) => {
            if (result.status === "fulfilled" && result.value.available === false) {
                unavailable.add(String(result.value.appid));
            }
        });

        if (unavailable.size > 0) {
            console.log(`[free-games] Excluding ${unavailable.size} delisted Steam game(s).`);
        }

        return genuinelyFree
            .filter((item) => !unavailable.has(String(item.appid)))
            .map((item) => ({
                id: `steam-${item.appid}`,
                name: item.name,
                description: null,
                image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
                url: `https://store.steampowered.com/app/${item.appid}`,
                source: "Steam",
                tags: [genreMap[String(item.appid)] || "Other"]
            }));
    } catch (err) {
        console.error("[free-games] SteamSpy fetch failed:", err.message || err);
        return [];
    }
}

// GOG's modern storefront (the React-based site) calls this catalog API
// directly — the old www.gog.com/games/ajax/filtered endpoint used
// previously appears to have stopped returning results reliably.
async function fetchGogFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://catalog.gog.com/v1/catalog?limit=48&order=desc:trending&productType=in:game&price=between:0,0&countryCode=US&locale=en-US&currencyCode=USD",
            10000
        );

        const products = data.products || [];

        // Defensive price check, same reasoning as Steam's — only exclude
        // an item if we can positively confirm it's NOT free, since we
        // can't be fully certain of GOG's exact field shape without live
        // testing; anything ambiguous is kept rather than dropped.
        const genuinelyFree = products.filter((p) => {
            const amount = p.price && p.price.final && p.price.final.amount;
            if (amount === undefined) return true;
            return parseFloat(amount) === 0;
        });

        console.log(`[free-games] GOG: found ${products.length} results, ${genuinelyFree.length} confirmed free.`);

        return genuinelyFree.map((p) => ({
            id: `gog-${p.id}`,
            name: p.title,
            description: null,
            image: p.coverHorizontal || p.coverVertical || null,
            url: p.slug ? `https://www.gog.com/en/game/${p.slug}` : "https://www.gog.com",
            source: "GOG",
            tags: [(p.genres && p.genres[0] && (p.genres[0].name || p.genres[0])) || "Other"]
        }));
    } catch (err) {
        console.error("[free-games] GOG fetch failed:", err.message || err);
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
    // never take the others down with it.
    const results = await Promise.allSettled([
        fetchEpicFreeGames(),
        fetchSteamFreeGames(),
        fetchGogFreeGames()
    ]);

    results.forEach((r, i) => {
        if (r.status === "rejected") {
            const storeName = ["Epic", "Steam", "GOG"][i];
            console.error(`[free-games] ${storeName} fetch rejected entirely:`, r.reason);
        }
    });

    const [epicGames, steamGames, gogGames] = results.map((r) =>
        r.status === "fulfilled" ? r.value : []
    );

    const allFree = [...epicGames, ...steamGames, ...gogGames];

    // Track when Riftgate first saw each one, so the "Newly Added" row can
    // show items discovered within the last 7 days, regardless of the
    // store's own promotion dates. Anything no longer in the current
    // fetch has either stopped being free or been delisted — its entry is
    // dropped here so this file doesn't grow forever with stale games
    // that will never be shown again.
    const seenCache = readFreeGamesSeenCache();
    const now = Date.now();
    const currentIds = new Set(allFree.map((g) => g.id));
    const prunedCache = {};

    allFree.forEach((game) => {
        if (!seenCache[game.id]) {
            seenCache[game.id] = now;
        }
        game.firstSeenAt = seenCache[game.id];
        prunedCache[game.id] = seenCache[game.id];
    });

    const removedCount = Object.keys(seenCache).filter((id) => !currentIds.has(id)).length;
    if (removedCount > 0) {
        console.log(`[free-games] Pruned ${removedCount} game(s) no longer free from the "first seen" cache.`);
    }

    fs.writeFileSync(FREEGAMES_SEEN_FILE, JSON.stringify(prunedCache, null, 2));
    saveDataCache("cache-free-games.json", allFree);

    return allFree;
});

// Instant retrieval of the last successfully fetched Free Games list —
// same "show something immediately, refresh quietly after" pattern as
// the book sections, so this section isn't empty on launch either.
ipcMain.handle("get-cached-free-games", async () => loadDataCache("cache-free-games.json") || []);

// --- Movies currently in theaters (TMDB — free public movie database) ---

// Supplementary lookup for a movie that came back with no poster from
// the main (English-locale) listing — TMDB's /images endpoint isn't
// tied to a single language the way the listing endpoint is, so it can
// surface a poster (Portuguese-specific releases included) without
// having to switch the whole request to a different locale, which is
// what broke English descriptions the first time this was attempted.
async function fetchFallbackPoster(movieId, preferredLanguage) {
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/movie/${movieId}/images`, {});
        const posters = data.posters || [];
        if (posters.length === 0) return null;

        // Prefer one matching the user's region if available, otherwise
        // fall back to the neutral/language-less posters TMDB often has,
        // otherwise just take whatever's first — any poster beats none.
        const preferred = posters.find((p) => p.iso_639_1 === (preferredLanguage || "").split("-")[0]);
        const neutral = posters.find((p) => !p.iso_639_1);
        const chosen = preferred || neutral || posters[0];

        return chosen ? `https://image.tmdb.org/t/p/w500${chosen.file_path}` : null;
    } catch (err) {
        return null;
    }
}

ipcMain.handle("get-now-playing-movies", async (event, countryCode) => {

    try {
        // Always English for the main listing — titles/descriptions are
        // far more completely translated in TMDB's English data than in
        // most other locales, and switching this to match the region
        // caused descriptions to go missing for titles without a
        // Portuguese (or other) overview populated yet.
        const data = await mediaProxyGetJsonPlain("tmdb", "/movie/now_playing", {
            region: countryCode,
            language: "en-US",
            page: "1"
        });
        const results = data.results || [];

        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";
        const mapped = await Promise.all(results.map(async (m) => {
            let poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
            if (!poster) {
                poster = await fetchFallbackPoster(m.id, tmdbLanguage);
            }
            return {
                id: m.id,
                title: m.title,
                description: m.overview,
                poster,
                releaseDate: m.release_date
            };
        }));

        return mapped;
    } catch (err) {
        console.error("[movies] now_playing fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-movie-trailer", async (event, movieId) => {

    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/movie/${movieId}/videos`, {});

        const candidates = (data.results || []).filter(
            (v) => v.site === "YouTube" && v.type === "Trailer"
        );

        // TMDB doesn't guarantee "best" results first — prefer the one
        // it explicitly marks as official over an arbitrary fan upload
        // or regional variant that happens to be listed first.
        const trailer = candidates.find((v) => v.official) || candidates[0];

        return trailer ? trailer.key : null;
    } catch (err) {
        console.error("[movies] trailer fetch failed:", err.message || err);
        return null;
    }
});

// TV shows in My Shows previously fell back to a generic YouTube text
// search (the same one used for games/apps), which isn't tied to any
// verified database entry — a show sharing a name with (or based on) a
// game could easily pull back that game's trailer instead, especially
// if the game's video is more popular. This looks the show up in TMDB's
// own TV database first and uses its curated video data instead, the
// same reliable, ID-based approach movies already use.
ipcMain.handle("get-show-trailer", async (event, showName) => {

    try {
        const searchData = await mediaProxyGetJsonPlain("tmdb", "/search/tv", { query: showName });

        const match = searchData.results && searchData.results[0];
        if (!match) return null;

        const videoData = await mediaProxyGetJsonPlain("tmdb", `/tv/${match.id}/videos`, {});

        const candidates = (videoData.results || []).filter(
            (v) => v.site === "YouTube" && v.type === "Trailer"
        );
        const trailer = candidates.find((v) => v.official) || candidates[0];

        return trailer ? trailer.key : null;
    } catch (err) {
        console.error("[shows] trailer fetch failed:", err.message || err);
        return null;
    }
});

// --- "NEW" section: upcoming movies, new TV shows, upcoming games ---------

ipcMain.handle("get-upcoming-movies", async (event, countryCode) => {
    try {
        // Same reasoning as now_playing above — English for the main
        // listing (reliable titles/descriptions), with a targeted
        // per-movie fallback for posters specifically when missing,
        // rather than switching the whole request to another locale.
        const data = await mediaProxyGetJsonPlain("tmdb", "/movie/upcoming", {
            region: countryCode,
            language: "en-US",
            page: "1"
        });
        const results = data.results || [];

        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";
        const mapped = await Promise.all(results.map(async (m) => {
            let poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
            if (!poster) {
                poster = await fetchFallbackPoster(m.id, tmdbLanguage);
            }
            return {
                id: m.id,
                title: m.title,
                description: m.overview,
                poster,
                releaseDate: m.release_date
            };
        }));

        return mapped;
    } catch (err) {
        console.error("[new] upcoming movies fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-new-tv-shows", async () => {
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", "/discover/tv", {
            sort_by: "first_air_date.desc",
            "air_date.lte": new Date().toISOString().slice(0, 10),
            "vote_count.gte": "5",
            language: "en-US",
            page: "1"
        });

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
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/tv/${tmdbId}/videos`, {});

        const trailer = (data.results || []).find(
            (v) => v.site === "YouTube" && v.type === "Trailer"
        );

        return trailer ? trailer.key : null;
    } catch (err) {
        console.error("[new] TV trailer fetch failed:", err.message || err);
        return null;
    }
});

// Used to source Steam's own "coming_soon" bucket, but that's only ever
// PC games sold on Steam, and only whatever Valve's storefront happens
// to be featuring that day — not necessarily what's actually most
// anticipated. RAWG aggregates across every platform, and ordering by
// "added" (how many RAWG users have put a game on their own list) is the
// closest free equivalent to "what people are talking about most" —
// covering both the "any platform" and "most talked about" parts of
// what this list is supposed to show.
ipcMain.handle("get-upcoming-games", async () => {
    try {
        const today = new Date();
        const sixMonthsOut = new Date(today);
        sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
        const fmt = (d) => d.toISOString().slice(0, 10);

        const data = await mediaProxyGetJsonPlain("rawg", "/games", {
            dates: `${fmt(today)},${fmt(sixMonthsOut)}`,
            ordering: "-added",
            page_size: "24"
        });

        const results = data.results || [];

        return results.map((g) => ({
            id: `rawg-${g.id}`,
            name: g.name,
            image: g.background_image || null,
            url: `https://rawg.io/games/${g.slug}`,
            releaseDate: g.released || null
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

// --- Detecting a freshly-installed app/game --------------------------------
// Watches for any running process whose name looks like an installer
// ("setup", "install"), and once it exits, checks whether any shortcut
// appeared on the Desktop or in the Start Menu more recently than the
// installer started — a strong signal something just got installed.
const INSTALLER_NAME_PATTERNS = [/setup/i, /install/i];
let watchedInstallers = {}; // { pid: { name, startTime } }

function getAllProcesses() {
    return new Promise((resolve) => {
        execFile("tasklist", ["/FO", "CSV", "/NH"], (error, stdout) => {
            if (error) {
                resolve([]);
                return;
            }
            // CSV columns: "Image Name","PID","Session Name","Session#","Mem Usage"
            const processes = stdout
                .split("\n")
                .map((line) => {
                    const match = line.match(/^"([^"]+)","(\d+)"/);
                    return match ? { name: match[1], pid: match[2] } : null;
                })
                .filter(Boolean);
            resolve(processes);
        });
    });
}

function scanForNewShortcuts(sinceTimestamp) {
    const locations = [
        app.getPath("desktop"),
        process.env.APPDATA ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : null,
        process.env.ProgramData ? path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : null
    ].filter(Boolean);

    const foundShortcuts = [];

    for (const dir of locations) {
        if (!fs.existsSync(dir)) continue;

        try {
            const scan = (folder, depth) => {
                if (depth > 2) return; // avoid runaway recursion into deep subfolders
                let entries;
                try {
                    entries = fs.readdirSync(folder, { withFileTypes: true });
                } catch (err) {
                    return; // some Start Menu subfolders can be permission-restricted
                }
                for (const entry of entries) {
                    const fullPath = path.join(folder, entry.name);
                    if (entry.isDirectory()) {
                        scan(fullPath, depth + 1);
                    } else if (entry.name.toLowerCase().endsWith(".lnk")) {
                        try {
                            const stat = fs.statSync(fullPath);
                            if (stat.mtimeMs > sinceTimestamp) {
                                foundShortcuts.push({ path: fullPath, name: entry.name.replace(/\.lnk$/i, "") });
                            }
                        } catch (err) {
                            // skip unreadable shortcut
                        }
                    }
                }
            };
            scan(dir, 0);
        } catch (err) {
            console.error("[installer-detect] scan failed for", dir, err.message || err);
        }
    }

    if (foundShortcuts.length === 0) return;

    // An installer very often creates BOTH a Desktop shortcut and a Start
    // Menu shortcut for the same app — resolving each to its real target
    // and deduping here means that only shows up as one prompt, not two.
    const seenTargets = new Set();
    const candidates = [];

    // Also skip anything already in the library, so a game added earlier
    // (manually, or from a previous install-detection prompt) never gets
    // asked about again.
    let existingPaths = new Set();
    try {
        const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
        existingPaths = new Set(games.map((g) => (g.path || "").toLowerCase()));
    } catch (err) {
        // if this fails, just proceed without the extra check
    }

    for (const item of foundShortcuts) {
        try {
            const shortcut = shell.readShortcutLink(item.path);
            const target = shortcut.target;
            if (!target) continue;
            const key = target.toLowerCase();
            if (seenTargets.has(key) || existingPaths.has(key)) continue;
            seenTargets.add(key);
            candidates.push({ path: target, name: item.name });
        } catch (err) {
            // unreadable shortcut, skip
        }
    }

    if (candidates.length > 0 && win && !win.isDestroyed()) {
        console.log(`[installer-detect] Found ${candidates.length} new install(s) after installer closed.`);
        win.webContents.send("new-install-detected", candidates);
    }
}

async function pollForInstallers() {
    const processes = await getAllProcesses();
    const currentPids = new Set(processes.map((p) => p.pid));

    processes.forEach((proc) => {
        // Riftgate's own auto-update installer must never be mistaken for
        // a new game/app being installed.
        if (proc.name.toLowerCase().includes("riftgate")) return;

        const looksLikeInstaller = INSTALLER_NAME_PATTERNS.some((pattern) => pattern.test(proc.name));
        if (looksLikeInstaller && !watchedInstallers[proc.pid]) {
            watchedInstallers[proc.pid] = { name: proc.name, startTime: Date.now() };
            console.log(`[installer-detect] Watching installer process: ${proc.name} (PID ${proc.pid})`);
        }
    });

    // Tracking by PID (not just name) means two different installers that
    // happen to share a generic name like "setup.exe" are still tracked
    // and resolved independently, instead of one overwriting the other.
    for (const pid of Object.keys(watchedInstallers)) {
        if (!currentPids.has(pid)) {
            const { name, startTime } = watchedInstallers[pid];
            delete watchedInstallers[pid];
            console.log(`[installer-detect] ${name} (PID ${pid}) exited — scanning for new shortcuts...`);
            scanForNewShortcuts(startTime);
        }
    }
}

setInterval(pollForInstallers, 5000);

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
    const searchResult = await mediaProxyGetJson(
        "steamgriddb",
        `/search/autocomplete/${encodeURIComponent(term)}`,
        {}
    );

    if (!searchResult.success || !searchResult.data || searchResult.data.length === 0) {
        return null;
    }

    return searchResult.data[0];
}

ipcMain.handle("fetch-online-cover", async (event, gameName) => {

    console.log(`[cover] Looking up "${gameName}" on SteamGridDB...`);

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

        const gridsResult = await mediaProxyGetJson(
            "steamgriddb",
            `/grids/game/${gameId}`,
            { dimensions: "600x900" }
        );

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

ipcMain.handle("fetch-trailer", async (event, gameName, type, description, cacheKey) => {

    // Permanent cache — Installed Games and My Shows already persist their
    // trailer in games.json/watchlist.json, but Free Games and Upcoming
    // Games have no per-item store of their own, so they re-fetched (and
    // re-spent YouTube quota) on every single hover, every session. This
    // cache key lets those two reuse a result forever once found.
    let cache = {};
    if (cacheKey) {
        try {
            cache = JSON.parse(fs.readFileSync(TRAILER_CACHE_FILE, "utf8"));
        } catch (err) {
            cache = {};
        }
        if (cache[cacheKey]) {
            console.log(`[trailer] Using cached trailer for "${gameName}" (no API call spent).`);
            return cache[cacheKey];
        }
    }

    console.log(`[trailer] Looking up trailer for "${gameName}" (type: ${type || "game"})...`);

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

    let quotaExceeded = false;

    async function youtubeSearch(query, orderByViews) {
        const params = { part: "snippet", maxResults: "1", type: "video", q: query };
        if (orderByViews) params.order = "viewCount";

        const result = await mediaProxyGetJson("youtube", "/search", params);

        // YouTube returns a normal 200-shaped JSON body even for quota
        // errors — {"error": {"code": 403, ...}} — so this has to be
        // checked explicitly, or a quota problem silently looks identical
        // to "no trailer found" with no way to tell the difference.
        if (result.error) {
            if (result.error.code === 403) quotaExceeded = true;
            console.error(`[trailer] YouTube API error (${result.error.code}): ${result.error.message}`);
            return null;
        }

        if (!result.items || result.items.length === 0) return null;
        return (result.items[0].id && result.items[0].id.videoId) || null;
    }

    try {
        const canonicalName = await resolveCanonicalName(gameName);
        const typePhrase = TYPE_QUALIFIERS[type] || TYPE_QUALIFIERS.game;

        // Layered fallback — each step is a little less strict than the
        // last, so a generic or ambiguous name still ends up with SOMETHING
        // related rather than nothing, while still preferring an official
        // trailer whenever one can be found. These run ONE AT A TIME and
        // stop as soon as something is found — running all of them in
        // parallel used to make trailers appear a bit faster, but it also
        // multiplied API quota usage by up to 5x on every single lookup,
        // which burns through YouTube's small daily quota far too fast and
        // makes trailers stop working for the rest of the day. A cache hit
        // above avoids most repeat cost anyway, so this only matters for
        // genuinely new titles.
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

        let foundId = null;

        for (const attempt of attempts) {
            if (quotaExceeded) break;
            const videoId = await youtubeSearch(attempt.query, attempt.views);
            if (videoId) {
                console.log(`[trailer] Found trailer for "${gameName}" via ${attempt.label}: ${videoId}`);
                foundId = videoId;
                break;
            }
        }

        if (quotaExceeded) {
            console.error("[trailer] YouTube daily quota appears to be exhausted — trailers will stop appearing until it resets.");
        }

        if (foundId && cacheKey) {
            cache[cacheKey] = foundId;
            fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(cache, null, 2));
        }

        if (!foundId) {
            console.log(`[trailer] No trailer found for "${gameName}" after all fallbacks.`);
        }

        return foundId;

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

    try {
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
    } catch (err) {
        console.error("[update-game] failed:", err.message || err);
        return false;
    }
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

// --- eBook library (EPUB/PDF) ----------------------------------------------

ipcMain.handle("select-ebook-file", async () => {
    const result = await dialog.showOpenDialog(win, {
        title: "Add eBooks",
        properties: ["openFile", "multiSelections"],
        filters: [
            { name: "eBooks", extensions: ["epub", "pdf"] }
        ]
    });

    if (result.canceled) return [];
    return result.filePaths;
});

// Reads an EPUB's own metadata (it's just a zip file containing XML) to
// get a real title/author and cover image, instead of relying on the
// filename. Falls back gracefully — a malformed or unusual EPUB just
// ends up with placeholder info rather than crashing anything.

// Pulls one attribute's value out of a tag string regardless of where it
// appears among the tag's other attributes — real-world EPUBs don't
// follow a consistent attribute order, so a regex anchored to a specific
// order (e.g. always expecting id="..." before href="...") silently
// fails on a large share of actual files.
function extractAttr(tagString, attrName) {
    const match = tagString.match(new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, "i"));
    return match ? match[1] : null;
}

// Looks up a file inside the zip using the exact path first, then falls
// back to a URL-decoded version (hrefs are often percent-encoded, e.g.
// "cover%20image.jpg" for a file actually named "cover image.jpg") and
// finally a case-insensitive match — real EPUBs are inconsistent enough
// about this that a single exact lookup misses a meaningful share of them.
function readZipEntryFuzzy(zip, dir, href) {
    const candidates = [href, decodeURIComponent(href)];
    for (const candidate of candidates) {
        try {
            return zip.readFile(path.posix.join(dir, candidate));
        } catch (err) {
            // try the next candidate
        }
    }

    const targetName = decodeURIComponent(href).toLowerCase();
    const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(targetName.split("/").pop()));
    if (entry) {
        try {
            return zip.readFile(entry);
        } catch (err) {
            return null;
        }
    }

    return null;
}

// Writes exactly what's happening for a specific book that still has no
// description after extraction — whether a <dc:description> tag exists
// in its OPF at all, and if so, a raw snippet of it, so the real cause
// can be diagnosed from actual data rather than guessed at again.
function logDescriptionDiagnostic(entry) {
    const logPath = path.join(app.getPath("userData"), "description-diagnostic-log.txt");
    try {
        const zip = new AdmZip(entry.path);
        const containerXml = zip.readAsText("META-INF/container.xml");
        const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);

        if (!opfPathMatch) {
            fs.appendFileSync(logPath, `\n=== ${entry.title} ===\nCould not find the OPF file (container.xml may be malformed).\n`);
            return;
        }

        const opfXml = zip.readAsText(opfPathMatch[1]);
        const hasDescTag = /<dc:description/i.test(opfXml);
        let snippet = "No <dc:description> tag exists anywhere in this book's OPF file — it genuinely has no description in its metadata.";

        if (hasDescTag) {
            const idx = opfXml.search(/<dc:description/i);
            snippet = opfXml.substring(idx, idx + 500);
        }

        fs.appendFileSync(logPath, `\n=== ${entry.title} ===\nHas <dc:description> tag: ${hasDescTag}\n${snippet}\n`);
    } catch (err) {
        try {
            fs.appendFileSync(logPath, `\n=== ${entry.title} ===\nCouldn't even open the file to check: ${err.message}\n`);
        } catch (e) {
            // give up silently — this is a diagnostic aid, not a critical path
        }
    }
}

function extractEpubMetadata(filePath) {
    try {
        const zip = new AdmZip(filePath);

        const containerXml = zip.readAsText("META-INF/container.xml");
        const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!opfPathMatch) return { title: null, author: null, coverBuffer: null };

        const opfPath = opfPathMatch[1];
        const opfXml = zip.readAsText(opfPath);
        const opfDir = path.dirname(opfPath);

        const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
        const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);

        // The naive [^<]+ version only matched a description with zero
        // nested tags — but real-world EPUB descriptions very commonly
        // include HTML formatting (paragraph breaks, italics, etc.) or
        // are wrapped in a CDATA block, and either one made the whole
        // match fail outright rather than just losing the formatting.
        // [\s\S]*? matches any content (including nested tags/newlines)
        // up to the real closing tag, then CDATA and any remaining HTML
        // tags get stripped out afterward to leave clean plain text.
        const descriptionTagMatch = opfXml.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
        let extractedDescription = null;
        if (descriptionTagMatch) {
            let raw = descriptionTagMatch[1];
            const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
            if (cdataMatch) raw = cdataMatch[1];
            raw = raw.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            raw = raw.replace(/\s+/g, " ").trim();
            extractedDescription = raw || null;
        }

        // Pull every <item .../> tag out of the manifest individually, so
        // each one's attributes can be read independently of their order
        // in the source markup.
        const itemTags = opfXml.match(/<item\b[^>]*\/?>/gi) || [];

        let coverHref = null;

        // EPUB3: the cover is marked directly on its manifest item via
        // properties="cover-image" — no indirection needed. This is the
        // modern, increasingly common case and wasn't handled before.
        for (const tag of itemTags) {
            const properties = extractAttr(tag, "properties");
            if (properties && properties.split(/\s+/).includes("cover-image")) {
                coverHref = extractAttr(tag, "href");
                break;
            }
        }

        // EPUB2 fallback: <meta name="cover" content="some-id"/> pointing
        // at a manifest item's id, which then has the real filename.
        if (!coverHref) {
            const metaTags = opfXml.match(/<meta\b[^>]*\/?>/gi) || [];
            let coverId = null;
            for (const tag of metaTags) {
                if ((extractAttr(tag, "name") || "").toLowerCase() === "cover") {
                    coverId = extractAttr(tag, "content");
                    break;
                }
            }
            if (coverId) {
                for (const tag of itemTags) {
                    if (extractAttr(tag, "id") === coverId) {
                        coverHref = extractAttr(tag, "href");
                        break;
                    }
                }
            }
        }

        // Last-resort fallback: some EPUBs skip both conventions above
        // but still name their cover file obviously (cover.jpg etc.) —
        // worth trying before giving up on a cover entirely.
        if (!coverHref) {
            for (const tag of itemTags) {
                const href = extractAttr(tag, "href") || "";
                if (/cover.*\.(jpe?g|png|gif)$/i.test(href)) {
                    coverHref = href;
                    break;
                }
            }
        }

        let coverBuffer = null;
        if (coverHref) {
            coverBuffer = readZipEntryFuzzy(zip, opfDir, coverHref);

            // Some EPUBs mark an XHTML "cover page" as the cover instead
            // of the image itself — if what was found isn't actually an
            // image, treat it as HTML and pull the real image reference
            // out of it instead.
            if (coverBuffer && /\.(x?html?)$/i.test(coverHref)) {
                const pageHtml = coverBuffer.toString("utf8");
                const imgMatch = pageHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
                    || pageHtml.match(/<image[^>]+(?:xlink:href|href)=["']([^"']+)["']/i);
                if (imgMatch) {
                    const imageDir = path.posix.dirname(path.posix.join(opfDir, coverHref));
                    coverBuffer = readZipEntryFuzzy(zip, imageDir, imgMatch[1]) || coverBuffer;
                }
            }
        }

        return {
            title: titleMatch ? titleMatch[1].trim() : null,
            author: authorMatch ? authorMatch[1].trim() : null,
            description: extractedDescription,
            coverBuffer
        };
    } catch (err) {
        console.error("[ebooks] EPUB metadata extraction failed:", err.message || err);
        return { title: null, author: null, coverBuffer: null };
    }
}

// PDFs aren't a zip archive, but many still have a simple, uncompressed
// /Title field readable via a direct text scan — no full PDF parser
// needed for just this. Doesn't work for every PDF (compressed metadata
// streams, encryption), but degrades safely to "no title found".
function extractPdfTitle(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const text = buffer.toString("latin1", 0, Math.min(buffer.length, 200000));
        const titleMatch = text.match(/\/Title\s*\(([^)]+)\)/);
        if (!titleMatch) return null;
        return titleMatch[1].replace(/\\(.)/g, "$1").trim() || null;
    } catch (err) {
        return null;
    }
}

// PDFs never had cover support at all before — every one silently fell
// back to the placeholder regardless of the actual file. This is a
// lightweight heuristic rather than a real PDF renderer: it scans the
// raw bytes for the first embedded JPEG large enough to plausibly be a
// real cover (skipping small decorative/font images), which works for
// a meaningful share of real-world PDF ebooks without needing a full
// PDF-parsing dependency.
function extractPdfCoverImage(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        const soiMarker = Buffer.from([0xff, 0xd8, 0xff]);
        const eoiMarker = Buffer.from([0xff, 0xd9]);

        let searchFrom = 0;
        while (true) {
            const startIndex = buffer.indexOf(soiMarker, searchFrom);
            if (startIndex === -1) return null;

            const endIndex = buffer.indexOf(eoiMarker, startIndex);
            if (endIndex === -1) return null;

            const candidate = buffer.slice(startIndex, endIndex + 2);
            if (candidate.length > 8000) {
                return candidate;
            }

            searchFrom = endIndex + 2;
        }
    } catch (err) {
        return null;
    }
}

ipcMain.handle("get-ebook-metadata", async (event, filePath) => {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".epub") {
        const meta = extractEpubMetadata(filePath);
        let coverPath = null;

        if (meta.coverBuffer) {
            try {
                if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });
                const coverFileName = `ebook-${crypto.randomUUID()}.jpg`;
                const destPath = path.join(COVERS_FOLDER, coverFileName);
                fs.writeFileSync(destPath, meta.coverBuffer);
                // Relative to the local server's root (see startLocalServer)
                // — an absolute filesystem path won't resolve as an <img
                // src> the way this app serves covers.
                coverPath = `covers/${coverFileName}`;
            } catch (err) {
                coverPath = null;
            }
        }

        return { title: meta.title, author: meta.author, description: meta.description, coverPath };
    }

    if (ext === ".pdf") {
        let coverPath = null;
        const coverBuffer = extractPdfCoverImage(filePath);
        if (coverBuffer) {
            try {
                if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });
                const coverFileName = `ebook-${crypto.randomUUID()}.jpg`;
                fs.writeFileSync(path.join(COVERS_FOLDER, coverFileName), coverBuffer);
                coverPath = `covers/${coverFileName}`;
            } catch (err) {
                coverPath = null;
            }
        }
        return { title: extractPdfTitle(filePath), author: null, coverPath };
    }

    return { title: null, author: null, coverPath: null };
});

// --- Reading Room drop folder ------------------------------------------
// A real folder the user can drop EPUB/PDF files into directly from
// Explorer — watched continuously so anything dropped there gets added
// to the library automatically, without needing to open Riftgate first.

let dropzoneWatcher = null;

function startDropzoneWatcher() {
    if (dropzoneWatcher || !EBOOKS_DROPZONE_FOLDER) return;

    try {
        dropzoneWatcher = fs.watch(EBOOKS_DROPZONE_FOLDER, { persistent: true }, (eventType, fileName) => {
            if (!fileName) return;
            const ext = path.extname(fileName).toLowerCase();
            if (ext !== ".epub" && ext !== ".pdf") return;

            const fullPath = path.join(EBOOKS_DROPZONE_FOLDER, fileName);

            // Debounce briefly — file-copy operations often fire multiple
            // "change" events while the file is still being written, so
            // this waits for it to settle before treating it as ready.
            setTimeout(() => {
                if (!fs.existsSync(fullPath)) return;
                if (win && !win.isDestroyed()) {
                    win.webContents.send("dropzone-file-detected", fullPath);
                }
            }, 800);
        });
    } catch (err) {
        console.error("[reading-room] dropzone watcher failed to start:", err.message || err);
    }
}

ipcMain.handle("open-dropzone-folder", async () => {
    shell.openPath(EBOOKS_DROPZONE_FOLDER);
    return true;
});

// So the description diagnostic log can actually be found and opened
// without needing to know or type the userData path by hand.
ipcMain.handle("open-description-diagnostic-log", async () => {
    const logPath = path.join(app.getPath("userData"), "description-diagnostic-log.txt");
    if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, "No diagnostic entries yet — reopen Reading Room to run the check.");
    }
    shell.openPath(logPath);
    return true;
});

ipcMain.handle("get-ebooks", async () => {
    if (!fs.existsSync(EBOOKS_FILE)) return [];
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));

        // Reset the diagnostic log at the start of each pass, so it only
        // ever reflects the most recent run rather than accumulating
        // across every app launch.
        try {
            fs.writeFileSync(path.join(app.getPath("userData"), "description-diagnostic-log.txt"), "");
        } catch (err) {
            // non-critical — diagnostics just won't reset this run
        }

        // Self-heals any entry stuck with a broken cover from before the
        // relative-path fix (or the earlier EPUB2-only parser missing
        // it entirely) — re-extracts on the fly so existing libraries
        // repair themselves automatically, without needing the book
        // removed and re-added.
        let changed = false;
        for (const entry of ebooks) {
            const hasValidCover = entry.cover && entry.cover.startsWith("covers/");
            const needsDescription = !entry.description;
            const needsEpubMeta = (!hasValidCover || needsDescription) && entry.format === "epub" && fs.existsSync(entry.path);

            if (needsEpubMeta) {
                const meta = extractEpubMetadata(entry.path);

                if (!hasValidCover && meta.coverBuffer) {
                    try {
                        if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });
                        const coverFileName = `ebook-${crypto.randomUUID()}.jpg`;
                        fs.writeFileSync(path.join(COVERS_FOLDER, coverFileName), meta.coverBuffer);
                        entry.cover = `covers/${coverFileName}`;
                        changed = true;
                    } catch (err) {
                        // leave as-is — will retry again next load
                    }
                }

                if (!entry.title && meta.title) {
                    entry.title = meta.title;
                    changed = true;
                }
                if (!entry.author && meta.author) {
                    entry.author = meta.author;
                    changed = true;
                }
                if (needsDescription) {
                    if (meta.description) {
                        entry.description = meta.description;
                        changed = true;
                    } else {
                        // Diagnostic logging for whatever's still failing —
                        // I can't run this app or test against real files
                        // myself, so this writes exactly what's happening
                        // for each affected book to a plain log file, so
                        // the actual cause can be identified from real
                        // data instead of another guess.
                        logDescriptionDiagnostic(entry);
                    }
                }
            } else if (!hasValidCover && entry.format === "pdf" && fs.existsSync(entry.path)) {
                const coverBuffer = extractPdfCoverImage(entry.path);
                if (coverBuffer) {
                    try {
                        if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });
                        const coverFileName = `ebook-${crypto.randomUUID()}.jpg`;
                        fs.writeFileSync(path.join(COVERS_FOLDER, coverFileName), coverBuffer);
                        entry.cover = `covers/${coverFileName}`;
                        changed = true;
                    } catch (err) {
                        // leave as-is — will retry again next load
                    }
                }
            }
        }

        if (changed) {
            fs.writeFileSync(EBOOKS_FILE, JSON.stringify(ebooks, null, 2));
        }

        return ebooks;
    } catch (err) {
        return [];
    }
});

ipcMain.handle("save-ebook", async (event, ebook) => {
    let ebooks = [];
    if (fs.existsSync(EBOOKS_FILE)) {
        try {
            ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        } catch (err) {
            ebooks = [];
        }
    }

    const exists = ebooks.find((b) => b.path.toLowerCase() === ebook.path.toLowerCase());
    if (exists) return { success: false, duplicate: true };

    ebook.addedAt = Date.now();
    ebook.lastOpenedAt = null;
    ebooks.push(ebook);
    fs.writeFileSync(EBOOKS_FILE, JSON.stringify(ebooks, null, 2));
    return { success: true };
});

// My Library is backed by the dropzone folder as its single source of
// truth — any book added via drag-and-drop or the + button gets copied
// in here (if it isn't already), so "My Library" always matches exactly
// what's physically in that folder, however it got there.
function copyIntoDropzone(sourcePath) {
    const ext = path.extname(sourcePath);
    let fileName = path.basename(sourcePath);
    let destPath = path.join(EBOOKS_DROPZONE_FOLDER, fileName);

    // Already living in the dropzone — nothing to copy.
    if (path.resolve(sourcePath).toLowerCase() === path.resolve(destPath).toLowerCase()) {
        return sourcePath;
    }

    let counter = 1;
    const baseName = path.basename(fileName, ext);
    while (fs.existsSync(destPath)) {
        fileName = `${baseName} (${counter})${ext}`;
        destPath = path.join(EBOOKS_DROPZONE_FOLDER, fileName);
        counter++;
    }

    fs.copyFileSync(sourcePath, destPath);
    return destPath;
}

ipcMain.handle("add-ebook-to-library", async (event, sourcePath) => {
    try {
        const destPath = copyIntoDropzone(sourcePath);
        return { success: true, path: destPath };
    } catch (err) {
        console.error("[reading-room] copy into dropzone failed:", err.message || err);
        return { success: false, error: "Couldn't add this file — try again." };
    }
});

// Full sync of the dropzone folder against the tracked library — catches
// anything dropped in via Explorer while Riftgate wasn't running, which
// the live fs.watch() alone would miss.
ipcMain.handle("scan-dropzone-folder", async () => {
    if (!EBOOKS_DROPZONE_FOLDER || !fs.existsSync(EBOOKS_DROPZONE_FOLDER)) return [];

    let ebooks = [];
    if (fs.existsSync(EBOOKS_FILE)) {
        try {
            ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        } catch (err) {
            ebooks = [];
        }
    }

    const trackedPaths = new Set(ebooks.map((b) => b.path.toLowerCase()));

    let filesOnDisk;
    try {
        filesOnDisk = fs.readdirSync(EBOOKS_DROPZONE_FOLDER);
    } catch (err) {
        return [];
    }

    const untracked = filesOnDisk
        .filter((f) => [".epub", ".pdf"].includes(path.extname(f).toLowerCase()))
        .map((f) => path.join(EBOOKS_DROPZONE_FOLDER, f))
        .filter((fullPath) => !trackedPaths.has(fullPath.toLowerCase()));

    return untracked;
});

ipcMain.handle("mark-ebook-opened", async (event, ebookPath) => {
    if (!fs.existsSync(EBOOKS_FILE)) return true;
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        const entry = ebooks.find((b) => b.path === ebookPath);
        if (entry) {
            entry.lastOpenedAt = Date.now();
            fs.writeFileSync(EBOOKS_FILE, JSON.stringify(ebooks, null, 2));
        }
        return true;
    } catch (err) {
        return false;
    }
});

ipcMain.handle("toggle-ebook-favorite", async (event, ebookPath) => {
    if (!fs.existsSync(EBOOKS_FILE)) return { success: false };
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        const entry = ebooks.find((b) => b.path === ebookPath);
        if (!entry) return { success: false };
        entry.favorite = !entry.favorite;
        fs.writeFileSync(EBOOKS_FILE, JSON.stringify(ebooks, null, 2));
        return { success: true, favorite: entry.favorite };
    } catch (err) {
        return { success: false };
    }
});

// Lets the user manually pick their own cover image from disk for any
// book — mirrors the equivalent feature already available for games,
// used here as a direct workaround for books where no cover could be
// found automatically (Open Library and Gutenberg don't have art for
// every title in their catalogs).
ipcMain.handle("select-ebook-cover-image", async () => {
    const result = await dialog.showOpenDialog(win, {
        title: "Choose a cover image",
        properties: ["openFile"],
        filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const chosenPath = result.filePaths[0];
    const ext = path.extname(chosenPath);

    if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });

    const fileName = `ebook-cover-${crypto.randomUUID()}${ext}`;
    const destPath = path.join(COVERS_FOLDER, fileName);
    fs.copyFileSync(chosenPath, destPath);

    return `covers/${fileName}`;
});

// Only relevant for books already in My Library — Discover Online/Buy
// Books results aren't persisted anywhere yet, so a manually-picked
// cover there just updates what's shown on screen for that session
// (and carries over automatically if the book is later downloaded,
// since that flow uses the book object's current cover field).
ipcMain.handle("update-ebook-cover", async (event, { ebookPath, newCover }) => {
    if (!fs.existsSync(EBOOKS_FILE)) return false;
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        const entry = ebooks.find((b) => b.path === ebookPath);
        if (entry) {
            entry.cover = newCover;
            fs.writeFileSync(EBOOKS_FILE, JSON.stringify(ebooks, null, 2));
        }
        return true;
    } catch (err) {
        return false;
    }
});

ipcMain.handle("remove-ebook", async (event, ebookPath) => {
    // Actually deletes the file too, not just the tracking entry — since
    // My Library is backed by the dropzone folder and gets rescanned on
    // every startup, untracking alone would just cause it to reappear
    // automatically on next launch.
    if (fs.existsSync(ebookPath) && path.resolve(path.dirname(ebookPath)).toLowerCase() === path.resolve(EBOOKS_DROPZONE_FOLDER).toLowerCase()) {
        try {
            fs.unlinkSync(ebookPath);
        } catch (err) {
            console.error("[reading-room] failed to delete file:", err.message || err);
        }
    }

    if (!fs.existsSync(EBOOKS_FILE)) return true;
    const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
    const updated = ebooks.filter((b) => b.path !== ebookPath);
    fs.writeFileSync(EBOOKS_FILE, JSON.stringify(updated, null, 2));
    return true;
});

// Opens the file with whatever the user's system already has set as the
// default handler for EPUB/PDF — matches the rest of Riftgate's
// "launcher, not a player" approach rather than rendering books in-app.
ipcMain.handle("launch-ebook", async (event, ebookPath) => {
    if (!fs.existsSync(ebookPath)) {
        return { success: false, error: "File not found." };
    }
    const result = await shell.openPath(ebookPath);
    if (result) {
        return { success: false, error: result };
    }
    return { success: true };
});

// Copies a book to wherever the user picks — a connected Kindle, phone,
// tablet, or any other drive mounted as storage — preserving the
// original filename.
ipcMain.handle("send-ebook-to-device", async (event, sourcePath) => {
    if (!fs.existsSync(sourcePath)) {
        return { success: false, error: "File not found." };
    }

    const result = await dialog.showOpenDialog(win, {
        title: "Choose where to send this book (e.g. your connected device)",
        properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
    }

    const destFolder = result.filePaths[0];
    const fileName = path.basename(sourcePath);
    const destPath = path.join(destFolder, fileName);

    try {
        fs.copyFileSync(sourcePath, destPath);
        return { success: true, path: destPath };
    } catch (err) {
        console.error("[reading-room] send-to-device failed:", err.message || err);
        return { success: false, error: "Couldn't copy the file — check the device has space and is still connected." };
    }
});

ipcMain.handle("check-missing-ebooks", async () => {
    if (!fs.existsSync(EBOOKS_FILE)) return [];
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        return ebooks
            .filter((b) => b.path && !fs.existsSync(b.path))
            .map((b) => ({ path: b.path, name: b.title || path.basename(b.path) }));
    } catch (err) {
        return [];
    }
});

// --- Free eBooks discovery (Project Gutenberg via the Gutendex API) -------
// Gutendex is Gutenberg's own public, no-auth-required JSON API, and
// crucially exposes a real download_count per book — the one clean,
// genuine popularity signal available across the sources considered for
// this feature, which is why it's used for all three ranked lists below.

// Independent uptime monitoring shows Gutendex has been genuinely
// unreliable (well under 50% uptime in recent history) — this is a
// third-party reliability problem, not a bug on Riftgate's side. Each
// page fetch gets a couple of quick retries before giving up, since
// failures there tend to be transient rather than a full outage.
async function fetchWithRetry(url, timeoutMs, attempts = 3) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await httpsGetJsonPlain(url, timeoutMs);
        } catch (err) {
            lastError = err;
            if (i < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
            }
        }
    }
    throw lastError;
}

async function fetchGutenbergPages(pages) {
    const allBooks = [];
    let lastError = null;
    for (let page = 1; page <= pages; page++) {
        try {
            const data = await fetchWithRetry(`https://gutendex.com/books/?sort=popular&page=${page}`, 10000);
            if (data && Array.isArray(data.results)) {
                allBooks.push(...data.results);
            }
            if (!data || !data.next) break;
        } catch (err) {
            lastError = err.message || String(err);
            console.error(`[ebooks] Gutenberg fetch failed after retries (page ${page}):`, lastError);
            break;
        }
    }
    return { books: allBooks, error: allBooks.length === 0 ? lastError : null };
}

function mapGutenbergBook(b) {
    const epubUrl = (b.formats && b.formats["application/epub+zip"]) || null;
    const coverUrl = (b.formats && b.formats["image/jpeg"]) || null;

    return {
        id: `gutenberg-${b.id}`,
        title: b.title || "Untitled",
        author: (b.authors && b.authors[0] && b.authors[0].name) || "Unknown",
        cover: coverUrl,
        downloadUrl: epubUrl,
        downloadCount: b.download_count || 0,
        summary: (b.summaries && b.summaries[0]) || null,
        source: "Project Gutenberg"
    };
}

ipcMain.handle("get-recommended-ebooks", async () => {
    try {
        const { books, error } = await fetchGutenbergPages(3);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books.filter((b) => b.formats && b.formats["application/epub+zip"]).map(mapGutenbergBook);
        // Shuffled from a broad popular pool — distinct from the strict
        // rank-order charts below, meant to feel like a rotating
        // discovery pick rather than "the same top 10 again".
        const shuffled = [...mapped].sort(() => Math.random() - 0.5);
        const result = shuffled.slice(0, 40);
        saveDataCache("cache-recommended-ebooks.json", result);
        return { success: true, books: result };
    } catch (err) {
        console.error("[ebooks] recommended fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-popular-ebooks", async () => {
    try {
        const { books, error } = await fetchGutenbergPages(2);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books.filter((b) => b.formats && b.formats["application/epub+zip"]).map(mapGutenbergBook);
        saveDataCache("cache-popular-ebooks.json", mapped);
        return { success: true, books: mapped };
    } catch (err) {
        console.error("[ebooks] popular fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-top-downloaded-ebooks", async () => {
    try {
        const { books, error } = await fetchGutenbergPages(4);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books
            .filter((b) => b.formats && b.formats["application/epub+zip"])
            .map(mapGutenbergBook)
            .slice(0, 100);
        saveDataCache("cache-top-downloaded-ebooks.json", mapped);
        return { success: true, books: mapped };
    } catch (err) {
        console.error("[ebooks] top-downloaded fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

// Instant retrieval of whatever was last successfully fetched, with no
// network call — this is what lets the app show real content the
// moment a section opens instead of an empty state while a fresh fetch
// is still in flight.
ipcMain.handle("get-cached-recommended-ebooks", async () => loadDataCache("cache-recommended-ebooks.json") || []);
ipcMain.handle("get-cached-popular-ebooks", async () => loadDataCache("cache-popular-ebooks.json") || []);
ipcMain.handle("get-cached-top-downloaded-ebooks", async () => loadDataCache("cache-top-downloaded-ebooks.json") || []);
ipcMain.handle("get-cached-openlibrary-popular", async () => loadDataCache("cache-openlibrary-popular.json") || []);
ipcMain.handle("get-cached-openlibrary-most-sold", async () => loadDataCache("cache-openlibrary-most-sold.json") || []);
ipcMain.handle("get-cached-openlibrary-new-releases", async () => loadDataCache("cache-openlibrary-new-releases.json") || []);

// Live search against Gutenberg's full catalog (70,000+ books) — unlike
// the Recommended/Popular/Top-100 lists, which only ever cover a small
// slice of the catalog, this actually queries the real thing so a search
// can find any public-domain book Gutenberg has, not just whatever
// happened to already be loaded on screen.
ipcMain.handle("search-gutenberg-books", async (event, query) => {
    if (!query || !query.trim()) return { success: true, books: [] };

    try {
        const data = await fetchWithRetry(
            `https://gutendex.com/books/?search=${encodeURIComponent(query.trim())}`,
            10000
        );
        const results = (data && Array.isArray(data.results)) ? data.results : [];
        const mapped = results
            .filter((b) => b.formats && b.formats["application/epub+zip"])
            .map(mapGutenbergBook);
        return { success: true, books: mapped };
    } catch (err) {
        console.error("[ebooks] Gutenberg search failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

// --- Buy Books (Open Library API) ------------------------------------
// Open Library (run by the nonprofit Internet Archive) has a genuinely
// free, public, well-documented API with no key needed — used here
// after Google Books proved unreliable in practice (both from a real
// bug on this app's side, since fixed, and possibly stricter
// unauthenticated rate limits on Google's side beyond that). Since Open
// Library is a library catalog rather than a marketplace, it has no
// real sale/price data of its own — every result links out to its Open
// Library page, which itself surfaces borrow/read/buy options where
// available. Nothing from this source is ever treated as "free" for
// the Discover Online transfer, since there's no reliable signal here
// to base that on (unlike Gutenberg, which is downloadable public
// domain by definition).

function mapOpenLibraryBook(doc) {
    const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
    const workKey = doc.key || null;

    // Open Library's own access-level field — since only a fraction of
    // its 20M+ catalog records actually have readable content attached,
    // this tells the UI whether a given book is genuinely accessible
    // here or just a metadata listing with no direct access.
    let accessLevel = "catalog";
    if (doc.ebook_access === "public") accessLevel = "public";
    else if (doc.ebook_access === "borrowable") accessLevel = "borrowable";
    else if (doc.ebook_access === "printdisabled") accessLevel = "printdisabled";

    return {
        id: `openlibrary-${workKey || doc.cover_edition_key || Math.random()}`,
        title: doc.title || "Untitled",
        author: (doc.author_name && doc.author_name[0]) || "Unknown",
        cover: coverUrl,
        description: null,
        workKey,
        publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
        isFree: false,
        price: null,
        accessLevel,
        buyLink: workKey ? `https://openlibrary.org${workKey}` : null,
        infoLink: workKey ? `https://openlibrary.org${workKey}` : null,
        source: "Open Library"
    };
}

async function fetchOpenLibraryBooks(query, sort) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const data = await fetchWithRetry(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=40&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access`,
        10000
    );
    const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
    return docs.filter((d) => d.title).map(mapOpenLibraryBook);
}

// New Releases specifically has a much worse cover-availability rate
// than the other lists — Open Library's "new" sort surfaces
// freshly-cataloged entries, and cover art indexing consistently lags
// behind cataloging, so a large share of genuinely recent entries just
// don't have artwork yet. Sorting no-cover items to the bottom helps,
// but doesn't fix having too few good results overall — this instead
// pulls a much larger candidate pool and filters to books that
// actually have a cover before trimming to the desired count, so what
// actually gets shown is consistently complete rather than mostly bare
// listings.
async function fetchOpenLibraryBooksWithCovers(query, sort, desiredCount) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const data = await fetchWithRetry(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=200&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access`,
        10000
    );
    const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
    const withCovers = docs.filter((d) => d.title && d.cover_i).map(mapOpenLibraryBook);

    if (withCovers.length >= desiredCount) {
        return withCovers.slice(0, desiredCount);
    }

    // Still came up short even from a 200-candidate pool — top up with
    // whatever no-cover ones exist rather than showing an unnecessarily
    // small list; the no-cover-last sort on the frontend still keeps
    // these visually at the bottom.
    const withoutCovers = docs.filter((d) => d.title && !d.cover_i).map(mapOpenLibraryBook);
    return [...withCovers, ...withoutCovers].slice(0, desiredCount);
}

ipcMain.handle("get-openlibrary-popular", async () => {
    try {
        const books = await fetchOpenLibraryBooks("fiction", "rating");
        saveDataCache("cache-openlibrary-popular.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library popular fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-openlibrary-most-sold", async () => {
    try {
        const books = await fetchOpenLibraryBooks("bestseller");
        saveDataCache("cache-openlibrary-most-sold.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library most-sold fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-openlibrary-new-releases", async () => {
    try {
        const books = await fetchOpenLibraryBooksWithCovers("fiction", "new", 40);
        saveDataCache("cache-openlibrary-new-releases.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library new-releases fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("search-openlibrary-books", async (event, query) => {
    if (!query || !query.trim()) return { success: true, books: [] };
    try {
        const books = await fetchOpenLibraryBooks(query.trim());
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library search failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

// Open Library's search listing never returns a description — that
// only lives on the separate per-work endpoint. Fetching it for every
// book in every list upfront would mean dozens of extra requests per
// load, so this is called lazily instead (on hover, matching the
// existing description-on-hover UI), one request per book actually
// looked at rather than the whole list every time.
ipcMain.handle("get-openlibrary-description", async (event, workKey) => {
    if (!workKey) return null;
    try {
        const data = await fetchWithRetry(`https://openlibrary.org${workKey}.json`, 8000);
        const desc = data && data.description;
        if (!desc) return null;
        // Open Library returns either a plain string or a {value: "..."}
        // structured-text object depending on the entry.
        return typeof desc === "string" ? desc : (desc.value || null);
    } catch (err) {
        return null;
    }
});


ipcMain.handle("download-free-ebook", async (event, book) => {
    if (!book.downloadUrl) {
        return { success: false, error: "No EPUB download available for this book." };
    }

    try {
        const ebooksFolder = path.join(app.getPath("userData"), "downloaded-ebooks");
        if (!fs.existsSync(ebooksFolder)) fs.mkdirSync(ebooksFolder, { recursive: true });

        const safeFileName = book.title.replace(/[^a-z0-9]/gi, "_").slice(0, 80) + `-${book.id}.epub`;
        const destPath = path.join(ebooksFolder, safeFileName);

        if (fs.existsSync(destPath)) {
            return { success: false, duplicate: true, path: destPath };
        }

        await downloadFileFollowingRedirects(book.downloadUrl, destPath);

        const meta = extractEpubMetadata(destPath);
        let coverPath = null;
        if (meta.coverBuffer) {
            try {
                if (!fs.existsSync(COVERS_FOLDER)) fs.mkdirSync(COVERS_FOLDER, { recursive: true });
                const coverFileName = `ebook-${crypto.randomUUID()}.jpg`;
                fs.writeFileSync(path.join(COVERS_FOLDER, coverFileName), meta.coverBuffer);
                // Relative to the local server's root, same as every other
                // cover in the app — an absolute path won't load as <img src>.
                coverPath = `covers/${coverFileName}`;
            } catch (err) {
                coverPath = null;
            }
        }

        return {
            success: true,
            path: destPath,
            title: meta.title || book.title,
            author: meta.author || book.author,
            cover: coverPath || null
        };
    } catch (err) {
        console.error("[ebooks] download failed:", err.message || err);
        return { success: false, error: "Download failed — check your connection and try again." };
    }
});

// Checks every installed entry's executable path against the actual
// filesystem — anything that no longer exists is very likely uninstalled
// (or moved), and the user is asked whether to clean it up rather than
// having it silently removed or left as a permanently broken entry.
// Many Electron-based apps (Discord, Slack, VS Code, and others) use a
// versioned-folder auto-update scheme: <parent>\app-X.Y.Z\<AppName>.exe.
// When the app updates itself, it creates a new version folder and the
// old one — which Riftgate's saved path points to — stops existing, so
// the app looks "removed" even though it's still installed, just at a
// new version folder. This checks specifically for that pattern before
// giving up, so an update doesn't get mistaken for an uninstall.
function findRelocatedVersionedApp(originalPath) {
    try {
        const dir = path.dirname(originalPath);
        const exeName = path.basename(originalPath);
        const dirName = path.basename(dir);

        if (!/^app-[\d.]+$/i.test(dirName)) return null;

        const parentDir = path.dirname(dir);
        if (!fs.existsSync(parentDir)) return null;

        const siblingFolders = fs.readdirSync(parentDir)
            .filter((name) => /^app-[\d.]+$/i.test(name) && name !== dirName);

        for (const folder of siblingFolders) {
            const candidatePath = path.join(parentDir, folder, exeName);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

ipcMain.handle("check-missing-games", async () => {
    if (!fs.existsSync(GAMES_FILE)) return [];

    try {
        const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
        let relocated = false;
        const genuinelyMissing = [];

        for (const g of games) {
            // Protocol-style paths (steam://, etc.) aren't real
            // filesystem paths — Steam-imported games use these since
            // Steam manifests don't reliably expose a real .exe path.
            // fs.existsSync would always return false for these, wrongly
            // flagging every one of them as "missing" regardless of
            // whether it's installed.
            if (!g.path || g.path.includes("://") || fs.existsSync(g.path)) continue;

            const relocatedPath = findRelocatedVersionedApp(g.path);
            if (relocatedPath) {
                g.path = relocatedPath;
                relocated = true;
            } else {
                genuinelyMissing.push({ path: g.path, name: g.name });
            }
        }

        if (relocated) {
            fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));
        }

        return genuinelyMissing;
    } catch (err) {
        console.error("[missing-games] check failed:", err.message || err);
        return [];
    }
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

// --- Persistent login session --------------------------------------------
// Keeps the user logged in across app restarts — a password is only asked
// for again after an explicit Log Out, not just because the app was closed
// and reopened. Encrypted at rest with Electron's safeStorage (OS-level —
// DPAPI on Windows) when available; falls back to a plain local file on the
// rare platform where OS encryption isn't available, since this still
// never leaves the machine and every privileged action re-verifies the
// password against the server on its own anyway.
ipcMain.handle("save-login-session", async (event, { username, password }) => {
    try {
        const payload = JSON.stringify({ username, password });
        if (safeStorage.isEncryptionAvailable()) {
            fs.writeFileSync(SESSION_FILE, safeStorage.encryptString(payload));
        } else {
            fs.writeFileSync(SESSION_FILE, payload, "utf8");
        }
        return { success: true };
    } catch (err) {
        console.error("[session] Failed to save login session:", err.message || err);
        return { success: false };
    }
});

ipcMain.handle("load-login-session", async () => {
    if (!fs.existsSync(SESSION_FILE)) return null;

    try {
        const raw = fs.readFileSync(SESSION_FILE);
        const payload = safeStorage.isEncryptionAvailable()
            ? safeStorage.decryptString(raw)
            : raw.toString("utf8");
        const parsed = JSON.parse(payload);
        if (!parsed || !parsed.username || !parsed.password) return null;
        return parsed;
    } catch (err) {
        // Corrupt file, or encrypted on a machine/user profile that can no
        // longer decrypt it — treat exactly like "no saved session" rather
        // than erroring the whole app out.
        return null;
    }
});

ipcMain.handle("clear-login-session", async () => {
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
        return { success: true };
    } catch (err) {
        console.error("[session] Failed to clear login session:", err.message || err);
        return { success: false };
    }
});

// --- Username system (Supabase) -----------------------------------------
// This "publishable" key is meant to be embedded in client apps exactly
// like this — it can only do what the database's Row Level Security
// policies allow (public read + insert on these two tables, nothing else),
// so it carries no meaningful risk on its own.
const SUPABASE_URL = "https://hblndwtdksnxlzlhiqir.supabase.co";
const SUPABASE_KEY = "sb_publishable_y8RbQHAV0rlHmkOLXz5iUw_5OdyUnpT";

function supabaseRequest(pathAndQuery, method, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`);
        const payload = body ? JSON.stringify(body) : null;

        const options = {
            method,
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json"
            }
        };

        if (method === "POST") {
            options.headers["Prefer"] = "return=representation";
        }
        if (payload) {
            options.headers["Content-Length"] = Buffer.byteLength(payload);
        }

        const req = https.request(url, options, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                let parsed = null;
                try { parsed = raw ? JSON.parse(raw) : null; } catch (err) { /* leave null */ }
                resolve({ statusCode: res.statusCode, body: parsed });
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("Supabase request timed out")));

        if (payload) req.write(payload);
        req.end();
    });
}

// Supabase Storage uses a different API shape than the JSON REST calls
// above (binary upload bodies, a signed-URL endpoint) — these two
// helpers handle that, used specifically for the private shared folder
// feature.
function supabaseStorageUpload(storagePath, fileBuffer, contentType) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/riftgate-shares/${storagePath}`);

        const req = https.request(url, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": contentType || "application/octet-stream",
                "Content-Length": fileBuffer.length
            }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                resolve({ statusCode: res.statusCode, body: raw });
            });
        });

        req.on("error", reject);
        req.setTimeout(60000, () => req.destroy(new Error("Upload timed out")));
        req.write(fileBuffer);
        req.end();
    });
}

function supabaseStorageSignedUrl(storagePath, expiresInSeconds) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/sign/riftgate-shares/${storagePath}`);
        const payload = JSON.stringify({ expiresIn: expiresInSeconds || 300 });

        const req = https.request(url, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed.signedURL ? `${SUPABASE_URL}/storage/v1${parsed.signedURL}` : null);
                } catch (err) {
                    resolve(null);
                }
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("Signed URL request timed out")));
        req.write(payload);
        req.end();
    });
}

function supabaseStorageDelete(storagePath) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/riftgate-shares/${storagePath}`);

        const req = https.request(url, {
            method: "DELETE",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            }
        }, (res) => {
            res.on("data", () => {});
            res.on("end", () => resolve(res.statusCode));
        });

        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("Delete request timed out")));
        req.end();
    });
}

// A random ID generated once and stored locally, never tied to any
// personal information — this is what makes a username "belong" to a
// specific install, instead of relying on IP address.
ipcMain.handle("get-device-id", async () => {
    let current = { ...DEFAULT_SETTINGS };

    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
        } catch (err) {
            // fall back to defaults if the file is somehow corrupt
        }
    }

    if (!current.deviceId) {
        current.deviceId = crypto.randomUUID();
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2));
    }

    return current.deviceId;
});

// Every registered Riftgate username — used by the super-admin's "Manage
// Users" panel to search and promote/demote any real user, instead of
// requiring their exact username to be typed in blind.
ipcMain.handle("get-all-usernames", async () => {
    try {
        const result = await supabaseRequest("usernames?select=username&order=username.asc&limit=500", "GET");
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, usernames: [] };
        }
        return { success: true, usernames: result.body.map((u) => u.username) };
    } catch (err) {
        console.error("[admin] get-all-usernames failed:", err.message || err);
        return { success: false, usernames: [] };
    }
});

// Admin status is displayed by appending "_Adm" or "_Root" to a real
// admin's username — a regular user choosing a nickname that literally
// ends the same way (e.g. "SomeName_Adm") would look visually
// identical to a genuine admin anywhere their name is shown, even
// though they'd have none of the actual permissions. Blocking these
// suffixes at registration prevents that impersonation outright.
const RESERVED_USERNAME_SUFFIXES = ["_adm", "_root", "_admin", "_administrator"];

function hasReservedAdminSuffix(username) {
    const lower = username.toLowerCase();
    return RESERVED_USERNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

ipcMain.handle("check-username-available", async (event, username) => {
    if (hasReservedAdminSuffix(username)) {
        return { available: false, error: "Usernames can't end in \"_Adm\", \"_Root\", or similar — those are reserved to prevent impersonating an admin." };
    }

    try {
        const result = await supabaseRequest(
            `usernames?username=eq.${encodeURIComponent(username)}&select=id`,
            "GET"
        );

        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { available: false, error: "Couldn't check right now — check your connection and try again." };
        }

        return { available: result.body.length === 0 };
    } catch (err) {
        console.error("[username] availability check failed:", err.message || err);
        return { available: false, error: "Couldn't check right now — check your connection and try again." };
    }
});

ipcMain.handle("register-username", async (event, { username, deviceId }) => {
    if (hasReservedAdminSuffix(username)) {
        return { success: false, error: "Usernames can't end in \"_Adm\", \"_Root\", or similar — those are reserved to prevent impersonating an admin." };
    }

    try {
        const result = await supabaseRequest("usernames", "POST", {
            username,
            device_id: deviceId
        });

        if (result.statusCode === 201) {
            return { success: true };
        }

        // The unique constraint is the real source of truth — if someone
        // else grabs the name in the split second between our check and
        // this insert, the database itself will reject it here.
        if (result.statusCode === 409) {
            return { success: false, error: "That username was just taken — try another." };
        }

        return { success: false, error: "Something went wrong — try again." };
    } catch (err) {
        console.error("[username] registration failed:", err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
});

// --- Suggestions (Supabase) ------------------------------------------------

ipcMain.handle("submit-suggestion", async (event, { username, text }) => {
    try {
        const result = await supabaseRequest("suggestions", "POST", {
            username: username || null,
            suggestion_text: text
        });

        if (result.statusCode === 201) {
            return { success: true };
        }

        return { success: false, error: "Something went wrong — try again." };
    } catch (err) {
        console.error("[suggestions] submit failed:", err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
});

ipcMain.handle("get-suggestions", async () => {
    try {
        // Embeds each suggestion's replies in one request via PostgREST's
        // foreign-key embedding — suggestion_replies.suggestion_id already
        // references suggestions(id), so this works without a manual join.
        // This depends on the admin-system SQL having been run (that's
        // what creates suggestion_replies) — if it hasn't, this falls
        // back to a plain suggestions-only query below rather than
        // breaking suggestion viewing entirely for anyone who hasn't set
        // that up yet.
        const result = await supabaseRequest(
            "suggestions?select=id,username,suggestion_text,created_at,status,resolved_at,code_change_done,fix_applied_at,suggestion_replies(id,reply_text,created_at)&order=created_at.desc&suggestion_replies.order=created_at.asc&limit=200",
            "GET"
        );

        if (result.statusCode === 200 && Array.isArray(result.body)) {
            return { success: true, suggestions: result.body };
        }

        // Fallback: suggestion_replies (or the status/resolved_at columns)
        // probably doesn't exist yet.
        const fallback = await supabaseRequest(
            "suggestions?select=id,username,suggestion_text,created_at&order=created_at.desc&limit=200",
            "GET"
        );

        if (fallback.statusCode !== 200 || !Array.isArray(fallback.body)) {
            return { success: false, error: "Couldn't load suggestions right now." };
        }

        return {
            success: true,
            suggestions: fallback.body.map((s) => ({ ...s, suggestion_replies: [] }))
        };
    } catch (err) {
        console.error("[suggestions] fetch failed:", err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
});

// --- Admin system (Supabase, password never leaves the database) ---------
// Every privileged action below calls a Postgres function that re-checks
// the password hash server-side — the app never has access to the actual
// hash, only a yes/no answer, so nothing useful can be extracted even by
// reading this source code.

async function callAdminRpc(fnName, params) {
    try {
        const result = await supabaseRequest(`rpc/${fnName}`, "POST", params);
        if (result.statusCode !== 200) {
            // A non-200 here doesn't necessarily mean a connectivity
            // problem — it's just as likely the SQL function itself
            // rejecting the call (e.g. a stale/incorrect cached admin
            // password failing verify_admin_login and raising "Not
            // authorized"). Surfacing the real body instead of a
            // generic message is what actually tells the two apart.
            let detail = result.body;
            try {
                const parsed = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
                detail = (parsed && (parsed.message || parsed.error)) || result.body;
            } catch (err) {
                // body wasn't JSON — use it raw
            }
            console.error(`[admin] ${fnName} returned ${result.statusCode}:`, detail);
            return { success: false, error: `${detail || "Request failed"} (status ${result.statusCode})` };
        }
        return { success: true, result: result.body };
    } catch (err) {
        console.error(`[admin] ${fnName} failed:`, err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
}

// Checks whether this username needs to set/reset its password before
// doing anything else — either it's a brand-new admin with no password
// yet, or a super-admin triggered a reset for them.
ipcMain.handle("admin-needs-password-setup", async (event, username) => {
    const r = await callAdminRpc("admin_needs_password_setup", { input_username: username });
    if (!r.success) return r;
    return { success: true, needsSetup: r.result === true };
});

// True only for a username that already exists in the admins table at
// all — used to give a clear "you're not on the admin list" message
// instead of a generic wrong-password error.
ipcMain.handle("admin-account-exists", async (event, username) => {
    try {
        const result = await supabaseRequest(`rpc/get_admin_usernames`, "POST", {});
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, exists: false };
        }
        return { success: true, exists: result.body.some((a) => a.username === username) };
    } catch (err) {
        return { success: false, exists: false };
    }
});

ipcMain.handle("verify-admin-login", async (event, { username, password }) => {
    const r = await callAdminRpc("verify_admin_login", { input_username: username, input_password: password });
    if (!r.success) return r;
    return { success: true, valid: r.result === true };
});

// Sets your OWN password — works for first-time setup (no password yet)
// and for completing a reset a super-admin triggered.
ipcMain.handle("set-own-admin-password", async (event, { username, newPassword }) => {
    const r = await callAdminRpc("set_own_admin_password", { input_username: username, new_password: newPassword });
    if (!r.success) return r;
    return { success: true, changed: r.result === true };
});

// --- Vault (shared-folder) password gate -----------------------------
//
// Being on the allowlist used to be enough on its own to get Vault access
// — the username is just a self-chosen local nickname with no password
// behind it, so anyone who typed in (or set their own nickname to) an
// allowlisted name got full access with nothing proving they were that
// person. This mirrors the admin login pattern (first-time setup, then a
// password checked server-side on every login) so allowlist membership
// alone is no longer sufficient.
ipcMain.handle("vault-needs-password-setup", async (event, username) => {
    const r = await callAdminRpc("vault_needs_password_setup", { input_username: username });
    if (!r.success) return r;
    return { success: true, needsSetup: r.result === true };
});

ipcMain.handle("verify-vault-login", async (event, { username, password }) => {
    const r = await callAdminRpc("verify_vault_login", { input_username: username, input_password: password });
    if (!r.success) return r;
    return { success: true, valid: r.result === true };
});

ipcMain.handle("set-own-vault-password", async (event, { username, newPassword }) => {
    const r = await callAdminRpc("set_own_vault_password", { input_username: username, new_password: newPassword });
    if (!r.success) return r;
    return { success: true, changed: r.result === true };
});

// --- Unified login (one password per account) -------------------------
//
// Replaces both the admin-only password and the Vault-only password
// above with a single account password, set the first time someone opens
// Riftgate and checked once every time after that. Admin status and
// Vault access are both then granted automatically based on who's
// logged in — see admin-account-exists / check-allowlist-only, which are
// plain membership checks with no password of their own.
ipcMain.handle("login-needs-password-setup", async (event, username) => {
    const r = await callAdminRpc("login_needs_password_setup", { input_username: username });
    if (!r.success) return r;
    return { success: true, needsSetup: r.result === true };
});

ipcMain.handle("verify-login", async (event, { username, password }) => {
    const r = await callAdminRpc("verify_login", { input_username: username, input_password: password });
    if (!r.success) return r;
    return { success: true, valid: r.result === true };
});

ipcMain.handle("set-own-login-password", async (event, { username, newPassword }) => {
    const r = await callAdminRpc("set_own_login_password", { input_username: username, new_password: newPassword });
    if (!r.success) return r;
    return { success: true, changed: r.result === true };
});

// Everything below requires super-admin credentials, re-verified inside
// the database function itself every single time — a regular admin
// passing their own valid credentials here simply gets rejected.
ipcMain.handle("super-add-admin", async (event, { superUsername, superPassword, newUsername, makeSuper }) => {
    const r = await callAdminRpc("super_add_admin", {
        super_username: superUsername,
        super_password: superPassword,
        new_username: newUsername,
        make_super: !!makeSuper
    });
    if (!r.success) return r;
    return { success: true, added: r.result === true };
});

ipcMain.handle("super-remove-admin", async (event, { superUsername, superPassword, targetUsername }) => {
    const r = await callAdminRpc("super_remove_admin", {
        super_username: superUsername,
        super_password: superPassword,
        target_username: targetUsername
    });
    if (!r.success) return r;
    return { success: true, removed: r.result === true };
});

ipcMain.handle("super-trigger-password-reset", async (event, { superUsername, superPassword, targetUsername }) => {
    const r = await callAdminRpc("super_trigger_password_reset", {
        super_username: superUsername,
        super_password: superPassword,
        target_username: targetUsername
    });
    if (!r.success) return r;
    return { success: true, triggered: r.result === true };
});

ipcMain.handle("super-set-role", async (event, { superUsername, superPassword, targetUsername, makeSuper }) => {
    const r = await callAdminRpc("super_set_role", {
        super_username: superUsername,
        super_password: superPassword,
        target_username: targetUsername,
        make_super: !!makeSuper
    });
    if (!r.success) return r;
    return { success: true, changed: r.result === true };
});

ipcMain.handle("delete-suggestion", async (event, { username, password, id }) => {
    const r = await callAdminRpc("delete_suggestion", { input_username: username, input_password: password, target_id: id });
    if (!r.success) return r;
    return { success: true, deleted: r.result === true };
});

ipcMain.handle("delete-reply", async (event, { username, password, id }) => {
    const r = await callAdminRpc("delete_reply", { input_username: username, input_password: password, target_id: id });
    if (!r.success) return r;
    return { success: true, deleted: r.result === true };
});

ipcMain.handle("add-admin-reply", async (event, { username, password, suggestionId, text }) => {
    const r = await callAdminRpc("add_admin_reply", {
        input_username: username,
        input_password: password,
        target_suggestion_id: suggestionId,
        reply_text: text
    });
    if (!r.success) return r;
    return { success: true, added: r.result === true };
});

// Only a super-admin can approve or reject a suggestion for an automatic
// code fix — verified server-side inside these RPCs (membership in
// "admins" with is_super_admin = true, plus the account's own login
// password), not just by what the renderer happens to show. Approving
// only marks the suggestion; the actual code change is made separately
// by a scheduled check-in, not by this app.
ipcMain.handle("apply-suggestion", async (event, { username, password, id }) => {
    const r = await callAdminRpc("apply_suggestion", { input_username: username, input_password: password, target_id: id });
    if (!r.success) return r;
    return { success: true, applied: r.result === true };
});

ipcMain.handle("reject-suggestion", async (event, { username, password, id }) => {
    const r = await callAdminRpc("reject_suggestion", { input_username: username, input_password: password, target_id: id });
    if (!r.success) return r;
    return { success: true, rejected: r.result === true };
});

// --- Private Shared Folder --------------------------------------------

ipcMain.handle("check-share-access", async (event, username) => {
    const result = await callAdminRpc("check_share_access", { p_username: username });
    return result.success ? !!result.result : false;
});

// Checks the allowlist specifically, separate from admin status — used
// so admin-based Vault access requires actually being logged in as
// admin in the current session, while allowlist-based access stays
// permanent regardless of session state (which is the whole point of
// an allowlist).
ipcMain.handle("check-allowlist-only", async (event, username) => {
    const result = await callAdminRpc("check_allowlist_only", { p_username: username });
    return result.success ? !!result.result : false;
});

ipcMain.handle("get-shared-files", async (event, { username, password }) => {
    const result = await callAdminRpc("get_shared_files", { p_username: username, p_password: password || null });
    if (!result.success) return { success: false, files: [], error: result.error };
    return { success: true, files: Array.isArray(result.result) ? result.result : [] };
});

ipcMain.handle("upload-shared-file", async (event, { username, password, description, expiresHours }) => {
    const picked = await dialog.showOpenDialog(win, {
        title: "Choose a file to share",
        properties: ["openFile"]
    });

    if (picked.canceled || picked.filePaths.length === 0) {
        return { success: false, canceled: true };
    }

    const filePath = picked.filePaths[0];
    const originalName = path.basename(filePath);

    try {
        // Supabase's free tier hard-caps every upload at 50MB, with no
        // way to configure around it — checking this upfront gives a
        // clear, specific reason immediately, instead of only finding
        // out after the upload attempt fails.
        const stats = fs.statSync(filePath);
        const fileSizeMb = stats.size / (1024 * 1024);
        if (fileSizeMb > 50) {
            return {
                success: false,
                error: `This file is ${fileSizeMb.toFixed(1)}MB, but the free Supabase plan only allows up to 50MB per file. Split it into smaller parts, or upgrade to Supabase Pro to remove this limit.`
            };
        }

        const fileBuffer = fs.readFileSync(filePath);
        const storagePath = `${crypto.randomUUID()}-${safeFileName(originalName)}`;

        const uploadResult = await supabaseStorageUpload(storagePath, fileBuffer);
        if (uploadResult.statusCode !== 200) {
            // Surface the real reason instead of a generic message — this
            // is the one part of the whole feature I genuinely couldn't
            // verify without live testing, so seeing the actual Supabase
            // response is what actually diagnoses it instead of guessing.
            console.error(`[share] upload failed — status ${uploadResult.statusCode}:`, uploadResult.body);
            let detail = uploadResult.body;
            try {
                const parsed = JSON.parse(uploadResult.body);
                detail = parsed.message || parsed.error || uploadResult.body;
            } catch (err) {
                // body wasn't JSON — use it raw
            }
            return { success: false, error: `Upload failed (${uploadResult.statusCode}): ${detail}` };
        }

        const metaResult = await callAdminRpc("add_shared_file", {
            p_username: username,
            p_filename: originalName,
            p_storage_path: storagePath,
            p_file_size: fileBuffer.length,
            p_description: description || null,
            p_expires_hours: expiresHours,
            p_password: password || null
        });

        if (!metaResult.success) {
            return { success: false, error: metaResult.error || "Couldn't record the shared file — you may not be on the allowlist." };
        }

        return { success: true, file: metaResult.result };
    } catch (err) {
        console.error("[share] upload failed:", err.message || err);
        return { success: false, error: "Something went wrong reading or uploading that file." };
    }
});

// Just the signed URL, no save dialog — used for hover-preview of image
// files, as opposed to download-shared-file which is the full
// "pick where to save it" flow.
ipcMain.handle("get-shared-file-preview-url", async (event, storagePath) => {
    try {
        const signedUrl = await supabaseStorageSignedUrl(storagePath, 3600);
        return signedUrl ? { success: true, url: signedUrl } : { success: false };
    } catch (err) {
        return { success: false };
    }
});

ipcMain.handle("download-shared-file", async (event, { storagePath, filename }) => {
    const saveResult = await dialog.showSaveDialog(win, {
        title: "Save shared file",
        defaultPath: filename
    });

    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
    }

    try {
        const signedUrl = await supabaseStorageSignedUrl(storagePath);
        if (!signedUrl) {
            return { success: false, error: "Couldn't generate a download link — try again." };
        }

        const fileBuffer = await new Promise((resolve, reject) => {
            https.get(signedUrl, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Download failed with status ${res.statusCode}`));
                    return;
                }
                const chunks = [];
                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => resolve(Buffer.concat(chunks)));
            }).on("error", reject);
        });

        fs.writeFileSync(saveResult.filePath, fileBuffer);
        return { success: true, path: saveResult.filePath };
    } catch (err) {
        console.error("[share] download failed:", err.message || err);
        return { success: false, error: "Something went wrong downloading that file." };
    }
});

ipcMain.handle("delete-shared-file", async (event, { username, fileId, storagePath, adminPassword, password }) => {
    const result = await callAdminRpc("delete_shared_file", {
        p_username: username,
        p_file_id: fileId,
        p_admin_password: adminPassword || null,
        p_password: password || null
    });

    const deleted = result.success ? !!result.result : false;

    // The metadata row is the source of truth for whether this
    // succeeded — if it did, also remove the actual file from storage
    // so deleted shares don't just sit there as orphaned data forever.
    if (deleted && storagePath) {
        try {
            await supabaseStorageDelete(storagePath);
        } catch (err) {
            console.error("[share] storage cleanup after delete failed:", err.message || err);
        }
    }

    return deleted;
});

// Removes every expired share's metadata row, then deletes each one's
// actual file from storage — the RPC below only handles the metadata
// side (returning what it deleted), so the storage cleanup happens
// here in the app. Any allowlisted user's Riftgate can safely trigger
// this; it's called periodically rather than needing a dedicated
// server to run on a schedule.
ipcMain.handle("cleanup-expired-shared-files", async (event, { username, password }) => {
    const result = await callAdminRpc("cleanup_expired_shared_files", { p_username: username, p_password: password || null });
    if (!result.success || !Array.isArray(result.result)) return { success: false, cleaned: 0 };

    for (const file of result.result) {
        try {
            await supabaseStorageDelete(file.storage_path);
        } catch (err) {
            console.error("[share] expired file storage cleanup failed:", err.message || err);
        }
    }

    return { success: true, cleaned: result.result.length };
});

ipcMain.handle("force-clean-shared-folder", async (event, { adminUsername, adminPassword }) => {
    const result = await callAdminRpc("force_clean_shared_folder", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword
    });

    if (!result.success || !Array.isArray(result.result)) {
        return { success: false, error: result.error };
    }

    for (const file of result.result) {
        try {
            await supabaseStorageDelete(file.storage_path);
        } catch (err) {
            console.error("[share] force-clean storage cleanup failed:", err.message || err);
        }
    }

    return { success: true, cleaned: result.result.length };
});

// --- Shared links (WeTransfer etc., for files over the 50MB cap) ------

ipcMain.handle("get-shared-links", async (event, { username, password }) => {
    const result = await callAdminRpc("get_shared_links", { p_username: username, p_password: password || null });
    if (!result.success) return { success: false, links: [], error: result.error };
    return { success: true, links: Array.isArray(result.result) ? result.result : [] };
});

ipcMain.handle("add-shared-link", async (event, { username, password, url, description }) => {
    const result = await callAdminRpc("add_shared_link", {
        p_username: username,
        p_url: url,
        p_description: description || null,
        p_password: password || null
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true, link: result.result };
});

ipcMain.handle("delete-shared-link", async (event, { username, linkId, adminPassword, password }) => {
    const result = await callAdminRpc("delete_shared_link", {
        p_username: username,
        p_link_id: linkId,
        p_admin_password: adminPassword || null,
        p_password: password || null
    });
    return result.success ? !!result.result : false;
});

ipcMain.handle("cleanup-expired-shared-links", async (event, { username, password }) => {
    const result = await callAdminRpc("cleanup_expired_shared_links", { p_username: username, p_password: password || null });
    if (!result.success) return { success: false, cleaned: 0 };
    return { success: true, cleaned: Array.isArray(result.result) ? result.result.length : 0 };
});

ipcMain.handle("force-clean-shared-links", async (event, { adminUsername, adminPassword }) => {
    const result = await callAdminRpc("force_clean_shared_links", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword
    });
    if (!result.success) return { success: false, error: result.error };
    return { success: true, cleaned: Array.isArray(result.result) ? result.result.length : 0 };
});

ipcMain.handle("add-to-share-allowlist", async (event, { adminUsername, adminPassword, targetUsername }) => {
    const result = await callAdminRpc("add_to_share_allowlist", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_target_username: targetUsername
    });
    return { success: result.success && !!result.result, error: result.error };
});

ipcMain.handle("remove-from-share-allowlist", async (event, { adminUsername, adminPassword, targetUsername }) => {
    const result = await callAdminRpc("remove_from_share_allowlist", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_target_username: targetUsername
    });
    return { success: result.success && !!result.result, error: result.error };
});

ipcMain.handle("get-share-allowlist", async (event, { adminUsername, adminPassword }) => {
    const result = await callAdminRpc("get_share_allowlist", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword
    });
    if (!result.success) return { success: false, list: [], error: result.error };
    return { success: true, list: Array.isArray(result.result) ? result.result : [] };
});

// Safe, public-facing lists — never include password_hash, unlike a raw
// table read would.
ipcMain.handle("get-admins", async () => {
    try {
        const result = await supabaseRequest("rpc/get_admin_usernames", "POST", {});
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, admins: [] };
        }
        return { success: true, admins: result.body.map((a) => a.username) };
    } catch (err) {
        console.error("[admin] get-admins failed:", err.message || err);
        return { success: false, admins: [] };
    }
});

ipcMain.handle("get-admin-list-detailed", async () => {
    try {
        const result = await supabaseRequest("rpc/get_admin_list", "POST", {});
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, admins: [] };
        }
        return { success: true, admins: result.body };
    } catch (err) {
        console.error("[admin] get-admin-list-detailed failed:", err.message || err);
        return { success: false, admins: [] };
    }
});

// Admin-only export of every suggestion (and its replies) as a plain
// text file, for reviewing/processing outside the app.
ipcMain.handle("export-suggestions-txt", async (event, { username, password }) => {
    const verify = await callAdminRpc("verify_admin_login", { input_username: username, input_password: password });
    if (!verify.success || verify.result !== true) {
        return { success: false, error: "Not authorized." };
    }

    try {
        const result = await supabaseRequest(
            "suggestions?select=username,suggestion_text,created_at,suggestion_replies(reply_text,created_at)&order=created_at.desc&suggestion_replies.order=created_at.asc",
            "GET"
        );

        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, error: "Couldn't load suggestions." };
        }

        const lines = [];
        lines.push(`Riftgate Suggestions Export — ${new Date().toLocaleString()}`);
        lines.push(`Total suggestions: ${result.body.length}`);
        lines.push("=".repeat(60));
        lines.push("");

        result.body.forEach((s, i) => {
            lines.push(`[${i + 1}] From: ${s.username || "Anonymous"}  |  ${new Date(s.created_at).toLocaleString()}`);
            lines.push(s.suggestion_text);
            (s.suggestion_replies || []).forEach((r) => {
                lines.push(`    > Reply (${new Date(r.created_at).toLocaleString()}): ${r.reply_text}`);
            });
            lines.push("-".repeat(60));
        });

        const saveResult = await dialog.showSaveDialog(win, {
            title: "Export Suggestions",
            defaultPath: `riftgate-suggestions-${Date.now()}.txt`,
            filters: [{ name: "Text File", extensions: ["txt"] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, canceled: true };
        }

        fs.writeFileSync(saveResult.filePath, lines.join("\n"), "utf8");
        return { success: true, path: saveResult.filePath };
    } catch (err) {
        console.error("[admin] export-suggestions-txt failed:", err.message || err);
        return { success: false, error: "Something went wrong exporting." };
    }
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

    try {
        const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));

        games.forEach((g) => {
            delete g.description;
            delete g.trailerId;
        });

        fs.writeFileSync(GAMES_FILE, JSON.stringify(games, null, 2));

        return games;
    } catch (err) {
        console.error("[refresh-metadata] failed:", err.message || err);
        return [];
    }
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
    startDropzoneWatcher();

    // A single one-shot check with no retry meant that if it happened to
    // fail once (a network hiccup, GitHub briefly unreachable, etc.),
    // the user would never be notified for the rest of that session even
    // though a real update existed — this retries a few times with
    // backoff, then re-checks periodically so a session left open for a
    // long time still eventually catches an update that becomes
    // available after startup.
    function checkForUpdatesWithRetry(attempt) {
        autoUpdater.checkForUpdates().catch((err) => {
            console.error(`[updater] check failed (attempt ${attempt}):`, err.message || err);
            if (attempt < 3) {
                setTimeout(() => checkForUpdatesWithRetry(attempt + 1), 15000 * attempt);
            }
        });
    }

    // Waits for the renderer to actually confirm its update listeners
    // are registered, instead of guessing with a fixed timeout — a
    // guess that fires even slightly too early means the notification
    // is silently lost forever, since Electron's IPC doesn't queue
    // messages sent before anything is listening. The startup animation
    // and general page-load time can vary enough (slower machines
    // especially) that a fixed few seconds isn't reliably safe. A
    // generous fallback still triggers the check even if that signal is
    // somehow never received, so a broken renderer doesn't block
    // updates from ever being checked.
    let rendererReadyForUpdates = false;
    ipcMain.once("renderer-ready-for-updates", () => {
        if (rendererReadyForUpdates) return;
        rendererReadyForUpdates = true;
        checkForUpdatesWithRetry(1);
    });

    setTimeout(() => {
        if (rendererReadyForUpdates) return;
        rendererReadyForUpdates = true;
        console.error("[updater] renderer-ready signal never arrived — checking anyway via fallback timeout.");
        checkForUpdatesWithRetry(1);
    }, 15000);

    // Checks as often as GitHub's unauthenticated API allows without
    // going over: 60 requests per hour per machine, divided evenly
    // across the hour = one check every 60 seconds. The existing
    // "update-available" / "update-not-available" handling in the
    // renderer already does exactly what's wanted here with zero changes
    // needed there: it only pops the update dialog when a newer version
    // is actually found (see ipcRenderer.on("update-available") in
    // renderer.js) and otherwise stays completely silent for anything
    // that isn't a manual "Check for Updates" click.
    setInterval(() => checkForUpdatesWithRetry(1), 60 * 1000);
});


console.log("=====================================");
console.log("Game Launcher started");
console.log("Online cover fetch (SteamGridDB): via Supabase media-proxy Edge Function.");
console.log("=====================================");