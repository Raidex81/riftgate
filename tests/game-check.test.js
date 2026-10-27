// node tests/game-check.test.js — "Will it run on this PC?" (services/hardware.js
// on Steam's real requirements) and "Buy now or wait?" (engine/prices.js).
"use strict";
const assert = require("assert");
const path = require("path");
const Module = require("module");
const hw = require("../services/hardware");
const REQ = require("./fixtures/steam-requirements.json");

// graphics cards and processors, roughly in the right order
const g = hw.gpuScore, c = hw.cpuScore;
assert.ok(g("NVIDIA GeForce RTX 4070 Ti SUPER") > g("NVIDIA GeForce RTX 4070 Ti") && g("NVIDIA GeForce RTX 4070 Ti") > g("NVIDIA GeForce RTX 4070"));
assert.ok(g("GeForce GTX 1060 6GB") > g("NVIDIA GEFORCE GTX 1060 3 GB"));
assert.ok(g("NVIDIA GeForce RTX 4060 Laptop GPU") < g("NVIDIA GeForce RTX 4060"), "a laptop's chip is slower");
assert.strictEqual(g("AMD Radeon RX 580 8GB"), g("GeForce GTX 1060 6GB"));
assert.ok(g("Intel(R) UHD Graphics 630") < 30 && g("AMD Radeon 780M Graphics") > g("Intel(R) Iris(R) Xe Graphics"));
assert.strictEqual(g("Microsoft Basic Display Adapter"), null);
assert.strictEqual(c("INTEL CORE I5-8400"), 100);
assert.ok(c("Intel(R) Core(TM) i7-12700K CPU @ 3.60GHz") > c("Core i7-6700") && c("Core i7-6700") > c("Intel Core i3-3240"));
assert.ok(c("12th Gen Intel(R) Core(TM) i5-1235U") > c("Intel Core i5-3470"), "a laptop's 12th generation is newer than a 3rd");
assert.ok(c("AMD Ryzen 7 7800X3D 8-Core Processor") > c("AMD Ryzen 7 7700X 8-Core Processor"));
assert.strictEqual(c("Intel Xeon E5-2680"), null, "too varied to guess");
assert.strictEqual(hw.gpuFromRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER (0x00002705) Direct3D11 vs_5_0 ps_5_0, D3D11)"), "NVIDIA GeForce RTX 4070 Ti SUPER");
assert.strictEqual(hw.ramGb("12 GB RAM"), 12); assert.strictEqual(hw.ramGb("512 MB RAM"), .5);

// Steam's requirements, read
const cp = { min: hw.readRequirements(REQ["1091500"].minimum), rec: hw.readRequirements(REQ["1091500"].recommended) };
assert.strictEqual(cp.min.gpu.text, "GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380");
assert.strictEqual(cp.min.gpu.score, g("Arc A380"), "any of the cards will do: the slowest sets the bar");
assert.strictEqual(cp.min.ram.gb, 12);
assert.ok(cp.rec.cpu.score && cp.rec.gpu.score);

// three PCs
const pc = (gpu, cpu, ram) => ({ gpu: { name: gpu, score: g(gpu) }, cpu: { name: cpu, score: c(cpu) }, ramGb: ram });
const mine = pc("NVIDIA GeForce RTX 4070 Ti SUPER", "AMD Ryzen 7 7800X3D", 31.8);
const old = pc("GeForce GTX 960", "Intel Core i5-4460", 8);
const mid = pc("GeForce GTX 1660 Super", "AMD Ryzen 5 3600", 16);
const run = (p, id) => hw.compare(p, hw.readRequirements(REQ[id].minimum), hw.readRequirements(REQ[id].recommended));
assert.strictEqual(run(mine, "1091500").verdict, "great");
assert.strictEqual(run(mine, "1245620").verdict, "great");
assert.strictEqual(run(old, "367520").verdict, "great", "Hollow Knight runs anywhere");
const er = run(old, "1245620");
assert.strictEqual(er.verdict, "below");
assert.deepStrictEqual(er.parts.map((p) => [p.id, p.state]), [["gpu", "below"], ["cpu", "below"], ["ram", "below"]]);
assert.strictEqual(run(mid, "1245620").verdict, "ok", "meets the minimum, not the recommended");
assert.strictEqual(run(pc("Some Unknown GPU", "Intel Xeon", 16), "367520").verdict, "unknown");
assert.strictEqual(hw.compare(mine, null, null).verdict, null);

// ---- Buy now or wait ------------------------------------------------------------------------
Module._load = ((orig) => function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => require("os").tmpdir() } };
    return orig.call(this, req, ...rest);
})(Module._load);
const prices = require("../engine/prices");
const v = (price, retail, lowest) => prices.verdict({ price, retail, lowest }).verdict;
assert.strictEqual(v(2.99, 14.99, 2.99), "lowest");
assert.strictEqual(v(3.2, 14.99, 2.99), "lowest", "a few cents over is still the lowest");
assert.strictEqual(v(3.7, 14.99, 2.99), "good");
assert.strictEqual(v(9.99, 14.99, 2.99), "wait");
assert.strictEqual(v(14.99, 14.99, 2.99), "full");
assert.strictEqual(v(59.99, 59.99, 59.99), "steady");
assert.strictEqual(v(59.99, 59.99, 56.99), "steady", "it barely ever drops");
assert.strictEqual(prices.verdict({ price: 14.99, retail: 14.99, lowest: 2.99 }).lowestOff, 80);
// the same game on Game Pass and in a store
assert.strictEqual(prices.passKey("Hollow Knight™"), prices.passKey("Hollow Knight"));
assert.strictEqual(prices.passKey("9 Kings (Game Preview)"), prices.passKey("9 Kings"));
assert.strictEqual(prices.passKey("Forza Horizon 5 Standard Edition"), prices.passKey("Forza Horizon 5"));
assert.strictEqual(prices.passKey("Microsoft Flight Simulator (PC)"), prices.passKey("Microsoft Flight Simulator"));
assert.notStrictEqual(prices.passKey("Halo Infinite"), prices.passKey("Halo"));

// the whole answer, from fake CheapShark and Microsoft answers
const { EventEmitter } = require("events");
const https = require("https");
const fs = require("fs"), os = require("os");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-price-"));
const hits = [];
https.get = function (url, opts, cb) {
    cb = typeof opts === "function" ? opts : cb; url = String(url); hits.push(url);
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req; req.end = () => req;
    setImmediate(() => {
        let body = {};
        if (url.includes("games?steamAppID=367520")) body = [{ gameID: "165363", external: "Hollow Knight", thumb: null }];
        else if (url.includes("games?id=165363")) body = { info: { title: "Hollow Knight" }, cheapestPriceEver: { price: "2.99", date: 1712840581 }, deals: [{ storeID: "1", dealID: "abc%3D", price: "14.99", retailPrice: "14.99" }, { storeID: "11", dealID: "def%3D", price: "9.99", retailPrice: "14.99" }] };
        else if (url.includes("/stores")) body = [{ storeID: "1", storeName: "Steam" }, { storeID: "11", storeName: "Humble Store" }];
        else if (url.includes("catalog.gamepass.com")) body = [{ siglId: "x", title: "All PC Games" }, { id: "9NBLGGH4R315" }, { id: "9P8LR42PTRGJ" }];
        else if (url.includes("displaycatalog")) body = { Products: [{ LocalizedProperties: [{ ProductTitle: "Hollow Knight™" }] }, { LocalizedProperties: [{ ProductTitle: "Forza Horizon 5 Standard Edition" }] }] };
        else if (url.includes("games?title=")) body = [];
        const res = new EventEmitter(); res.statusCode = 200; cb(res);
        res.emit("data", JSON.stringify(body)); res.emit("end");
    });
    return req;
};
const handlers = {};
Module._load = ((orig) => function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => tmp } };
    return orig.call(this, req, ...rest);
})(Module._load);
delete require.cache[require.resolve("../engine/prices")];
delete require.cache[require.resolve("../engine/core/data")];
require("../engine/prices").register({ handle: (ch, fn) => { handlers[ch] = fn; } }, { usdRate: async () => 0.9, currencyFor: () => "EUR" });
(async () => {
    const hk = await handlers["r2-price-check"]({}, { title: "Hollow Knight", steamAppId: "367520" });
    assert.strictEqual(hk.price.price, 9.99);
    assert.strictEqual(hk.price.store, "Humble Store");
    assert.strictEqual(hk.price.lowest, 2.99);
    assert.strictEqual(hk.verdict, "wait");
    assert.strictEqual(hk.off, 33);
    assert.deepStrictEqual(hk.money, { currency: "EUR", rate: 0.9 });
    assert.strictEqual(hk.gamePass, true);
    const n = hits.length;
    const again = await handlers["r2-price-check"]({}, { title: "Hollow Knight", steamAppId: "367520" });
    assert.strictEqual(hits.length, n, "kept for 12 hours, and the Game Pass list for a week");
    assert.strictEqual(again.verdict, "wait");
    const fz = await handlers["r2-price-check"]({}, { title: "Forza Horizon 5" });
    assert.strictEqual(fz.price, null); assert.strictEqual(fz.gamePass, true);
    const none = await handlers["r2-price-check"]({}, { title: "Nothing Like It" });
    assert.strictEqual(none.gamePass, false);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("game-check: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
