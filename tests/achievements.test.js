// node tests/achievements.test.js — engine/achievements.js without Electron or Steam.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { EventEmitter } = require("events");

// a stand-in Electron: a temporary data folder and a window that records what it's sent
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-ach-"));
const sentToWindow = [];
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => tmp }, safeStorage: { isEncryptionAvailable: () => false } };
    return origLoad.call(this, req, ...rest);
};
// no timers: the background look is called by hand here
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms) => (ms >= 60000 ? 0 : realSetTimeout(fn, ms));
global.setInterval = () => 0;

// Steam's public rarity endpoint, answered by a fake https
const https = require("https");
let RARITY = { ACH_A: 82.4, ACH_B: 12.1, ACH_C: 0.6 }, RARITY_DOWN = false;
https.get = https.request = function (url) {
    const req = new EventEmitter();
    req.setTimeout = () => req; req.end = () => req; req.destroy = (e) => { setImmediate(() => req.emit("error", e)); return req; };
    setImmediate(() => {
        if (RARITY_DOWN) return req.emit("error", Object.assign(new Error("offline"), { code: "ENOTFOUND" }));
        const res = new EventEmitter(); res.statusCode = 200;
        req.emit("response", res);
        const cb = typeof arguments[arguments.length - 1] === "function" ? arguments[arguments.length - 1] : null;
        void cb;
    });
    // httpsGetJsonPlain passes a callback: call it with a response that streams the body
    const cb = [...arguments].find((a) => typeof a === "function");
    if (cb) setImmediate(() => {
        if (RARITY_DOWN) return;
        const res = new EventEmitter(); res.statusCode = 200; cb(res);
        res.emit("data", JSON.stringify({ achievementpercentages: { achievements: Object.entries(RARITY).map(([name, percent]) => ({ name, percent: String(percent) })) } }));
        res.emit("end");
    });
    return req;
};

const settings = require("../engine/core/settings");
const windowRef = require("../engine/core/window");
windowRef.set({ isDestroyed: () => false, webContents: { send: (c, p) => sentToWindow.push([c, p]) } });

// a fake Steam behind the media proxy
let PROFILE = "public", STEAM_DOWN = false, calls = 0;
const unlocked = { ACH_A: 1760000000, ACH_C: 1761000000 };
const SCHEMA = { game: { gameName: "Hollow Tide", availableGameStats: { achievements: [
    { name: "ACH_A", displayName: "First light", description: "Start the journey", icon: "a.jpg", icongray: "a_g.jpg", hidden: 0 },
    { name: "ACH_B", displayName: "Deep water", description: "Reach the depths", icon: "b.jpg", icongray: "b_g.jpg", hidden: 0 },
    { name: "ACH_C", displayName: "The last bell", description: "", icon: "c.jpg", icongray: "c_g.jpg", hidden: 1 }
] } } };
async function steamApi(p, q) {
    calls++;
    if (STEAM_DOWN) throw Object.assign(new Error("offline"), { code: "ENOTFOUND" });
    if (p.includes("GetSchemaForGame")) return q.appid === "999" ? { game: {} } : SCHEMA;
    if (PROFILE === "private") throw Object.assign(new Error("HTTP 403"), { statusCode: 403, body: { playerstats: { error: "Profile is not public", success: false } } });
    if (PROFILE === "proxy-old") throw Object.assign(new Error("This endpoint isn't on the allowlist for this vendor."), { statusCode: 403, body: { error: "This endpoint isn't on the allowlist for this vendor." } });
    return { playerstats: { success: true, achievements: Object.keys(SCHEMA.game.availableGameStats.achievements.reduce((m, a) => (m[a.name] = 1, m), {})).map((k) => ({ apiname: k, achieved: unlocked[k] ? 1 : 0, unlocktime: unlocked[k] || 0 })) } };
}

const handlers = {};
require("../engine/achievements").register({ handle: (c, fn) => { handlers[c] = fn; } }, { steamApi });
const call = (c, ...a) => handlers[c]({}, ...a);

(async () => {
    // no SteamID: says so
    let r = await call("r2-achievements-game", "1000");
    assert.strictEqual(r.state, "no-steamid");

    settings.update({ steamId64: "76561198000000001", steamPlaytimes: { 1000: 120, 999: 30, 1002: 0 } });

    // a game: every achievement, with yours and its rarity
    r = await call("r2-achievements-game", "1000");
    assert.strictEqual(r.state, "ok");
    assert.strictEqual(r.name, "Hollow Tide");
    assert.deepStrictEqual([r.total, r.unlocked], [3, 2]);
    const c = r.items.find((a) => a.id === "ACH_C");
    assert.strictEqual(c.hidden, true); assert.strictEqual(c.achieved, true); assert.strictEqual(c.percent, 0.6);
    assert.strictEqual(c.unlockedAt, 1761000000 * 1000);
    assert.strictEqual(r.items.find((a) => a.id === "ACH_B").achieved, false);

    // the summary: rarest and most recent unlocks
    let s = await call("r2-achievements-summary");
    assert.strictEqual(s.games["1000"].rarest.id, "ACH_C");
    assert.strictEqual(s.recent[0].id, "ACH_C"); assert.strictEqual(s.recent[0].game, "Hollow Tide");

    // within the hour: answered from what's saved, no new request
    calls = 0; await call("r2-achievements-game", "1000"); assert.strictEqual(calls, 0);
    // asking fresh: Steam is asked again
    calls = 0; await call("r2-achievements-game", "1000", { fresh: true }); assert.ok(calls >= 1);

    // a game without achievements
    r = await call("r2-achievements-game", "999");
    assert.strictEqual(r.state, "none");

    // Steam down: the saved copy, still complete
    STEAM_DOWN = true; RARITY_DOWN = true;
    r = await call("r2-achievements-game", "1000", { fresh: true });
    assert.strictEqual(r.state, "ok"); assert.strictEqual(r.unlocked, 2); assert.strictEqual(r.items.find((a) => a.id === "ACH_C").percent, 0.6);
    // ...and a game never seen before: an error, not a crash
    r = await call("r2-achievements-game", "1234");
    assert.strictEqual(r.state, "error");
    STEAM_DOWN = false; RARITY_DOWN = false;

    // a private profile, and a media proxy that doesn't allow achievements yet
    PROFILE = "private";
    r = await call("r2-achievements-game", "1000", { fresh: true });
    assert.strictEqual(r.state, "private");
    PROFILE = "proxy-old";
    r = await call("r2-achievements-game", "1000", { fresh: true });
    assert.strictEqual(r.state, "server-update");
    PROFILE = "public";

    // the background look: only games you've played whose playtime changed
    unlocked.ACH_B = 1762000000;
    settings.update({ steamPlaytimes: { 1000: 150, 999: 30, 1002: 0 } });
    calls = 0; sentToWindow.length = 0;
    s = await call("r2-achievements-sweep");
    assert.strictEqual(s.games["1000"].unlocked, 3, "the new unlock is seen");
    assert.ok(sentToWindow.some(([ch, p]) => ch === "r2-achievements-changed" && p.unlocked === 1), "the window is told about the new unlock");
    calls = 0;
    await call("r2-achievements-sweep");
    assert.strictEqual(calls, 0, "nothing played since: Steam isn't asked again");

    // a private profile stops the look and is remembered
    settings.update({ steamPlaytimes: { 1000: 200 } });
    PROFILE = "private";
    s = await call("r2-achievements-sweep");
    assert.strictEqual(s.state, "private");
    PROFILE = "public";
    // "Check again" (force) looks at every game you've played and clears it
    calls = 0; s = await call("r2-achievements-sweep", { force: true });
    assert.ok(calls >= 1, "check again asks Steam even when nothing was played");
    assert.strictEqual(s.state, null, "the private note goes once Steam answers");

    // nonsense in, nothing out
    assert.strictEqual((await call("r2-achievements-game", "../etc")).state, "none");
    console.log("achievements: all checks passed");
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
