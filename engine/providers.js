// Riftgate's outside sources (TMDB, Steam, Epic, Open Library…) and how the
// engine behaves when one of them fails.
//
// What this module does, in one place, for every request the engine makes:
//
//  * knows which provider a request belongs to (by host, or by vendor for
//    requests that go through Riftgate's media proxy);
//  * keeps each provider's health: when it last answered, when it last
//    failed and why (offline, timed out, busy, down);
//  * backs off a host that keeps failing: after a few failures in a row it
//    is left alone for a while (90 s, doubling up to 10 min) and requests to
//    it fail at once instead of waiting for a timeout, so the interface can
//    fall back to saved data straight away. Try again clears it;
//  * ties every request to the interface call that caused it, so the answer
//    can say which providers failed during that call, and whether what came
//    back is a saved copy (and from when). The answer itself keeps its usual
//    shape; this travels beside it (see wrapResult and preload.js).
//
// Nothing here knows about any feature. Features only call
// servedSaved(savedAt) when they fall back to a saved copy, and
// track(vendor, promise) for media-proxy requests.
"use strict";
const { AsyncLocalStorage } = require("async_hooks");
const fs = require("fs");
const path = require("path");

const PROVIDERS = [
    { id: "tmdb", label: "TMDB", what: "films and series", hosts: [/(^|\.)themoviedb\.org$/] },
    { id: "rawg", label: "RAWG", what: "upcoming games", hosts: [/(^|\.)rawg\.io$/] },
    { id: "steamgriddb", label: "SteamGridDB", what: "covers", hosts: [/(^|\.)steamgriddb\.com$/] },
    { id: "youtube", label: "YouTube", what: "trailers", hosts: [] }, // only through the media proxy
    { id: "googlebooks", label: "Google Books", what: "book covers", hosts: [/^www\.googleapis\.com$/] },
    { id: "steam", label: "Steam", what: "games, deals and playtime", hosts: [/^store\.steampowered\.com$/, /^api\.steampowered\.com$/, /^steamcommunity\.com$/] },
    { id: "steamspy", label: "SteamSpy", what: "free Steam games", hosts: [/(^|\.)steamspy\.com$/] },
    { id: "cheapshark", label: "CheapShark", what: "deals and prices", hosts: [/(^|\.)cheapshark\.com$/] },
    { id: "epic", label: "Epic Games", what: "free games", hosts: [/^store-site-backend-static(-ipv4)?\.ak\.epicgames\.com$/, /^graphql\.epicgames\.com$/, /^store\.epicgames\.com$/] },
    { id: "gog", label: "GOG", what: "free games", hosts: [/^(www|catalog|embed|api)\.gog\.com$/] },
    { id: "itch", label: "itch.io", what: "free games", hosts: [/^itch\.io$/] },
    { id: "gamerpower", label: "GamerPower", what: "giveaways", hosts: [/(^|\.)gamerpower\.com$/] },
    { id: "tvmaze", label: "TVmaze", what: "episodes", hosts: [/^api\.tvmaze\.com$/] },
    { id: "openlibrary", label: "Open Library", what: "books", hosts: [/^openlibrary\.org$/] },
    { id: "gutenberg", label: "Project Gutenberg", what: "free classics", hosts: [/^gutendex\.com$/] },
    { id: "osm", label: "OpenStreetMap", what: "cinemas near you", hosts: [/^overpass(-api)?\./, /^nominatim\.openstreetmap\.org$/] },
    { id: "github", label: "GitHub", what: "updates and app info", hosts: [/^api\.github\.com$/] },
    { id: "riftgate", label: "Riftgate online", what: "accounts, themes and apps", hosts: [/\.supabase\.co$/] },
    { id: "wikipedia", label: "Wikipedia", what: "descriptions", hosts: [/\.wikipedia\.org$/] },
    { id: "location", label: "Location lookup", what: "your country", hosts: [/^ipapi\.co$/] },
    { id: "rates", label: "Exchange rates", what: "prices in your currency", hosts: [/^open\.er-api\.com$/] },
];
const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
// media-proxy vendors that aren't a provider id of their own
const VENDOR_ALIAS = { steam: "steam", tmdb: "tmdb", rawg: "rawg", steamgriddb: "steamgriddb", youtube: "youtube" };

function providerForHost(host) {
    host = String(host || "").toLowerCase().replace(/:\d+$/, "");
    if (!host || host === "127.0.0.1" || host === "localhost") return null;
    for (const p of PROVIDERS) if (p.hosts.some((re) => re.test(host))) return p;
    return null;
}

// ---- why a request failed, in words the interface can show -----------------
function reasonOf(err, status) {
    if (status === 429) return "busy";
    if (status >= 500) return "down";
    const code = err && err.code;
    if (code === "EPROVIDERCOOLING") return "resting";
    if (["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "EHOSTUNREACH"].includes(code)) return "offline";
    if (code === "ETIMEDOUT" || /timed out/i.test(String(err && err.message))) return "timeout";
    return "error";
}

// ---- health: per provider, persisted so a restart still knows --------------
let healthFile = null;
let notify = () => {};
const health = {}; // id -> { lastOkAt, lastFailAt, reason, fails }
let saveTimer = null, notifyTimer = null;
function load() {
    if (!healthFile) return;
    try { Object.assign(health, JSON.parse(fs.readFileSync(healthFile, "utf8")) || {}); } catch (err) { /* first run */ }
}
function persistSoon() {
    if (!healthFile || saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try { fs.writeFileSync(healthFile + ".tmp", JSON.stringify(health)); fs.renameSync(healthFile + ".tmp", healthFile); } catch (err) { /* best effort */ }
    }, 2000);
    if (saveTimer.unref) saveTimer.unref();
}
function changedSoon() {
    if (notifyTimer) return;
    notifyTimer = setTimeout(() => { notifyTimer = null; try { notify(status()); } catch (err) { /* window gone */ } }, 400);
    if (notifyTimer.unref) notifyTimer.unref();
}

// ---- backing off a host that keeps failing ---------------------------------
const FAILS_BEFORE_REST = 3;
const REST_MIN_MS = 90 * 1000, REST_MAX_MS = 10 * 60 * 1000;
const hosts = new Map(); // host -> { fails, restUntil, restMs }
function hostState(host) {
    let s = hosts.get(host);
    if (!s) hosts.set(host, (s = { fails: 0, restUntil: 0, restMs: REST_MIN_MS }));
    return s;
}
function resting(host) { const s = hosts.get(host); return !!s && s.restUntil > Date.now(); }

// ---- the call each request belongs to --------------------------------------
const als = new AsyncLocalStorage();

function report(provider, host, ok, reason) {
    const now = Date.now();
    const h = health[provider.id] || (health[provider.id] = { fails: 0 });
    const was = h.lastFailAt > (h.lastOkAt || 0);
    if (ok) { h.lastOkAt = now; h.fails = 0; delete h.reason; }
    else { h.lastFailAt = now; h.fails = (h.fails || 0) + 1; h.reason = reason; }
    if (host && reason !== "resting") {
        const s = hostState(host);
        if (ok) { s.fails = 0; s.restMs = REST_MIN_MS; s.restUntil = 0; }
        else if (reason !== "error" && ++s.fails >= FAILS_BEFORE_REST && s.restUntil < now) {
            s.restUntil = now + s.restMs;
            s.restMs = Math.min(REST_MAX_MS, s.restMs * 2);
            console.warn(`[providers] ${provider.label} (${host}) keeps failing (${reason}); leaving it alone for ${Math.round((s.restUntil - now) / 1000)} s`);
        }
    }
    const call = als.getStore();
    if (call) {
        const c = call.providers.get(provider.id) || { ok: false, reason: null };
        if (ok) c.ok = true; else c.reason = c.reason || reason;
        call.providers.set(provider.id, c);
    }
    persistSoon();
    if (was !== !ok) changedSoon();
}

// ---- watching every request the engine makes -------------------------------
function hostAndPath(args) {
    const a = args[0];
    try {
        if (typeof a === "string") { const u = new URL(a); return [u.hostname, u.pathname]; }
        if (a instanceof URL) return [a.hostname, a.pathname];
        if (a && typeof a === "object") return [a.hostname || a.host, a.path || "/"];
    } catch (err) { /* not a URL */ }
    return [null, null];
}

function observe(req, host, provider) {
    let done = false;
    req.once("response", (res) => {
        if (done) return; done = true;
        const bad = res.statusCode >= 500 || res.statusCode === 429;
        report(provider, host, !bad, bad ? reasonOf(null, res.statusCode) : null);
    });
    // listening for "error" here also means a failed request can never crash
    // the engine through an unhandled "error" event
    req.on("error", (err) => { if (done) return; done = true; report(provider, host, false, reasonOf(err)); });
    return req;
}

let installed = false;
function install({ dir, onChange } = {}) {
    if (installed) return;
    installed = true;
    if (dir) { healthFile = path.join(dir, "cache-provider-health.json"); load(); }
    if (onChange) notify = onChange;
    for (const name of ["https", "http"]) {
        const mod = require(name);
        for (const fn of ["request", "get"]) {
            const orig = mod[fn];
            mod[fn] = function (...args) {
                const [host, p] = hostAndPath(args);
                // media-proxy requests are counted for their vendor (track())
                const provider = p && p.startsWith("/functions/v1/media-proxy") ? null : providerForHost(host);
                if (provider && resting(host)) {
                    const req = orig.apply(this, args);
                    const err = Object.assign(new Error(`${provider.label} isn't answering; trying again later`), { code: "EPROVIDERCOOLING" });
                    process.nextTick(() => req.destroy(err));
                    return observe(req, host, provider);
                }
                const req = orig.apply(this, args);
                return provider ? observe(req, host, provider) : req;
            };
        }
    }
}

// For requests through the media proxy: count the outcome for the vendor.
function track(vendor, promise) {
    const provider = BY_ID.get(VENDOR_ALIAS[vendor] || vendor);
    if (!provider) return promise;
    return promise.then((v) => { report(provider, null, true); return v; }, (err) => {
        // a vendor answering "not found" or "over quota" isn't the vendor being down
        const status = err && (err.statusCode || (/HTTP (\d{3})/.exec(String(err.message)) || [])[1]);
        const reason = err && err.quotaExceeded ? "quota" : reasonOf(err, Number(status) || 0);
        if (!(Number(status) >= 400 && Number(status) < 500 && Number(status) !== 429) || err.quotaExceeded) report(provider, null, false, reason);
        throw err;
    });
}

// A feature fell back to a copy it saved earlier, because a refresh failed.
function servedSaved(savedAt) {
    const call = als.getStore();
    if (!call) return;
    const t = Number(savedAt) || 0;
    call.savedAt = call.savedAt ? Math.min(call.savedAt, t || call.savedAt) : (t || Date.now());
}

// Runs one interface call, watching which providers it touches.
function runCall(fn) {
    const call = { providers: new Map(), savedAt: null };
    return als.run(call, async () => {
        const value = await fn();
        return wrapResult(value, call);
    });
}

// The answer keeps its own shape. When something went wrong (or a saved copy
// was used), it travels as { [META]: meta, value }; preload.js unwraps it, and
// only api.js's invokeMeta() sees the meta.
const META = "__riftgateMeta";
function wrapResult(value, call) {
    const failed = [];
    for (const [id, c] of call.providers) if (!c.ok && c.reason) failed.push({ id, label: BY_ID.get(id).label, what: BY_ID.get(id).what, reason: c.reason });
    if (!failed.length && !call.savedAt) return value;
    const meta = { failed, savedAt: call.savedAt || null, offline: failed.length > 0 && failed.every((f) => f.reason === "offline") };
    return { [META]: meta, value };
}

// Everything the interface shows in Settings → Sources.
function status() {
    const now = Date.now();
    return PROVIDERS.map((p) => {
        const h = health[p.id] || {};
        const failing = !!h.lastFailAt && h.lastFailAt > (h.lastOkAt || 0);
        const restingHosts = [...hosts.entries()].filter(([host, s]) => s.restUntil > now && providerForHost(host) === p);
        return {
            id: p.id, label: p.label, what: p.what,
            state: !h.lastOkAt && !h.lastFailAt ? "unused" : failing ? "failing" : "ok",
            reason: failing ? h.reason || "error" : null,
            lastOkAt: h.lastOkAt || null, lastFailAt: h.lastFailAt || null,
            restingUntil: restingHosts.length ? Math.max(...restingHosts.map(([, s]) => s.restUntil)) : null,
        };
    });
}

// Try again: stop backing off everything (or one provider).
function retry(id) {
    for (const [host, s] of hosts) if (!id || (providerForHost(host) || {}).id === id) { s.fails = 0; s.restUntil = 0; s.restMs = REST_MIN_MS; }
}

module.exports = { install, runCall, track, servedSaved, status, retry, providerForHost, reasonOf, META, PROVIDERS };
