const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, safeStorage, protocol, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const {
    supabaseRequest,
    supabaseSignedUpload,
    callAdminRpc,
    mediaProxyGetJson,
    mediaProxyGetJsonPlain,
    sendVerificationEmail,
    sendPasswordResetEmail,
    callEdgeFunction
} = require("./services/supabase");
const platform = require("./services/platform");

// Only one Riftgate may run at a time: two copies would read and rewrite
// the same library/settings files underneath each other. A second launch
// just brings the existing window forward (see "second-instance" below).
if (!app.requestSingleInstanceLock()) {
    app.exit(0);
}

// The window only ever shows Riftgate's own page. Anything that tries to
// navigate it elsewhere (a stray link, injected markup) is blocked, and
// new-window requests (target=_blank, window.open — e.g. "Watch on YouTube"
// inside a trailer) open in the user's browser instead, https only.
function isAppPageUrl(url) {
    return localServerPort !== null && typeof url === "string"
        && url.startsWith(`http://127.0.0.1:${localServerPort}/`);
}

app.on("web-contents-created", (event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    const blockOffAppNavigation = (navEvent, url) => {
        if (!isAppPageUrl(url)) navEvent.preventDefault();
    };
    contents.on("will-navigate", blockOffAppNavigation);
    contents.on("will-redirect", blockOffAppNavigation);
});
const {
    httpsGetJson,
    httpsGetJsonPlain,
    httpsGetTextPlain,
    httpsPostJsonRaw,
    runWithConcurrencyLimit,
    fetchWithRetry
} = require("./services/http");
const tvmaze = require("./services/tvmaze");
const github = require("./services/github");
const booksApi = require("./services/books");
const { textContainsMatureKeyword } = require("./services/content-filters");
const steam = require("./services/steam");
const {
    fetchEpicFreeGames,
    fetchGogFreeGames,
    fetchGamerPowerFreeGames,
    fetchItchFreeGames,
    fetchItchVrFreeGames,
    getCuratedAlwaysFreeGames,
    fetchCuratedAlwaysFreeGames,
    normalizeGameName,
    dedupeCuratedAgainstLive
} = require("./services/free-games");
const {
    TMDB_LANGUAGE_BY_COUNTRY,
    fetchFallbackPoster,
    pickBestYoutubeTrailer,
    mapProviderMovie,
    mapProviderShow
} = require("./services/tmdb");

// Registering a custom scheme's privileges must happen before the app is
// "ready" — Electron ignores registerSchemesAsPrivileged calls made any
// later, so this has to sit at module load time rather than inside
// initUserData()/app.whenReady() alongside the rest of this cache's setup.
// "standard"+"supportFetchAPI" let it behave like a normal origin (so an
// <img src="covercache://..."> loads exactly like any other image URL);
// "corsEnabled" avoids a same-origin surprise since the covers grid mixes
// this scheme with genuine https:// URLs.
protocol.registerSchemesAsPrivileged([
    { scheme: "covercache", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// The local http://127.0.0.1:<port> server (see startLocalServer()) is the
// ONLY page this app ever loads, and its port is randomized per launch —
// set once createWindow() knows it. Every ipcMain handler below is wrapped
// to reject any call whose sender frame isn't that exact origin, so even a
// hypothetical XSS or a stray window/frame can't reach into main-process
// IPC just because it shares a process with the real window.
let localServerPort = null;

function isTrustedIpcSender(event) {
    try {
        const senderURL = new URL(
            event.senderFrame ? event.senderFrame.url : event.sender.getURL()
        );
        return (
            senderURL.protocol === "http:" &&
            senderURL.hostname === "127.0.0.1" &&
            localServerPort !== null &&
            senderURL.port === String(localServerPort)
        );
    } catch (err) {
        return false;
    }
}

const _ipcMainHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
    _ipcMainHandle(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) {
            const from = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
            console.warn(`[ipc] blocked "${channel}" from untrusted sender: ${from}`);
            throw new Error("Untrusted IPC sender");
        }
        return listener(event, ...args);
    });
};

const _ipcMainOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, listener) => {
    _ipcMainOn(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) {
            const from = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
            console.warn(`[ipc] blocked "${channel}" from untrusted sender: ${from}`);
            return;
        }
        return listener(event, ...args);
    });
};

const _ipcMainOnce = ipcMain.once.bind(ipcMain);
ipcMain.once = (channel, listener) => {
    _ipcMainOnce(channel, (event, ...args) => {
        if (!isTrustedIpcSender(event)) {
            const from = event.senderFrame ? event.senderFrame.url : event.sender.getURL();
            console.warn(`[ipc] blocked "${channel}" from untrusted sender: ${from}`);
            return;
        }
        return listener(event, ...args);
    });
};

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
let FREEGAMES_VR_FILE;
let FREEGAMES_LAST_REFRESH_FILE;
let FREEGAMES_BULK_SEARCH_DONE_FILE;
let TRAILER_CACHE_FILE;
let SESSION_FILE;
let EBOOKS_FILE;
let EBOOKS_DROPZONE_FOLDER;
let FREEGAMES_COVER_CACHE_FOLDER;
let STORE_DEALS_LAST_REFRESH_FILE;
let STORE_SEEN_FILE;

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
    // The single app-wide region setting -- drives Theatre (showtimes,
    // streaming providers), New tab (upcoming movies/shows region), and
    // Store (Steam pricing region + display currency). movieCountry and
    // upcomingMoviesCountry below are legacy/superseded: kept only so an
    // existing install's prior choice can be migrated into `country`
    // instead of silently resetting to US (see renderer.js).
    country: "US",
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


// ISO 4217 currency for each of the same countries above -- drives Store
// pricing (see fetchSteamDeals/performStoreDealsRefresh) so a deal's
// price is shown in the currency of the country the user actually picked,
// not always USD.
const CURRENCY_BY_COUNTRY = {
    US: "USD", GB: "GBP", PT: "EUR", CA: "CAD", AU: "AUD",
    DE: "EUR", FR: "EUR", ES: "EUR", BR: "BRL", IT: "EUR",
    NL: "EUR", BE: "EUR", IE: "EUR", CH: "CHF", AT: "EUR",
    MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", JP: "JPY",
    KR: "KRW", CN: "CNY", HK: "HKD", TW: "TWD", IN: "INR",
    RU: "RUB", SE: "SEK", NO: "NOK", DK: "DKK", FI: "EUR",
    PL: "PLN", TR: "TRY", GR: "EUR", CZ: "CZK", HU: "HUF",
    RO: "RON", ZA: "ZAR", NZ: "NZD", PH: "PHP", ID: "IDR",
    MY: "MYR", SG: "SGD", TH: "THB", VN: "VND", SA: "SAR",
    AE: "AED", EG: "EGP", IL: "ILS", UA: "UAH"
};

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

// --- Free Games cover image cache -----------------------------------------
// Free Games can show thousands of cover images (Steam alone verifies
// 4000+ titles), all re-fetched from their original CDN on every single
// visit since renderer.js used to point <img>/background-image straight at
// the remote URL — slow every time, even though a given game's box art
// never changes. Covers now load through this custom "covercache://"
// protocol instead: the first request for a given URL fetches it and saves
// it to disk under the app's userData folder, and every request after that
// (including on the next app launch) is served straight from disk.
function freeGamesCoverCachePathFor(realUrl) {
    const hash = crypto.createHash("sha1").update(realUrl).digest("hex");
    const extMatch = realUrl.match(/\.(jpg|jpeg|png|webp|gif)(?:[?#]|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    return path.join(FREEGAMES_COVER_CACHE_FOLDER, `${hash}.${ext}`);
}

function freeGamesCoverMimeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/jpeg";
}

// The renderer can ask covercache:// for ANY URL, so the fetch below must not
// become a way to reach things on this computer or the local network (the
// app's own 127.0.0.1 server, a router admin page, cloud metadata at
// 169.254.169.254, ...). Every hop — redirects included — must be http(s),
// must resolve only to public addresses (checked at connect time, so a DNS
// name that points at 127.0.0.1 is refused too), must answer with an image,
// and may not exceed a size cap.
const net = require("net");
const dns = require("dns");
const MAX_COVER_BYTES = 15 * 1024 * 1024;

function isNonPublicAddress(address) {
    if (net.isIPv4(address)) {
        const [a, b] = address.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 192 && b === 0) ||
            (a === 198 && (b === 18 || b === 19));
    }
    if (net.isIPv6(address)) {
        const lower = address.toLowerCase();
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isNonPublicAddress(mapped[1]);
        return lower === "::" || lower === "::1" ||
            /^f[cd]/.test(lower) ||          // fc00::/7 unique-local
            /^fe[89ab]/.test(lower) ||       // fe80::/10 link-local
            /^ff/.test(lower);               // multicast
    }
    return true;
}

function publicOnlyLookup(hostname, options, callback) {
    dns.lookup(hostname, options, (err, address, family) => {
        if (err) return callback(err);
        const all = Array.isArray(address) ? address : [{ address, family }];
        if (all.length === 0 || all.some((entry) => isNonPublicAddress(entry.address))) {
            return callback(new Error("Cover host is not a public address"));
        }
        callback(null, address, family);
    });
}

function isAllowedCoverUrl(url) {
    try {
        const parsed = new URL(url);
        return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
    } catch (err) {
        return false;
    }
}

// Same shape as downloadFileFollowingRedirects, but resolves with the image
// bytes in memory instead of writing straight to a known destination path —
// this cache doesn't know the right on-disk filename (extension included)
// until it sees where a redirect chain actually ends up.
function fetchBufferFollowingRedirects(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        if (!isAllowedCoverUrl(url)) {
            reject(new Error("Cover URL not allowed"));
            return;
        }
        const client = url.startsWith("http://") ? http : https;
        const req = client.get(url, { headers: { "User-Agent": "RiftgateApp/1.0" }, lookup: publicOnlyLookup, timeout: 20000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                let nextUrl;
                try {
                    nextUrl = new URL(res.headers.location, url).toString();
                } catch (err) {
                    reject(new Error("Bad cover redirect"));
                    return;
                }
                fetchBufferFollowingRedirects(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Cover fetch failed: ${res.statusCode}`));
                return;
            }
            const type = String(res.headers["content-type"] || "").toLowerCase();
            if (type && !type.startsWith("image/") && !type.startsWith("application/octet-stream") && !type.startsWith("binary/octet-stream")) {
                res.resume();
                reject(new Error("Cover response is not an image"));
                return;
            }
            if (Number(res.headers["content-length"] || 0) > MAX_COVER_BYTES) {
                res.destroy();
                reject(new Error("Cover image too large"));
                return;
            }
            const chunks = [];
            let total = 0;
            res.on("data", (chunk) => {
                total += chunk.length;
                if (total > MAX_COVER_BYTES) {
                    res.destroy(new Error("Cover image too large"));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("timeout", () => req.destroy(new Error("Cover fetch timed out")));
        req.on("error", reject);
    });
}

// Every Free Games card now paints TWO images from the same cover URL — the
// sharp foreground <img> and the .cover-bg-img backdrop behind it (see
// renderer.js's buildFreeGameCard) — and a grid can have hundreds of cards
// with covers loading around the same time even with loading="lazy" (the
// browser starts a generous margin of them ahead of the actual viewport).
// Without anything here, that's two independent cache-miss requests per
// card hitting Steam's CDN at once, and thousands of cards' worth of these
// bursting out together with no cap at all — which is exactly the kind of
// load that gets connections reset/timed out partway through, showing up as
// MORE covers failing to load (including the foreground one, which used to
// load fine on its own before the backdrop started requesting the same URL
// alongside it) rather than fewer. Two fixes below address this together:
// requests for the same not-yet-cached URL that arrive close together now
// share one real fetch instead of issuing two, and real network fetches
// (cache hits still return immediately, uncapped) are capped to a small
// number running at once, queueing the rest instead of firing them all
// simultaneously — roughly mirroring how a browser limits connections per
// host on its own.
const inFlightCoverFetches = new Map(); // cachePath -> Promise<Buffer>
const MAX_CONCURRENT_COVER_FETCHES = 6;
let activeCoverFetchCount = 0;
const coverFetchQueue = [];

function runNextQueuedCoverFetch() {
    if (activeCoverFetchCount >= MAX_CONCURRENT_COVER_FETCHES) return;
    const next = coverFetchQueue.shift();
    if (!next) return;
    activeCoverFetchCount++;
    fetchBufferFollowingRedirects(next.url)
        .then(next.resolve, next.reject)
        .finally(() => {
            activeCoverFetchCount--;
            runNextQueuedCoverFetch();
        });
}

function queuedFetchBuffer(url) {
    return new Promise((resolve, reject) => {
        coverFetchQueue.push({ url, resolve, reject });
        runNextQueuedCoverFetch();
    });
}

// Registered once, in app.whenReady() before the window is created, so the
// scheme is already live by the time index.html's first cover image asks
// for it. Requests look like covercache://cover?u=<encodeURIComponent(url)>
// — the encoded original URL rides along as a query param rather than the
// path so it survives untouched (encodeURIComponent already escapes any
// "/" it contains, but keeping it out of the path sidesteps ever having to
// think about that).
function registerFreeGamesCoverCacheProtocol() {
    protocol.handle("covercache", async (request) => {
        let realUrl;
        try {
            // searchParams.get() already percent-decodes the query value
            // once (that's what turns the renderer's encodeURIComponent
            // back into the real cover URL) — an extra decodeURIComponent
            // on top of that used to double-decode it. Harmless for a URL
            // with nothing else percent-encoded in it (Steam/Epic/GOG
            // covers), but itch.io's own CDN URLs (img.itch.zone) contain a
            // pre-encoded "%23" in their path — after surviving the first
            // decode intact, the second decode turned that into a literal
            // "#", which the HTTP request then read as a URL fragment and
            // silently chopped off everything after it, turning a real
            // image URL into one that resolves to nothing. That's why every
            // itch.io cover (and only itch.io's) was falling back to the
            // "no cover" placeholder.
            realUrl = new URL(request.url).searchParams.get("u") || "";
        } catch (err) {
            realUrl = "";
        }
        if (!realUrl || realUrl.length > 2048 || !isAllowedCoverUrl(realUrl)) {
            return new Response(null, { status: 400 });
        }

        const cachePath = freeGamesCoverCachePathFor(realUrl);
        // Cached responses are content-hashed and never change in place, so
        // the renderer/Chromium's own HTTP cache is safe to lean on too —
        // this cuts out a second round trip through this handler entirely
        // for the common case of the foreground and backdrop images on one
        // card requesting the exact same URL.
        const cacheHeaders = { "Cache-Control": "public, max-age=31536000, immutable" };

        if (fs.existsSync(cachePath)) {
            try {
                const data = fs.readFileSync(cachePath);
                return new Response(data, { headers: { "Content-Type": freeGamesCoverMimeFor(cachePath), ...cacheHeaders } });
            } catch (err) {
                // Fall through and re-fetch — a corrupt/half-written cache
                // file shouldn't permanently break this one cover.
            }
        }

        try {
            // Share one in-flight fetch across every request that lands
            // while it's still running, instead of letting each kick off
            // its own — this is what actually stops the foreground and
            // backdrop images (or several cards' worth of duplicate URLs)
            // from doubling up on the same network request and disk write.
            let bufferPromise = inFlightCoverFetches.get(cachePath);
            if (!bufferPromise) {
                bufferPromise = queuedFetchBuffer(realUrl).finally(() => {
                    inFlightCoverFetches.delete(cachePath);
                });
                inFlightCoverFetches.set(cachePath, bufferPromise);
            }
            const buffer = await bufferPromise;
            // Best-effort write: a failed disk write still lets this one
            // request succeed from the buffer already in hand, it just
            // won't be cached for next time.
            try {
                fs.writeFileSync(cachePath, buffer);
            } catch (err) {
                // Ignore — see above.
            }
            return new Response(buffer, { headers: { "Content-Type": freeGamesCoverMimeFor(cachePath), ...cacheHeaders } });
        } catch (err) {
            return new Response(null, { status: 502 });
        }
    });
}

// --- Detecting installed games from Steam / Epic ---------------------------


// Store-manifest scanning (Steam, Epic on Windows) and the generic
// installed-apps sweep (Start Menu shortcuts on Windows, /Applications on
// Mac) both live in services/platform/{windows,mac}.js now, behind
// platform.scanStoreManifests() / platform.scanGenericApps() /
// platform.isSteamAppStillInstalled() — this is the same logic that used
// to be inline here, just split per-OS so a Mac build isn't stuck running
// PowerShell/tasklist calls that don't exist on that platform.
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
    const storeGames = platform.scanStoreManifests();
    const shortcutApps = await platform.scanGenericApps();

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

        const found = platform.scanStoreManifests();

        return found.filter((g) => !existingPaths.has(g.path) && !dismissedSet.has(g.path));

    } catch (err) {
        console.error("[import] scan-new-games failed:", err.message || err);
        return [];
    }
});


// A Start Menu shortcut (Windows) / .app bundle (Mac) alone can't tell a game from any other desktop
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

                // Runtime-downloaded covers (Steam/Epic/etc., fetched on
                // demand) live here, in the writable AppData folder. But
                // some entries ship their cover art bundled with the app
                // itself instead — e.g. the locally-cropped Meta Quest
                // covers, which have no live source to download from at
                // runtime — and those live read-only under the app's own
                // covers/ folder, never copied into AppData. Fall back to
                // that bundled copy whenever AppData doesn't have the file.
                if (!fs.existsSync(path.resolve(path.join(root, relativePath)))) {
                    root = path.join(__dirname, "covers");
                }
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
    FREEGAMES_VR_FILE = path.join(userDataDir, "freegames-vr.json");
    FREEGAMES_LAST_REFRESH_FILE = path.join(userDataDir, "freegames-last-refresh.json");
    STORE_DEALS_LAST_REFRESH_FILE = path.join(userDataDir, "store-deals-last-refresh.json");
    STORE_SEEN_FILE = path.join(userDataDir, "store-deals-seen.json");
    FREEGAMES_BULK_SEARCH_DONE_FILE = path.join(userDataDir, "freegames-bulk-search-done.json");
    TRAILER_CACHE_FILE = path.join(userDataDir, "trailer-cache.json");
    SESSION_FILE = path.join(userDataDir, "session.dat");
    EBOOKS_FILE = path.join(userDataDir, "ebooks.json");
    EBOOKS_DROPZONE_FOLDER = path.join(userDataDir, "Reading Room Dropzone");
    FREEGAMES_COVER_CACHE_FOLDER = path.join(userDataDir, "freegames-cover-cache");

    if (!fs.existsSync(EBOOKS_DROPZONE_FOLDER)) {
        fs.mkdirSync(EBOOKS_DROPZONE_FOLDER, { recursive: true });
    }

    if (!fs.existsSync(COVERS_FOLDER)) {
        fs.mkdirSync(COVERS_FOLDER, { recursive: true });
    }

    if (!fs.existsSync(FREEGAMES_COVER_CACHE_FOLDER)) {
        fs.mkdirSync(FREEGAMES_COVER_CACHE_FOLDER, { recursive: true });
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

    // One-time cleanup: any Store trailer cached before Steam's own
    // official trailer became available as a source (see
    // fetchSteamOfficialTrailerUrl) may have locked in a wrong YouTube
    // search result for an ambiguous title. Drop just those entries so
    // they get looked up fresh, this time preferring the unambiguous
    // Steam source when one exists -- everything else in the cache
    // (Installed Games, My Shows, etc.) is untouched.
    try {
        const trailerCache = JSON.parse(fs.readFileSync(TRAILER_CACHE_FILE, "utf8"));
        if (!trailerCache.__storeTrailerCacheMigrated) {
            let purged = 0;
            for (const key of Object.keys(trailerCache)) {
                if (key.startsWith("steam-") || key.startsWith("cheapshark-")) {
                    delete trailerCache[key];
                    purged++;
                }
            }
            trailerCache.__storeTrailerCacheMigrated = true;
            fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(trailerCache, null, 2));
            if (purged > 0) {
                console.log(`[trailer] One-time cleanup: cleared ${purged} previously-cached Store trailer(s) so they re-resolve with Steam's official source when available.`);
            }
        }
    } catch (err) {
        console.error("[trailer] Store trailer cache migration failed:", err.message || err);
    }

    // Second one-time cleanup: the YouTube-search relevance check used to
    // accept a substring match ("black" inside "blackwood"), which could
    // lock in a wrong trailer for a title sharing a word-fragment with an
    // unrelated video (reported case: "The Black Within" resolved to a
    // trailer for a different game, "Blackwood"). Now that the check
    // requires a real whole-word match (see resultLooksRelevant), purge
    // Store's cache again so anything cached under the old, looser check
    // gets a chance to re-resolve correctly.
    try {
        const trailerCache = JSON.parse(fs.readFileSync(TRAILER_CACHE_FILE, "utf8"));
        if (!trailerCache.__storeTrailerCacheMigrated2) {
            let purged = 0;
            for (const key of Object.keys(trailerCache)) {
                if (key.startsWith("steam-") || key.startsWith("cheapshark-")) {
                    delete trailerCache[key];
                    purged++;
                }
            }
            trailerCache.__storeTrailerCacheMigrated2 = true;
            fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(trailerCache, null, 2));
            if (purged > 0) {
                console.log(`[trailer] One-time cleanup: cleared ${purged} previously-cached Store trailer(s) so they re-resolve under the stricter whole-word relevance check.`);
            }
        }
    } catch (err) {
        console.error("[trailer] Store trailer cache migration (2) failed:", err.message || err);
    }

    // Third one-time cleanup: neither migration above helps a non-Store
    // free game (GamerPower, itch.io, GOG, a curated DRM-Free listing,
    // etc.) that was cached under fetch-trailer's old YouTube-only guess
    // -- fetch-trailer now also tries resolving a matching Steam listing
    // by exact name first (see resolveSteamAppIdByExactName), but a cache
    // hit returns immediately, before that new logic ever gets a chance
    // to run (reported case: a one-word DRM-Free giveaway, "Leaper",
    // locked in an unrelated YouTube result). Any cached entry that ISN'T
    // already a full https:// URL is necessarily a bare YouTube video id
    // from that old guess-only path, so purge just those -- a Steam
    // trailer URL, once found for a specific appid, is never wrong and is
    // left alone -- and let every one of them get a fresh chance at the
    // deterministic Steam source.
    try {
        const trailerCache = JSON.parse(fs.readFileSync(TRAILER_CACHE_FILE, "utf8"));
        if (!trailerCache.__storeTrailerCacheMigrated3) {
            let purged = 0;
            for (const key of Object.keys(trailerCache)) {
                if (key.startsWith("__")) continue;
                const value = trailerCache[key];
                if (typeof value === "string" && !value.startsWith("http")) {
                    delete trailerCache[key];
                    purged++;
                }
            }
            trailerCache.__storeTrailerCacheMigrated3 = true;
            fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(trailerCache, null, 2));
            if (purged > 0) {
                console.log(`[trailer] One-time cleanup: cleared ${purged} previously YouTube-guessed trailer(s) so they get a chance to resolve to an exact-match Steam trailer instead.`);
            }
        }
    } catch (err) {
        console.error("[trailer] Trailer cache migration (3) failed:", err.message || err);
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

    if (!fs.existsSync(STORE_SEEN_FILE)) {
        fs.writeFileSync(STORE_SEEN_FILE, "{}");
    }

    if (!fs.existsSync(FREEGAMES_UNAVAILABLE_FILE)) {
        fs.writeFileSync(FREEGAMES_UNAVAILABLE_FILE, "{}");
    }

    if (!fs.existsSync(FREEGAMES_VERIFIED_FILE)) {
        fs.writeFileSync(FREEGAMES_VERIFIED_FILE, "{}");
    }

    if (!fs.existsSync(FREEGAMES_VR_FILE)) {
        fs.writeFileSync(FREEGAMES_VR_FILE, "{}");
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
    localServerPort = port;

    win = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        title: "Riftgate",
        autoHideMenuBar: true,
        frame: false,
        // Opening hidden and only showing once maximized (see the
        // ready-to-show handler below) avoids a visible "small window
        // that suddenly snaps to full size" flash a plain win.maximize()
        // right here would cause -- this way the very first frame the
        // user sees is already the maximized one.
        show: false,
        // Without this, Windows falls back to the .exe's own embedded icon
        // for the taskbar/alt-tab entry — correct for a packaged build, but
        // in dev mode ("electron .") that .exe is just Electron's own
        // generic one, so the taskbar icon would never match the app icon
        // this file actually sets everywhere else (Tray, theme switching).
        icon: resolveIconPath("icon.ico"),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, "preload.js")
        }
    });

    // width/height above (1400x900) is only ever the UN-maximized restore
    // size (what the window returns to if the user later unmaximizes it) --
    // the actual window a user sees on first launch is maximized to
    // whichever monitor and resolution they're actually using, exactly
    // like every other properly screen-size-aware desktop app. Without
    // this, Riftgate always opened at that fixed 1400x900 regardless of
    // the user's real screen size, which is what made carousels and grids
    // look like they were clipping content on a larger display: not a bug
    // in the row-fitting logic itself (fitHscrollTrack already sizes cards
    // to whatever width it's actually given), just a window that was
    // never given the screen's real width to fit to in the first place.
    win.once("ready-to-show", () => {
        win.maximize();
        win.show();
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
const THEME_ICON_NAMES = new Set(["riftgate", "cyberpunk", "emerald", "crimson", "ocean", "gold", "red", "frost", "venom"]);

ipcMain.handle("set-app-icon", async (event, themeName) => {
    if (!THEME_ICON_NAMES.has(themeName)) return false;
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
    return platform.resolveShortcut(filePath);
});


ipcMain.handle("search-tv-shows", async (event, query) => {
    try {
        const results = await tvmaze.searchShows(query);

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
            const episodes = await tvmaze.getShowEpisodes(show.id);

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

// Lightweight per-show metadata (genre type, community rating, next
// scheduled episode) that powers the type/rating badges and "Next: ..."
// countdown on Recently Released and My Shows cards. Fetched lazily, one
// show at a time, the first time a given card is rendered (see
// applyShowMeta in renderer.js) rather than prefetched for the whole
// watchlist up front — keeps opening Theatre fast regardless of how many
// shows are tracked.
ipcMain.handle("get-show-meta", async (event, showId) => {
    try {
        const detail = await tvmaze.getShowWithNextEpisode(showId);
        const next = detail._embedded && detail._embedded.nextepisode;

        return {
            type: detail.type || null,
            rating: (detail.rating && typeof detail.rating.average === "number") ? detail.rating.average : null,
            nextEpisode: next ? {
                season: next.season,
                number: next.number,
                name: next.name,
                airdate: next.airdate,
                airstamp: next.airstamp
            } : null
        };
    } catch (err) {
        console.error(`[tv] show meta fetch failed for show ${showId}:`, err.message || err);
        return null;
    }
});

// Reads the embedded FileDescription from an .exe's Windows version info
// (e.g. chrome.exe's real description is "Google Chrome", not "Chrome") —
// this is what fixes wrong covers/descriptions/trailers caused by using
// just the filename.
ipcMain.handle("get-exe-description", async (event, exePath) => {
    return platform.getExeDescription(exePath);
});

// MyMemory is a free, public, keyless translation API — used only for
// translating dynamic content (descriptions pulled from external sources),
// since Riftgate's own UI text is translated from the static dictionary
// in renderer.js instead.

// Specific genres to cross-reference against the free-to-play set, so
// categories are real genres (RTS, MMORPG, etc.) instead of a single
// generic bucket. Each lookup has its own timeout and is wrapped in
// Promise.allSettled below — a slow or failed genre lookup can only ever
// cost that one genre's labels, never the actual game list.
const STEAM_GENRE_TAGS = [
    "MMORPG", "MMO", "RTS", "FPS", "Battle Royale", "Survival",
    "Strategy", "Action", "Adventure", "RPG"
];

// SteamSpy's community tagging also covers VR directly ("VR Only" and the
// broader "VR" tag), which lets VR status be filled in for EVERY free
// Steam game right away, from this same bulk tag fetch -- instead of only
// ever learning it from checkSteamAppAvailability's per-appid appdetails
// check, which is capped at MAX_STEAM_CHECKS_PER_REFRESH per refresh (see
// its own comment above). On a free-to-play list running into the
// thousands, that cap meant a newly-free VR title could sit with
// vr: null -- and so be invisible to the VR row/filter entirely -- for
// days or weeks until its individual turn came up. This tag-based guess
// is only ever a stand-in: the real appdetails category (vrCache, once
// populated) always takes priority over it below.
const STEAM_VR_TAGS = ["VR Only", "VR"];

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

// SteamSpy aggregates public Steam catalog data specifically for bulk
// tag-based queries like this — unlike Steam's own storesearch (which is a
// search-box autocomplete API, not a catalog browser, and only ever
// returned a handful of results for an empty search term).
async function fetchSteamFreeGames(forceFullCheck) {
    try {
        // Only the very first run the app has EVER had uses Steam's own
        // live search (see steam.fetchSteamFreeGamesBulkSearch above) instead of
        // the normal SteamSpy-tag path — it's a one-time thing specifically
        // to avoid a first-time verification backlog of thousands of
        // games; every run after that goes back to the regular path below
        // unless told again to redo the bulk search.
        const isFirstEverRun = !hasBulkSearchRunBefore();
        let entries;
        let usedBulkSearch = false;

        if (isFirstEverRun) {
            console.log("[free-games] First run ever — using Steam's own live search (price filter) instead of the SteamSpy tag list, so nothing needs one-by-one verification.");
            const bulkResults = await steam.fetchSteamFreeGamesBulkSearch();
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
        const vrTagMap = {};

        // Best-effort genre + VR categorization — allSettled means one slow
        // or failing tag can only ever cost that one tag's labels, never
        // the actual game list (a genre tag failing leaves those games as
        // "Other"; a VR tag failing just leaves vr guessed as null until
        // real verification catches up).
        try {
            const [genreResults, vrTagResults] = await Promise.all([
                Promise.allSettled(
                    STEAM_GENRE_TAGS.map((tag) =>
                        httpsGetJsonPlain(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`, 6000)
                            .then((genreData) => ({ tag, genreData }))
                    )
                ),
                Promise.allSettled(
                    STEAM_VR_TAGS.map((tag) =>
                        httpsGetJsonPlain(`https://steamspy.com/api.php?request=tag&tag=${encodeURIComponent(tag)}`, 6000)
                            .then((vrData) => ({ tag, vrData }))
                    )
                )
            ]);

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

            // STEAM_VR_TAGS is processed in order ("VR Only" before "VR"),
            // so a title tagged both ways always ends up "native" — the
            // more specific claim wins, matching categorizeSteamVrSupport's
            // own "VR Only" > "VR Supported" priority for the real
            // appdetails data this is standing in for.
            vrTagResults.forEach((result) => {
                if (result.status !== "fulfilled") return;
                const { tag, vrData } = result.value;
                const guessed = tag === "VR Only" ? "native" : "adapted";
                Object.values(vrData || {}).forEach((item) => {
                    const idStr = String(item.appid);
                    if (!freeIds.has(idStr)) return;
                    if (guessed === "native" || !vrTagMap[idStr]) {
                        vrTagMap[idStr] = guessed;
                    }
                });
            });
        } catch (err) {
            console.error("[free-games] Steam genre/VR-tag lookup failed entirely:", err.message || err);
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
        const vrCache = readFreeGamesVrCache();

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

            // No appdetails categories were fetched on this path (the bulk
            // search endpoint doesn't return them), so VR status is
            // unknown for all of these until a later refresh's normal
            // verification pass checks each one individually.
            return stillListed.map((item) => ({
                id: `steam-${item.appid}`,
                name: item.name,
                description: null,
                // The portrait "library capsule" (2:3, same shape Steam's
                // own library grid uses) instead of the old landscape
                // header.jpg (460x215) — a portrait cover-wrap box (see
                // #freeGamesContainer .cover-wrap in style.css) fits this
                // shape almost exactly, instead of needing to shrink a
                // wide banner down to a sliver and pad the rest. Not every
                // appid has this asset (very old/obscure titles sometimes
                // don't), so fallbackImage carries the old header.jpg for
                // the renderer to fall back to on a load error.
                image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`,
                fallbackImage: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
                url: `https://store.steampowered.com/app/${item.appid}`,
                source: "Steam",
                tags: [genreMap[String(item.appid)] || "Other"],
                // No appdetails check has run yet on this first-run path —
                // SteamSpy's own VR/"VR Only" community tags (see
                // STEAM_VR_TAGS above) stand in as a best guess until a
                // later refresh's real verification confirms it.
                vr: vrTagMap[String(item.appid)] || null,
                releaseDate: null,
                // Steam's live search (this first-run-only path) doesn't
                // return review counts the way the normal SteamSpy tag path
                // does — unknown until a later refresh re-fetches this game
                // through that path.
                rating: null
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
                    steam.checkSteamAppAvailability(item.appid).then((result) => ({ appid: item.appid, result }))
                )
            );

            let batchHasNewDelisted = false;
            let vrChanged = false;
            batchResults.forEach((res) => {
                checkedCount++;
                if (res.status !== "fulfilled") return; // network hiccup — leave unverified, retried next refresh
                const appid = String(res.value.appid);
                const { show, delisted, vr, releaseDate } = res.value.result;

                // Learned independently of show/delisted/free status below —
                // a game's VR support/release date don't change just
                // because it's temporarily not free, so both are recorded
                // whenever appdetails actually returned data at all. Cache
                // entries here are {vr, releaseDate} objects; steam.getSteamVr/
                // steam.getSteamReleaseDate below also accept the older plain-
                // string shape this cache used before releaseDate existed.
                const prevEntry = vrCache[appid];
                const prevVr = steam.getSteamVr(prevEntry);
                const prevReleaseDate = steam.getSteamReleaseDate(prevEntry);
                const nextVr = vr || prevVr;
                const nextReleaseDate = releaseDate || prevReleaseDate;
                if (nextVr !== prevVr || nextReleaseDate !== prevReleaseDate) {
                    vrCache[appid] = { vr: nextVr || null, releaseDate: nextReleaseDate || null };
                    vrChanged = true;
                }

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
            if (vrChanged) saveFreeGamesVrCache(vrCache);

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
                image: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/library_600x900.jpg`,
                fallbackImage: `https://cdn.akamai.steamstatic.com/steam/apps/${item.appid}/header.jpg`,
                url: `https://store.steampowered.com/app/${item.appid}`,
                source: "Steam",
                tags: [genreMap[String(item.appid)] || "Other"],
                // From vrCache, not the (possibly stale/unchecked-this-run)
                // result above — a game not due for re-verification this
                // refresh still keeps whatever VR status/release date was
                // learned the last time it WAS checked, instead of
                // resetting to "unknown" every run. A game that has NEVER
                // been individually verified at all falls back to the
                // SteamSpy tag-based guess (vrTagMap) instead of sitting on
                // null indefinitely -- see STEAM_VR_TAGS above for why.
                vr: steam.getSteamVr(vrCache[String(item.appid)]) || vrTagMap[String(item.appid)] || null,
                releaseDate: steam.getSteamReleaseDate(vrCache[String(item.appid)]),
                // SteamSpy's tag response already carries each game's
                // positive/negative review counts — no extra request needed.
                // Only Steam has this data of the free-game sources Riftgate
                // pulls from (Epic/GOG/GamerPower/itch.io/the curated
                // platforms don't expose per-title review data at all), so
                // this stays null for everything else and the badge just
                // doesn't render there — see steam.computeSteamSpyRating.
                rating: steam.computeSteamSpyRating(item),
                // Total review count — the popularity signal used to rank
                // Free Games rows (see freeGamePopularity in renderer.js).
                reviewCount: ((Number(item.positive) || 0) + (Number(item.negative) || 0)) || null
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

// Which Steam appids are known to be VR games ("native" = VR Only, "adapted"
// = a flatscreen game that also supports VR), keyed by appid. This is
// learned as a side effect of the availability check every Steam game
// already goes through (see steam.checkSteamAppAvailability/steam.categorizeSteamVrSupport)
// — no extra requests — but since only a capped subset of games gets
// checked on any single refresh (see MAX_STEAM_CHECKS_PER_REFRESH), this
// cache is what lets a game's VR status, once learned, keep applying on
// every later refresh instead of resetting to "unknown" the moment it's
// not due for re-verification.
function readFreeGamesVrCache() {
    try {
        return JSON.parse(fs.readFileSync(FREEGAMES_VR_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

function saveFreeGamesVrCache(data) {
    try {
        fs.writeFileSync(FREEGAMES_VR_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[free-games] failed to save VR-games cache:", err.message || err);
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


// The curated list (getCuratedAlwaysFreeGames) is hand-edited code, not a
// live fetch — so unlike Steam/Epic/GOG/etc., it never needs a real
// network round-trip to be "fresh". Baking it in only during a full
// runFreeGamesRefresh means any code change to it (a new cover image, a
// newly added platform, a corrected link) sits invisible in the already-
// cached data for up to 24h until the user manually hits Refresh. This
// re-stamps whatever's in cache with the current curated list on every
// get-free-games call — cheap and synchronous — so curated data is always
// current even when the rest of the cache is still within its window.
function mergeFreshCuratedGames(cachedGames) {
    const curatedGames = getCuratedAlwaysFreeGames();
    const seenCache = readFreeGamesSeenCache();
    // Whatever's already in cache with a non-curated id is a live listing
    // (Steam, Epic, GOG, GamerPower, itch.io) — leave it alone. Re-run the
    // same live-vs-curated dedup runFreeGamesRefresh uses, so a curated
    // entry doesn't get re-added as a duplicate of a live one that's
    // already sitting in cache representing the same game.
    const liveGames = (cachedGames || []).filter((g) => !String(g.id).startsWith("curated-"));
    const curatedGamesDeduped = dedupeCuratedAgainstLive(curatedGames, liveGames);
    const freshCurated = curatedGamesDeduped.map((g) => ({
        ...g,
        firstSeenAt: seenCache[g.id] || Date.now()
    }));
    return [...liveGames, ...freshCurated];
}

async function runFreeGamesRefresh(forceFullCheck) {
    // allSettled instead of all — one store's fetch failing outright must
    // never take the others down with it.
    const results = await Promise.allSettled([
        fetchEpicFreeGames(),
        fetchSteamFreeGames(forceFullCheck),
        fetchGogFreeGames(),
        fetchGamerPowerFreeGames(),
        fetchItchFreeGames(),
        fetchItchVrFreeGames(),
        fetchCuratedAlwaysFreeGames(),
        fetchCheapSharkFreeGames()
    ]);

    results.forEach((r, i) => {
        if (r.status === "rejected") {
            const storeName = ["Epic", "Steam", "GOG", "GamerPower", "itch.io", "itch.io VR", "Curated", "CheapShark"][i];
            console.error(`[free-games] ${storeName} fetch rejected entirely:`, r.reason);
        }
    });

    const [epicGames, steamGames, gogGames, gamerPowerGames, itchGamesRaw, itchVrGames, curatedGames, cheapSharkFreeGamesRaw] = results.map((r) =>
        r.status === "fulfilled" ? r.value : []
    );

    // itch.io's VR tag listing (fetchItchVrFreeGames) is a separate page
    // from its general new-and-popular listing (fetchItchFreeGames) — the
    // same game can appear on both, so this merges them by id instead of
    // just concatenating: anything already found by the general listing
    // keeps its place but picks up the "native" VR tag, and only genuinely
    // new titles (VR games popular enough to be missed by "new and
    // popular" — mostly older/niche ones) get appended.
    const itchIds = new Set(itchGamesRaw.map((g) => g.id));
    const itchVrById = new Map(itchVrGames.map((g) => [g.id, g.vr]));
    itchGamesRaw.forEach((g) => {
        if (itchVrById.has(g.id)) g.vr = itchVrById.get(g.id);
    });
    const itchGames = [...itchGamesRaw, ...itchVrGames.filter((g) => !itchIds.has(g.id))];

    // The curated always-free list (see getCuratedAlwaysFreeGames) is a
    // manually-maintained fallback for platforms with no live "what's free
    // right now" API — but several of those same titles ARE also
    // discoverable live (e.g. Apex Legends and Rainbow Six Siege both also
    // list on Steam). Without this check they'd show up twice, once per
    // source. A live source's own listing is always preferred (it has a
    // real, currently-verified image and up-to-date data), so any curated
    // entry whose name matches something a live source already found gets
    // dropped here rather than shown as a duplicate card.
    // Same name-based dedup the curated list gets below, applied first:
    // a 100%-off CheapShark listing that's really the same game one of
    // the dedicated live sources (most often Epic's own official feed)
    // already found is dropped here, before curatedGames even gets a
    // chance to compare against it -- otherwise the same giveaway could
    // theoretically show up under two different `source` labels.
    const dedicatedLiveGames = [...epicGames, ...steamGames, ...gogGames, ...gamerPowerGames, ...itchGames];
    const dedicatedLiveNames = new Set(dedicatedLiveGames.map((g) => normalizeGameName(g.name)));
    const cheapSharkFreeGames = cheapSharkFreeGamesRaw.filter((g) => !dedicatedLiveNames.has(normalizeGameName(g.name)));
    const cheapSharkDupCount = cheapSharkFreeGamesRaw.length - cheapSharkFreeGames.length;
    if (cheapSharkDupCount > 0) {
        console.log(`[free-games] Skipped ${cheapSharkDupCount} CheapShark 100%-off entr${cheapSharkDupCount === 1 ? "y" : "ies"} already found by a dedicated source.`);
    }

    const liveGames = [...dedicatedLiveGames, ...cheapSharkFreeGames];
    const curatedGamesDeduped = dedupeCuratedAgainstLive(curatedGames, liveGames);
    const dedupedCount = curatedGames.length - curatedGamesDeduped.length;
    if (dedupedCount > 0) {
        console.log(`[free-games] Skipped ${dedupedCount} curated entr${dedupedCount === 1 ? "y" : "ies"} already found live by another source.`);
    }

    const allFree = [...liveGames, ...curatedGamesDeduped];

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

// Every "platform" a single-platform Refresh can be scoped to falls into
// one of two buckets: Steam/Epic Games/GOG/itch.io each have their own
// dedicated live fetcher above, while everything else (Battle.net, EA,
// Riot Games, Ubisoft Connect, Wargaming.net, Gaijin.net, Grinding Gear
// Games, or any platform GamerPower starts covering later) only ever gets
// live entries through fetchGamerPowerFreeGames's giveaway feed — see its
// own COVERED_PLATFORMS list, which deliberately excludes those four so
// they're never double-fetched. That split is what lets a scoped refresh
// know exactly which network call(s) a given platform actually needs,
// without a hardcoded per-platform table that would silently go stale the
// day a fifth dedicated fetcher gets added.
//
// Same in-flight-sharing idea as freeGamesRefreshPromise above, but keyed
// per platform — clicking Refresh twice in a row while viewing "Steam"
// shouldn't fire two overlapping Steam fetches, but a scoped refresh for
// one platform is free to run alongside one for another (or a full
// all-platforms refresh) instead of waiting on it.
const freeGamesPlatformRefreshPromises = new Map();

// Refreshes only what the currently-displayed platform (or the VR lens)
// actually needs, instead of every source — backs the manual Refresh
// button when the Free Games view is scoped to one platform, so clicking
// it doesn't also re-hit Steam/Epic/GOG/itch.io/GamerPower for stores the
// user isn't even looking at right now. Everything already cached for
// every OTHER platform is left completely untouched: no re-fetch, no
// re-verification, and nothing disappears from it even if this pass fails.
// A game a dedicated store feed already lists shouldn't come back a second
// time from CheapShark's deals feed (same rule the full refresh applies).
function withoutCheapSharkDuplicates(cheapSharkGames, dedicatedGames) {
    const dedicatedNames = new Set(dedicatedGames.map((g) => normalizeGameName(g.name)));
    return cheapSharkGames.filter((g) => !dedicatedNames.has(normalizeGameName(g.name)));
}

async function runFreeGamesRefreshForPlatform(platform) {
    const cached = loadDataCache("cache-free-games.json") || [];

    const isTouched = platform === "VR" ? (g) => !!g.vr : (g) => g.source === platform;
    const untouched = cached.filter((g) => !isTouched(g));
    const liveElsewhere = untouched.filter((g) => !String(g.id).startsWith("curated-"));

    let freshLive;
    try {
        if (platform === "VR") {
            // The VR lens spans whichever live sources can actually carry a
            // vr tag today (itch.io's dedicated VR listing, and any
            // GamerPower giveaway itself tagged VR) — curated entries never
            // carry one, so there's nothing curated to fold in here.
            const [itchVr, gamerPower] = await Promise.all([fetchItchVrFreeGames(), fetchGamerPowerFreeGames()]);
            freshLive = [...itchVr, ...gamerPower.filter((g) => g.vr)];
        } else if (platform === "Steam") {
            const [steam, cheapSharkFree] = await Promise.all([fetchSteamFreeGames(true), fetchCheapSharkFreeGames()]);
            freshLive = [...steam, ...withoutCheapSharkDuplicates(cheapSharkFree.filter((g) => g.source === "Steam"), steam)];
        } else if (platform === "Epic Games") {
            // CheapShark's general deals feed catches indie-run 100%-off
            // promos on the Epic store that Epic's own dedicated
            // freeGamesPromotions endpoint (fetchEpicFreeGames) never
            // covers -- it only reports Epic's own official "this week's
            // free game" slot. Without this, a scoped refresh here would
            // silently be narrower than a full all-platforms refresh.
            const [epic, cheapSharkFree] = await Promise.all([fetchEpicFreeGames(), fetchCheapSharkFreeGames()]);
            freshLive = [...epic, ...withoutCheapSharkDuplicates(cheapSharkFree.filter((g) => g.source === "Epic Games"), epic)];
        } else if (platform === "GOG") {
            const [gog, cheapSharkFree] = await Promise.all([fetchGogFreeGames(), fetchCheapSharkFreeGames()]);
            freshLive = [...gog, ...withoutCheapSharkDuplicates(cheapSharkFree.filter((g) => g.source === "GOG"), gog)];
        } else if (platform === "itch.io") {
            const [general, vr] = await Promise.all([fetchItchFreeGames(), fetchItchVrFreeGames()]);
            const generalIds = new Set(general.map((g) => g.id));
            const vrById = new Map(vr.map((g) => [g.id, g.vr]));
            general.forEach((g) => {
                if (vrById.has(g.id)) g.vr = vrById.get(g.id);
            });
            freshLive = [...general, ...vr.filter((g) => !generalIds.has(g.id))];
        } else {
            // Covers both GamerPower-tracked platforms (Battle.net, Riot,
            // etc.) AND any CheapShark-only store (Fanatical, GameBillet,
            // WinGameStore, GreenManGaming, Gamesplanet, IndieGala, Loaded)
            // -- without the CheapShark half here, a scoped refresh for one
            // of those platforms would find nothing and wipe its entries
            // from cache instead of leaving them alone (see `untouched`
            // above: this platform's existing entries are already excluded
            // from it, so an empty freshLive here would delete them, not
            // just fail to update them).
            const [gamerPower, cheapSharkFree] = await Promise.all([fetchGamerPowerFreeGames(), fetchCheapSharkFreeGames()]);
            const gamerPowerForPlatform = gamerPower.filter((g) => g.source === platform);
            freshLive = [
                ...gamerPowerForPlatform,
                ...withoutCheapSharkDuplicates(cheapSharkFree.filter((g) => g.source === platform), gamerPowerForPlatform)
            ];
        }
    } catch (err) {
        console.error(`[free-games] Scoped refresh for "${platform}" failed:`, err.message || err);
        // Never overwrite the cache over a single failed fetch — just hand
        // back what was already there (still re-stamped with any curated
        // edits, same as a normal get-free-games read).
        return mergeFreshCuratedGames(cached);
    }

    // Curated entries belonging to this platform get the same live-vs-
    // curated dedup a full refresh runs — checked against this platform's
    // fresh live results plus whatever's already cached for every OTHER
    // platform, so e.g. a curated EA/Ubisoft title that's also legitimately
    // findable on Steam still gets dropped in favor of the live listing,
    // exactly like a full refresh would.
    const curatedForPlatform = platform === "VR"
        ? []
        : getCuratedAlwaysFreeGames().filter((g) => g.source === platform);
    const curatedDeduped = dedupeCuratedAgainstLive(curatedForPlatform, [...freshLive, ...liveElsewhere]);

    const seenCache = readFreeGamesSeenCache();
    const now = Date.now();
    [...freshLive, ...curatedDeduped].forEach((game) => {
        if (!seenCache[game.id]) {
            seenCache[game.id] = now;
        }
        game.firstSeenAt = seenCache[game.id];
    });

    const merged = [...untouched, ...freshLive, ...curatedDeduped];

    // Only prune "first seen" entries that actually belonged to this
    // platform and are genuinely gone now — everything untouched keeps its
    // existing entry exactly as it was.
    const mergedIds = new Set(merged.map((g) => g.id));
    const prunedSeenCache = {};
    Object.keys(seenCache).forEach((id) => {
        if (mergedIds.has(id)) prunedSeenCache[id] = seenCache[id];
    });

    fs.writeFileSync(FREEGAMES_SEEN_FILE, JSON.stringify(prunedSeenCache, null, 2));
    saveDataCache("cache-free-games.json", merged);
    // Deliberately NOT calling saveFreeGamesLastRefresh here — this was a
    // scoped, single-platform pass, not a real full refresh, so the normal
    // 24h auto-refresh gate for every other platform stays exactly as it
    // was before this click.

    return merged;
}

async function performFreeGamesRefreshForPlatform(platform) {
    if (freeGamesPlatformRefreshPromises.has(platform)) {
        return freeGamesPlatformRefreshPromises.get(platform);
    }
    const promise = runFreeGamesRefreshForPlatform(platform).finally(() => {
        freeGamesPlatformRefreshPromises.delete(platform);
    });
    freeGamesPlatformRefreshPromises.set(platform, promise);
    return promise;
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
        return mergeFreshCuratedGames(cached);
    }

    return performFreeGamesRefresh();
});

// Backs the manual "Refresh" button in Free Games — always does a real
// fetch-and-verify pass regardless of how recently the last one ran, for
// when the user specifically wants an up-to-date list right now rather
// than waiting out the rest of the 24h window.
ipcMain.handle("force-refresh-free-games", async () => performFreeGamesRefresh(true));

// Backs the same manual Refresh button, but for when the Free Games view
// is scoped to one platform (or the VR lens) — only that platform's live
// source gets hit, every other platform's cached entries are left exactly
// as they were. Falls back to a real full refresh if the renderer somehow
// calls this without a valid platform string.
ipcMain.handle("force-refresh-free-games-platform", async (event, platform) => {
    if (typeof platform !== "string" || !platform || platform === "all") {
        return performFreeGamesRefresh(true);
    }
    return performFreeGamesRefreshForPlatform(platform);
});

// Instant retrieval of the last successfully fetched Free Games list —
// same "show something immediately, refresh quietly after" pattern as
// the book sections, so this section isn't empty on launch either.
ipcMain.handle("get-cached-free-games", async () => mergeFreshCuratedGames(loadDataCache("cache-free-games.json") || []));

// --- Store: currently-discounted games worth buying, not just free ones.
//
// Deliberately much simpler than the Free Games machinery above — a
// price/discount either holds right now or it doesn't, so there's no
// need for Free Games' per-game "still available" trust window or
// verification passes. Every refresh just asks each storefront what's
// on sale right now and replaces the cached list outright.
//
// Steam is fetched directly (a stable, documented public endpoint).
// Everything else goes through CheapShark, a free deals-aggregator that
// covers GOG, Epic, Humble, Fanatical, GreenManGaming, and ~30 more
// stores in one call -- see fetchCheapSharkDeals below for why (two
// earlier attempts at calling GOG's and Epic's own APIs directly came
// back empty in practice, despite matching documented/observed shapes).

// Steam's official featuredcategories endpoint — cc=us/l=english pins
// the response to USD/English regardless of this machine's own locale,
// matching how Free Games' Steam fetch already treats pricing/region.
// Steam's own featuredcategories feed (used below) carries no review
// data at all, unlike CheapShark's deals (which do, when they've
// resolved a Steam match -- see the ratingText/ratingPercent fields in
// fetchCheapSharkDeals). This is Steam's separate, unauthenticated
// per-app review summary endpoint, used to backfill the same rating
// (and a real review count to rank by) for Store's native Steam specials
// so both "halves" of the Store tab show the same ranking info.
async function fetchSteamAppReviewSummary(appId) {
    try {
        const data = await httpsGetJsonPlain(
            `https://store.steampowered.com/appreviews/${appId}?json=1&num_per_page=0&language=all&purchase_type=all`,
            8000
        );
        const summary = data && data.query_summary;
        if (!summary || !summary.total_reviews) return null;
        const percent = Math.round((summary.total_positive / summary.total_reviews) * 100);
        return {
            ratingText: summary.review_score_desc || null,
            ratingPercent: isNaN(percent) ? null : percent,
            ratingCount: summary.total_reviews
        };
    } catch (err) {
        return null;
    }
}

async function fetchSteamDeals(countryCode) {
    try {
        const cc = (countryCode || "US").toLowerCase();
        const data = await httpsGetJsonPlain(`https://store.steampowered.com/api/featuredcategories?cc=${cc}&l=english`, 10000);
        const items = (data.specials && data.specials.items) || [];

        const mapped = items
            // Steam's specials feed is discounted-but-still-paid games, not
            // giveaways -- a 100%-off item belongs in Free Games instead
            // (see fetchCheapSharkFreeGames), same reasoning as the
            // identical exclusion in fetchCheapSharkDeals below.
            .filter((it) => it && typeof it.discount_percent === "number" && it.discount_percent > 0 && it.discount_percent < 100)
            .map((it) => ({
                id: `steam-${it.id}`,
                steamAppId: String(it.id),
                name: it.name,
                // The portrait "library capsule" (2:3, same shape/CDN
                // pattern already used for Free Games' Steam covers --
                // see fetchSteamFreeGames above) reads much better in a
                // uniform grid than the landscape capsule this used to
                // point at. Not every appid has that asset though, so the
                // old landscape image rides along as fallbackImage (used
                // by renderer.js if the portrait one 404s).
                image: `https://cdn.akamai.steamstatic.com/steam/apps/${it.id}/library_600x900.jpg`,
                fallbackImage: it.large_capsule_image || it.header_image || it.small_capsule_image || null,
                url: `https://store.steampowered.com/app/${it.id}`,
                source: "Steam",
                discountPercent: it.discount_percent,
                finalPrice: typeof it.final_price === "number" ? it.final_price / 100 : null,
                originalPrice: typeof it.original_price === "number" ? it.original_price / 100 : null,
                currency: it.currency || "USD",
                // Backfilled just below via appreviews -- this endpoint
                // itself has no review-count field to rank by.
                popularity: null,
                ratingText: null,
                ratingPercent: null,
                metacriticScore: null
            }));

        // Bounded concurrency (6 at a time) rather than firing every
        // request at once -- same reasoning as every other
        // runWithConcurrencyLimit use in this app: a batch this size
        // hitting an external API in one burst risks tripping its rate
        // limiting. This only runs on the same 6-hour-throttled Store
        // refresh as everything else here, so the extra round trip per
        // item is a non-issue in practice.
        await runWithConcurrencyLimit(mapped, 6, async (deal) => {
            const summary = await fetchSteamAppReviewSummary(deal.steamAppId);
            if (summary) {
                deal.ratingText = summary.ratingText;
                deal.ratingPercent = summary.ratingPercent;
                deal.popularity = summary.ratingCount;
            }
        });

        return mapped;
    } catch (err) {
        console.error("[store] Steam deals fetch failed:", err.message || err);
        return [];
    }
}

// CheapShark's own deal listing -- see the module comment above for why
// this replaced calling GOG/Epic directly. Each deal that CheapShark can
// tie to a Steam release includes steamAppID; when present that's used
// to point image at the same reliable portrait "library capsule" Steam
// deals use above (see fetchSteamDeals) instead of CheapShark's own
// thumb, which is a small landscape crop that looks inconsistent in a
// portrait grid. thumb still rides along as fallbackImage either way.
// Loaded (formerly CDKeys) isn't one of CheapShark's tracked stores (no
// "Loaded"/"CDKeys" entry ever showed up in a live refresh's per-store
// breakdown -- confirmed against the running app, not guessed), and it
// has no public API of its own -- it's a Magento 2 storefront (Hyva
// theme), so this scrapes its own deals page instead.
//
// IMPORTANT caveat, in keeping with this file's other scraped/unverified
// sources: this was written without ever seeing loaded.com's actual raw
// HTML -- only an AI-summarized/markdown rendering of it, which strips
// exact tag/class names. Rather than match a specific class name (which
// could easily be wrong and match nothing, the same failure GOG's first
// attempt hit), this looks for the things that rendering DID confirm
// exist verbatim on the page: a product-page link on this domain, an
// <img> with a real alt attribute (the product name), a "$X.XX" price,
// and an "NN% Off" badge, all close together. That's more forgiving of
// markup details it can't see, at the cost of being more likely to
// false-positive on some unrelated snippet that happens to contain all
// of those nearby. If this comes back empty or wrong, that's the first
// thing to check against the page's real HTML.
// The Free Games half of the split described above fetchCheapSharkDeals --
// only the entries CheapShark reports as 100% off, mapped into Free
// Games' own game shape (id/name/description/image/url/source/tags/vr)
// instead of Store's deal shape. Deduped against every other live source
// by normalized name in runFreeGamesRefresh below, same as the curated
// list is deduped against live sources -- a promo CheapShark surfaces
// that Epic's own dedicated feed (or Steam's, or GOG's) ALSO already
// found shouldn't show up as two separate cards for the same game.
async function fetchCheapSharkFreeGames() {
    try {
        const { storeNames, deals } = await fetchCheapSharkRawDeals();

        const mapped = deals
            .map((d) => {
                const discountPercent = Math.round(parseFloat(d.savings));
                if (discountPercent < 100) return null;

                const storeNameRaw = storeNames[d.storeID] || `Store ${d.storeID}`;
                // CheapShark calls Epic's storefront "Epic Games Store";
                // fetchEpicFreeGames above uses "Epic Games" as its own
                // source string. Normalized to match so the name-based
                // dedup step actually recognizes the same game found by
                // both sources as one game, not two differently-sourced
                // ones.
                const source = storeNameRaw === "Epic Games Store" ? "Epic Games" : storeNameRaw;

                const steamAppId = d.steamAppID && /^\d+$/.test(String(d.steamAppID)) ? d.steamAppID : null;

                return {
                    id: `cheapshark-free-${d.dealID}`,
                    name: d.title,
                    description: null,
                    image: steamAppId
                        ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`
                        : (d.thumb || null),
                    fallbackImage: steamAppId ? (d.thumb || null) : null,
                    url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
                    source,
                    tags: [],
                    vr: null,
                    __unverifiedSteamAppId: steamAppId // checked just below, then discarded
                };
            })
            .filter(Boolean);

        // Same CheapShark cross-reference check fetchCheapSharkDeals runs
        // for Store -- see verifySteamAppIdMatchesName's comment above.
        await runWithConcurrencyLimit(mapped, 6, async (game) => {
            const steamAppId = game.__unverifiedSteamAppId;
            if (!steamAppId) return;
            const verified = await verifySteamAppIdMatchesName(steamAppId, game.name);
            if (!verified) {
                console.log(`[free-games] Dropping unverified Steam appid ${steamAppId} for "${game.name}" -- CheapShark's cross-reference didn't match Steam's own name for that appid.`);
                game.image = game.fallbackImage || game.image;
                game.fallbackImage = null;
            }
        });
        mapped.forEach((game) => { delete game.__unverifiedSteamAppId; });

        return mapped;
    } catch (err) {
        console.error("[free-games] CheapShark fetch failed:", err.message || err);
        return [];
    }
}

async function fetchLoadedDeals() {
    // DISABLED -- confirmed dead end, not a guess. The debug dump this
    // function briefly wrote to disk (see git history) turned out to be
    // Cloudflare's own bot-challenge page ("Just a moment...", the same
    // interstitial a browser solves silently before the real page loads)
    // instead of any real deal data. That's a wall a plain server-side
    // request can never get past on its own, no matter how the scraper
    // below is tuned -- it would need a real browser (something like
    // Puppeteer/Playwright driving an actual Chromium instance) to solve
    // that challenge first, which is a much heavier dependency than
    // anything else this app pulls in for a single deals source. Same
    // fundamental failure mode as GOG's catalog API earlier, just
    // confirmed with real evidence this time instead of inferred from
    // empty results.
    //
    // The scraper logic below is left in place, unused, in case a future
    // headless-browser-based fetch wants to reuse its extraction rules
    // once something can actually get past the challenge page first.
    return [];

    // eslint-disable-next-line no-unreachable
    try {
        const page = await httpsGetTextPlain("https://www.loaded.com/cdkeys-deals", 12000);
        if (page.statusCode !== 200) {
            throw new Error(`HTTP ${page.statusCode}`);
        }

        // One chunk per product link on the domain (excluding the deals
        // page itself linking to itself in nav/breadcrumbs) -- everything
        // about that one product (its image, price, discount badge)
        // reliably follows its own opening <a href> in a normal product
        // tile, so splitting right before each such anchor keeps each
        // product's own data together in one chunk instead of spread
        // across chunk boundaries.
        const chunks = page.body.split(/(?=<a[^>]+href="https:\/\/www\.loaded\.com\/(?!cdkeys-deals"|affiliate-program)[a-z0-9-]+"[^>]*>)/i);

        const deals = [];
        const seenIds = new Set();

        for (const chunk of chunks) {
            const hrefMatch = chunk.match(/^<a[^>]+href="(https:\/\/www\.loaded\.com\/[a-z0-9-]+)"/i);
            if (!hrefMatch) continue;

            // Looked for in whatever order they appear -- src-then-alt and
            // alt-then-src both turn up across different Magento themes.
            const imgMatch = chunk.match(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"/i)
                || chunk.match(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]+)"/i);
            if (!imgMatch) continue;
            const isFirstGroupUrl = /^https?:\/\//i.test(imgMatch[1]);
            const image = isFirstGroupUrl ? imgMatch[1] : imgMatch[2];
            const name = (isFirstGroupUrl ? imgMatch[2] : imgMatch[1]).trim();
            if (!name || !/^https?:\/\//i.test(image)) continue;

            const discountMatch = chunk.match(/(\d{1,3})\s*%\s*Off/i);
            const priceMatch = chunk.match(/\$([\d,]+\.\d{2})/);
            if (!discountMatch || !priceMatch) continue;

            const discountPercent = parseInt(discountMatch[1], 10);
            const finalPrice = parseFloat(priceMatch[1].replace(/,/g, ""));
            if (!discountPercent || discountPercent <= 0 || discountPercent >= 100 || isNaN(finalPrice)) continue;

            const url = hrefMatch[1];
            const id = `loaded-${url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
            if (seenIds.has(id)) continue; // a tile can legitimately contain more than one link to itself
            seenIds.add(id);

            // The listing page only shows the sale price and a discount
            // badge, not a separate struck-through original price to
            // parse -- derived algebraically instead, same as GOG's
            // base/final fallback above does when a field's missing.
            const originalPrice = Math.round((finalPrice / (1 - discountPercent / 100)) * 100) / 100;

            deals.push({
                id,
                name,
                image,
                fallbackImage: null,
                url,
                source: "Loaded (CDKeys)",
                discountPercent,
                finalPrice,
                originalPrice,
                currency: "USD",
                popularity: null
            });
        }

        return deals;
    } catch (err) {
        console.error("[store] Loaded (CDKeys) deals fetch failed:", err.message || err);
        return [];
    }
}

// Shared by fetchCheapSharkDeals (Store, below) and fetchCheapSharkFreeGames
// (Free Games, further below) -- same underlying feed, split into "real
// discounts" and "100% off, i.e. actually free" by the two callers, each
// doing its own independent fetch on its own section's refresh schedule.
async function fetchCheapSharkRawDeals() {
    const [storesRaw, dealsRaw] = await Promise.all([
        httpsGetJsonPlain("https://www.cheapshark.com/api/1.0/stores", 10000),
        httpsGetJsonPlain("https://www.cheapshark.com/api/1.0/deals?pageSize=60&sortBy=Savings&onSale=true", 10000)
    ]);

    const storeNames = {};
    (Array.isArray(storesRaw) ? storesRaw : []).forEach((s) => {
        if (s && s.storeID) storeNames[s.storeID] = s.storeName;
    });

    return { storeNames, deals: Array.isArray(dealsRaw) ? dealsRaw : [] };
}

// A 100%-off CheapShark listing is a free game, not a discount -- Free
// Games is where that belongs (fetchCheapSharkFreeGames below), not here,
// so the exact same giveaway doesn't end up shown twice, once per
// section. This surfaced real gaps in Free Games' own coverage: Epic's
// dedicated freeGamesPromotions endpoint (fetchEpicFreeGames above) only
// covers Epic's own official "this week's free game" slot, not every
// indie dev running their own temporary 100%-off promo through the Epic
// store -- CheapShark's general deals feed catches those too.
async function fetchCheapSharkDeals() {
    try {
        const { storeNames, deals } = await fetchCheapSharkRawDeals();

        const mapped = deals
            .map((d) => {
                const storeName = storeNames[d.storeID] || `Store ${d.storeID}`;
                // Steam is already covered directly (and more completely)
                // by fetchSteamDeals above -- skip it here to avoid dupes.
                if (storeName === "Steam") return null;

                const finalPrice = parseFloat(d.salePrice);
                const originalPrice = parseFloat(d.normalPrice);
                const discountPercent = Math.round(parseFloat(d.savings));
                if (!discountPercent || discountPercent <= 0 || discountPercent >= 100) return null;

                const steamAppId = d.steamAppID && /^\d+$/.test(String(d.steamAppID)) ? d.steamAppID : null;

                // steamRatingCount -- how many Steam reviews the game has --
                // is used as a popularity proxy (dealRating is a 0-10 "how
                // good is THIS deal" score, not how popular the game is, so
                // it isn't what "sort by popularity" should mean here).
                // Only set when CheapShark actually resolved a Steam
                // match; parseInt on undefined/"" correctly yields NaN,
                // normalized to null below.
                const popularity = parseInt(d.steamRatingCount, 10);

                // Ranking display: Steam's own rating when CheapShark has
                // resolved one ("94" + "Very Positive"), Metacritic as the
                // fallback for titles with no Steam match. CheapShark
                // returns "0"/null for "no data" here, not a real score of
                // zero, so those are normalized to null rather than shown
                // as a 0% rating.
                const steamRatingPercentNum = parseInt(d.steamRatingPercent, 10);
                const metacriticScoreNum = parseInt(d.metacriticScore, 10);

                return {
                    id: `cheapshark-${d.dealID}`,
                    // CheapShark's own cross-store identifier for "this is
                    // the same underlying game" -- used just below to
                    // collapse duplicate listings from different resellers.
                    gameId: d.gameID || null,
                    // When CheapShark has resolved a Steam match for this
                    // title, renderer.js passes it back into fetch-trailer
                    // so Steam's own official trailer can be used instead
                    // of an ambiguous YouTube text search -- see
                    // fetchSteamOfficialTrailerUrl.
                    steamAppId,
                    name: d.title,
                    image: steamAppId
                        ? `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`
                        : (d.thumb || null),
                    fallbackImage: steamAppId ? (d.thumb || null) : null,
                    url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
                    source: storeName,
                    discountPercent,
                    finalPrice: isNaN(finalPrice) ? null : finalPrice,
                    originalPrice: isNaN(originalPrice) ? null : originalPrice,
                    currency: "USD",
                    popularity: isNaN(popularity) ? null : popularity,
                    ratingText: d.steamRatingText || null,
                    ratingPercent: !isNaN(steamRatingPercentNum) && steamRatingPercentNum > 0 ? steamRatingPercentNum : null,
                    metacriticScore: !isNaN(metacriticScoreNum) && metacriticScoreNum > 0 ? metacriticScoreNum : null
                };
            })
            .filter(Boolean);

        // CheapShark's steamAppID is its own crowdsourced cross-reference,
        // not something Steam confirms -- verify each one against Steam's
        // own name for that appid before trusting it for cover art or a
        // trailer (see verifySteamAppIdMatchesName's comment above). Only
        // deals that actually resolved one need checking; bounded to 6 at
        // once, same as fetchSteamDeals' review-summary pass, since this
        // only runs on the same 6-hour-throttled Store refresh as that.
        await runWithConcurrencyLimit(mapped, 6, async (deal) => {
            if (!deal.steamAppId) return;
            const verified = await verifySteamAppIdMatchesName(deal.steamAppId, deal.name);
            if (!verified) {
                console.log(`[store] Dropping unverified Steam appid ${deal.steamAppId} for "${deal.name}" -- CheapShark's cross-reference didn't match Steam's own name for that appid.`);
                deal.steamAppId = null;
                deal.image = deal.fallbackImage || deal.image;
                deal.fallbackImage = null;
            }
        });

        // Multiple resellers (e.g. GameBillet and Gamesplanet) frequently
        // list the exact same game at different prices -- CheapShark's
        // gameID is the same for all of them, so it's the correct key to
        // group by. Keep only the cheapest listing per game; deals with no
        // resolvable gameID (rare) are left alone rather than merged away.
        const cheapestByGame = new Map();
        const noGameId = [];
        for (const deal of mapped) {
            if (!deal.gameId) {
                noGameId.push(deal);
                continue;
            }
            const existing = cheapestByGame.get(deal.gameId);
            const dealIsCheaper = deal.finalPrice != null && (existing?.finalPrice == null || deal.finalPrice < existing.finalPrice);
            if (!existing || dealIsCheaper) {
                cheapestByGame.set(deal.gameId, deal);
            }
        }

        return [...cheapestByGame.values(), ...noGameId];
    } catch (err) {
        console.error("[store] CheapShark deals fetch failed:", err.message || err);
        return [];
    }
}

// Prices/discounts move faster than the free-games list (which only
// needs to catch a game newly going free or newly stopping), so this is
// a much shorter gate — 6 hours rather than 24.
const STORE_DEALS_REFRESH_MIN_AGE_MS = 6 * 60 * 60 * 1000;

function readStoreDealsLastRefresh() {
    try {
        const data = JSON.parse(fs.readFileSync(STORE_DEALS_LAST_REFRESH_FILE, "utf8"));
        return data.lastRefreshedAt || 0;
    } catch (err) {
        return 0;
    }
}

function readStoreDealsLastCountry() {
    try {
        const data = JSON.parse(fs.readFileSync(STORE_DEALS_LAST_REFRESH_FILE, "utf8"));
        return data.countryCode || null;
    } catch (err) {
        return null;
    }
}

// sourceCounts rides alongside the timestamp — per-platform result
// counts from the last refresh, so a "why is one platform missing/empty"
// question can be answered from inside the app itself (Store's result
// count line shows it, see renderer.js), rather than needing console/log
// access that isn't normally reachable once the app is packaged.
function saveStoreDealsLastRefresh(timestamp, sourceCounts, countryCode) {
    try {
        fs.writeFileSync(STORE_DEALS_LAST_REFRESH_FILE, JSON.stringify({ lastRefreshedAt: timestamp, sourceCounts: sourceCounts || {}, countryCode: countryCode || "US" }));
    } catch (err) {
        console.error("[store] failed to save last-refresh timestamp:", err.message || err);
    }
}

function readStoreDealsSourceCounts() {
    try {
        const data = JSON.parse(fs.readFileSync(STORE_DEALS_LAST_REFRESH_FILE, "utf8"));
        return data.sourceCounts || {};
    } catch (err) {
        return {};
    }
}

function readStoreSeenCache() {
    try {
        return JSON.parse(fs.readFileSync(STORE_SEEN_FILE, "utf8"));
    } catch (err) {
        return {};
    }
}

// A deal's own id (cheapshark-<dealID>) churns every time its price or
// discount changes even slightly -- useless as a "have we seen this
// before" key, since the same game would look "new" again on every
// refresh. gameId (CheapShark's cross-store game identifier, see
// fetchCheapSharkDeals) is stable across those changes, so it's preferred;
// a direct Steam deal has no gameId but its steamAppId never changes
// either. Only as a last resort (no gameId or steamAppId at all) does
// this fall back to the normalized name, which is the least stable of
// the three but still far better than the raw deal id.
function storeSeenKey(deal) {
    if (deal.gameId) return `game-${deal.gameId}`;
    if (deal.steamAppId) return `steam-${deal.steamAppId}`;
    return `name-${normalizeGameName(deal.name)}`;
}

// CheapShark (all ~30 non-Steam stores in Store) has no country/currency
// parameter at all -- it only ever returns US-dollar prices, no matter
// what region the request is "for". This is the only way to still show
// something other than USD for those listings: convert the number with a
// live exchange rate. open.er-api.com is free, keyless, and covers every
// currency CURRENCY_BY_COUNTRY above can name. Best-effort -- if this
// fails (offline, rate-limited, etc.), those deals just stay in USD
// rather than the whole Store refresh failing over a pricing nicety.
async function fetchUsdToTargetRate(targetCurrency) {
    if (!targetCurrency || targetCurrency === "USD") return 1;
    try {
        const data = await httpsGetJsonPlain("https://open.er-api.com/v6/latest/USD", 10000);
        const rate = data && data.rates && data.rates[targetCurrency];
        return typeof rate === "number" && rate > 0 ? rate : null;
    } catch (err) {
        console.error("[store] exchange rate fetch failed:", err.message || err);
        return null;
    }
}

// Same in-flight-promise dedupe as performFreeGamesRefresh above, so a
// renderer refresh landing at the same instant as the startup auto-check
// doesn't double up on requests to Steam/CheapShark.
let storeDealsRefreshPromise = null;

async function performStoreDealsRefresh(countryCode) {
    if (storeDealsRefreshPromise) return storeDealsRefreshPromise;

    storeDealsRefreshPromise = (async () => {
        // fetchLoadedDeals is disabled (Cloudflare blocks it outright --
        // see its own comment) and deliberately left out of this list
        // rather than called for a guaranteed-empty result every refresh.
        const [steamDeals, cheapSharkDeals] = await Promise.all([fetchSteamDeals(countryCode), fetchCheapSharkDeals()]);
        const deals = [...steamDeals, ...cheapSharkDeals].sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));

        // Steam already comes back priced in the target currency (via its
        // own cc= region param above); anything still priced in a
        // different currency at this point is CheapShark-sourced and
        // needs converting to match. Fetched once per refresh, not once
        // per deal.
        const targetCurrency = CURRENCY_BY_COUNTRY[countryCode] || "USD";
        const needsConversion = deals.some((d) => d.currency && d.currency !== targetCurrency);
        const rate = needsConversion ? await fetchUsdToTargetRate(targetCurrency) : 1;
        deals.forEach((deal) => {
            if (deal.currency && deal.currency !== targetCurrency && typeof rate === "number") {
                if (typeof deal.finalPrice === "number") deal.finalPrice = Math.round(deal.finalPrice * rate * 100) / 100;
                if (typeof deal.originalPrice === "number") deal.originalPrice = Math.round(deal.originalPrice * rate * 100) / 100;
                deal.currency = targetCurrency;
                deal.priceIsConverted = true;
            }
        });

        // Tallied from whichever source names actually turned up this
        // refresh, rather than a fixed list -- CheapShark can surface
        // dozens of different stores, not a set known in advance.
        const sourceCounts = {};
        for (const deal of deals) {
            sourceCounts[deal.source] = (sourceCounts[deal.source] || 0) + 1;
        }

        // Tracks when Riftgate first saw each deal (by its stable
        // storeSeenKey, not its churny id) so the Store UI can show a
        // "Newly Added" row, the same way Free Games already does for
        // itself -- see runFreeGamesRefresh's own firstSeenAt tracking.
        // A deal no longer present this refresh has either expired or
        // dropped in discount below the threshold; its entry is pruned so
        // this file doesn't grow forever with stale, never-shown-again keys.
        const seenCache = readStoreSeenCache();
        const now = Date.now();
        const currentKeys = new Set();
        deals.forEach((deal) => {
            const key = storeSeenKey(deal);
            currentKeys.add(key);
            if (!seenCache[key]) seenCache[key] = now;
            deal.firstSeenAt = seenCache[key];
        });
        const prunedSeenCache = {};
        currentKeys.forEach((key) => { prunedSeenCache[key] = seenCache[key]; });
        fs.writeFileSync(STORE_SEEN_FILE, JSON.stringify(prunedSeenCache, null, 2));

        saveDataCache("cache-store-deals.json", deals);
        saveStoreDealsLastRefresh(Date.now(), sourceCounts, countryCode);
        console.log(`[store] refreshed: ${deals.length} deal(s) across ${Object.keys(sourceCounts).length} store(s).`);
        return deals;
    })().finally(() => {
        storeDealsRefreshPromise = null;
    });

    return storeDealsRefreshPromise;
}

// Same "cached instantly, real refresh only once it's actually due"
// pattern as get-free-games above -- except the cache is also considered
// stale the instant the requested country doesn't match whichever
// country it was built for, so switching your region in Options doesn't
// keep showing the old region's prices/currency for up to 6 hours.
ipcMain.handle("get-store-deals", async (event, countryCode) => {
    const cached = loadDataCache("cache-store-deals.json") || [];
    const lastRefreshedAt = readStoreDealsLastRefresh();
    const lastCountry = readStoreDealsLastCountry();
    const country = countryCode || "US";

    if (cached.length > 0 && lastCountry === country && (Date.now() - lastRefreshedAt) < STORE_DEALS_REFRESH_MIN_AGE_MS) {
        return cached;
    }
    return performStoreDealsRefresh(country);
});

// Backs the manual Refresh button — always does a real fetch regardless
// of the 6h gate.
ipcMain.handle("force-refresh-store-deals", async (event, countryCode) => performStoreDealsRefresh(countryCode || "US"));

// Instant retrieval of the last successfully fetched list, for showing
// something immediately on section open while a real refresh (if due)
// runs quietly in the background — same pattern as get-cached-free-games.
ipcMain.handle("get-cached-store-deals", async () => loadDataCache("cache-store-deals.json") || []);

// Backs the small per-platform count line in the Store section's UI —
// see the comment on saveStoreDealsLastRefresh above for why this exists.
ipcMain.handle("get-store-source-counts", async () => readStoreDealsSourceCounts());

// --- Movies currently in theaters (TMDB — free public movie database) ---


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
                rating: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
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

// --- Streaming Providers (Theatre) ---------------------------------------
//
// TMDB doesn't publish a stable, hand-maintainable list of provider IDs
// (they get added/renumbered over time), so provider IDs are resolved
// live from TMDB's own /watch/providers list and matched by name instead
// of hardcoded. Cached per media type + region for a day since the
// provider catalog itself barely changes.
const watchProvidersListCache = new Map(); // key: `${mediaType}:${countryCode}` -> { list, fetchedAt }
const WATCH_PROVIDERS_CACHE_MS = 24 * 60 * 60 * 1000;

const PRIORITY_PROVIDER_NAMES = [
    "Netflix", "Amazon Prime Video", "Disney Plus", "Max", "Hulu",
    "Apple TV Plus", "Paramount Plus", "Peacock", "Crunchyroll"
];

async function getWatchProvidersList(mediaType, countryCode) {
    const cacheKey = `${mediaType}:${countryCode}`;
    const cached = watchProvidersListCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < WATCH_PROVIDERS_CACHE_MS) {
        return cached.list;
    }
    const data = await mediaProxyGetJsonPlain("tmdb", `/watch/providers/${mediaType}`, {
        language: "en-US",
        watch_region: countryCode
    });
    const list = (data.results || []).map((p) => ({
        id: p.provider_id,
        name: p.provider_name,
        logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null
    }));
    watchProvidersListCache.set(cacheKey, { list, fetchedAt: Date.now() });
    return list;
}

// Combined movie+TV provider list for the dropdown -- most big names
// (Netflix, Max, etc) carry both, but this also covers TV-only or
// movie-only services, deduped by name.
ipcMain.handle("get-watch-providers", async (event, countryCode) => {
    try {
        const [movieList, tvList] = await Promise.all([
            getWatchProvidersList("movie", countryCode),
            getWatchProvidersList("tv", countryCode)
        ]);
        const byName = new Map();
        [...movieList, ...tvList].forEach((p) => {
            if (!byName.has(p.name)) byName.set(p.name, p);
        });
        const combined = Array.from(byName.values());
        combined.sort((a, b) => {
            const aPriority = PRIORITY_PROVIDER_NAMES.indexOf(a.name);
            const bPriority = PRIORITY_PROVIDER_NAMES.indexOf(b.name);
            if (aPriority === -1 && bPriority === -1) return a.name.localeCompare(b.name);
            if (aPriority === -1) return 1;
            if (bPriority === -1) return -1;
            return aPriority - bPriority;
        });
        return combined;
    } catch (err) {
        console.error("[theatre] watch providers list fetch failed:", err.message || err);
        return [];
    }
});


// Trending row for one specific provider -- "flatrate" (subscription
// streaming) only, not rent/buy, since that's what "what's on Netflix
// right now" actually means.
ipcMain.handle("get-trending-by-provider", async (event, { providerName, countryCode } = {}) => {
    try {
        const [movieList, tvList] = await Promise.all([
            getWatchProvidersList("movie", countryCode),
            getWatchProvidersList("tv", countryCode)
        ]);
        const movieProvider = movieList.find((p) => p.name === providerName);
        const tvProvider = tvList.find((p) => p.name === providerName);
        if (!movieProvider && !tvProvider) return [];

        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";

        const [movieData, tvData] = await Promise.all([
            movieProvider
                ? mediaProxyGetJsonPlain("tmdb", "/discover/movie", {
                    sort_by: "popularity.desc",
                    watch_region: countryCode,
                    with_watch_providers: String(movieProvider.id),
                    with_watch_monetization_types: "flatrate",
                    language: "en-US",
                    page: "1"
                })
                : Promise.resolve({ results: [] }),
            tvProvider
                ? mediaProxyGetJsonPlain("tmdb", "/discover/tv", {
                    sort_by: "popularity.desc",
                    watch_region: countryCode,
                    with_watch_providers: String(tvProvider.id),
                    with_watch_monetization_types: "flatrate",
                    language: "en-US",
                    page: "1"
                })
                : Promise.resolve({ results: [] })
        ]);

        const mapped = await Promise.all([
            ...(movieData.results || []).slice(0, 20).map((m) => mapProviderMovie(m, tmdbLanguage)),
            ...(tvData.results || []).slice(0, 20).map((s) => mapProviderShow(s, tmdbLanguage))
        ]);
        mapped.sort((a, b) => b.popularity - a.popularity);
        return mapped.slice(0, 24);
    } catch (err) {
        console.error("[theatre] trending-by-provider fetch failed:", err.message || err);
        return [];
    }
});

// Searches ANY title (not just what's trending on a provider in the
// dropdown above) and reports every provider it's actually streaming on
// in this region -- this is what satisfies "the search should find any
// [provider] even if not displayed inside Riftgate". TMDB's /search/multi
// covers movies + TV in one call; each hit's own /watch/providers is then
// checked individually.
ipcMain.handle("search-watch-providers", async (event, { query, countryCode } = {}) => {
    try {
        const trimmed = String(query || "").trim();
        if (!trimmed) return [];

        const searchData = await mediaProxyGetJsonPlain("tmdb", "/search/multi", {
            query: trimmed,
            language: "en-US",
            page: "1"
        });

        const candidates = (searchData.results || [])
            .filter((r) => r.media_type === "movie" || r.media_type === "tv")
            .slice(0, 10);

        const results = await Promise.all(candidates.map(async (r) => {
            try {
                const providersData = await mediaProxyGetJsonPlain(
                    "tmdb",
                    `/${r.media_type}/${r.id}/watch/providers`,
                    {}
                );
                const regionData = (providersData.results || {})[countryCode] || {};
                const flatrate = regionData.flatrate || [];
                if (flatrate.length === 0) return null;

                const title = r.media_type === "movie" ? r.title : r.name;
                const releaseDate = r.media_type === "movie" ? r.release_date : r.first_air_date;
                const poster = r.poster_path ? `https://image.tmdb.org/t/p/w200${r.poster_path}` : null;

                return {
                    id: r.id,
                    mediaType: r.media_type,
                    name: title,
                    image: poster,
                    releaseDate,
                    isMature: !!r.adult || textContainsMatureKeyword(title) || textContainsMatureKeyword(r.overview),
                    providers: flatrate
                        .map((p) => ({
                            name: p.provider_name,
                            logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null
                        }))
                        .sort((a, b) => a.name.localeCompare(b.name))
                };
            } catch (err) {
                return null;
            }
        }));

        return results.filter(Boolean);
    } catch (err) {
        console.error("[theatre] search-watch-providers failed:", err.message || err);
        return [];
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
                rating: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
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
                rating: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
                isMature: textContainsMatureKeyword(s.name) || textContainsMatureKeyword(s.overview)
            };
        }));

        return mapped;
    } catch (err) {
        console.error("[new] new TV shows fetch failed:", err.message || err);
        return [];
    }
});

// Anime is very often catalogued on TMDB as a brand-new show entry per
// SEASON (its own id, its own "first_air_date" set to when that season
// started airing) rather than as one show with multiple seasons the way
// Western TV almost always is -- so the first_air_date.gte filter below,
// which correctly keeps get-new-tv-shows above to real new shows, lets a
// returning anime's new season right back in too, since as far as TMDB's
// data is concerned it genuinely is a "new" entry. There's no reliable
// flag for this, so this catches it the same way a person would: by the
// title itself almost always saying "Season 2", "3rd Season", "Part 2",
// "Final Season", trailing " II"/" III", etc. for a continuing show.
const SEQUEL_SEASON_NAME_PATTERNS = [
    /\bseasons?\s*\d+\b/i,
    /\b\d+(st|nd|rd|th)\s*season\b/i,
    /\bfinal\s*season\b/i,
    /\bpart\s*\d+\b/i,
    /\bcour\s*\d+\b/i,
    /\b(ii|iii|iv|v|vi|vii)$/i
];

function looksLikeSequelSeason(name) {
    if (!name) return false;
    return SEQUEL_SEASON_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

// TMDB has no dedicated "this is anime" flag -- Animation (genre 16) +
// origin country Japan is the standard proxy every app built on TMDB
// uses for this, since virtually everything that combination returns
// genuinely is anime, and it needs no extra API beyond what
// get-new-tv-shows above already uses. Same 90-day "actually new" window
// and popularity ordering as that handler, just scoped further.
ipcMain.handle("get-new-anime", async (event, countryCode) => {
    try {
        const today = new Date();
        const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        const data = await mediaProxyGetJsonPlain("tmdb", "/discover/tv", {
            sort_by: "popularity.desc",
            "first_air_date.gte": ninetyDaysAgo.toISOString().slice(0, 10),
            "air_date.lte": today.toISOString().slice(0, 10),
            "vote_count.gte": "5",
            with_genres: "16",
            with_origin_country: "JP",
            language: "en-US",
            page: "1"
        });


        const tmdbLanguage = TMDB_LANGUAGE_BY_COUNTRY[countryCode] || "en-US";
        const genuinelyNew = (data.results || []).filter((s) => !looksLikeSequelSeason(s.name));
        const mapped = await Promise.all(genuinelyNew.map(async (s) => {
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
                rating: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
                isMature: textContainsMatureKeyword(s.name) || textContainsMatureKeyword(s.overview)
            };
        }));

        return mapped;
    } catch (err) {
        console.error("[new] new anime fetch failed:", err.message || err);
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

ipcMain.handle("select-exe", async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [
            { name: "Applications", extensions: [process.platform === "darwin" ? "app" : "exe"] }
        ]
    });

    if (result.canceled) return null;

    return result.filePaths[0];
});

// Process tracking (isProcessRunning/getAllProcesses) and the
// freshly-installed-app watcher live in services/platform/{windows,mac}.js
// behind platform.isProcessRunning() and platform.startInstallWatcher().
// Both platforms now compare snapshots once an hour: Desktop/Start Menu
// shortcut targets on Windows, /Applications on Mac.
platform.startInstallWatcher(
    () => GAMES_FILE,
    (candidates) => {
        if (win && !win.isDestroyed()) {
            win.webContents.send("new-install-detected", candidates);
        }
    }
);

// Launcher links the importers actually produce. Anything else with "://" is refused.
const ALLOWED_LAUNCH_URI_SCHEMES = ["steam:"];

function isInLibrary(targetPath) {
    try {
        const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
        return Array.isArray(games) && games.some((g) => g && g.path === targetPath);
    } catch (err) {
        return false;
    }
}

ipcMain.handle("launch-app", async (event, exePath) => {
    // Only things the user has in their library can be launched, and link-style
    // entries only for known game launchers.
    if (typeof exePath !== "string" || !exePath || !isInLibrary(exePath)) {
        return { started: false, error: "not_in_library" };
    }
    if (exePath.includes("://")) {
        let scheme = "";
        try { scheme = new URL(exePath).protocol.toLowerCase(); } catch (err) { /* malformed */ }
        if (!ALLOWED_LAUNCH_URI_SCHEMES.includes(scheme)) {
            return { started: false, error: "unsupported_link" };
        }
    }

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

        const imageName = await platform.getLaunchImageName(exePath);

        platform.spawnApp(exePath, (error) => {
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

                const stillRunning = await platform.isProcessRunning(imageName);

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

// generateNameVariants' "just the first word" fallback is a reasonable
// guess for a real game ("Diablo IV" -> "Diablo"), but for a Store bundle/
// collection listing ("Daedalic - Gigantic Bundle") that first word is
// often just a publisher name, and SteamGridDB's autocomplete will still
// happily return SOME unrelated game for it -- which then gets accepted
// as this title's "vertical replacement" and shown instead, wrong picture
// and all. This checks the match SteamGridDB actually returned against
// the real, full title (never the variant that found it) and rejects one
// that shares no real words with it, rather than trust any hit at all.
function isPlausibleSteamGridMatch(searchName, matchName) {
    if (!matchName) return false;
    const normalize = (s) => (s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);
    const searchWords = normalize(searchName);
    if (searchWords.length === 0) return true;
    const matchWords = new Set(normalize(matchName));
    return searchWords.some((w) => matchWords.has(w));
}

ipcMain.handle("fetch-online-cover", async (event, gameName) => {

    // Skip the network round trip for a title already fetched before --
    // this now runs far more often than just the Installed library's
    // manual "Add cover"/scan flows (every landscape cover across the app
    // tries this once, see watchForLandscapeCover in renderer.js), so
    // re-hitting SteamGridDB for the same title on every render would
    // burn API quota for nothing.
    try {
        if (fs.existsSync(COVERS_FOLDER)) {
            const baseName = safeFileName(gameName);
            const cached = fs.readdirSync(COVERS_FOLDER).find((f) => f.startsWith(`${baseName}.`));
            if (cached) {
                console.log(`[cover] Using cached cover for "${gameName}": ${cached}`);
                return `covers/${cached}`;
            }
        }
    } catch (err) {
        // Fall through to a fresh online lookup if the cache check itself
        // fails for any reason.
    }

    console.log(`[cover] Looking up "${gameName}" on SteamGridDB...`);

    try {
        const variants = generateNameVariants(gameName);
        let match = null;

        for (const variant of variants) {
            console.log(`[cover] Trying "${variant}"...`);
            const candidate = await searchSteamGridDb(variant);
            if (!candidate) continue;

            if (!isPlausibleSteamGridMatch(gameName, candidate.name)) {
                console.log(`[cover] Rejecting implausible match via "${variant}": ${candidate.name} (id ${candidate.id}) doesn't share a word with "${gameName}"`);
                continue;
            }

            match = candidate;
            console.log(`[cover] Match found via "${variant}": ${match.name} (id ${match.id})`);
            break;
        }

        if (!match) {
            console.log(`[cover] No plausible match for "${gameName}" after trying: ${variants.join(", ")}`);
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

// Steam's own appdetails endpoint exposes each game's official trailer(s)
// directly by numeric appid -- no search/relevance guessing involved,
// unlike the YouTube fallback below. Tried first whenever a Store deal has
// a resolvable Steam appid (see fetch-trailer), since a text search can
// occasionally return an unrelated video for a short/generic title (e.g.
// a one-word game name matching something else entirely) while this
// cannot -- it's either that exact app's trailer or nothing.
async function fetchSteamOfficialTrailerUrl(appId) {
    try {
        const data = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english&filters=movies`, 10000);
        const entry = data && data[appId];
        const movies = entry && entry.success && entry.data && Array.isArray(entry.data.movies) ? entry.data.movies : [];
        if (movies.length === 0) return null;

        const movie = movies.find((m) => m.highlight) || movies[0];
        const url = (movie.mp4 && (movie.mp4.max || movie.mp4["480"])) || (movie.webm && (movie.webm.max || movie.webm["480"])) || null;
        return url || null;
    } catch (err) {
        console.error(`[trailer] Steam official trailer fetch failed for appid ${appId}:`, err.message || err);
        return null;
    }
}

// Most Free Games entries come from a giveaway source (GamerPower,
// itch.io, GOG, a curated DRM-Free listing) that has no official trailer
// of its own to offer -- so fetch-trailer falls back to guessing from a
// YouTube text search, which is unreliable for a short/generic title
// ("Leaper" is a real word before it's ever a game name, and there can
// genuinely be more than one product that goes by it). Many of these
// giveaway titles are ALSO, separately, for sale on Steam under the exact
// same name even though this particular deal isn't the Steam one -- and
// Steam's own official trailer (fetchSteamOfficialTrailerUrl) is
// deterministic, not a guess. This resolves a Steam appid purely by exact
// normalized name match against Steam's own store search, so it's only
// ever used when the match is unambiguous; anything less than an exact
// match falls through to the YouTube search below rather than risk
// borrowing a different, similarly-named game's trailer.
async function resolveSteamAppIdByExactName(name) {
    try {
        const term = (name || "").trim();
        if (!term) return null;

        const data = await httpsGetJsonPlain(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=english`,
            8000
        );
        const items = data && Array.isArray(data.items) ? data.items : [];
        const target = normalizeGameName(term);
        const match = items.find((item) => normalizeGameName(item.name) === target);
        return match ? String(match.id) : null;
    } catch (err) {
        console.error(`[trailer] Steam appid resolution by name failed for "${name}":`, err.message || err);
        return null;
    }
}

// See resolveSteamAppIdByExactName's comment just above for the general
// "don't borrow a different game's trailer" philosophy -- this is the
// same idea applied to CheapShark's OWN cross-reference instead of a
// text search. Used by fetchCheapSharkDeals/fetchCheapSharkFreeGames
// below to sanity-check d.steamAppID before trusting it for anything
// (cover art, and — via fetch-trailer's steamAppId short-circuit —
// the trailer itself), since that field is CheapShark's own crowdsourced
// guess at which Steam listing a deal corresponds to, not something
// Steam itself confirms. filters=basic keeps this cheap (just a name),
// since a cross-reference check has no need for the fuller payload
// fetchSteamOfficialTrailerUrl's filters=movies fetches.
async function verifySteamAppIdMatchesName(appId, expectedName) {
    try {
        const data = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english&filters=basic`, 8000);
        const entry = data && data[appId];
        const actualName = entry && entry.success && entry.data && entry.data.name;
        if (!actualName) return false;

        const actual = normalizeGameName(actualName);
        const expected = normalizeGameName(expectedName);
        if (!actual || !expected) return false;
        return actual === expected || actual.startsWith(expected) || expected.startsWith(actual);
    } catch (err) {
        console.error(`[store] Steam appid verification failed for appid ${appId}:`, err.message || err);
        return false; // unverifiable -- don't trust a mapping that couldn't be confirmed
    }
}

ipcMain.handle("fetch-trailer", async (event, gameName, type, description, cacheKey, steamAppId) => {

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

    if (steamAppId && /^\d+$/.test(String(steamAppId))) {
        const steamTrailerUrl = await fetchSteamOfficialTrailerUrl(steamAppId);
        if (steamTrailerUrl) {
            console.log(`[trailer] Using Steam's own official trailer for "${gameName}" (appid ${steamAppId}) -- no YouTube search needed.`);
            if (cacheKey) {
                cache[cacheKey] = steamTrailerUrl;
                fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(cache, null, 2));
            }
            return steamTrailerUrl;
        }
        console.log(`[trailer] Steam has no official trailer for appid ${steamAppId}, falling back to YouTube search.`);
    }

    if (!steamAppId) {
        const resolvedAppId = await resolveSteamAppIdByExactName(gameName);
        if (resolvedAppId) {
            const steamTrailerUrl = await fetchSteamOfficialTrailerUrl(resolvedAppId);
            if (steamTrailerUrl) {
                console.log(`[trailer] Resolved "${gameName}" to Steam appid ${resolvedAppId} by exact name match -- using its official trailer instead of a YouTube guess.`);
                if (cacheKey) {
                    cache[cacheKey] = steamTrailerUrl;
                    fs.writeFileSync(TRAILER_CACHE_FILE, JSON.stringify(cache, null, 2));
                }
                return steamTrailerUrl;
            }
            console.log(`[trailer] Resolved "${gameName}" to Steam appid ${resolvedAppId} but it has no official trailer, falling back to YouTube search.`);
        }
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
            // this way -- don't block on it rather than reject everything.
            if (words.length === 0) return true;
            // \b...\b, not a plain substring check -- "black" has to
            // match as its own word, never as a fragment buried inside a
            // longer one. A real observed miss: "The Black Within"'s
            // search came back with "Blackwood - Official Game Overview
            // Trailer" (a completely different game) and the old
            // titleLower.includes("black") happily accepted it, since
            // "black" IS a substring of "blackwood". significantWords()
            // already strips each word down to plain [a-z0-9] before this
            // runs, so no regex-escaping is needed to build the pattern
            // from it.
            return words.some((w) => new RegExp(`\\b${w}\\b`).test(titleLower));
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
const EBOOK_OPEN_EXTENSIONS = new Set([".epub", ".pdf"]);

ipcMain.handle("launch-ebook", async (event, ebookPath) => {
    // shell.openPath runs whatever it's given (including .exe), so only open
    // e-book files that are actually in the user's library.
    if (typeof ebookPath !== "string" || !EBOOK_OPEN_EXTENSIONS.has(path.extname(ebookPath).toLowerCase())) {
        return { success: false, error: "Not an e-book file." };
    }
    let inLibrary = false;
    try {
        const ebooks = JSON.parse(fs.readFileSync(EBOOKS_FILE, "utf8"));
        inLibrary = Array.isArray(ebooks) && ebooks.some((b) => b && b.path === ebookPath);
    } catch (err) {
        inLibrary = false;
    }
    if (!inLibrary) {
        return { success: false, error: "This book isn't in your library." };
    }
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

ipcMain.handle("get-recommended-ebooks", async () => {
    try {
        const { books, error } = await booksApi.fetchGutenbergPages(3);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books.filter((b) => b.formats && b.formats["application/epub+zip"]).map(booksApi.mapGutenbergBook);
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
        const { books, error } = await booksApi.fetchGutenbergPages(2);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books.filter((b) => b.formats && b.formats["application/epub+zip"]).map(booksApi.mapGutenbergBook);
        saveDataCache("cache-popular-ebooks.json", mapped);
        return { success: true, books: mapped };
    } catch (err) {
        console.error("[ebooks] popular fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-top-downloaded-ebooks", async () => {
    try {
        const { books, error } = await booksApi.fetchGutenbergPages(4);
        if (books.length === 0) {
            return { success: false, books: [], error: error || "No books returned." };
        }
        const mapped = books
            .filter((b) => b.formats && b.formats["application/epub+zip"])
            .map(booksApi.mapGutenbergBook)
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
            .map(booksApi.mapGutenbergBook);

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
            .map(booksApi.mapGutenbergBook);
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

// True if a book's title or subject list mentions the given keyword —
// used to keep Manga and (Western/general) Comics from bleeding into
// each other, since Open Library files plenty of manga under a generic
// "comics" subject too. Checked against the raw search doc (subjects
// aren't kept on the mapped book object).
ipcMain.handle("get-openlibrary-popular", async () => {
    try {
        const books = await booksApi.fetchOpenLibraryBooks("fiction", "rating");
        saveDataCache("cache-openlibrary-popular.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library popular fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-openlibrary-most-sold", async () => {
    try {
        const books = await booksApi.fetchOpenLibraryBooks("bestseller");
        saveDataCache("cache-openlibrary-most-sold.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library most-sold fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

ipcMain.handle("get-openlibrary-new-releases", async () => {
    try {
        const books = await booksApi.fetchOpenLibraryBooksWithCovers("fiction", "new", 40);
        saveDataCache("cache-openlibrary-new-releases.json", books);
        return { success: true, books };
    } catch (err) {
        console.error("[books] Open Library new-releases fetch failed:", err.message || err);
        return { success: false, books: [], error: err.message || String(err) };
    }
});

// Manga/Comics sections — reuse the exact same Open Library machinery as
// Buy Books (booksApi.fetchOpenLibraryBooks, booksApi.mapOpenLibraryBook, saveDataCache),
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
        // (see booksApi.openLibraryYearIsPlausible), and booksApi.openLibraryDocHasSpecificManga
        // filters out Western comics/graphic novels caught by a broad
        // "comics, graphic novels, manga" umbrella subject tag.
        const books = await booksApi.fetchOpenLibraryBooksWithCovers("subject:manga", "rating", 150, null, booksApi.openLibraryDocHasSpecificManga, 1950);
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
        // hit is a much later adaptation (see booksApi.openLibraryYearIsPlausible).
        const books = await booksApi.fetchOpenLibraryBooksWithCovers("subject:comics", "rating", 150, "manga", ["comic", "graphic novel"], 1930);
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
        // (see booksApi.openLibraryYearIsPlausible) — without it, searching Manga
        // or Comics could still surface a classic work whose only real
        // link to the genre is a much later adaptation.
        const minYear = isManga ? 1950 : 1930;
        const scoped = isManga
            ? docs.filter((d) => booksApi.openLibraryDocHasSpecificManga(d) && booksApi.openLibraryYearIsPlausible(d, minYear))
            : docs.filter((d) => !booksApi.openLibraryDocMentions(d, "manga") && booksApi.openLibraryDocMentionsAny(d, ["comic", "graphic novel"]) && booksApi.openLibraryYearIsPlausible(d, minYear));
        const books = scoped.filter((d) => d.title).map(booksApi.mapOpenLibraryBook);
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
                const books = await booksApi.fetchOpenLibraryBooks(term);
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
        const books = await booksApi.fetchOpenLibraryBooks(query.trim());
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
// The versioned-folder-relocation check (Discord/Slack/VS-Code-style
// self-update layouts) now lives in services/platform/windows.js as
// platform.findRelocatedApp() — Mac apps don't use this update scheme, so
// mac.js's version is a no-op that always returns null.

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
            // their own check — see platform.isSteamAppStillInstalled above. Every
            // other "://" path (any launcher protocol besides Steam's)
            // still isn't a real filesystem path either, but there's no
            // equivalent manifest to check it against, so — same as
            // before — it's left alone rather than risk a false "missing".
            const steamMatch = g.path.match(/^steam:\/\/rungameid\/(\d+)$/i);
            if (steamMatch) {
                if (!platform.isSteamAppStillInstalled(steamMatch[1])) {
                    genuinelyMissing.push({ path: g.path, name: g.name });
                }
                continue;
            }

            if (g.path.includes("://") || fs.existsSync(g.path)) continue;

            const relocatedPath = platform.findRelocatedApp(g.path);
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

// Real uninstall (registry lookup on Windows, shell.trashItem on Mac) now
// lives in services/platform/{windows,mac}.js as platform.uninstallApp().

ipcMain.handle("uninstall-game", async (event, { path: gamePath, name: gameName }) => {
    try {
        return await platform.uninstallApp(gamePath, gameName);
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
// and reopened. The file is encrypted at rest with Electron's safeStorage
// (OS-level — DPAPI on Windows); if that isn't available on this machine the
// session is simply not persisted.
//
// On a backend that supports login sessions (get_backend_info
// schema_version >= 5) the file holds only a random session token that the
// server can revoke — never the password. Older backends still get the
// previous behaviour (the password itself, encrypted), and a password saved
// by an older app version is exchanged for a token the first time it's read.
const SESSION_TOKEN_MIN_SCHEMA = 5;
const SERVER_SIDE_EMAIL_MIN_SCHEMA = 6;
const DEVICE_BOUND_PASSWORD_MIN_SCHEMA = 3;

let cachedBackendInfo = null;

// Asks the server which hardened features it has. A server that predates the
// check (404) or can't be reached counts as version 0 — and isn't cached, so
// the next call asks again.
async function getBackendSchemaVersion() {
    if (cachedBackendInfo) return cachedBackendInfo.schema_version || 0;
    const r = await callAdminRpc("get_backend_info", {});
    if (r.success && r.result && typeof r.result === "object") {
        cachedBackendInfo = r.result;
        return cachedBackendInfo.schema_version || 0;
    }
    return 0;
}

function readSessionFile() {
    if (!fs.existsSync(SESSION_FILE) || !safeStorage.isEncryptionAvailable()) return null;
    try {
        const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(SESSION_FILE)));
        return parsed && parsed.username ? parsed : null;
    } catch (err) {
        // Corrupt, left over in plain text by an old version, or encrypted by
        // another Windows user profile — same as having no session.
        return null;
    }
}

function writeSessionFile(payload) {
    fs.writeFileSync(SESSION_FILE, safeStorage.encryptString(JSON.stringify(payload)));
}

function deleteSessionFile() {
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

async function createServerSession(username, password) {
    const r = await callAdminRpc("create_login_session", { input_username: username, input_password: password });
    if (r.success && r.result && r.result.success && typeof r.result.token === "string") {
        return { ok: true, token: r.result.token };
    }
    // reachable-but-refused vs. network failure matters to the caller
    return { ok: false, refused: r.success };
}

function revokeServerSession(username, token) {
    // Best effort — an unreachable server just means the token expires on its own.
    return callAdminRpc("revoke_login_session", { input_username: username, input_token: token }).catch(() => null);
}

ipcMain.handle("save-login-session", async (event, { username, password }) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            deleteSessionFile();
            console.warn("[session] OS-level encryption unavailable — not persisting login session.");
            return { success: false, reason: "encryption_unavailable" };
        }

        if (await getBackendSchemaVersion() >= SESSION_TOKEN_MIN_SCHEMA) {
            const created = await createServerSession(username, password);
            if (!created.ok) {
                // Never fall back to storing the password on a backend that
                // supports tokens — the user just logs in again next launch.
                return { success: false, reason: "session_unavailable" };
            }
            const previous = readSessionFile();
            if (previous && previous.token) revokeServerSession(previous.username, previous.token);
            writeSessionFile({ username, token: created.token });
            return { success: true };
        }

        writeSessionFile({ username, password });
        return { success: true };
    } catch (err) {
        console.error("[session] Failed to save login session:", err.message || err);
        return { success: false };
    }
});

// Returns { username, token } (current backends), { username, password }
// (legacy backends only), or null.
ipcMain.handle("load-login-session", async () => {
    const saved = readSessionFile();
    if (!saved) return null;
    if (typeof saved.token === "string") return { username: saved.username, token: saved.token };
    if (typeof saved.password !== "string") return null;

    if (await getBackendSchemaVersion() < SESSION_TOKEN_MIN_SCHEMA) {
        return { username: saved.username, password: saved.password };
    }

    // Saved by an older app version: swap the password for a token so it no
    // longer sits on disk at all.
    try {
        const created = await createServerSession(saved.username, saved.password);
        if (created.ok) {
            writeSessionFile({ username: saved.username, token: created.token });
            return { username: saved.username, token: created.token };
        }
        if (created.refused) deleteSessionFile(); // wrong/changed password — drop it
        return null;
    } catch (err) {
        console.error("[session] Failed to upgrade saved session:", err.message || err);
        return null;
    }
});

ipcMain.handle("redeem-login-session", async (event, { username, token }) => {
    if (typeof username !== "string" || typeof token !== "string") return { success: false };
    const r = await callAdminRpc("redeem_login_session", { input_username: username, input_token: token });
    if (!r.success) return r;
    return { success: true, valid: r.result === true };
});

ipcMain.handle("clear-login-session", async () => {
    try {
        const saved = readSessionFile();
        if (saved && typeof saved.token === "string") await revokeServerSession(saved.username, saved.token);
        deleteSessionFile();
        return { success: true };
    } catch (err) {
        console.error("[session] Failed to clear login session:", err.message || err);
        return { success: false };
    }
});

// This install's own device id (see get-device-id below), or null.
function readDeviceIdSync() {
    try {
        const current = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
        return typeof current.deviceId === "string" ? current.deviceId : null;
    } catch (err) {
        return null;
    }
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
    // Newer backends only accept a first-time password from the device that
    // registered the username; older ones take just the username.
    const deviceId = readDeviceIdSync();
    const params = { input_username: username, new_password: newPassword };
    if (deviceId && await getBackendSchemaVersion() >= DEVICE_BOUND_PASSWORD_MIN_SCHEMA) {
        params.input_device_id = deviceId;
    }
    const r = await callAdminRpc("set_own_login_password", params);
    if (!r.success) return r;
    return { success: true, changed: r.result === true };
});

// Email verification — optional, and separate from login. Riftgate still
// signs people in with a username + this same login password only; this
// just lets an account optionally prove it owns an email address, in
// case that's ever needed for account recovery. Both handlers are
// password-gated the same way as set-own-login-password above (the RPC
// itself checks the password), and the verification token generated by
// request_email_verification is used server-side (by us, right here) to
// email a link — it's never returned to the renderer.
ipcMain.handle("request-email-verification", async (event, { username, password, email }) => {
    // Lowercased/trimmed here so "Name@Gmail.com" and "name@gmail.com" are
    // always treated as the same address — both for the "one email per
    // account" uniqueness check, and because some mail providers (and
    // Resend's own test-mode sender restriction) are case-sensitive about
    // an exact match.
    const normalizedEmail = email ? email.trim().toLowerCase() : null;

    // Newer backends create and email the link server-side; the token never
    // reaches this app.
    if (await getBackendSchemaVersion() >= SERVER_SIDE_EMAIL_MIN_SCHEMA) {
        try {
            const { statusCode, parsed } = await callEdgeFunction("account-email", {
                action: "verify-email", username, password, email: normalizedEmail
            });
            if (statusCode === 429) return { success: false, error: "Too many requests — try again in a few minutes." };
            if (parsed && parsed.success) return { success: true, email: parsed.email };
            return { success: false, error: (parsed && parsed.error) || "Couldn't send the verification email — try again in a moment." };
        } catch (err) {
            console.error("[email] account-email verify-email failed:", err.message || err);
            return { success: false, error: "Couldn't reach the server — check your connection and try again." };
        }
    }

    const r = await callAdminRpc("request_email_verification", {
        input_username: username,
        input_password: password,
        input_new_email: normalizedEmail
    });
    if (!r.success) return { success: false, error: r.error };

    const rpcResult = r.result;
    if (!rpcResult || !rpcResult.success) {
        return { success: false, error: (rpcResult && rpcResult.error) || "Couldn't start email verification." };
    }

    const sendResult = await sendVerificationEmail(username, rpcResult.email, rpcResult.token);
    if (!sendResult.success) {
        return { success: false, error: "Couldn't send the verification email — try again in a moment." };
    }

    return { success: true, email: rpcResult.email };
});

ipcMain.handle("get-email-verification-status", async (event, { username, password }) => {
    const r = await callAdminRpc("get_own_email_status", { input_username: username, input_password: password });
    if (!r.success) return { success: false, error: r.error };

    const rpcResult = r.result;
    if (!rpcResult || !rpcResult.success) {
        return { success: false, error: (rpcResult && rpcResult.error) || "Couldn't check email status." };
    }

    return { success: true, email: rpcResult.email, verified: rpcResult.verified, sentAt: rpcResult.sentAt };
});

// Self-service "forgot password" recovery. Unlike the email-verification
// handlers just above, this is NOT authenticated with the account's own
// password -- that's the whole point, the user has forgotten it. The
// request_password_reset RPC always returns the same generic
// {success:true} shape whether the username exists, has a verified
// email, or was just rate-limited (see its own comment in the SQL) --
// this handler preserves that by never surfacing an RPC-level failure
// either, so nothing here can be used to probe which usernames are
// registered. A code is only ever actually emailed when the RPC handed
// one back.
ipcMain.handle("request-password-reset", async (event, { username }) => {
    // Newer backends generate and email the code server-side (account-email
    // Edge Function); the answer is the same generic success either way.
    if (await getBackendSchemaVersion() >= SERVER_SIDE_EMAIL_MIN_SCHEMA) {
        try {
            await callEdgeFunction("account-email", { action: "password-reset", username });
        } catch (err) {
            console.error("[password-reset] account-email failed:", err.message || err);
        }
        return { success: true };
    }

    const r = await callAdminRpc("request_password_reset", { input_username: username });
    if (!r.success) return { success: true };

    const rpcResult = r.result;
    if (rpcResult && rpcResult.email && rpcResult.code) {
        const sendResult = await sendPasswordResetEmail(username, rpcResult.email, rpcResult.code);
        if (!sendResult.success) {
            console.error(`[password-reset] Failed to send reset email for "${username}".`);
        }
    }

    return { success: true };
});

// Second step: the code the user just got emailed, plus their new
// password. confirm_password_reset itself enforces expiry, single-use,
// and a 5-attempt lockout on the code -- this handler just relays
// whatever it decides.
ipcMain.handle("confirm-password-reset", async (event, { username, code, newPassword }) => {
    const r = await callAdminRpc("confirm_password_reset", {
        input_username: username,
        input_code: code,
        input_new_password: newPassword
    });
    if (!r.success) return { success: false, error: r.error };

    const rpcResult = r.result;
    if (!rpcResult || !rpcResult.success) {
        return { success: false, error: (rpcResult && rpcResult.error) || "Couldn't reset the password." };
    }

    return { success: true };
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

// Every Vault file transfer goes through the "vault" Edge Function (backend
// schema 7+): the storage bucket is private with no public rules, so the app
// can't touch it directly. The function checks the password, then hands back
// short-lived signed upload/download links.
const VAULT_FUNCTION_MIN_SCHEMA = 7;
const VAULT_NEEDS_SERVER_UPDATE = "The Vault is being upgraded — file sharing will be back shortly.";

async function callVault(action, params) {
    if (await getBackendSchemaVersion() < VAULT_FUNCTION_MIN_SCHEMA) {
        return { success: false, error: VAULT_NEEDS_SERVER_UPDATE };
    }
    try {
        const { statusCode, parsed } = await callEdgeFunction("vault", { action, ...params });
        if (parsed && typeof parsed === "object") {
            if (parsed.success) return parsed;
            return { ...parsed, success: false, error: parsed.error || `The Vault couldn't do that (status ${statusCode}).` };
        }
        return { success: false, error: `The Vault couldn't do that (status ${statusCode}).` };
    } catch (err) {
        console.error(`[vault] ${action} failed:`, err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
}

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
        // Supabase's free tier hard-caps every upload at 50MB — checking this
        // upfront gives a clear reason immediately instead of a failed upload.
        const stats = fs.statSync(filePath);
        const fileSizeMb = stats.size / (1024 * 1024);
        if (fileSizeMb > 50) {
            return {
                success: false,
                error: `This file is ${fileSizeMb.toFixed(1)}MB, but the free Supabase plan only allows up to 50MB per file. Split it into smaller parts, or upgrade to Supabase Pro to remove this limit.`
            };
        }

        const start = await callVault("upload-start", { username, password, filename: originalName, size: stats.size });
        if (!start.success) return { success: false, error: start.error };

        const fileBuffer = fs.readFileSync(filePath);
        const uploadResult = await supabaseSignedUpload(start.uploadUrl, fileBuffer);
        if (uploadResult.statusCode < 200 || uploadResult.statusCode >= 300) {
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

        const finish = await callVault("upload-finish", {
            username,
            password,
            storagePath: start.storagePath,
            filename: originalName,
            description: description || "",
            expiresHours
        });
        if (!finish.success) {
            return { success: false, error: finish.error || "Couldn't record the shared file — you may not be on the allowlist." };
        }
        return { success: true, file: finish.file };
    } catch (err) {
        console.error("[share] upload failed:", err.message || err);
        return { success: false, error: "Something went wrong reading or uploading that file." };
    }
});

// Just the signed URL, no save dialog — used for hover-preview of image files.
// The Edge Function re-checks the password and that the file is in the Vault.
ipcMain.handle("get-shared-file-preview-url", async (event, { username, password, storagePath }) => {
    const result = await callVault("download-url", { username, password, storagePath, expiresIn: 3600 });
    return result.success ? { success: true, url: result.url } : { success: false, error: result.error };
});

ipcMain.handle("download-shared-file", async (event, { username, password, storagePath, filename }) => {
    // Ask for the link first, so an unauthorized request never opens a save dialog.
    const link = await callVault("download-url", { username, password, storagePath });
    if (!link.success) return { success: false, error: link.error || "Not authorized for that file." };

    const saveResult = await dialog.showSaveDialog(win, {
        title: "Save shared file",
        defaultPath: filename
    });

    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
    }

    try {
        // The first link may have expired while the save dialog was open.
        const fresh = await callVault("download-url", { username, password, storagePath });
        if (!fresh.success) return { success: false, error: `Couldn't generate a download link: ${fresh.error || "unknown error"}` };

        const fileBuffer = await new Promise((resolve, reject) => {
            https.get(fresh.url, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
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

// The Edge Function deletes the Vault entry and its stored file together.
ipcMain.handle("delete-shared-file", async (event, { username, fileId, adminPassword, password }) => {
    const result = await callVault("delete", {
        username,
        password: password || adminPassword || "",
        adminPassword: adminPassword || null,
        fileId
    });
    return !!result.success;
});

// Removes expired shares (entry + stored file). Any allowlisted user's
// Riftgate triggers this periodically — there's no scheduled server job.
ipcMain.handle("cleanup-expired-shared-files", async (event, { username, password }) => {
    const result = await callVault("cleanup-expired", { username, password });
    return result.success ? { success: true, cleaned: result.cleaned || 0 } : { success: false, cleaned: 0 };
});

ipcMain.handle("force-clean-shared-folder", async (event, { adminUsername, adminPassword }) => {
    const result = await callVault("force-clean", { username: adminUsername, password: adminPassword });
    return result.success ? { success: true, cleaned: result.cleaned || 0 } : { success: false, error: result.error };
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

// Public counters, not gated behind the Vault password check every other
// handler above uses — same reasoning as increment-community-app-visit in
// the Applications section: the RPC only ever adds 1 to one row's numeric
// counter, and the id it targets is never exposed to anyone who hasn't
// already been through get-shared-files/get-shared-links (which ARE
// password-gated), so leaving this one open to any client can't leak or
// alter the file/link itself — worst case is a slightly inflated count.
ipcMain.handle("increment-shared-file-download", async (event, fileId) => {
    try {
        const result = await supabaseRequest("rpc/increment_shared_file_download", "POST", { p_file_id: fileId });
        if (result.statusCode !== 200) return { success: false };
        return { success: true, downloadCount: typeof result.body === "number" ? result.body : null };
    } catch (err) {
        console.error("[share] download-count increment failed:", err.message || err);
        return { success: false };
    }
});

ipcMain.handle("increment-shared-link-open", async (event, linkId) => {
    try {
        const result = await supabaseRequest("rpc/increment_shared_link_open", "POST", { p_link_id: linkId });
        if (result.statusCode !== 200) return { success: false };
        return { success: true, openCount: typeof result.body === "number" ? result.body : null };
    } catch (err) {
        console.error("[share] open-count increment failed:", err.message || err);
        return { success: false };
    }
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
    const repoPath = github.extractRepoPath(trimmedUrl);
    let finalAuthor = (author || "").trim() || null;
    if (!finalAuthor && repoPath) {
        finalAuthor = repoPath.split("/")[0];
    }

    let finalDescription = (description || "").trim() || null;
    if (!finalDescription) {
        finalDescription = await github.fetchRepoDescription(trimmedUrl);
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

// Public counter, not admin-gated — anyone browsing Applications can bump
// this just by clicking Visit, same as request-share-access above is a
// public RPC call with no admin credentials. The RPC itself (see
// community-apps-visits.sql) only ever adds exactly 1 to exactly one row,
// so there's no arbitrary-write risk in leaving this open to every client.
ipcMain.handle("increment-community-app-visit", async (event, appId) => {
    try {
        const result = await supabaseRequest("rpc/increment_community_app_visit", "POST", { p_app_id: appId });
        if (result.statusCode !== 200) return { success: false };
        return { success: true, visitCount: typeof result.body === "number" ? result.body : null };
    } catch (err) {
        console.error("[apps] visit increment failed:", err.message || err);
        return { success: false };
    }
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

app.on("second-instance", () => {
    if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }
});

app.whenReady().then(async () => {
    // Content-Security-Policy, applied at the network layer (not a <meta>
    // tag) so it can't be bypassed by anything that gets injected into the
    // page. script-src/style-src stay locked to 'self' (style-src also
    // allows 'unsafe-inline' since the UI uses plenty of inline style=""
    // attributes) — no remote script can ever run in this window. img-src
    // allows any https: host plus the covercache: scheme and data: URIs,
    // since cover art/avatars are pulled from dozens of unpredictable CDNs
    // (Steam, TMDB, GitHub, Epic, itch.io, per-game vendor sites, etc.) and
    // there's no fixed list to allowlist. frame-src is scoped to YouTube
    // only, for trailer embeds. connect-src is 'self' because the renderer
    // never calls fetch()/XHR itself — every external API call happens in
    // this process (main.js, over Node's https module) and results are
    // relayed to the renderer over IPC, so the page has nothing to reach
    // out to on its own.
    const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: covercache: https:; media-src 'self'; frame-src https://www.youtube.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';";
    // BUG FIXED: this originally had no URL filter, so it rewrote the
    // Content-Security-Policy header on EVERY response in the whole
    // session — including the YouTube trailer iframe's own page and
    // everything it loads. YouTube's actual video data streams from a
    // completely different origin (*.googlevideo.com), so Riftgate's
    // media-src/connect-src 'self' was silently blocking YOUTUBE'S OWN
    // player from fetching video — hence trailers loading as a black,
    // frozen frame instead of playing. The filter below (host-only —
    // match patterns can't restrict by port) plus the exact-port check
    // inside the listener make sure this CSP only ever applies to
    // Riftgate's own page, never to anything else the app happens to
    // load (YouTube embeds now, potentially other third-party iframes
    // later).
    session.defaultSession.webRequest.onHeadersReceived(
        { urls: ["http://127.0.0.1/*"] },
        (details, callback) => {
            const isOwnPage = localServerPort !== null
                && details.url.startsWith(`http://127.0.0.1:${localServerPort}/`);
            if (!isOwnPage) {
                callback({});
                return;
            }
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    "Content-Security-Policy": [CSP]
                }
            });
        }
    );

    // Electron's default for both of these is ALLOW — a permission
    // request or check that nothing here handles is granted automatically.
    // Since Riftgate loads real third-party content (the YouTube trailer
    // iframe today, potentially other embedded pages later), that default
    // is worth overriding explicitly rather than relying on: nothing on
    // Riftgate's own feature list needs camera, microphone, geolocation,
    // notifications, MIDI, clipboard access, screen/window capture, or raw
    // USB/HID/serial device access, so all of those are denied outright.
    // "fullscreen" is the one exception — the YouTube player's own
    // fullscreen button depends on it, and it doesn't expose anything
    // sensitive.
    const ALLOWED_PERMISSIONS = new Set(["fullscreen"]);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(ALLOWED_PERMISSIONS.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        return ALLOWED_PERMISSIONS.has(permission);
    });

    registerFreeGamesCoverCacheProtocol();
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

    // Re-checks every 4 hours (plus a random 0-30 min so installs don't all
    // hit GitHub at the same moment), so a session left open for days still
    // picks up a new release. The manual "Check for Updates" button is
    // unaffected and checks immediately.
    const scheduleNextUpdateCheck = () => {
        const delay = 4 * 60 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000);
        setTimeout(() => {
            checkForUpdatesWithRetry(1);
            scheduleNextUpdateCheck();
        }, delay);
    };
    scheduleNextUpdateCheck();
});


console.log("=====================================");
console.log("Game Launcher started");
console.log("Online cover fetch (SteamGridDB): via Supabase media-proxy Edge Function.");
console.log("=====================================");