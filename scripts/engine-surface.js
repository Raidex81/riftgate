// Loads the engine (main.js) with a stand-in Electron and prints everything it
// wires up: IPC channels (handle/on/once), app events, and the modules it
// pulls in. Used to prove a refactor of the engine changes none of it.
//   node scripts/engine-surface.js            -> JSON on stdout
//   node scripts/engine-surface.js --call     -> also calls every handler once
//       with no arguments, the network and child processes cut off, and
//       records how each one ends. A handler that now fails with "x is not
//       defined" lost a dependency in a refactor.
//   node scripts/engine-surface.js --call --check
//                                             -> exit 1 if any handler fails that way
"use strict";
const Module = require("module");
const path = require("path");
const os = require("os");
const fs = require("fs");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-surface-"));
// --seed=<dir>: start from these saved files (old caches, a watchlist…)
const seed = (process.argv.find((a) => a.startsWith("--seed=")) || "").slice(7);
if (seed) for (const f of fs.readdirSync(seed)) fs.copyFileSync(path.join(seed, f), path.join(tmp, f));
const seen = { handle: [], on: [], once: [], appOn: [], appOnce: [], protocols: [], requires: new Set() };

const noop = () => {};
const proxy = (name) => new Proxy(function () {}, {
    get: (t, k) => k === "then" ? undefined : (k === Symbol.toPrimitive ? () => name : proxy(name + "." + String(k))),
    apply: () => proxy(name + "()"),
    construct: () => proxy("new " + name),
});
const listeners = {};
const ipcMain = {
    handle: (c, fn) => { seen.handle.push(c); listeners[c] = fn; }, on: (c) => seen.on.push(c), once: (c) => seen.once.push(c),
    removeHandler: noop, removeAllListeners: noop, handleOnce: (c) => seen.handle.push(c + " (once)"),
};
const app = new Proxy({
    getPath: () => tmp, getVersion: () => "0.0.0-surface", getName: () => "Riftgate", isPackaged: false,
    getAppPath: () => root, whenReady: () => (process.argv.includes("--call") ? new Promise((r) => setImmediate(r)) : new Promise(noop)), on: (e) => { seen.appOn.push(e); return app; },
    once: (e) => { seen.appOnce.push(e); return app; }, requestSingleInstanceLock: () => true,
    setAppUserModelId: noop, commandLine: { appendSwitch: noop }, setLoginItemSettings: noop,
    getLoginItemSettings: () => ({}), quit: noop, exit: noop, disableHardwareAcceleration: noop,
}, { get: (t, k) => (k in t ? t[k] : proxy("app." + String(k))) });
const electron = new Proxy({
    app, ipcMain,
    protocol: new Proxy({ registerSchemesAsPrivileged: (l) => seen.protocols.push(...l.map((x) => x.scheme)) }, { get: (t, k) => (k in t ? t[k] : proxy("protocol." + String(k))) }),
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => String(b) },
}, { get: (t, k) => (k in t ? t[k] : proxy("electron." + String(k))) });
// no network, no child processes: everything outside fails fast
const CALL = process.argv.includes("--call");
const offline = () => { const e = new (require("events").EventEmitter)(); e.setTimeout = () => e; e.end = () => e; e.write = () => true; e.destroy = () => e; e.abort = () => e; setImmediate(() => e.emit("error", Object.assign(new Error("offline (surface test)"), { code: "ENOTFOUND" }))); return e; };
if (CALL) {
    for (const m of ["https", "http"]) { const mod = require(m); mod.get = offline; mod.request = offline; }
    const cp = require("child_process");
    for (const k of ["exec", "execFile", "spawn", "fork"]) cp[k] = () => { const e = new (require("events").EventEmitter)(); e.stdout = e.stderr = new (require("events").EventEmitter)(); e.kill = () => {}; e.unref = () => {}; setImmediate(() => { e.emit("exit", 1); e.emit("close", 1); }); return e; };
    for (const k of ["execSync", "execFileSync", "spawnSync"]) cp[k] = () => { throw new Error("no processes (surface test)"); };
}
const stubs = { electron, "electron-updater": { autoUpdater: proxy("autoUpdater") }, "adm-zip": proxy("AdmZip") };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    if (request.startsWith(".") && parent && parent.filename) {
        const rel = path.relative(root, Module._resolveFilename(request, parent)).split(path.sep).join("/");
        seen.requires.add(path.relative(root, parent.filename).split(path.sep).join("/") + " -> " + rel);
    }
    return origLoad.apply(this, arguments);
};
console.log = console.info = (...a) => process.stderr.write(a.join(" ") + "\n");
// timers would keep the process alive; the surface is what's registered at load
const realSetTimeout = global.setTimeout;
global.setInterval = () => 0; global.setTimeout = (fn, ms) => (CALL && ms <= 1500 ? realSetTimeout(fn, ms) : 0);
// test mode: the engine's own window port, so its sender check lets our calls through
const origJs = Module._extensions[".js"];
Module._extensions[".js"] = function (m, filename) {
    if (CALL && filename.startsWith(root) && !filename.includes("node_modules")) {
        const src = fs.readFileSync(filename, "utf8");
        if (/let localServerPort = null;/.test(src)) { m._compile(src.replace("let localServerPort = null;", "let localServerPort = 47999;").replace(/localServerPort = port;/g, "localServerPort = 47999;"), filename); return; }
    }
    return origJs(m, filename);
};
require(path.join(root, "main.js"));
const out = {
    handle: [...seen.handle].sort(), on: [...seen.on].sort(), once: [...seen.once].sort(),
    appOn: [...seen.appOn].sort(), appOnce: [...seen.appOnce].sort(), protocols: seen.protocols.sort(),
    requires: [...seen.requires].sort(),
};
// what a result looks like, not its values: "array", "{success,games}", "null"...
const shape = (v) => v === null ? "null" : v === undefined ? "undefined" : Array.isArray(v) ? "array" :
    typeof v === "object" ? "{" + Object.keys(v).sort().join(",") + "}" : typeof v;
process.on("uncaughtException", (err) => process.stderr.write("[surface] stray error: " + (err && err.message) + "\n"));
process.on("unhandledRejection", () => {});
(async () => {
    if (CALL) {
        await new Promise((r) => realSetTimeout(r, 1500)); // let startup finish
        out.calls = {};
        const event = { senderFrame: { url: "http://127.0.0.1:47999/index.html" }, sender: { getURL: () => "http://127.0.0.1:47999/index.html", send: () => {} } };
        const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
        for (const c of Object.keys(listeners).sort()) {
            if (only && c !== only) continue;
            let res;
            try {
                res = await Promise.race([Promise.resolve().then(() => listeners[c](event)), new Promise((r) => realSetTimeout(() => r("__timeout"), 4000))]);
                if (res === "__timeout") { out.calls[c] = "timeout"; continue; }
                const meta = res && typeof res === "object" && res.__riftgateMeta;
                if (meta) {
                    out.meta = out.meta || {};
                    out.meta[c] = meta.failed.map((f) => f.id + ":" + f.reason).join(",") + (meta.savedAt ? " saved" : "");
                    res = res.value;
                }
                out.calls[c] = "ok " + shape(res);
            } catch (err) {
                const msg = String(err && err.message || err);
                if (only) process.stderr.write("[surface] " + (err && err.stack) + "\n");
                out.calls[c] = (err && err.name || "Error") + (/is not defined|is not a function|Cannot access/.test(msg) ? ": " + msg : "");
            }
        }
    }
    // --cases=file.json: [[channel, ...args], …] called with those arguments;
    // the whole answer is recorded, to compare two versions of the engine.
    const casesArg = (process.argv.find((a) => a.startsWith("--cases=")) || "").slice(8);
    if (CALL && casesArg) {
        out.cases = {};
        const event = { senderFrame: { url: "http://127.0.0.1:47999/index.html" }, sender: { getURL: () => "http://127.0.0.1:47999/index.html", send: () => {} } };
        for (const [c, ...args] of JSON.parse(fs.readFileSync(casesArg, "utf8"))) {
            const key = c + " " + JSON.stringify(args);
            try {
                let res = await Promise.race([Promise.resolve().then(() => listeners[c](event, ...args)), new Promise((r) => realSetTimeout(() => r("__timeout"), 4000))]);
                if (res && typeof res === "object" && res.__riftgateMeta) res = { value: res.value, failed: res.__riftgateMeta.failed.map((f) => f.id) };
                out.cases[key] = JSON.stringify(res === undefined ? "undefined" : res).slice(0, 400);
            } catch (err) { out.cases[key] = "throws " + (err && err.name) + ": " + String(err && err.message).slice(0, 120); }
        }
    }
    if (process.argv.includes("--check")) {
        const broken = Object.entries(out.calls || {}).filter(([, v]) => /not defined|Cannot access/.test(v));
        if (broken.length) { console.error("engine: handlers that lost a dependency:\n" + broken.map(([c, v]) => `  - ${c}: ${v}`).join("\n")); process.exit(1); }
        console.error(`engine: ${out.handle.length} handlers, all loaded and callable`);
        process.exit(0);
    }
    process.stdout.write(JSON.stringify(out, null, 1) + "\n");
    process.exit(0);
})();
