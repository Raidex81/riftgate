// node tests/providers.test.js — engine/providers.js without Electron or a network.
"use strict";
const assert = require("assert");
const https = require("https");
const { EventEmitter } = require("events");

// a fake network: every request fails the way FAIL says, or answers STATUS
let FAIL = null, STATUS = 200, sent = 0;
https.request = https.get = function () {
    sent++;
    const req = new EventEmitter();
    req.setTimeout = () => req; req.end = () => req; req.write = () => true;
    req.destroy = (err) => { req._done = true; setImmediate(() => req.emit("error", err)); return req; };
    setImmediate(() => {
        if (req._done) return;
        if (FAIL) req.emit("error", Object.assign(new Error(FAIL), { code: FAIL }));
        else { const res = new EventEmitter(); res.statusCode = STATUS; req.emit("response", res); }
    });
    return req;
};
const providers = require("../engine/providers");
providers.install({});
const get = (url) => new Promise((resolve) => { const r = https.get(url); r.on("error", (e) => resolve(e.code)); r.on("response", (res) => resolve(res.statusCode)); });

(async () => {
    // hosts belong to the right provider
    assert.strictEqual(providers.providerForHost("api.tvmaze.com").id, "tvmaze");
    assert.strictEqual(providers.providerForHost("overpass.kumi.systems").id, "osm");
    assert.strictEqual(providers.providerForHost("x.supabase.co").id, "riftgate");
    assert.strictEqual(providers.providerForHost("example.com"), null);

    // a call where TVmaze is offline says so, and keeps its answer's shape
    FAIL = "ENOTFOUND";
    let r = await providers.runCall(async () => { await get("https://api.tvmaze.com/shows/1"); return [1, 2]; });
    assert.deepStrictEqual(r.value, [1, 2]);
    assert.deepStrictEqual(r[providers.META].failed.map((f) => f.id + ":" + f.reason), ["tvmaze:offline"]);
    assert.strictEqual(r[providers.META].offline, true);

    // a call where nothing went wrong is untouched
    FAIL = null;
    r = await providers.runCall(async () => { await get("https://api.tvmaze.com/shows/1"); return { ok: 1 }; });
    assert.deepStrictEqual(r, { ok: 1 });

    // a provider that fails then answers within one call isn't reported
    r = await providers.runCall(async () => { FAIL = "ETIMEDOUT"; await get("https://overpass-api.de/a"); FAIL = null; await get("https://overpass.kumi.systems/a"); return []; });
    assert.deepStrictEqual(r, []);

    // a saved copy is reported, with its date
    r = await providers.runCall(async () => { providers.servedSaved(1000); return ["old"]; });
    assert.strictEqual(r[providers.META].savedAt, 1000);

    // 5xx and 429 count as failures, 404 doesn't
    STATUS = 503; r = await providers.runCall(async () => { await get("https://openlibrary.org/x"); return 1; });
    assert.strictEqual(r[providers.META].failed[0].reason, "down");
    STATUS = 404; r = await providers.runCall(async () => { await get("https://gutendex.com/x"); return 1; });
    assert.strictEqual(r, 1);
    STATUS = 200;

    // three network failures in a row: the host rests, and requests fail at once
    FAIL = "ECONNRESET"; // "error" never rests a host
    for (let i = 0; i < 4; i++) await get("https://www.cheapshark.com/api");
    sent = 0; FAIL = null; assert.strictEqual(await get("https://www.cheapshark.com/api"), 200);
    FAIL = "ETIMEDOUT";
    for (let i = 0; i < 3; i++) await get("https://www.gamerpower.com/api");
    FAIL = null; sent = 0;
    assert.strictEqual(await get("https://www.gamerpower.com/api"), "EPROVIDERCOOLING");
    const st = providers.status().find((p) => p.id === "gamerpower");
    assert.strictEqual(st.state, "failing"); assert.ok(st.restingUntil > Date.now());
    // other hosts are unaffected
    assert.strictEqual(await get("https://api.tvmaze.com/x"), 200);
    // Try again clears it
    providers.retry("gamerpower");
    assert.strictEqual(await get("https://www.gamerpower.com/api"), 200);
    assert.strictEqual(providers.status().find((p) => p.id === "gamerpower").state, "ok");

    // media-proxy vendors: a failure counts for the vendor, "not found" doesn't
    await providers.runCall(async () => { try { await providers.track("tmdb", Promise.reject(Object.assign(new Error("HTTP 404"), {}))); } catch (e) {} });
    assert.notStrictEqual(providers.status().find((p) => p.id === "tmdb").state, "failing");
    r = await providers.runCall(async () => { try { await providers.track("tmdb", Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" }))); } catch (e) {} return 0; });
    assert.strictEqual(r[providers.META].failed[0].id, "tmdb");
    console.log("providers: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
