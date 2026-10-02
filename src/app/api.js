// Riftgate 2 — the bridge to the engine (main process).
// Every call goes through window.riftgate.invoke (preload allowlist). Answers
// are memoised for the session so moving between views is instant; pass
// { fresh: true } to skip the memo (e.g. after a Refresh).

const memo = new Map();
const bridge = () => window.riftgate;

export async function call(channel, ...args) {
    try {
        return await bridge().invoke(channel, ...args);
    } catch (err) {
        console.error(`[r2] ${channel} failed:`, err);
        return null;
    }
}

export function cached(channel, args = [], { fresh = false } = {}) {
    const key = channel + JSON.stringify(args);
    if (!fresh && memo.has(key)) return memo.get(key);
    const p = call(channel, ...args).then((v) => {
        if (v === null) memo.delete(key); // don't remember failures
        return v;
    });
    memo.set(key, p);
    return p;
}

export function forget(prefix) {
    for (const k of [...memo.keys()]) if (k.startsWith(prefix)) memo.delete(k);
}

export function on(channel, fn) {
    try { bridge().on(channel, fn); } catch (err) { /* not an allowed channel */ }
}
export function send(channel, ...args) {
    try { bridge().send(channel, ...args); } catch (err) { /* not allowed */ }
}

// Settings + the user's region (films in cinemas, streaming, prices).
let settingsP = null;
export function settings({ fresh = false } = {}) {
    if (!settingsP || fresh) settingsP = call("load-settings").then((s) => s || {});
    return settingsP;
}
export async function saveSettings(partial) {
    const r = await call("save-settings", partial);
    settingsP = null;
    return r;
}

let countryP = null;
export function country() {
    if (!countryP) {
        countryP = settings().then(async (s) => {
            // `country` is the app-wide region; until the user confirms it
            // (locationConfirmed) the "US" default is a guess, so ask by IP.
            const c = s.country;
            if (c && /^[A-Z]{2}$/.test(c) && (s.locationConfirmed || c !== "US")) return c;
            const ip = await call("get-country-by-ip");
            const code = ip && ip.countryCode;
            return typeof code === "string" && /^[A-Z]{2}$/.test(code) ? code : (c || "US");
        });
    }
    return countryP;
}

export function openExternal(url) {
    if (url && /^https?:\/\//i.test(url)) call("open-external", url);
}
