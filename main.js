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
let FREEGAMES_UNAVAILABLE_FILE;
let FREEGAMES_VERIFIED_FILE;
let FREEGAMES_LAST_REFRESH_FILE;
let FREEGAMES_BULK_SEARCH_DONE_FILE;
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
    ambientBackground: true,
    colorTheme: "riftgate",
    lastSeenVersion: null,
    lastSeenTourVersion: null,
    launchAtStartup: false,
    defaultCategory: "ask",
    confirmBeforeRemove: true,
    gridDensity: "comfortable",
    trailerVolume: 50,
    runInBackground: false,
    dismissedImports: [],
    categoryOrder: ["game", "vr", "app", "other"],
    sectionOrder: ["new", "installed", "free-games", "theatre", "reading-room", "shared-folder", "applications"],
    movieCountry: "US",
    upcomingMoviesCountry: "US",
    startupSection: "new",
    lastReadingRoomTab: "buyfree",
    movieCity: "",
    startupAnimation: true,
    deviceId: null,
    username: null,
    // SteamID64 the user enters in Settings, plus the last playtime pull
    // from Steam's API — see refresh-steam-playtime below. Not a secret,
    // just an identifier (like a username), so it's fine to sit in plain
    // settings.json alongside everything else here.
    steamId64: "",
    steamPlaytimes: {},
    steamPlaytimesUpdatedAt: null,
    // "Mark as seen/watched" state for TV episodes (keyed by
    // "showId|season|number", so a newly aired episode gets a fresh key
    // and naturally shows as unwatched) and movies (keyed by TMDB id).
    seenEpisodes: {},
    seenMovies: {}
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
    BR: "pt-BR",
    IT: "it-IT",
    NL: "nl-NL",
    BE: "nl-BE",
    IE: "en-IE",
    CH: "de-CH",
    AT: "de-AT",
    MX: "es-MX",
    AR: "es-AR",
    CL: "es-CL",
    CO: "es-CO",
    JP: "ja-JP",
    KR: "ko-KR",
    CN: "zh-CN",
    HK: "zh-HK",
    TW: "zh-TW",
    IN: "hi-IN",
    RU: "ru-RU",
    SE: "sv-SE",
    NO: "no-NO",
    DK: "da-DK",
    FI: "fi-FI",
    PL: "pl-PL",
    TR: "tr-TR",
    GR: "el-GR",
    CZ: "cs-CZ",
    HU: "hu-HU",
    RO: "ro-RO",
    ZA: "en-ZA",
    NZ: "en-NZ",
    PH: "en-PH",
    ID: "id-ID",
    MY: "ms-MY",
    SG: "en-SG",
    TH: "th-TH",
    VN: "vi-VN",
    SA: "ar-SA",
    AE: "ar-AE",
    EG: "ar-EG",
    IL: "he-IL",
    UA: "uk-UA"
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

// A Steam-imported game's saved "path" is a steam://rungameid/<appid>
// launch URL, not a real filesystem path (Steam manifests don't reliably
// expose a usable .exe path) — so it can never be checked with
// fs.existsSync the way every other entry is. The manifest file Steam
// itself writes for an installed game (appmanifest_<appid>.acf, in
// whichever library folder it's installed to) IS a real file on disk
// though, and Steam deletes it the moment a game is uninstalled — so
// that file's existence is what actually stands in for "is this Steam
// game still installed" for check-missing-games below.
function isSteamAppStillInstalled(appid) {
    try {
        for (const steamapps of findSteamLibraryPaths()) {
            if (fs.existsSync(path.join(steamapps, `appmanifest_${appid}.acf`))) {
                return true;
            }
        }
        return false;
    } catch (err) {
        // Same caution as the rest of this feature: if the check itself
        // fails (Steam not found, a permissions hiccup), never treat that
        // as "uninstalled" and wrongly flag every Steam game at once.
        return true;
    }
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

// Steam/Epic manifests only cover those two stores — anything installed
// through a different launcher (Battle.net, Ubisoft Connect, GOG Galaxy,
// EA App, Riot, Wargaming Game Center, Rockstar Games Launcher, ...) or as
// a plain standalone install has no manifest for scanSteamGames/
// scanEpicGames to read, so it only turns up via the Start Menu shortcut
// sweep below. This combined list is deliberately used ONLY by the manual,
// user-initiated "Scan for Apps & Games" button (scan-all-installed) — the
// shortcut sweep finds literally every piece of software already sitting
// on the computer, and running it automatically at startup meant Riftgate
// asked, one at a time, "Add X to Riftgate?" for every pre-existing
// Windows app it had never seen before, not just genuinely new installs.
// The automatic startup check (scan-new-games, below) intentionally stays
// narrower — Steam/Epic only, the "outside" stores Riftgate actually
// watches for new installs — so a game like World of Tanks or any other
// shortcut-only software is still fully discoverable, just through the
// manual scan the user opens on their own rather than an unprompted popup.
async function findAllInstalledCandidates() {
    const storeGames = [...scanSteamGames(), ...scanEpicGames()];
    const shortcutApps = await scanStartMenuShortcuts();

    const combined = [...storeGames, ...shortcutApps];

    // De-dupe by resolved path + name — the same install can turn up both
    // as a store manifest entry and a Start Menu shortcut. Name is part of
    // the key (not path alone) for the same reason scanStartMenuShortcuts
    // includes it above: several distinct shortcut-only games can share
    // one launcher .exe as their path (every Battle.net title, for one),
    // and deduping by path alone would collapse all of them into one.
    const seenPaths = new Set();
    const deduped = [];
    for (const item of combined) {
        const key = item.path.toLowerCase() + "|" + item.name.toLowerCase();
        if (seenPaths.has(key)) continue;
        seenPaths.add(key);
        deduped.push(item);
    }

    return deduped;
}

// Automatic startup check — deliberately limited to Steam/Epic store
// detections ("outside apps"), not the full Start Menu shortcut sweep
// findAllInstalledCandidates() also does. Sweeping every already-installed
// piece of Windows software into this automatic, one-at-a-time prompt was
// too noisy: it re-litigated the user's entire existing software library
// instead of only flagging genuinely new installs. Anything shortcut-only
// (World of Tanks, other launchers, regular desktop apps) is still fully
// reachable — just through the manual "Scan for Apps & Games" button
// (scan-all-installed below), which the user opens on their own terms.
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

// Finds installed desktop apps/games via Start Menu shortcuts (.lnk) —
// this covers everything scanSteamGames/scanEpicGames miss (Battle.net,
// Ubisoft Connect, GOG Galaxy, Origin/EA App titles, and regular desktop
// software), since virtually every Windows installer creates one of
// these. Resolves shortcut targets in a single PowerShell pass rather
// than one process per shortcut, for speed.
function scanStartMenuShortcuts() {
    return new Promise((resolve) => {
        const psScript = [
            '$ErrorActionPreference = "SilentlyContinue"',
            '$shell = New-Object -ComObject WScript.Shell',
            '$dirs = @(',
            '    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",',
            '    "$env:AppData\\Microsoft\\Windows\\Start Menu\\Programs"',
            ')',
            '$skipWords = @("uninstall","read me","readme","help","website","license","support","changelog","documentation","faq","setup","install")',
            '$results = @()',
            'foreach ($dir in $dirs) {',
            '    if (-not (Test-Path $dir)) { continue }',
            '    Get-ChildItem -Path $dir -Filter *.lnk -Recurse | ForEach-Object {',
            '        $nameLower = $_.BaseName.ToLower()',
            '        $skip = $false',
            '        foreach ($w in $skipWords) { if ($nameLower.Contains($w)) { $skip = $true } }',
            '        if ($skip) { return }',
            '        try {',
            '            $sc = $shell.CreateShortcut($_.FullName)',
            '            $target = $sc.TargetPath',
            '            if ($target -and $target.ToLower().EndsWith(".exe") -and (Test-Path $target)) {',
            '                $results += [PSCustomObject]@{ name = $_.BaseName; path = $target }',
            '            }',
            '        } catch {}',
            '    }',
            '}',
            '$results | ConvertTo-Json -Compress'
        ].join("\n");

        execFile(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psScript],
            { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout) => {
                if (error || !stdout) {
                    if (error) console.error("[import] shortcut scan failed:", error.message || error);
                    resolve([]);
                    return;
                }
                try {
                    let parsed = JSON.parse(stdout);
                    if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];
                    const seen = new Set();
                    const deduped = [];
                    for (const item of parsed) {
                        if (!item || !item.name || !item.path) continue;
                        // Keyed by path+name, not path alone: every game
                        // installed through a launcher (Battle.net,
                        // Ubisoft Connect, GOG Galaxy, EA App, ...) has a
                        // Start Menu shortcut whose TargetPath is that
                        // shared launcher .exe, not a path unique to the
                        // game itself — e.g. every Battle.net title
                        // (Diablo, Overwatch, WoW, ...) resolves to the
                        // same "Battle.net.exe". Deduping by path alone
                        // silently collapsed all of them down to whichever
                        // one happened to be scanned first, which is why
                        // titles like Diablo never turned up even though
                        // their shortcut was right there.
                        const key = String(item.path).toLowerCase() + "|" + String(item.name).toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        deduped.push({ name: item.name, path: item.path, source: "Detected" });
                    }
                    resolve(deduped);
                } catch (err) {
                    console.error("[import] shortcut scan JSON parse failed:", err.message || err);
                    resolve([]);
                }
            }
        );
    });
}

// A Start Menu shortcut alone can't tell a game from any other desktop
// software — that's exactly why every shortcut-only find (GOG Galaxy,
// Battle.net, Ubisoft Connect, itch.io, a standalone indie install, ...)
// used to get lumped in as a plain "app" here, with only Steam/Epic
// manifest entries ever counted as "game". Checking each shortcut's name
// against SteamGridDB — a database of games, not general software — gives
// a real signal instead of guessing from the source alone, so an indie or
// GOG/Battle.net title now gets recognized as a game just like a Steam
// one would. Steam/Epic entries are always real games regardless and skip
// the lookup entirely. Runs with limited concurrency (a full scan can
// easily turn up 100+ shortcuts) so this doesn't hammer the proxy or take
// forever; anything inconclusive (lookup failed, or genuinely no match)
// safely falls back to "app" — worse case, that title just isn't
// pre-selected under "Games only" and the user can still switch to "Both".
async function classifyScanCandidates(items) {
    const CONCURRENCY = 5;
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            const item = items[index];

            if (item.source !== "Detected") {
                results[index] = { ...item, category: "game" };
                continue;
            }

            let isGame = false;
            try {
                for (const variant of generateNameVariants(item.name)) {
                    if (await searchSteamGridDb(variant)) {
                        isGame = true;
                        break;
                    }
                }
            } catch (err) {
                // Lookup failed (network hiccup, proxy issue) — fall back
                // to "app" rather than letting one failure abort the scan.
            }

            results[index] = { ...item, category: isGame ? "game" : "app" };
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    return results;
}

// Manual, on-demand version of the automatic Steam/Epic-only scan-new-games
// above — also sweeps Start Menu shortcuts to catch launchers and regular
// software scan-new-games never looked at. Meant to back a "Scan for Apps &
// Games" button that shows everything found as a checklist, rather than
// prompting one at a time.
ipcMain.handle("scan-all-installed", async () => {
    try {
        const existingGames = fs.existsSync(GAMES_FILE)
            ? JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"))
            : [];
        const existingPaths = new Set(existingGames.map((g) => g.path));

        // Deliberately NOT filtering out dismissedImports here, unlike
        // scan-new-games above — dismissing the automatic one-at-a-time
        // prompt only means "stop asking me about this automatically," not
        // "hide it from me forever." The manual scan is exactly where a
        // dismissed item should still be reachable, so the user can add it
        // later if they change their mind. Only things already in the
        // library are excluded here.
        const found = await findAllInstalledCandidates();
        const newOnly = found.filter((g) => !existingPaths.has(g.path));

        return await classifyScanCandidates(newOnly);
    } catch (err) {
        console.error("[import] scan-all-installed failed:", err.message || err);
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
                    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
                    // Chromium (this is what actually renders the window)
                    // will otherwise cache these on disk and keep serving
                    // stale HTML/CSS/JS/images after an update, even across
                    // a full app restart — every file this server hands out
                    // is local and can change at any time, so never let the
                    // browser cache it.
                    "Cache-Control": "no-store"
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
    FREEGAMES_UNAVAILABLE_FILE = path.join(userDataDir, "freegames-unavailable.json");
    FREEGAMES_VERIFIED_FILE = path.join(userDataDir, "freegames-verified.json");
    FREEGAMES_LAST_REFRESH_FILE = path.join(userDataDir, "freegames-last-refresh.json");
    FREEGAMES_BULK_SEARCH_DONE_FILE = path.join(userDataDir, "freegames-bulk-search-done.json");
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

    const seedToolDefault = path.join(__dirname, "covers", "windows-tool-default.jpg");
    const userToolDefault = path.join(COVERS_FOLDER, "windows-tool-default.jpg");

    if (!fs.existsSync(userToolDefault) && fs.existsSync(seedToolDefault)) {
        fs.copyFileSync(seedToolDefault, userToolDefault);
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

    if (!fs.existsSync(FREEGAMES_UNAVAILABLE_FILE)) {
        fs.writeFileSync(FREEGAMES_UNAVAILABLE_FILE, "{}");
    }

    if (!fs.existsSync(FREEGAMES_VERIFIED_FILE)) {
        fs.writeFileSync(FREEGAMES_VERIFIED_FILE, "{}");
    }

    if (!fs.existsSync(FREEGAMES_LAST_REFRESH_FILE)) {
        fs.writeFileSync(FREEGAMES_LAST_REFRESH_FILE, "{}");
    }
}

// One-time-only marker: the very first Steam free-games pass for a
// brand-new install uses a fast bulk search instead of the normal
// verify-one-by-one approach (see fetchSteamFreeGames) — per your own
// instruction, this must never repeat itself on later runs unless you
// specifically ask for it again, so it's tracked with its own
// persisted flag rather than inferred from the verified cache being
// empty (which could also happen for other reasons, like a corrupted
// file, and shouldn't silently re-trigger this).
function hasBulkSearchRunBefore() {
    try {
        return fs.existsSync(FREEGAMES_BULK_SEARCH_DONE_FILE)
            && JSON.parse(fs.readFileSync(FREEGAMES_BULK_SEARCH_DONE_FILE, "utf8")).done === true;
    } catch (err) {
        return false;
    }
}

function markBulkSearchDone() {
    try {
        fs.writeFileSync(FREEGAMES_BULK_SEARCH_DONE_FILE, JSON.stringify({ done: true, at: Date.now() }, null, 2));
    } catch (err) {
        console.error("[free-games] failed to save bulk-search-done marker:", err.message || err);
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
    //
    // Wrapped on purpose: a Tray icon failing to load must never be able
    // to take the rest of startup down with it. It did exactly that
    // before this was added — createTray() threw, createWindow() (async)
    // turned that into a rejected promise, and the unguarded
    // "await createWindow()" in app.whenReady() meant everything after
    // it — startDropzoneWatcher() and the entire automatic update-check
    // setup — silently never ran. No tray icon is a cosmetic loss; no
    // update checks or dropzone watching is not.
    try {
        createTray();
    } catch (err) {
        console.error("[startup] tray icon failed to load — continuing without one:", err.message || err);
    }

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

// Native icon-loading (Tray, BrowserWindow#setIcon) reads straight off
// disk and can't see inside app.asar — only Node's own fs module gets
// Electron's transparent asar passthrough. So packaged builds need the
// *unpacked* copy electron-builder places next to app.asar (see
// asarUnpack in package.json); dev mode has no asar at all and just uses
// the plain path.
function resolveIconPath(...segments) {
    // icons/ is a normal shipped folder (unlike build/, electron-builder's
    // reserved buildResources dir, which never makes it into the packaged
    // app at all) — see asarUnpack in package.json for why packaged
    // builds still need the *unpacked* copy specifically.
    const base = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar.unpacked")
        : __dirname;
    return path.join(base, "icons", ...segments);
}

function createTray() {
    if (tray) return;

    tray = new Tray(resolveIconPath("icon.ico"));
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
        const iconPath = resolveIconPath(`${themeName}.ico`);
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
    // Only ever hand off real web links (plus mailto:, for the "Suggest
    // an App" button) here — shell.openExternal will happily open
    // file:// URLs or custom protocol URIs too, which is far more
    // capability than any "visit this website" / "watch trailer" /
    // "email us" button needs, and safer if a poisoned third-party API
    // response (a game/movie/book link) ever slipped through with
    // something unexpected in its url field.
    const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
    try {
        const parsed = new URL(url);
        if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
            console.warn("[open-external] blocked disallowed URL:", url);
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

// Same shape as httpsGetJsonPlain but for a plain-text/HTML response —
// used to read a Steam store page's actual rendered HTML, since some
// information (see checkSteamAppAvailability below) is only ever present
// in the page itself, never in Steam's public JSON API.
function httpsGetTextPlain(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "RiftgateApp/1.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
        }).on("error", reject);

        req.setTimeout(timeoutMs || 8000, () => {
            req.destroy(new Error("Request timed out"));
        });
    });
}

// Runs `fn` over `items` with at most `limit` in flight at once. Used for
// batches that hit an external API dozens or hundreds of times (e.g.
// checking whether every SteamSpy "free" game is still actually available) —
// firing them all in parallel via Promise.all/allSettled can trip that
// API's rate limiting, turning a small number of genuine failures into
// nearly all of them failing at once. Returns one settled-style result per
// item, in the original order, so callers can keep using the same
// `status`/`value`/`reason` shape as Promise.allSettled.
async function runWithConcurrencyLimit(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const current = nextIndex++;
            try {
                results[current] = { status: "fulfilled", value: await fn(items[current], current) };
            } catch (err) {
                results[current] = { status: "rejected", reason: err };
            }
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
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
            premiered: r.show.premiered,
            isMature: textContainsMatureKeyword(r.show.name)
                || textContainsMatureKeyword(r.show.summary)
                || (Array.isArray(r.show.genres) && r.show.genres.some((g) => textContainsMatureKeyword(g)))
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

// Shows the latest AIRED episode for every tracked show — a persistent
// status view. (An earlier "new since last visit" notification handler,
// check-new-episodes, was superseded by this and removed — it was never
// actually called from the renderer.)
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

// How long a Steam appid's "still available" verification is trusted
// before fetchSteamFreeGames bothers re-checking it — see the availability
// section below for why this exists (keeping the per-refresh check list
// small is what makes it safe to check that small list slowly enough to
// never trip Steam's rate limiting).
// A confirmed-available Steam game stays trusted for a week before it's
// ever re-checked. SteamSpy's "Free to Play" tag alone runs to ~5,000
// titles, so re-checking everyone every single day (this used to be set
// to just under 24h, on the theory that it would keep the list maximally
// fresh) meant, in practice, checking all ~5,000 of them every day —
// well over an hour of real work, every day, forever. A week-long trust
// window plus MAX_STEAM_CHECKS_PER_REFRESH below (which caps how much of
// that gets done in any one pass) spreads that same work out to a small,
// fast slice each day instead.
const FREEGAMES_VERIFIED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Hard ceiling on how many Steam games get a live availability check in
// any single refresh — regardless of how many are actually due. Without
// this, a large backlog (a first-ever run, or the app not being opened
// for a while) would still try to check everyone at once. Genuinely new
// entrants to the free-to-play list are checked first (see needsCheck
// below), so a brand-new giveaway is never the thing left waiting behind
// a backlog of routine re-checks.
//
// Each check below is actually two sequential requests (appdetails JSON,
// then the store page HTML), so at the 1200ms-per-item pacing this is
// still several minutes even capped — that's fine for the silent startup
// pass, but it's also what the manual Refresh button waits on, so this is
// kept well under the old 4900+-item runs (which took over an hour) even
// though it means clearing a first-run backlog takes several days.
const MAX_STEAM_CHECKS_PER_REFRESH = 200;

// Steam has two independent ways a "free" game can stop being real, and
// only checking one of them was exactly what let delisted titles like
// Need For Speed: Hot Pursuit keep showing up here: appdetails' own
// "success" flag catches an appid that's fully gone (the request
// redirects/fails), but far more often the store PAGE still loads fine
// (so appdetails keeps returning success:true with the game's old data)
// while showing a "Notice: <game> is no longer available on the Steam
// store" banner instead of a buy button. That banner only ever exists in
// the page's actual HTML — Steam's public API has no field for it — so
// it has to be checked for directly.
// Returns { show: boolean, delisted: boolean }. "delisted" (the store
// page/listing itself is gone) is permanent — once true, this appid is
// blacklisted for good, since a genuinely removed listing never comes
// back. "show: false, delisted: false" means the opposite: the listing
// is still perfectly real, it's just not priced at $0 right now (a
// limited-time promo ending is the common case) — this should only ever
// exclude it from THIS refresh's output, never a permanent blacklist,
// since the exact same title can legitimately go free again later (a
// future promo, a different giveaway) and needs to be able to reappear
// once SteamSpy/Steam's own data reflects that.
async function checkSteamAppAvailability(appid) {
    let apiAvailable = true;
    let stillFree = true;
    try {
        // No filters=basic here on purpose — "basic" trims the response
        // down far enough that it drops is_free, which is exactly the
        // field this needs: SteamSpy's own price field (used to build the
        // initial list) can lag behind a limited-time promo ending, so a
        // title that flipped back to paid stayed listed as free here
        // until this specific check actually asked Steam's own data for
        // its current price instead of just whether the page still loads.
        const detail = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appid}`, 10000);
        const entry = detail && detail[appid];
        apiAvailable = !!(entry && entry.success);
        if (apiAvailable && entry.data) {
            stillFree = entry.data.is_free === true;
        }
    } catch (err) {
        // A failed/timed-out request confirms nothing either way — treat
        // as available/free so a network hiccup can never masquerade as a
        // delisting or a price change.
        apiAvailable = true;
        stillFree = true;
    }

    if (!apiAvailable) return { show: false, delisted: true };
    if (!stillFree) return { show: false, delisted: false };

    try {
        const page = await httpsGetTextPlain(`https://store.steampowered.com/app/${appid}/?l=english`, 10000);
        if (page.statusCode === 200 && /is no longer available on the steam store/i.test(page.body)) {
            return { show: false, delisted: true };
        }
    } catch (err) {
        // Same reasoning as above — an unreadable page proves nothing.
    }

    return { show: true, delisted: false };
}

// First-run-only helper: Steam's own store search (the /search/results/
// endpoint the storefront's search box itself calls) supports filtering
// directly by live price (maxprice=free) and by type (category1=998 =
// Games, so DLC/software/soundtracks are excluded up front). That's a
// completely different endpoint from the "storesearch" autocomplete API
// mentioned above — this one is the real catalog browser and happily
// returns everything that matches, paginated 100 at a time. Since every
// result already reflects Steam's CURRENT price, none of them need the
// slow one-by-one appdetails/store-page verification pass that the
// normal SteamSpy-tag-based path still needs — this is only ever used
// once, on the very first run the app has ever had, specifically to
// avoid that huge first-time verification backlog.
async function fetchSteamFreeGamesBulkSearch() {
    const results = [];
    const seen = new Set();
    const PAGE_SIZE = 100;
    const MAX_PAGES = 60; // generous cap, well beyond how many free Steam games actually exist
    const rowRe = /data-ds-appid="(\d+)"[\s\S]*?<span class="title">([^<]*)<\/span>/g;

    for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * PAGE_SIZE;
        const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=${PAGE_SIZE}&maxprice=free&category1=998&infinite=1`;
        let data;
        try {
            data = await httpsGetJsonPlain(url, 15000);
        } catch (err) {
            console.error(`[free-games] Bulk Steam search request failed at start=${start}:`, err.message || err);
            break;
        }

        const html = (data && data.results_html) || "";
        if (!html) break;

        rowRe.lastIndex = 0;
        let match;
        let foundOnPage = 0;
        while ((match = rowRe.exec(html)) !== null) {
            const appid = match[1];
            foundOnPage++;
            if (seen.has(appid)) continue;
            seen.add(appid);
            const name = (match[2] || "").trim() || `App ${appid}`;
            results.push({ appid, name, price: "0" });
        }

        if (foundOnPage < PAGE_SIZE) break; // last page reached

        // Small courteous pause between pages — far fewer requests total
        // than the per-item verification loop this replaces ever needed.
        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    console.log(`[free-games] Bulk Steam search (first run): found ${results.length} free game(s) directly.`);
    return results;
}

// SteamSpy aggregates public Steam catalog data specifically for bulk
// tag-based queries like this — unlike Steam's own storesearch (which is a
// search-box autocomplete API, not a catalog browser, and only ever
// returned a handful of results for an empty search term).
async function fetchSteamFreeGames(forceFullCheck) {
    try {
        // Only the very first run the app has EVER had uses Steam's own
        // live search (see fetchSteamFreeGamesBulkSearch above) instead of
        // the normal SteamSpy-tag path — it's a one-time thing specifically
        // to avoid a first-time verification backlog of thousands of
        // games; every run after that goes back to the regular path below
        // unless told again to redo the bulk search.
        const isFirstEverRun = !hasBulkSearchRunBefore();
        let entries;
        let usedBulkSearch = false;

        if (isFirstEverRun) {
            console.log("[free-games] First run ever — using Steam's own live search (price filter) instead of the SteamSpy tag list, so nothing needs one-by-one verification.");
            const bulkResults = await fetchSteamFreeGamesBulkSearch();
            if (bulkResults.length > 0) {
                entries = bulkResults;
                usedBulkSearch = true;
            } else {
                console.log("[free-games] Bulk Steam search returned nothing usable — falling back to the normal SteamSpy-based check this run.");
                const data = await httpsGetJsonPlain(
                    "https://steamspy.com/api.php?request=tag&tag=Free+to+Play", 10000
                );
                entries = Object.values(data || {}).filter((item) => item.name);
            }
        } else {
            const data = await httpsGetJsonPlain(
                "https://steamspy.com/api.php?request=tag&tag=Free+to+Play", 10000
            );
            entries = Object.values(data || {}).filter((item) => item.name);
        }

        // SteamSpy's "Free to Play" tag can include games that AREN'T
        // actually priced at $0 right now (community tagging drifts, or the
        // tag reflects a base game that has paid DLC) — cross-check against
        // SteamSpy's own live price field so "free" is actually accurate.
        // The bulk search path skips this: Steam's own maxprice=free filter
        // already guarantees it.
        const genuinelyFree = usedBulkSearch
            ? entries
            : entries.filter((item) => {
                const price = parseInt(item.price, 10);
                return !isNaN(price) && price === 0;
            });

        console.log(usedBulkSearch
            ? `[free-games] Bulk Steam search: ${genuinelyFree.length} free game(s) found directly.`
            : `[free-games] SteamSpy: ${entries.length} tagged free, ${genuinelyFree.length} confirmed $0 right now.`);

        // Games already confirmed delisted in a past run are dropped
        // immediately, with no new network check spent on them — this also
        // means a game we've already caught can never quietly reappear just
        // because a later availability check happens to fail and falls back
        // to "keep" (see below).
        const knownUnavailable = readFreeGamesUnavailableCache();
        const stillListed = genuinelyFree.filter((item) => !knownUnavailable[String(item.appid)]);

        const freeIds = new Set(stillListed.map((item) => String(item.appid)));
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

        // Verify each remaining game is still actually available on the
        // store — SteamSpy's data can lag behind a title that's since been
        // delisted (editions and re-releases especially: a base game stays
        // up while a "Special Edition"/"GOTY" SKU quietly gets pulled,
        // "Notice: X is no longer available on the Steam store."). This
        // used to run every item through a concurrency-limited batch each
        // refresh, but even a limit of 5 was still enough total requests
        // to trip Steam's appdetails rate limiting on a large list — and
        // since a check that fails (rate-limited or not) falls back to
        // "keep" (a network hiccup shouldn't remove a game that's
        // genuinely fine), that rate limiting was quietly defeating this
        // whole filter for most of the list, letting delisted
        // editions/games slip through instead of just an occasional
        // unlucky one.
        //
        // Fixed at the root instead of just re-tuning the concurrency
        // number: a game confirmed available stays trusted for
        // FREEGAMES_VERIFIED_MAX_AGE_MS before it's ever checked again, so
        // on any given refresh only genuinely NEW entrants to the
        // free-to-play list (plus anything overdue for re-verification)
        // need an actual request — usually a handful, not hundreds. That
        // small remainder is then checked fully sequentially with a real
        // pause between each request, deliberately slow enough to never
        // approach Steam's rate limit in the first place, rather than
        // hoping a concurrency cap keeps it under some limit that isn't
        // precisely documented.
        const verified = readFreeGamesVerifiedCache();

        // Bulk-search results already reflect Steam's current live price —
        // that's the entire point of using that endpoint on a first run —
        // so none of them need the one-by-one verification pass below at
        // all. Mark every one of them verified right away, remember this
        // one-time search has now run (so it's never repeated on later
        // launches), and return straight away.
        if (usedBulkSearch) {
            stillListed.forEach((item) => {
                verified[String(item.appid)] = Date.now();
            });
            saveFreeGamesVerifiedCache(verified);
            markBulkSearchDone();
            console.log(`[free-games] First-run bulk search complete — ${stillListed.length} free Steam game(s) ready, no verification needed.`);

            return stillListed.map((item) => ({
                id: `steam-${item.appid}`,
                name: item.name,
                description: null,
                image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
                url: `https://store.steampowered.com/app/${item.appid}`,
                source: "Steam",
                tags: [genreMap[String(item.appid)] || "Other"]
            }));
        }

        const eligibleForCheck = forceFullCheck
            ? stillListed
            : stillListed.filter((item) => {
                const lastVerified = verified[String(item.appid)];
                return !lastVerified || (Date.now() - lastVerified) > FREEGAMES_VERIFIED_MAX_AGE_MS;
            });

        // New entrants (never verified at all, lastVerified undefined/0)
        // sort first — a fresh giveaway should never be stuck waiting
        // behind a backlog of routine re-checks. Beyond that, the
        // longest-overdue ones go next. Then MAX_STEAM_CHECKS_PER_REFRESH
        // caps the actual work done this cycle; anything past the cap
        // simply keeps its existing status until it's due again on a
        // later refresh. A forced full check (the manual Refresh button)
        // skips the cap entirely instead — the whole point of clicking it
        // is an up-to-date list right now, not a partially-stale one.
        eligibleForCheck.sort((a, b) => {
            const aVerified = verified[String(a.appid)] || 0;
            const bVerified = verified[String(b.appid)] || 0;
            return aVerified - bVerified;
        });

        const needsCheck = forceFullCheck ? eligibleForCheck : eligibleForCheck.slice(0, MAX_STEAM_CHECKS_PER_REFRESH);
        const deferredCount = eligibleForCheck.length - needsCheck.length;

        if (needsCheck.length > 0) {
            console.log(`[free-games] Verifying availability of ${needsCheck.length} Steam game(s)${forceFullCheck ? " (forced full check)" : ""} (${stillListed.length - eligibleForCheck.length} already verified recently${deferredCount > 0 ? `, ${deferredCount} more due but deferred to a later refresh` : ""}).`);
        }

        // A forced full check on a catalog this size (the SteamSpy
        // "Free to Play" tag alone is several thousand games) is far too
        // much to run one request at a time with a 1.2s gap between each
        // — that's well over an hour before anything is ever saved, which
        // looked exactly like "nothing is happening" even though it was
        // working the whole time. Small batches of concurrent requests,
        // with a real pause between batches (not between every single
        // request), cuts that down to a few minutes while still never
        // hammering Steam continuously the way plain concurrency did
        // before (see runWithConcurrencyLimit's comment — that's what
        // tripped rate limiting previously). Progress is also saved after
        // every batch instead of only once at the very end, so closing
        // Riftgate partway through a big catch-up run keeps whatever was
        // already verified instead of losing all of it and starting over.
        const STEAM_CHECK_BATCH_SIZE = 5;
        const STEAM_CHECK_BATCH_DELAY_MS = 700;

        // Delisted (the store listing itself is gone) is permanent — that
        // appid goes on the standing blacklist and is never checked again.
        // "Not free right now" (still a real listing, just currently
        // priced above $0) only excludes it from THIS pass's output —
        // never the permanent blacklist — since the same title can
        // legitimately go free again on a future promo.
        const newlyDelisted = [];
        const newlyNotFree = [];
        let verifiedChanged = false;
        let checkedCount = 0;

        for (let i = 0; i < needsCheck.length; i += STEAM_CHECK_BATCH_SIZE) {
            if (i > 0) {
                await new Promise((resolve) => setTimeout(resolve, STEAM_CHECK_BATCH_DELAY_MS));
            }

            const batch = needsCheck.slice(i, i + STEAM_CHECK_BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                batch.map((item) =>
                    checkSteamAppAvailability(item.appid).then((result) => ({ appid: item.appid, result }))
                )
            );

            let batchHasNewDelisted = false;
            batchResults.forEach((res) => {
                checkedCount++;
                if (res.status !== "fulfilled") return; // network hiccup — leave unverified, retried next refresh
                const appid = String(res.value.appid);
                const { show, delisted } = res.value.result;
                if (show) {
                    verified[appid] = Date.now();
                    verifiedChanged = true;
                } else if (delisted) {
                    newlyDelisted.push(appid);
                    knownUnavailable[appid] = Date.now();
                    delete verified[appid];
                    verifiedChanged = true;
                    batchHasNewDelisted = true;
                } else {
                    newlyNotFree.push(appid);
                    delete verified[appid];
                    verifiedChanged = true;
                }
            });

            if (verifiedChanged) saveFreeGamesVerifiedCache(verified);
            if (batchHasNewDelisted) saveFreeGamesUnavailableCache(knownUnavailable);

            if (needsCheck.length > 200 && (checkedCount % 500 < STEAM_CHECK_BATCH_SIZE || checkedCount === needsCheck.length)) {
                console.log(`[free-games] Verified ${checkedCount}/${needsCheck.length} Steam games so far...`);
            }
        }

        if (newlyDelisted.length > 0) {
            console.log(`[free-games] Excluding ${newlyDelisted.length} newly-delisted Steam game(s).`);
        }
        if (newlyNotFree.length > 0) {
            console.log(`[free-games] Excluding ${newlyNotFree.length} Steam game(s) no longer priced at $0 (may return if free again later).`);
        }

        const unavailableIds = new Set([...newlyDelisted, ...newlyNotFree]);

        return stillListed
            .filter((item) => !unavailableIds.has(String(item.appid)))
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

// Appids Steam has confirmed as delisted, keyed to when that was first
// confirmed — kept independently of the regular free-games cache so a
// delisted game stays excluded permanently, not just until the next
// refresh, and doesn't depend on every future fetch successfully
// re-checking it (see fetchSteamFreeGames).
function readFreeGamesUnavailableCache() {
    try {
        return JSON.parse(fs.readFileSync(FREEGAMES_UNAVAILABLE_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

function saveFreeGamesUnavailableCache(data) {
    try {
        fs.writeFileSync(FREEGAMES_UNAVAILABLE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[free-games] failed to save unavailable-games cache:", err.message || err);
    }
}

// Appids Steam has confirmed as STILL available, keyed to when that was
// last confirmed — this is what lets fetchSteamFreeGames skip re-checking
// most of the list on every refresh (see FREEGAMES_VERIFIED_MAX_AGE_MS),
// so the small number of checks it actually does each run can afford to
// go slowly enough to never trip Steam's rate limiting in the first
// place, rather than firing a full-list burst and hoping enough of it
// gets through before getting throttled.
function readFreeGamesVerifiedCache() {
    try {
        return JSON.parse(fs.readFileSync(FREEGAMES_VERIFIED_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

function saveFreeGamesVerifiedCache(data) {
    try {
        fs.writeFileSync(FREEGAMES_VERIFIED_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[free-games] failed to save verified-games cache:", err.message || err);
    }
}

// The whole point of this file: get-free-games used to redo the entire
// Steam/Epic/GOG fetch-and-verify pass every single time the Free Games
// section was opened, even seconds after the last one finished. This is
// the timestamp that lets it skip straight to "just hand back what's
// already cached" instead, and only pay for a real refresh once every
// FREEGAMES_FULL_REFRESH_MIN_AGE_MS.
function readFreeGamesLastRefresh() {
    try {
        const data = JSON.parse(fs.readFileSync(FREEGAMES_LAST_REFRESH_FILE, "utf8"));
        return data.lastRefreshedAt || 0;
    } catch (err) {
        return 0;
    }
}

function saveFreeGamesLastRefresh(timestamp) {
    try {
        fs.writeFileSync(FREEGAMES_LAST_REFRESH_FILE, JSON.stringify({ lastRefreshedAt: timestamp }, null, 2));
    } catch (err) {
        console.error("[free-games] failed to save last-refresh timestamp:", err.message || err);
    }
}

// At least once every 24 hours, per your own requirement, so the list
// itself (which games are free at all, not just whether each one is
// still available) never goes stale for more than a day. Individual
// games' own "last verified available" stamps last much longer than this
// (see FREEGAMES_VERIFIED_MAX_AGE_MS below) — that's deliberate, so most
// daily refreshes only add/remove games and re-check a small slice of
// the rest, instead of re-verifying everyone every day.
const FREEGAMES_FULL_REFRESH_MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// The actual Steam/Epic/GOG fetch-and-verify pass — shared by the normal
// (gated) get-free-games below and force-refresh-free-games, which skips
// the gate entirely for a manual "give me a fresh list right now" click.
// The startup auto-refresh and a renderer-triggered refresh can both see
// "this is due" within the same instant (e.g. right when the app opens
// straight into the Free Games section), which used to kick off two full
// fetch-and-verify passes at once — doubling every request to Steam/Epic/
// GOG for no reason. freeGamesRefreshPromise makes every caller that
// arrives while a pass is already running just await that same in-flight
// promise instead of starting a second one.
let freeGamesRefreshPromise = null;
let freeGamesRefreshIsFull = false;

// forceFullCheck bypasses BOTH the per-list 24h gate (handled by the
// caller, get-free-games vs force-refresh-free-games) AND the per-game
// 7-day trust window / MAX_STEAM_CHECKS_PER_REFRESH cap inside
// fetchSteamFreeGames — without this, clicking the manual Refresh button
// re-fetched the SteamSpy/Epic/GOG lists but still only re-verified a
// capped slice of already-cached-as-available Steam games, so a title
// that flipped from free back to paid within the last 7 days could stay
// listed even right after an explicit "give me a fresh list" click.
async function performFreeGamesRefresh(forceFullCheck) {
    if (freeGamesRefreshPromise) {
        if (!forceFullCheck || freeGamesRefreshIsFull) {
            return freeGamesRefreshPromise;
        }
        // A weaker (capped) refresh is already in flight, but this call
        // explicitly wants a real full check — wait for the weaker one to
        // finish (so the two never run concurrently and double up on
        // requests to Steam/Epic/GOG), then run a genuine full check right
        // after, instead of silently downgrading this explicit request.
        await freeGamesRefreshPromise.catch(() => {});
    }

    freeGamesRefreshIsFull = !!forceFullCheck;
    freeGamesRefreshPromise = runFreeGamesRefresh(forceFullCheck).finally(() => {
        freeGamesRefreshPromise = null;
        freeGamesRefreshIsFull = false;
    });
    return freeGamesRefreshPromise;
}

async function runFreeGamesRefresh(forceFullCheck) {
    // allSettled instead of all — one store's fetch failing outright must
    // never take the others down with it.
    const results = await Promise.allSettled([
        fetchEpicFreeGames(),
        fetchSteamFreeGames(forceFullCheck),
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

    // All three stores returning zero results at once basically never
    // happens legitimately — it means the fetches failed (network down,
    // blocked endpoint, temporary rate limit, etc). Previously this wrote
    // an empty list straight to cache-free-games.json, which permanently
    // wiped out the Free Games section for that user until a fetch
    // eventually succeeded again. Instead, fall back to whatever was last
    // cached and leave that cache file (and the last-refresh timestamp)
    // untouched, so a bad fetch cycle never overwrites good data and gets
    // retried for real next time instead of waiting out the full 24h.
    if (allFree.length === 0) {
        console.error("[free-games] All stores returned zero results — treating as a failed fetch, keeping previous cache.");
        return loadDataCache("cache-free-games.json") || [];
    }

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
    saveFreeGamesLastRefresh(Date.now());

    return allFree;
}

ipcMain.handle("get-free-games", async () => {
    // Riftgate already has last run's list on disk (cache-free-games.json)
    // — there's no reason to re-hit Steam/Epic/GOG (and re-verify every
    // Steam game) every single time this section is opened. Only do that
    // real work if it's actually been at least a day since the last one;
    // otherwise just hand back what's already there, unchanged.
    const cached = loadDataCache("cache-free-games.json") || [];
    const lastRefreshedAt = readFreeGamesLastRefresh();

    if (cached.length > 0 && (Date.now() - lastRefreshedAt) < FREEGAMES_FULL_REFRESH_MIN_AGE_MS) {
        return cached;
    }

    return performFreeGamesRefresh();
});

// Backs the manual "Refresh" button in Free Games — always does a real
// fetch-and-verify pass regardless of how recently the last one ran, for
// when the user specifically wants an up-to-date list right now rather
// than waiting out the rest of the 24h window.
ipcMain.handle("force-refresh-free-games", async () => performFreeGamesRefresh(true));

// Instant retrieval of the last successfully fetched Free Games list —
// same "show something immediately, refresh quietly after" pattern as
// the book sections, so this section isn't empty on launch either.
ipcMain.handle("get-cached-free-games", async () => loadDataCache("cache-free-games.json") || []);

// --- Movies currently in theaters (TMDB — free public movie database) ---

// Supplementary lookup for a movie or TV show that came back with no
// poster from the main (English-locale) listing — TMDB's /images endpoint
// isn't tied to a single language the way the listing endpoint is, so it
// can surface a poster (a release specific to Portugal, Japan, wherever,
// included) without having to switch the whole request to a different
// locale, which is what broke English descriptions the first time this
// was attempted. Shared by movies and TV shows — mediaType is "movie" or
// "tv", matching TMDB's own URL structure for both.
async function fetchFallbackPoster(mediaType, mediaId, preferredLanguage) {
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/${mediaType}/${mediaId}/images`, {});
        const posters = data.posters || [];
        if (posters.length === 0) return null;

        // Prefer one matching the user's region if available, otherwise
        // fall back to the neutral/language-less posters TMDB often has,
        // otherwise just take whatever's first — any poster beats none,
        // regardless of which country or language it happens to be from.
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
                poster = await fetchFallbackPoster("movie", m.id, tmdbLanguage);
            }
            return {
                id: m.id,
                title: m.title,
                description: m.overview,
                poster,
                releaseDate: m.release_date,
                popularity: m.popularity || 0,
                isMature: !!m.adult || textContainsMatureKeyword(m.title) || textContainsMatureKeyword(m.overview)
            };
        }));

        mapped.sort((a, b) => b.popularity - a.popularity);
        return mapped;
    } catch (err) {
        console.error("[movies] now_playing fetch failed:", err.message || err);
        return [];
    }
});

// Prefers a real "Trailer" over a "Teaser" — but falls back to a teaser
// rather than nothing, since that's frequently all that exists yet for a
// title that hasn't released. Within whichever type is used, an official
// upload is preferred over an arbitrary fan/regional one, since TMDB
// doesn't guarantee "best" results come first.
function pickBestYoutubeTrailer(videos) {
    const youtubeVideos = (videos || []).filter((v) => v.site === "YouTube");
    const trailers = youtubeVideos.filter((v) => v.type === "Trailer");
    const teasers = youtubeVideos.filter((v) => v.type === "Teaser");
    const pool = trailers.length ? trailers : teasers;
    const best = pool.find((v) => v.official) || pool[0];
    return best ? best.key : null;
}

ipcMain.handle("get-movie-trailer", async (event, movieId) => {

    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/movie/${movieId}/videos`, {});
        return pickBestYoutubeTrailer(data.results);
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
        const results = searchData.results || [];
        if (results.length === 0) return null;

        const lowerName = String(showName || "").toLowerCase();
        const match = results.find((r) => (r.name || "").toLowerCase() === lowerName) || results[0];

        const videoData = await mediaProxyGetJsonPlain("tmdb", `/tv/${match.id}/videos`, {});
        return pickBestYoutubeTrailer(videoData.results);
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
        // TMDB's own "upcoming" endpoint is known to include movies that
        // have already released in some regions/release-types, so we
        // double-check against today's date instead of trusting it blindly.
        const todayStr = new Date().toISOString().slice(0, 10);
        const results = (data.results || []).filter((m) => !m.release_date || m.release_date >= todayStr);

        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";
        const mapped = await Promise.all(results.map(async (m) => {
            let poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
            if (!poster) {
                poster = await fetchFallbackPoster("movie", m.id, tmdbLanguage);
            }
            return {
                id: m.id,
                title: m.title,
                description: m.overview,
                poster,
                releaseDate: m.release_date,
                popularity: m.popularity || 0,
                isMature: !!m.adult || textContainsMatureKeyword(m.title) || textContainsMatureKeyword(m.overview)
            };
        }));

        mapped.sort((a, b) => b.popularity - a.popularity);
        return mapped;
    } catch (err) {
        console.error("[new] upcoming movies fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-new-tv-shows", async (event, countryCode) => {
    try {
        // "air_date.lte: today" only ever excluded shows that haven't
        // aired yet — it never had a LOWER bound, so sorting the entire
        // rest of TMDB's catalog by popularity.desc surfaced whatever's
        // most popular all-time (Breaking Bad, Game of Thrones, ...),
        // not anything actually new. first_air_date.gte adds that lower
        // bound: only shows whose first season started within the last
        // ~90 days (long enough to cover a full weekly-release season)
        // are eligible at all, so "New Series" only ever shows what its
        // name says, most popular among those first.
        const today = new Date();
        const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        const data = await mediaProxyGetJsonPlain("tmdb", "/discover/tv", {
            sort_by: "popularity.desc",
            "first_air_date.gte": ninetyDaysAgo.toISOString().slice(0, 10),
            "air_date.lte": today.toISOString().slice(0, 10),
            "vote_count.gte": "5",
            language: "en-US",
            page: "1"
        });

        // Same reasoning as the movie listings above: this comes back in
        // English regardless of the show's own country, so a show without
        // an English-tagged poster used to get no cover at all — a
        // targeted per-show fallback fixes that without touching the
        // (reliably-translated) English titles/descriptions.
        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";
        const mapped = await Promise.all((data.results || []).map(async (s) => {
            let image = s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null;
            if (!image) {
                image = await fetchFallbackPoster("tv", s.id, tmdbLanguage);
            }
            return {
                id: s.id,
                name: s.name,
                description: s.overview,
                image,
                firstAirDate: s.first_air_date,
                isMature: textContainsMatureKeyword(s.name) || textContainsMatureKeyword(s.overview)
            };
        }));

        return mapped;
    } catch (err) {
        console.error("[new] new TV shows fetch failed:", err.message || err);
        return [];
    }
});

ipcMain.handle("get-tv-show-trailer", async (event, tmdbId) => {
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/tv/${tmdbId}/videos`, {});
        return pickBestYoutubeTrailer(data.results);
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
// Once a game's own release date arrives it stops matching the "still
// upcoming" date filter below and would otherwise just vanish from the
// list the instant that happens — instead it stays visible for a short
// grace window after release, and gets backfilled with a newly-anticipated
// game once that window closes, via a small persisted cache of whatever
// was shown last time (see below).
const UPCOMING_GAMES_TARGET_COUNT = 24;
const UPCOMING_GAMES_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks
// A genuinely unreleased game cannot have accumulated meaningful player
// ratings yet — anything at or above this is almost certainly already out
// in reality, regardless of what RAWG's own "released" field claims.
const UPCOMING_GAMES_MAX_RATINGS_COUNT = 10;

// Called once when renderer.js notices the app version just changed (see
// checkForUpdatePopup) — clears the one New-tab cache that survives
// restarts, so an update's users see a genuinely fresh Upcoming Games list
// built under the new logic instead of carrying forward whatever was
// cached under the previous version.
ipcMain.handle("clear-new-section-cache", async () => {
    try {
        const cachePath = path.join(app.getPath("userData"), "cache-upcoming-games-recent.json");
        if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
        return { success: true };
    } catch (err) {
        console.error("[new] clear-new-section-cache failed:", err.message || err);
        return { success: false };
    }
});

ipcMain.handle("get-upcoming-games", async () => {
    try {
        const today = new Date();
        // "Upcoming" means strictly after today — a game releasing today
        // no longer belongs in "new releases coming up," it belongs in the
        // just-released grace period below instead.
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const sixMonthsOut = new Date(today);
        sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
        const fmt = (d) => d.toISOString().slice(0, 10);

        // A few extra beyond the target count, so there's still enough left
        // over to backfill with after excluding anything already carried
        // forward from the grace list below.
        const data = await mediaProxyGetJsonPlain("rawg", "/games", {
            dates: `${fmt(tomorrow)},${fmt(sixMonthsOut)}`,
            ordering: "-added",
            page_size: String(UPCOMING_GAMES_TARGET_COUNT + 10)
        });

        const freshUpcoming = (data.results || [])
            .filter((g) => !g.tba && (g.ratings_count || 0) < UPCOMING_GAMES_MAX_RATINGS_COUNT)
            .map((g) => ({
                id: `rawg-${g.id}`,
                name: g.name,
                image: g.background_image || null,
                url: `https://rawg.io/games/${g.slug}`,
                releaseDate: g.released || null,
                platforms: (g.platforms || [])
                    .map((p) => p.platform && p.platform.name)
                    .filter(Boolean)
            }));

        // Carry forward anything shown last time that has since released
        // but is still within its 2-week grace window.
        const previous = loadDataCache("cache-upcoming-games-recent.json") || [];
        const graced = previous.filter((g) => {
            if (!g.releaseDate) return false;
            const msSinceRelease = today - new Date(g.releaseDate);
            return msSinceRelease > 0 && msSinceRelease <= UPCOMING_GAMES_GRACE_MS;
        });

        // Graced entries fill their slots first, then freshly-fetched
        // upcoming games top the list back up to the target count — this
        // is the "add another awaited game" backfill once a graced game's
        // window finally closes and drops off.
        const gracedIds = new Set(graced.map((g) => g.id));
        const combined = [...graced];
        for (const g of freshUpcoming) {
            if (combined.length >= UPCOMING_GAMES_TARGET_COUNT) break;
            if (gracedIds.has(g.id)) continue;
            combined.push(g);
        }

        saveDataCache("cache-upcoming-games-recent.json", combined);
        return combined;
    } catch (err) {
        console.error("[new] upcoming games fetch failed:", err.message || err);
        return [];
    }
});

// Fetches richer per-game detail (full description, platforms, minimum PC
// specs) for the New tab's Upcoming Games hover-detail window. Kept as a
// separate, on-demand call rather than folded into the 24-game listing
// above, since RAWG only returns this level of detail from its single-game
// endpoint, and fetching it for all 24 up front would be slow and mostly
// wasted on games the user never hovers.
ipcMain.handle("get-upcoming-game-details", async (event, rawgId) => {
    try {
        // rawgId arrives as "rawg-12345" (see get-upcoming-games above) —
        // strip the prefix back to the bare numeric RAWG id the detail
        // endpoint expects.
        const numericId = String(rawgId).replace(/^rawg-/, "");
        const g = await mediaProxyGetJsonPlain("rawg", `/games/${numericId}`);

        const platformNames = (g.platforms || [])
            .map((p) => p.platform && p.platform.name)
            .filter(Boolean);

        const pcEntry = (g.platforms || []).find(
            (p) => p.platform && p.platform.name === "PC" && p.requirements && p.requirements.minimum
        );

        // RAWG's requirements text comes back as an HTML-ish blob
        // ("Minimum:<br>OS: ...<br>CPU: ..."). This is third-party API
        // content, so it's stripped down to plain text with line breaks
        // here rather than ever being passed to innerHTML in the renderer.
        const stripHtml = (s) =>
            (s || "")
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<[^>]+>/g, "")
                .trim();

        // Related games — this game's own primary genre, queried against
        // RAWG's main game list and ranked by popularity, rather than
        // RAWG's "suggested-games" endpoint (which is based on player
        // behavior data that barely exists yet for an unreleased title —
        // that's why it so often came back empty here). Genre data is
        // present even for brand-new/unannounced games, so this works far
        // more consistently, and "same genre" is a more literal match for
        // what "related" means in this row anyway. Its own try/catch means
        // a failure here never breaks the description/specs above.
        let related = [];
        try {
            const primaryGenreSlug = g.genres && g.genres[0] && g.genres[0].slug;
            if (primaryGenreSlug) {
                const genreGames = await mediaProxyGetJsonPlain("rawg", "/games", {
                    genres: primaryGenreSlug,
                    ordering: "-added",
                    page_size: "13"
                });
                related = (genreGames.results || [])
                    .filter((sg) => String(sg.id) !== String(numericId))
                    .slice(0, 12)
                    .map((sg) => ({
                        id: `rawg-${sg.id}`,
                        name: sg.name,
                        image: sg.background_image || null,
                        url: `https://rawg.io/games/${sg.slug}`,
                        releaseDate: sg.released || null
                    }));
            }
        } catch (relErr) {
            console.error("[new] related games fetch failed:", relErr.message || relErr);
        }

        return {
            description: stripHtml(g.description_raw || g.description || ""),
            platforms: platformNames,
            minSpecs: pcEntry ? stripHtml(pcEntry.requirements.minimum) : null,
            related
        };
    } catch (err) {
        console.error("[new] upcoming game details fetch failed:", err.message || err);
        return { description: "", platforms: [], minSpecs: null, related: [] };
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

ipcMain.handle("get-file-icon", async (event, exePath) => {
    try {
        if (!exePath || !fs.existsSync(exePath)) return null;
        const icon = await app.getFileIcon(exePath, { size: "large" });
        if (!icon || icon.isEmpty()) return null;
        return icon.toDataURL();
    } catch (err) {
        return null;
    }
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

    // YouTube lets search results be scoped to the uploader's own declared
    // category, on top of matching query text — so a game search doesn't
    // even consider a video filed under Sports or Howto & Style, no matter
    // how well its title happens to match. Only applied to categories with
    // one clearly-correct YouTube category: Gaming (20) for games/VR, and
    // Entertainment (24) for the TV-show fallback (only ever used when
    // TMDB's own curated show lookup already came up empty). Apps/"other"
    // are left unrestricted — general software marketing videos land under
    // too many inconsistent categories on YouTube to safely narrow to one.
    const TYPE_CATEGORY_IDS = {
        game: "20",
        vr: "20",
        show: "24"
    };

    let quotaExceeded = false;

    async function youtubeSearch(query, orderByViews, categoryId) {
        const params = { part: "snippet", maxResults: "1", type: "video", q: query };
        if (orderByViews) params.order = "viewCount";
        if (categoryId) params.videoCategoryId = categoryId;

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
        const item = result.items[0];
        const videoId = (item.id && item.id.videoId) || null;
        if (!videoId) return null;
        return { videoId, title: (item.snippet && item.snippet.title) || "" };
    }

    // YouTube's search endpoint has no real relevance guarantee for a
    // query it doesn't have great matches for — an obscure or unreleased
    // title with no trailer actually uploaded yet can come back with
    // result #1 being something completely unrelated that just happens to
    // rank for that query (a real observed case: an upcoming game with no
    // trailer yet returned an unrelated "how X works" explainer video).
    // Since every attempt above blindly trusted whatever came back first,
    // this checks that the result's own title actually mentions the thing
    // being searched for before accepting it — cheap, no extra API calls,
    // and it turns a wrong trailer into "no trailer found" instead, which
    // is far less confusing than playing something unrelated.
    const STOPWORDS = new Set([
        "the", "and", "for", "with", "from", "official", "trailer", "game",
        "edition", "ultimate", "deluxe", "remastered", "remake", "reboot", "series"
    ]);

    function significantWords(name) {
        return (name || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    }

    function resultLooksRelevant(names, title) {
        const titleLower = (title || "").toLowerCase();
        return names.filter(Boolean).some((name) => {
            const words = significantWords(name);
            // A name with nothing meaningful left after stripping
            // stopwords (very short/generic titles) can't be checked
            // this way — don't block on it rather than reject everything.
            if (words.length === 0) return true;
            return words.some((w) => titleLower.includes(w));
        });
    }

    try {
        const canonicalName = await resolveCanonicalName(gameName);
        const typePhrase = TYPE_QUALIFIERS[type] || TYPE_QUALIFIERS.game;
        const categoryId = TYPE_CATEGORY_IDS[type] || null;

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
        // genuinely new titles. The category restriction (where one
        // applies to this type) stays on through every attempt, including
        // the last, most-relaxed one — a missing trailer is far less
        // confusing than the wrong one playing, so this never trades
        // correctness for a better hit rate.
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
        const relevanceNames = [gameName, canonicalName];

        for (const attempt of attempts) {
            if (quotaExceeded) break;
            const result = await youtubeSearch(attempt.query, attempt.views, categoryId);
            if (!result) continue;

            if (!resultLooksRelevant(relevanceNames, result.title)) {
                console.log(`[trailer] Rejected unrelated result for "${gameName}" via ${attempt.label}: "${result.title}"`);
                continue;
            }

            console.log(`[trailer] Found trailer for "${gameName}" via ${attempt.label}: ${result.videoId}`);
            foundId = result.videoId;
            break;
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
    // Every Gutenberg book is public-domain and freely readable online —
    // prefer their own in-browser HTML reader when Gutendex lists one,
    // otherwise fall back to the book's normal Gutenberg.org page, which
    // always offers a "Read this book online" link of its own.
    const htmlFormatKey = b.formats
        ? Object.keys(b.formats).find((k) => k.startsWith("text/html"))
        : null;
    const readUrl = (htmlFormatKey && b.formats[htmlFormatKey])
        || (b.id ? `https://www.gutenberg.org/ebooks/${b.id}` : null);
    const subjects = [
        ...(Array.isArray(b.subjects) ? b.subjects : []),
        ...(Array.isArray(b.bookshelves) ? b.bookshelves : [])
    ];
    const summaryText = (b.summaries && b.summaries[0]) || null;
    const isMature = textContainsMatureKeyword(b.title)
        || subjects.some((s) => textContainsMatureKeyword(s))
        || textContainsMatureKeyword(summaryText);

    return {
        id: `gutenberg-${b.id}`,
        title: b.title || "Untitled",
        author: (b.authors && b.authors[0] && b.authors[0].name) || "Unknown",
        cover: coverUrl,
        downloadUrl: epubUrl,
        downloadCount: b.download_count || 0,
        summary: summaryText,
        source: "Project Gutenberg",
        language: (b.languages && b.languages[0]) || null,
        readUrl,
        isMature
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
// Backs the Discover Online tab's Language/Category filters (and its
// search box, combined in one request) — Gutendex natively supports
// "languages" and "topic" query params on top of full-text "search", so
// this filters against its whole catalog server-side rather than just
// whatever's already been fetched into discoveryBooksCache.
ipcMain.handle("search-gutenberg-filtered", async (event, filters) => {
    try {
        const { query, language, topic } = filters || {};
        const params = new URLSearchParams();
        if (query && query.trim()) params.set("search", query.trim());
        if (language && language !== "all") params.set("languages", language);
        if (topic && topic !== "all") params.set("topic", topic);
        params.set("sort", "popular");

        const data = await fetchWithRetry(`https://gutendex.com/books/?${params.toString()}`, 10000);
        const books = (data && Array.isArray(data.results)) ? data.results : [];
        const mapped = books
            .filter((b) => b.formats && b.formats["application/epub+zip"])
            .map(mapGutenbergBook);

        return { success: true, books: mapped };
    } catch (err) {
        console.error("[ebooks] Gutenberg filtered search failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

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

// Explicit-content keyword filter, used across Books/Manga/Comics/Movies/
// Shows to compute an isMature flag on each item — deliberately narrow
// (sexual/explicit-content terms only, not broad "mature themes" like
// violence or horror) per your own instruction. This is best-effort: it
// only catches what the item's own title/subjects/genres/summary text
// actually says, so an admin can also manually force an item mature (or
// clear a false positive) via admin-toggle-item-mature/mature_overrides,
// checked separately from this.
const MATURE_KEYWORDS = [
    "hentai", "porn", "pornographic", "xxx", "erotica", "erotic",
    "nsfw", "fetish", "bdsm", "adult content", "explicit content",
    "sexually explicit"
];

function textContainsMatureKeyword(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    return MATURE_KEYWORDS.some((kw) => lower.includes(kw));
}

// True if a book's title or subject list mentions the given keyword —
// used to keep Manga and (Western/general) Comics from bleeding into
// each other, since Open Library files plenty of manga under a generic
// "comics" subject too. Checked against the raw search doc (subjects
// aren't kept on the mapped book object).
function openLibraryDocMentions(doc, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    if ((doc.title || "").toLowerCase().includes(lowerKeyword)) return true;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    return subjects.some((s) => String(s).toLowerCase().includes(lowerKeyword));
}

function openLibraryDocMentionsAny(doc, keywords) {
    return keywords.some((kw) => openLibraryDocMentions(doc, kw));
}

// Open Library's search.json groups results by WORK, not edition — and a
// work's "subject" list is the union of every edition's subjects. A classic,
// centuries-old text (a Shakespeare play, a public-domain novel) that later
// got a manga/graphic-novel adaptation (e.g. the real "Manga Shakespeare"
// series, or "Cirque du Freak: The Manga") ends up with "manga"/"comic" in
// its aggregate subject list even though the specific cover/edition Open
// Library hands back for that work is the original prose/play, not the
// adaptation — which is exactly how a Shakespeare title page or a plain
// novel cover was showing up inside Manga/Comics. first_publish_year is
// also a work-level minimum across all editions, so it still reflects the
// ORIGINAL work's date even when the match came from a much later
// adaptation — making it a reliable, already-fetched signal for filtering
// these out: manga as a format didn't exist before the mid-20th century,
// and neither did the modern comic book, so a work whose earliest known
// edition predates that has to be a false positive from this aggregation
// quirk, not an actual period-appropriate manga/comic.
function openLibraryYearIsPlausible(doc, minYear) {
    if (!minYear || !doc.first_publish_year) return true;
    return doc.first_publish_year >= minYear;
}

// A subject string like "Comics, graphic novels, manga" is a broad
// umbrella tag some libraries file ANY graphic-format book under — it
// makes a plain Western-style graphic novel (Dog Man, say — nothing
// Japanese about it) match a bare "manga" keyword search even though it
// isn't manga at all. A subject genuinely specific to manga is almost
// never phrased as "comic ... manga" in the same breath, so this requires
// a subject that mentions manga WITHOUT also reading like one of those
// umbrella comic/graphic-novel categories.
function openLibraryDocHasSpecificManga(doc) {
    if ((doc.title || "").toLowerCase().includes("manga")) return true;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    return subjects.some((s) => {
        const lower = String(s).toLowerCase();
        return lower.includes("manga") && !lower.includes("comic") && !lower.includes("graphic novel");
    });
}

function mapOpenLibraryBook(doc) {
    const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
    const workKey = doc.key || null;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    const isMature = textContainsMatureKeyword(doc.title) || subjects.some((s) => textContainsMatureKeyword(s));

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
        source: "Open Library",
        isMature
    };
}

async function fetchOpenLibraryBooks(query, sort) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const data = await fetchWithRetry(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=40&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access,subject`,
        10000
    );
    const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
    return docs.filter((d) => d.title).map(mapOpenLibraryBook);
}

// New Releases specifically has a much worse cover-availability rate
// than the other lists — Open Library's "new" sort surfaces
// freshly-cataloged entries, and cover art indexing consistently lags
// behind cataloging, so a large share of genuinely recent entries just
// don't have artwork yet. A single 200-candidate page used to come up
// short and get padded out with no-cover entries to hit the desired
// count, which is how a "New Releases" row ended up half blank covers.
// Instead, page through several batches of candidates (Open Library
// has no key/auth and a generous limit, so this is cheap and only runs
// once per cache refresh) and keep ONLY books that actually have cover
// art, stopping as soon as there are enough. If every page is
// exhausted and there still aren't enough, return what was found
// rather than padding with bare listings — a shorter, fully-illustrated
// row beats a full one that's mostly blank placeholders.
async function fetchOpenLibraryBooksWithCovers(query, sort, desiredCount, excludeKeyword, requireKeywords, minYear) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const pageSize = 200;
    const maxPages = 10; // up to 2000 candidates before giving up — Manga/Comics now ask for a much bigger list (150) than the original 40, so this needs more room to find that many with real cover art
    const withCovers = [];
    const seenKeys = new Set();

    for (let page = 0; page < maxPages && withCovers.length < desiredCount; page++) {
        let data;
        try {
            data = await fetchWithRetry(
                `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=${pageSize}&offset=${page * pageSize}&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access,subject`,
                10000
            );
        } catch (err) {
            break; // keep whatever was already gathered rather than failing the whole list over one bad page
        }

        const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
        if (docs.length === 0) break; // ran out of results before reaching maxPages

        for (const d of docs) {
            if (!d.title || !d.cover_i) continue;
            if (excludeKeyword && openLibraryDocMentions(d, excludeKeyword)) continue;
            // requireKeywords can be a plain keyword list (checked with
            // openLibraryDocMentionsAny) or a custom predicate function,
            // for cases like manga that need sharper logic than a bare
            // substring match (see openLibraryDocHasSpecificManga).
            if (requireKeywords) {
                const passes = typeof requireKeywords === "function"
                    ? requireKeywords(d)
                    : openLibraryDocMentionsAny(d, requireKeywords);
                if (!passes) continue;
            }
            if (!openLibraryYearIsPlausible(d, minYear)) continue;
            const dedupeKey = d.key || d.cover_edition_key;
            if (dedupeKey) {
                if (seenKeys.has(dedupeKey)) continue;
                seenKeys.add(dedupeKey);
            }
            withCovers.push(mapOpenLibraryBook(d));
            if (withCovers.length >= desiredCount) break;
        }
    }

    return withCovers;
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

// Manga/Comics sections — reuse the exact same Open Library machinery as
// Buy Books (fetchOpenLibraryBooks, mapOpenLibraryBook, saveDataCache),
// just scoped to different default queries. Unlike Buy Books/Popular
// though, Open Library's manga and comics catalogs have a much lower
// cover-art hit rate than general fiction — a plain query used to return
// a lot of entries with no artwork at all, showing up as blank covers in
// the grid. Using the same cover-filtering fetch already built for New
// Releases (which pages through candidates and keeps only the ones that
// actually have cover art) fixes that the same way it did there.
ipcMain.handle("get-manga-books", async () => {
    try {
        // Scoped to the actual "manga" subject rather than a loose
        // keyword search, so this doesn't also pull in books that just
        // mention manga in passing. minYear=1950 filters out classic
        // pre-manga-era works whose only "manga" hit is a much later
        // adaptation polluting Open Library's work-level subject list
        // (see openLibraryYearIsPlausible), and openLibraryDocHasSpecificManga
        // filters out Western comics/graphic novels caught by a broad
        // "comics, graphic novels, manga" umbrella subject tag.
        const books = await fetchOpenLibraryBooksWithCovers("subject:manga", "rating", 150, null, openLibraryDocHasSpecificManga, 1950);
        saveDataCache("cache-manga-books.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Manga fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-cached-manga-books", async () => loadDataCache("cache-manga-books.json") || []);

ipcMain.handle("get-comics-books", async () => {
    try {
        // Open Library files a lot of manga under the generic "comics"
        // subject too, so this excludes anything that mentions manga in
        // its own title/subjects — manga always belongs in the Manga
        // tab, never duplicated into Comics. minYear=1930 filters out
        // classic pre-comic-era works whose only "comic"/"graphic novel"
        // hit is a much later adaptation (see openLibraryYearIsPlausible).
        const books = await fetchOpenLibraryBooksWithCovers("subject:comics", "rating", 150, "manga", ["comic", "graphic novel"], 1930);
        saveDataCache("cache-comics-books.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Comics fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-cached-comics-books", async () => loadDataCache("cache-comics-books.json") || []);

// Manga/Comics search, kept as its own endpoint (rather than reusing the
// general search-openlibrary-books one below) specifically so a search
// typed inside the Manga tab stays scoped to subject:manga, and a search
// inside Comics stays scoped to subject:comics with manga excluded — the
// same separation as the default lists above, just applied live.
ipcMain.handle("search-genre-books", async (event, { term, kind } = {}) => {
    if (!term || !term.trim()) return { success: true, books: [] };
    try {
        const isManga = kind === "manga";
        const subjectFilter = isManga ? "subject:manga" : "subject:comics";
        const data = await fetchWithRetry(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(`${subjectFilter} ${term.trim()}`)}&limit=60&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access,subject`,
            10000
        );
        const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
        // Same work-level-aggregation guard as the default lists above
        // (see openLibraryYearIsPlausible) — without it, searching Manga
        // or Comics could still surface a classic work whose only real
        // link to the genre is a much later adaptation.
        const minYear = isManga ? 1950 : 1930;
        const scoped = isManga
            ? docs.filter((d) => openLibraryDocHasSpecificManga(d) && openLibraryYearIsPlausible(d, minYear))
            : docs.filter((d) => !openLibraryDocMentions(d, "manga") && openLibraryDocMentionsAny(d, ["comic", "graphic novel"]) && openLibraryYearIsPlausible(d, minYear));
        const books = scoped.filter((d) => d.title).map(mapOpenLibraryBook);
        return { success: true, books };
    } catch (err) {
        console.error("[books] genre search failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

// Live, cross-category web search for the header search bar — unlike
// the rest of the app, this deliberately does NOT touch any cache file:
// nothing here is ever added to a list, it's shown once and discarded
// the moment the search is cleared, per your own instruction. Queries
// Steam (games — exempt from mature filtering, same as every other
// games list), TMDB (movies/shows), and Open Library (books) in
// parallel. includeMature widens the result count and, for
// TMDB, actually asks for adult results too — the "bigger search for
// adults" you asked for — rather than just filtering the same small
// result set differently.
ipcMain.handle("web-search-all", async (event, { query, includeMature }) => {
    const term = (query || "").trim();
    if (!term) return { success: true, results: [] };

    const perCategoryLimit = includeMature ? 25 : 15;
    const results = [];

    const tasks = [
        (async () => {
            try {
                const data = await httpsGetJsonPlain(
                    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=US&l=english`,
                    8000
                );
                (data && Array.isArray(data.items) ? data.items : []).slice(0, perCategoryLimit).forEach((item) => {
                    results.push({
                        section: "game",
                        id: item.id,
                        title: item.name,
                        image: item.tiny_image || null,
                        link: `https://store.steampowered.com/app/${item.id}`,
                        isMature: false // games are exempt from mature filtering, per your own instruction
                    });
                });
            } catch (err) {
                console.error("[web-search] Steam search failed:", err.message || err);
            }
        })(),

        (async () => {
            try {
                const data = await mediaProxyGetJsonPlain("tmdb", "/search/movie", {
                    query: term,
                    include_adult: includeMature ? "true" : "false"
                });
                (data.results || []).slice(0, perCategoryLimit).forEach((m) => {
                    results.push({
                        section: "movie",
                        id: m.id,
                        title: m.title,
                        image: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
                        link: `https://www.themoviedb.org/movie/${m.id}`,
                        isMature: !!m.adult || textContainsMatureKeyword(m.title) || textContainsMatureKeyword(m.overview)
                    });
                });
            } catch (err) {
                console.error("[web-search] TMDB movie search failed:", err.message || err);
            }
        })(),

        (async () => {
            try {
                const data = await mediaProxyGetJsonPlain("tmdb", "/search/tv", {
                    query: term,
                    include_adult: includeMature ? "true" : "false"
                });
                (data.results || []).slice(0, perCategoryLimit).forEach((s) => {
                    results.push({
                        section: "show",
                        id: s.id,
                        title: s.name,
                        image: s.poster_path ? `https://image.tmdb.org/t/p/w200${s.poster_path}` : null,
                        link: `https://www.themoviedb.org/tv/${s.id}`,
                        isMature: !!s.adult || textContainsMatureKeyword(s.name) || textContainsMatureKeyword(s.overview)
                    });
                });
            } catch (err) {
                console.error("[web-search] TMDB tv search failed:", err.message || err);
            }
        })(),

        (async () => {
            try {
                const books = await fetchOpenLibraryBooks(term);
                books.slice(0, perCategoryLimit).forEach((b) => {
                    results.push({
                        section: "book",
                        id: b.id,
                        title: b.title,
                        image: b.cover,
                        link: b.infoLink,
                        isMature: b.isMature
                    });
                });
            } catch (err) {
                console.error("[web-search] Open Library search failed:", err.message || err);
            }
        })()
    ];

    await Promise.allSettled(tasks);

    // Defense in depth: even though the renderer already gates whether
    // it asks for mature results at all, never hand back mature items to
    // a caller that didn't explicitly ask for them.
    const filtered = includeMature ? results : results.filter((r) => !r.isMature);
    return { success: true, results: filtered };
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

        // Both title and id come from the book source's own metadata — id is
        // normally a plain numeric identifier, but it's sanitized the same
        // way as title (rather than trusted as-is) so a "../" in either one
        // can never build a path that escapes ebooksFolder.
        const safeTitle = book.title.replace(/[^a-z0-9]/gi, "_").slice(0, 80);
        const safeId = String(book.id).replace(/[^a-z0-9]/gi, "_");
        const safeFileName = `${safeTitle}-${safeId}.epub`;
        const destPath = path.join(ebooksFolder, safeFileName);

        // Defense-in-depth: confirm the resolved path is actually still
        // inside ebooksFolder before writing anything, regardless of how
        // safeFileName was built.
        const resolvedDest = path.resolve(destPath);
        const resolvedFolder = path.resolve(ebooksFolder) + path.sep;
        if (!resolvedDest.startsWith(resolvedFolder)) {
            return { success: false, error: "Invalid book metadata — refusing to download." };
        }

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
            if (!g.path) continue;

            // Steam-imported games are saved as a steam://rungameid/<appid>
            // launch URL rather than a real filesystem path, so they need
            // their own check — see isSteamAppStillInstalled above. Every
            // other "://" path (any launcher protocol besides Steam's)
            // still isn't a real filesystem path either, but there's no
            // equivalent manifest to check it against, so — same as
            // before — it's left alone rather than risk a false "missing".
            const steamMatch = g.path.match(/^steam:\/\/rungameid\/(\d+)$/i);
            if (steamMatch) {
                if (!isSteamAppStillInstalled(steamMatch[1])) {
                    genuinelyMissing.push({ path: g.path, name: g.name });
                }
                continue;
            }

            if (g.path.includes("://") || fs.existsSync(g.path)) continue;

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

// --- Real uninstall (Windows registry) -------------------------------------
// "Remove" above only removes the entry from Riftgate's own list — it never
// touched the actual installed program. This looks up the same uninstaller
// Control Panel / Settings would run (from the registry's Uninstall keys)
// and launches it directly, rather than deleting any files ourselves.
const UNINSTALL_REGISTRY_HIVES = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
];

function queryUninstallHive(hivePath) {
    return new Promise((resolve) => {
        execFile("reg", ["query", hivePath, "/s"], { maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
            if (error || !stdout) {
                resolve([]);
                return;
            }
            resolve(parseUninstallRegistryOutput(stdout));
        });
    });
}

function parseUninstallRegistryOutput(stdout) {
    const entries = [];
    const blocks = stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);

    blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        const keyLine = lines[0].trim();
        if (!keyLine.startsWith("HKEY_")) return;

        const entry = {};
        for (let i = 1; i < lines.length; i++) {
            const match = /^\s{2,}(\S.*?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(lines[i]);
            if (!match) continue;
            entry[match[1]] = match[3].trim();
        }
        if (entry.DisplayName) entries.push(entry);
    });

    return entries;
}

async function queryAllUninstallEntries() {
    const results = await Promise.all(UNINSTALL_REGISTRY_HIVES.map(queryUninstallHive));
    return results.flat();
}

// Splits a registry UninstallString ("C:\Path To\uninst.exe" /flag, or a
// bare MsiExec.exe /X{GUID} call) into an executable and its arguments,
// respecting a quoted executable path.
function parseUninstallCommand(cmd) {
    if (!cmd) return null;
    const trimmed = cmd.trim();

    if (trimmed.startsWith('"')) {
        const closingQuote = trimmed.indexOf('"', 1);
        if (closingQuote === -1) return { exe: trimmed.slice(1), args: [] };
        const exe = trimmed.slice(1, closingQuote);
        const rest = trimmed.slice(closingQuote + 1).trim();
        return { exe, args: rest ? rest.split(/\s+/) : [] };
    }

    const parts = trimmed.split(/\s+/);
    return { exe: parts[0], args: parts.slice(1) };
}

// Tries to find the registry Uninstall entry for an installed program,
// preferring an exact install-folder match over a name-based guess.
async function findUninstallEntryForGame(gamePath, gameName) {
    const entries = await queryAllUninstallEntries();
    const gameDir = path.dirname(gamePath).replace(/\\+$/, "").toLowerCase();

    let match = entries.find((e) => {
        if (!e.InstallLocation) return false;
        const loc = e.InstallLocation.replace(/\\+$/, "").toLowerCase();
        return loc && (gameDir === loc || gameDir.startsWith(loc + "\\"));
    });

    let confidence = "high";

    if (!match) {
        match = entries.find((e) => {
            const ref = (e.UninstallString || e.DisplayIcon || "").toLowerCase();
            return ref.includes(gameDir);
        });
    }

    if (!match && gameName) {
        const normalizedName = gameName.toLowerCase().trim();
        match = entries.find((e) => {
            const displayName = (e.DisplayName || "").toLowerCase().trim();
            return displayName && (displayName === normalizedName || displayName.includes(normalizedName) || normalizedName.includes(displayName));
        });
        confidence = "low";
    }

    if (!match || !match.UninstallString) return null;

    return {
        displayName: match.DisplayName,
        uninstallString: match.UninstallString,
        confidence
    };
}

ipcMain.handle("uninstall-game", async (event, { path: gamePath, name: gameName }) => {
    try {
        const found = await findUninstallEntryForGame(gamePath, gameName);

        if (!found) {
            return {
                success: false,
                reason: "not_found",
                error: "Couldn't find an uninstaller for this in Windows' installed-programs list (common for portable apps or manually-added entries). You can still remove it from Riftgate's list, or uninstall it yourself from Windows Settings."
            };
        }

        const command = parseUninstallCommand(found.uninstallString);
        if (!command || !command.exe) {
            return {
                success: false,
                reason: "unparseable",
                error: "Found an uninstaller entry, but couldn't understand how to run it."
            };
        }

        execFile(command.exe, command.args, (error) => {
            if (error) {
                console.error("[uninstall] uninstaller process error:", error.message || error);
            }
        });

        return {
            success: true,
            displayName: found.displayName,
            confidence: found.confidence
        };
    } catch (err) {
        console.error("[uninstall] uninstall-game failed:", err.message || err);
        return { success: false, reason: "error", error: "Something went wrong looking up the uninstaller." };
    }
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

// Steam's GetOwnedGames returns playtime_forever in MINUTES, keyed by
// appid, for every game on the given profile — but only if that profile's
// "Game details" privacy is set to Public; otherwise it comes back with no
// games array at all rather than an error, which is why that case gets
// its own message below instead of just failing silently.
ipcMain.handle("refresh-steam-playtime", async (event, rawSteamId) => {
    const steamId = (rawSteamId || "").trim();

    if (!/^\d{17}$/.test(steamId)) {
        return { success: false, error: "That doesn't look like a SteamID64 — it should be a 17-digit number (e.g. 76561198012345678)." };
    }

    let parsed;
    try {
        parsed = await mediaProxyGetJsonPlain("steam", "/IPlayerService/GetOwnedGames/v0001/", {
            steamid: steamId,
            include_played_free_games: 1,
            include_appinfo: 0,
            format: "json"
        });
    } catch (err) {
        return { success: false, error: err.message || "Couldn't reach Steam." };
    }

    const games = parsed && parsed.response && parsed.response.games;

    if (!games) {
        return { success: false, error: "Steam returned no games — double check the SteamID64 is correct and that your profile's \"Game details\" privacy is set to Public." };
    }

    const playtimes = {};
    for (const g of games) {
        if (g && g.appid) playtimes[g.appid] = g.playtime_forever || 0;
    }

    let current = { ...DEFAULT_SETTINGS };
    if (fs.existsSync(SETTINGS_FILE)) {
        try {
            current = { ...current, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
        } catch (err) {
            // fall back to defaults if the file is somehow corrupt
        }
    }

    const updated = { ...current, steamId64: steamId, steamPlaytimes: playtimes, steamPlaytimesUpdatedAt: Date.now() };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));

    return { success: true, count: games.length, playtimes };
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
// DPAPI on Windows). If OS-level encryption isn't available on this
// machine/profile, the session is simply not persisted at all rather than
// falling back to writing the password in plain text — the user just has
// to log in again next launch on that one machine, which is a much smaller
// cost than a recoverable plaintext password sitting on disk.
ipcMain.handle("save-login-session", async (event, { username, password }) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            // Clean up any session file a previous version of the app may
            // have left behind in plain text.
            if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
            console.warn("[session] OS-level encryption unavailable — not persisting login session.");
            return { success: false, reason: "encryption_unavailable" };
        }

        const payload = JSON.stringify({ username, password });
        fs.writeFileSync(SESSION_FILE, safeStorage.encryptString(payload));
        return { success: true };
    } catch (err) {
        console.error("[session] Failed to save login session:", err.message || err);
        return { success: false };
    }
});

ipcMain.handle("load-login-session", async () => {
    if (!fs.existsSync(SESSION_FILE)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;

    try {
        const raw = fs.readFileSync(SESSION_FILE);
        const payload = safeStorage.decryptString(raw);
        const parsed = JSON.parse(payload);
        if (!parsed || !parsed.username || !parsed.password) return null;
        return parsed;
    } catch (err) {
        // Corrupt file, a leftover plaintext file from an older version, or
        // encrypted on a machine/user profile that can no longer decrypt it
        // — treat exactly like "no saved session" rather than erroring the
        // whole app out.
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

// Resolves to { url, error } rather than just a bare URL/null — every
// failure used to collapse into the same generic "couldn't generate a
// link" message with nothing to actually diagnose it by (expired/missing
// storage object, an RLS/policy rejection, a bad path, a network error
// all looked identical). Now the real reason from Supabase's response
// flows all the way up to the dialog the user actually sees, the same
// way upload failures already surface their real reason instead of a
// generic one.
function supabaseStorageSignedUrl(storagePath, expiresInSeconds) {
    return new Promise((resolve) => {
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
                if (res.statusCode !== 200) {
                    let detail = raw;
                    try {
                        const parsed = JSON.parse(raw);
                        detail = parsed.message || parsed.error || raw;
                    } catch (err) {
                        // body wasn't JSON — use it raw
                    }
                    console.error(`[share] signed URL request failed — status ${res.statusCode}:`, raw);
                    resolve({ url: null, error: `(${res.statusCode}) ${detail}` });
                    return;
                }

                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.signedURL) {
                        resolve({ url: `${SUPABASE_URL}/storage/v1${parsed.signedURL}`, error: null });
                    } else {
                        console.error("[share] signed URL response had no signedURL field:", raw);
                        resolve({ url: null, error: "Storage didn't return a signed URL." });
                    }
                } catch (err) {
                    console.error("[share] signed URL response wasn't valid JSON:", raw);
                    resolve({ url: null, error: "Unexpected response from storage." });
                }
            });
        });

        req.on("error", (err) => {
            console.error("[share] signed URL request errored:", err.message || err);
            resolve({ url: null, error: err.message || String(err) });
        });
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

ipcMain.handle("register-username", async (event, { username, deviceId, dateOfBirth }) => {
    if (hasReservedAdminSuffix(username)) {
        return { success: false, error: "Usernames can't end in \"_Adm\", \"_Root\", or similar — those are reserved to prevent impersonating an admin." };
    }

    try {
        const result = await supabaseRequest("usernames", "POST", {
            username,
            device_id: deviceId,
            date_of_birth: dateOfBirth || null
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

// The account's own date of birth (used to compute minor/adult) and its
// mature-content display preference — read together since both gate the
// same thing (what mature content, if any, this account can see).
// Read-only, and only ever asked for the CURRENTLY logged-in account's
// own username — same trust level as get-all-usernames/submit-suggestion,
// not an admin-gated RPC, since nothing sensitive (like a password) is
// exposed here.
// Best-effort country lookup for the age gate — NOT accredited/ID-based
// age verification. This only tells Riftgate roughly what country a
// connection is coming from (a VPN defeats it trivially, like any IP
// geolocation), used purely to pick which minimum age counts as "adult"
// for that country, so it's a courtesy improvement over a single flat
// number, not a compliance guarantee for jurisdictions whose laws
// require real ID/age verification for adult content.
ipcMain.handle("get-country-by-ip", async () => {
    try {
        const data = await httpsGetJsonPlain("https://ipapi.co/json/", 8000);
        return { success: true, countryCode: (data && data.country_code) || null };
    } catch (err) {
        console.error("[age-gate] country lookup failed:", err.message || err);
        return { success: false, countryCode: null };
    }
});

ipcMain.handle("get-account-profile", async (event, username) => {
    try {
        const result = await supabaseRequest(
            `usernames?username=eq.${encodeURIComponent(username)}&select=date_of_birth,show_mature_content`,
            "GET"
        );

        if (result.statusCode !== 200 || !Array.isArray(result.body) || result.body.length === 0) {
            return { success: false };
        }

        return {
            success: true,
            dateOfBirth: result.body[0].date_of_birth || null,
            showMatureContent: !!result.body[0].show_mature_content
        };
    } catch (err) {
        console.error("[account] profile fetch failed:", err.message || err);
        return { success: false };
    }
});

// Existing accounts created before date-of-birth existed are asked for
// it right after they log in (see ensureLoggedIn in the renderer) —
// this is what saves it. Goes through set_own_date_of_birth (a
// security-definer RPC), NOT a direct PATCH against usernames — that
// table's Row Level Security has no UPDATE policy for the anon key, so
// a direct PATCH here silently updated nothing while still reporting a
// normal success status, which is why a date of birth that was
// "saved" kept coming back empty (and re-prompted) on every next login.
ipcMain.handle("set-account-date-of-birth", async (event, { username, dateOfBirth }) => {
    const r = await callAdminRpc("set_own_date_of_birth", { input_username: username, new_dob: dateOfBirth });
    if (!r.success) return r;
    return { success: r.result === true };
});

// The mature-content on/off toggle, for a verified adult — tied to the
// account (not this device) per your own choice, so it follows them to
// another PC. Minors never see the control that calls this at all; it's
// still checked server-side by the age gate itself regardless. Same RPC
// pattern as set-account-date-of-birth above, for the same reason — a
// direct PATCH here would silently fail against RLS too.
ipcMain.handle("set-show-mature-content", async (event, { username, show }) => {
    const r = await callAdminRpc("set_own_mature_content_preference", { input_username: username, new_value: !!show });
    if (!r.success) return r;
    return { success: r.result === true };
});

// Every item an admin has manually forced to count as mature (or
// force-cleared), regardless of what the app's own keyword check would
// otherwise decide. Read by every user so their own content list can be
// filtered client-side; only ever written through admin-toggle-item-mature.
ipcMain.handle("get-mature-overrides", async () => {
    try {
        const result = await supabaseRequest("mature_overrides?select=section,item_key", "GET");
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, overrides: [] };
        }
        return { success: true, overrides: result.body };
    } catch (err) {
        console.error("[mature] overrides fetch failed:", err.message || err);
        return { success: false, overrides: [] };
    }
});

// Admin-only: force an item to be treated as mature (or clear that),
// on top of whatever the keyword check alone would decide. Re-verifies
// the admin's password server-side inside admin_toggle_item_mature,
// exactly like every other admin-gated action in this app.
ipcMain.handle("admin-toggle-item-mature", async (event, { username, password, section, itemKey, itemName }) => {
    const r = await callAdminRpc("admin_toggle_item_mature", {
        input_username: username,
        input_password: password,
        target_section: section,
        target_item_key: itemKey,
        target_item_name: itemName || null
    });
    if (!r.success) return r;
    return { success: true, isMature: r.result === true };
});

// Every item an admin/super-admin has removed from Riftgate's catalog
// sections — removal is global, so this is read by every user (same
// pattern as get-mature-overrides) to filter their own view client-side.
// Only ever written through admin-remove-item.
ipcMain.handle("get-removed-items", async () => {
    try {
        const result = await supabaseRequest("removed_items?select=section,item_key", "GET");
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, removed: [] };
        }
        return { success: true, removed: result.body };
    } catch (err) {
        console.error("[removed-items] fetch failed:", err.message || err);
        return { success: false, removed: [] };
    }
});

// Admin/super-admin-only: permanently removes an item from Riftgate for
// every user. Re-verifies the admin's password server-side inside
// admin_remove_item, exactly like every other admin-gated action in this
// app — idempotent, so removing an already-removed item is a no-op.
ipcMain.handle("admin-remove-item", async (event, { username, password, section, itemKey, itemName }) => {
    const r = await callAdminRpc("admin_remove_item", {
        input_username: username,
        input_password: password,
        target_section: section,
        target_item_key: itemKey,
        target_item_name: itemName || null
    });
    if (!r.success) return r;
    return { success: true };
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

// --- Unified login (one password per account) -------------------------
//
// A single account password, set the first time someone opens Riftgate
// and checked once every time after that. Admin status and Vault access
// are both then granted automatically based on who's logged in — see
// admin-account-exists / check-allowlist-only, which are plain membership
// checks with no password of their own. (This replaced two separate,
// earlier password systems — one admin-only, one Vault-only — each with
// its own first-time setup step; both were fully superseded and, having
// no remaining callers, were removed.)
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
        const { url, error } = await supabaseStorageSignedUrl(storagePath, 3600);
        return url ? { success: true, url } : { success: false, error };
    } catch (err) {
        return { success: false, error: err.message || String(err) };
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
        const { url: signedUrl, error: signError } = await supabaseStorageSignedUrl(storagePath);
        if (!signedUrl) {
            console.error("[share] couldn't get signed URL for download:", signError);
            return { success: false, error: `Couldn't generate a download link: ${signError || "unknown error"}` };
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

// --- Vault access requests (non-allowlisted users asking to be let in) ---

ipcMain.handle("request-share-access", async (event, username) => {
    try {
        const result = await supabaseRequest("rpc/request_share_access", "POST", { p_username: username });
        if (result.statusCode !== 200) {
            return { success: false, error: "Couldn't send the request — try again in a moment." };
        }
        const granted = result.body === true || result.body === "true";
        return { success: true, requested: granted };
    } catch (err) {
        console.error("[share] request-share-access failed:", err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
});

ipcMain.handle("get-share-access-requests", async (event, { adminUsername, adminPassword }) => {
    const result = await callAdminRpc("get_share_access_requests", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword
    });
    if (!result.success) return { success: false, list: [], error: result.error };
    return { success: true, list: Array.isArray(result.result) ? result.result : [] };
});

ipcMain.handle("approve-share-access-request", async (event, { adminUsername, adminPassword, targetUsername }) => {
    const result = await callAdminRpc("approve_share_access_request", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_target_username: targetUsername
    });
    return { success: result.success && !!result.result, error: result.error };
});

ipcMain.handle("deny-share-access-request", async (event, { adminUsername, adminPassword, targetUsername }) => {
    const result = await callAdminRpc("deny_share_access_request", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_target_username: targetUsername
    });
    return { success: result.success && !!result.result, error: result.error };
});

// Safe, public-facing lists — never include password_hash, unlike a raw
// table read would.
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

// --- Applications (community-recommended apps) --------------------------
// A public, browsable list of third-party apps recommended by admins —
// this is open content for everyone (like Free Games or Theatre), not
// gated like The Vault. Only adding an app, editing its description, or
// removing it requires admin credentials, checked server-side via the
// exact same verify_admin_login every other admin-gated action in this
// app already uses (so this works for regular admins and super admins
// alike, matching the "admins or super admins" requirement with zero
// extra logic).

ipcMain.handle("get-community-apps", async () => {
    try {
        const result = await supabaseRequest("community_apps?select=*&order=created_at.desc", "GET");
        if (result.statusCode !== 200 || !Array.isArray(result.body)) {
            return { success: false, apps: [] };
        }
        return { success: true, apps: result.body };
    } catch (err) {
        console.error("[apps] fetch failed:", err.message || err);
        return { success: false, apps: [] };
    }
});

// GitHub exposes a repo's own short description with no auth needed for
// public repos — used to fill in a description automatically when an
// admin adds a github.com link, so they don't have to type one unless
// they want to. Any other host, a private/missing repo, or a repo with
// no description set just comes back null, and the admin types one in
// themselves (see add-community-app below).
function extractGithubRepoPath(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        return `${parts[0]}/${parts[1]}`;
    } catch (err) {
        return null;
    }
}

async function fetchGithubRepoDescription(rawUrl) {
    const repoPath = extractGithubRepoPath(rawUrl);
    if (!repoPath) return null;

    try {
        const data = await fetchWithRetry(`https://api.github.com/repos/${repoPath}`, 8000, 1);
        return (data && typeof data.description === "string" && data.description.trim()) || null;
    } catch (err) {
        console.error("[apps] GitHub description fetch failed:", err.message || err);
        return null;
    }
}

ipcMain.handle("add-community-app", async (event, { adminUsername, adminPassword, name, url, author, description }) => {
    const trimmedName = (name || "").trim();
    const trimmedUrl = (url || "").trim();

    if (!trimmedName || !trimmedUrl) {
        return { success: false, error: "Both a name and a link are required." };
    }

    try {
        new URL(trimmedUrl);
    } catch (err) {
        return { success: false, error: "That doesn't look like a valid link — make sure it includes https://." };
    }

    // The repo owner IS the author for a GitHub link — no extra request
    // needed, it's already right there in the URL.
    const repoPath = extractGithubRepoPath(trimmedUrl);
    let finalAuthor = (author || "").trim() || null;
    if (!finalAuthor && repoPath) {
        finalAuthor = repoPath.split("/")[0];
    }

    let finalDescription = (description || "").trim() || null;
    if (!finalDescription) {
        finalDescription = await fetchGithubRepoDescription(trimmedUrl);
    }

    const result = await callAdminRpc("add_community_app", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_name: trimmedName,
        p_url: trimmedUrl,
        p_author: finalAuthor,
        p_description: finalDescription
    });

    if (!result.success) return result;
    if (result.result === null) return { success: false, error: "Not authorized." };
    return { success: true, autoAuthor: finalAuthor, autoDescription: finalDescription };
});

ipcMain.handle("update-community-app-details", async (event, { adminUsername, adminPassword, appId, author, description }) => {
    const result = await callAdminRpc("update_community_app_details", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_app_id: appId,
        p_author: (author || "").trim() || null,
        p_description: (description || "").trim() || null
    });
    return { success: result.success && !!result.result, error: result.error };
});

ipcMain.handle("delete-community-app", async (event, { adminUsername, adminPassword, appId }) => {
    const result = await callAdminRpc("delete_community_app", {
        p_admin_username: adminUsername,
        p_admin_password: adminPassword,
        p_app_id: appId
    });
    return { success: result.success && !!result.result, error: result.error };
});

ipcMain.handle("open-data-folder", async () => {
    shell.openPath(app.getPath("userData"));
    return true;
});

// --- Backup / restore --------------------------------------------------
// Bundles the user's actual library/notes/settings data into one portable
// JSON file. Deliberately excludes: session.dat (a login token - exporting
// it would let anyone with the file impersonate the user), and the
// freegames-*/trailer-cache files (disposable caches that rebuild
// themselves, not user data).
const BACKUP_FORMAT_VERSION = 1;

function readJsonFileSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        console.error(`[backup] failed to read ${filePath}:`, err.message || err);
        return fallback;
    }
}

ipcMain.handle("export-backup-data", async () => {
    try {
        const backup = {
            riftgateBackup: true,
            formatVersion: BACKUP_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            appVersion: app.getVersion(),
            data: {
                games: readJsonFileSafe(GAMES_FILE, []),
                settings: readJsonFileSafe(SETTINGS_FILE, {}),
                overrides: readJsonFileSafe(OVERRIDES_FILE, {}),
                watchlist: readJsonFileSafe(WATCHLIST_FILE, []),
                ebooks: readJsonFileSafe(EBOOKS_FILE, [])
            }
        };

        const saveResult = await dialog.showSaveDialog(win, {
            title: "Export Riftgate Backup",
            defaultPath: `riftgate-backup-${Date.now()}.json`,
            filters: [{ name: "Riftgate Backup", extensions: ["json"] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, canceled: true };
        }

        fs.writeFileSync(saveResult.filePath, JSON.stringify(backup, null, 2), "utf8");
        return { success: true, path: saveResult.filePath };
    } catch (err) {
        console.error("[backup] export-backup-data failed:", err.message || err);
        return { success: false, error: "Something went wrong creating the backup." };
    }
});

ipcMain.handle("import-backup-data", async () => {
    try {
        const openResult = await dialog.showOpenDialog(win, {
            title: "Import Riftgate Backup",
            filters: [{ name: "Riftgate Backup", extensions: ["json"] }],
            properties: ["openFile"]
        });

        if (openResult.canceled || !openResult.filePaths || !openResult.filePaths.length) {
            return { success: false, canceled: true };
        }

        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(openResult.filePaths[0], "utf8"));
        } catch (err) {
            return { success: false, error: "That file isn't valid JSON." };
        }

        if (!parsed || !parsed.riftgateBackup || !parsed.data || typeof parsed.data !== "object") {
            return { success: false, error: "That doesn't look like a Riftgate backup file." };
        }

        const { data } = parsed;

        if (data.games !== undefined) {
            fs.writeFileSync(GAMES_FILE, JSON.stringify(data.games, null, 2));
        }
        if (data.settings !== undefined) {
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data.settings, null, 2));
        }
        if (data.overrides !== undefined) {
            fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(data.overrides, null, 2));
        }
        if (data.watchlist !== undefined) {
            fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(data.watchlist, null, 2));
        }
        if (data.ebooks !== undefined) {
            fs.writeFileSync(EBOOKS_FILE, JSON.stringify(data.ebooks, null, 2));
        }

        return { success: true, importedAt: parsed.exportedAt || null };
    } catch (err) {
        console.error("[backup] import-backup-data failed:", err.message || err);
        return { success: false, error: "Something went wrong importing that backup." };
    }
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
    // quitAndInstall(isSilent, isForceRunAfter) — both default to false,
    // which is what was making this feel manual: isSilent=false pops the
    // NSIS installer's own window (the user had to click through it
    // themselves), and isForceRunAfter=false meant Riftgate didn't
    // necessarily relaunch afterward even once that finished. Passing
    // true for both makes the installer run completely unattended in the
    // background and relaunches Riftgate the moment it's done — the user
    // only ever clicks "Update Now" once, nothing else.
    autoUpdater.quitAndInstall(true, true);
});

app.whenReady().then(async () => {
    await createWindow();
    startDropzoneWatcher();

    // Free Games is lazy-loaded — its data is only fetched once the user
    // actually opens that section — so on a session where they never do,
    // the daily refresh would otherwise never get a chance to run at all.
    // This runs it once at startup instead, whenever it's actually due
    // (performFreeGamesRefresh itself isn't gated — this check is what
    // keeps it to "at least once every 24h" rather than every launch),
    // so the cached list stays fresh for whenever they do check it,
    // launch after launch. Runs in the background, after the window is
    // already up, so it never delays startup.
    if ((Date.now() - readFreeGamesLastRefresh()) >= FREEGAMES_FULL_REFRESH_MIN_AGE_MS) {
        performFreeGamesRefresh().catch((err) => {
            console.error("[free-games] startup refresh failed:", err.message || err);
        });
    }

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