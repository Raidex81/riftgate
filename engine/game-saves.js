// Your games' save files, found with the Ludusavi manifest (where thousands
// of games keep their saves; services/save-manifest.js reads it) so backups
// can carry them and put them back. The manifest is downloaded when it's
// first needed and at most once a week after that (only if it changed), and
// kept compressed in the data folder. Only games in your Library are looked
// for; registry saves aren't copied.
//
// In a backup, a save file lives at saves/<game>/<where>/<path>, where
// <where> is the kind of folder it came from (home, winAppData, base = the
// game's install folder…), so it can go back to the same kind of folder on
// another PC.
"use strict";
const { app } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const sm = require("../services/save-manifest");
const data = require("./core/data");
const providers = require("./providers");

const URL = "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml";
const MANIFEST = () => data.file("cache-save-manifest.yaml.gz");
const META = "cache-save-manifest.json";
const FOUND = "cache-game-saves.json";
const WEEK = 7 * 86400e3;
const GAME_MAX = 300 * 1024 ** 2, ALL_MAX = 2 * 1024 ** 3, FILES_MAX = 20000;

// ---- The manifest ------------------------------------------------------------------------------
function download(etag) {
    return new Promise((resolve, reject) => {
        const req = https.get(URL, { headers: { "User-Agent": "RiftgateApp/1.0", "Accept-Encoding": "gzip", ...(etag ? { "If-None-Match": etag } : {}) } }, (res) => {
            if (res.statusCode === 304) { res.resume(); return resolve({ same: true }); }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const chunks = [];
            const body = res.headers["content-encoding"] === "gzip" ? res.pipe(zlib.createGunzip()) : res;
            body.on("data", (c) => chunks.push(c));
            body.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), etag: res.headers.etag || null }));
            body.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(120000, () => req.destroy(new Error("Request timed out")));
    });
}

let idxP = null, releaseTimer = null;
async function manifest({ fresh = false } = {}) {
    if (idxP && !fresh) return idxP;
    idxP = (async () => {
        const meta = data.loadCache(META) || {};
        const have = fs.existsSync(MANIFEST());
        let text = null;
        if (!have || fresh || Date.now() - (meta.at || 0) > WEEK) {
            try {
                const r = await download(have ? meta.etag : null);
                if (r.text) { fs.writeFileSync(MANIFEST(), zlib.gzipSync(r.text)); text = r.text; }
                data.saveCache(META, { at: Date.now(), etag: r.etag || meta.etag || null });
            } catch (err) {
                if (!have) throw new Error("The list of where games keep their saves couldn't be downloaded. Check your connection.");
                providers.servedSaved(meta.at);
            }
        }
        if (!text) text = zlib.gunzipSync(fs.readFileSync(MANIFEST())).toString("utf8");
        return sm.index(text);
    })().catch((err) => { idxP = null; throw err; });
    return idxP;
}

// ---- This PC's folders -------------------------------------------------------------------------
function steamLibraries() {
    const roots = ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam", path.join(process.env.ProgramFiles || "", "Steam")].filter((p, i, a) => p && a.indexOf(p) === i && fs.existsSync(p));
    const libs = new Set(roots.map((r) => path.join(r, "steamapps")));
    for (const r of roots) {
        try {
            const vdf = fs.readFileSync(path.join(r, "steamapps", "libraryfolders.vdf"), "utf8");
            for (const m of vdf.matchAll(/"path"\s*"([^"]*)"/gi)) libs.add(path.join(m[1].replace(/\\\\/g, "\\"), "steamapps"));
        } catch (e) { /* no library list */ }
    }
    return { roots, libs: [...libs].filter((l) => fs.existsSync(l)) };
}
// Where a Steam game is installed, from its appmanifest
function steamInstall(libs, appid) {
    for (const lib of libs) {
        try {
            const acf = fs.readFileSync(path.join(lib, `appmanifest_${appid}.acf`), "utf8");
            const m = /"installdir"\s*"([^"]*)"/i.exec(acf);
            if (m) { const dir = path.join(lib, "common", m[1]); if (fs.existsSync(dir)) return dir; }
        } catch (e) { /* not in this library */ }
    }
    return null;
}

const userDirs = () => ({
    home: [os.homedir()],
    winAppData: [process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")],
    winLocalAppData: [process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")],
    winDocuments: [app.getPath("documents")],
    winProgramData: [process.env.ProgramData || "C:\\ProgramData"],
    winDir: [process.env.windir || "C:\\Windows"],
    winPublic: [process.env.PUBLIC || "C:\\Users\\Public"]
});

const steamIdOf = (g) => { const m = /^steam:\/\/(?:rungameid|run)\/(\d+)/i.exec(g.path || ""); return m ? m[1] : null; };

// The folders a game's patterns can start from on this PC
function placesFor(g, e, steam) {
    const out = { ...userDirs(), base: [], root: steam.roots };
    const dirs = Object.keys((e && e.installDir) || {});
    const id = steamIdOf(g) || (e && e.steam && e.steam.id && String(e.steam.id));
    const fromSteam = id ? steamInstall(steam.libs, id) : null;
    if (fromSteam) out.base.push(fromSteam);
    if (g.path && !/^[a-z]+:\/\//i.test(g.path)) {
        const parts = g.path.split(/[\\/]/);
        // the folder in the game's path named like its install folder, else the folder its program is in
        const at = parts.findIndex((p) => dirs.some((d) => sm.key(d) === sm.key(p)));
        out.base.push(at > 0 ? parts.slice(0, at + 1).join(path.sep) : parts.slice(0, -1).join(path.sep));
    }
    out.base = out.base.filter((b, i, a) => b && a.indexOf(b) === i && fs.existsSync(b));
    return { places: out, installDir: (fromSteam && path.basename(fromSteam)) || dirs[0] || null };
}

// ---- Finding the files -------------------------------------------------------------------------
function walkFiles(dir, prefix, out, cap) {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of list) {
        if (out.length >= cap) return;
        const p = path.join(dir, d.name), r = prefix ? `${prefix}/${d.name}` : d.name;
        if (d.isDirectory()) walkFiles(p, r, out, cap);
        else if (d.isFile()) out.push({ abs: p, rest: r });
    }
}
// One pattern from one starting folder -> [{ abs, rest }] (rest: the path below the starting folder)
function expand(start, segs, cap) {
    let cur = [{ dir: start, rest: "" }];
    for (let i = 0; i < segs.length && cur.length; i++) {
        const seg = segs[i], next = [];
        for (const c of cur) {
            if (seg === "**") {
                const stack = [[c, 0]];
                while (stack.length && next.length < 2000) {
                    const [x, depth] = stack.pop(); next.push(x);
                    if (depth >= 6) continue;
                    let list = []; try { list = fs.readdirSync(x.dir, { withFileTypes: true }); } catch (e) { continue; }
                    for (const d of list) if (d.isDirectory()) stack.push([{ dir: path.join(x.dir, d.name), rest: x.rest ? `${x.rest}/${d.name}` : d.name }, depth + 1]);
                }
            } else if (sm.wild(seg)) {
                const re = sm.segmentRe(seg);
                let list = []; try { list = fs.readdirSync(c.dir); } catch (e) { continue; }
                for (const n of list) if (re.test(n)) next.push({ dir: path.join(c.dir, n), rest: c.rest ? `${c.rest}/${n}` : n });
            } else {
                const p = path.join(c.dir, seg);
                if (fs.existsSync(p)) next.push({ dir: p, rest: c.rest ? `${c.rest}/${seg}` : seg });
            }
        }
        cur = next;
    }
    const files = [];
    for (const c of cur) {
        let st; try { st = fs.statSync(c.dir); } catch (e) { continue; }
        if (st.isFile()) files.push({ abs: c.dir, rest: c.rest });
        else if (st.isDirectory()) walkFiles(c.dir, c.rest, files, cap);
        if (files.length >= cap) break;
    }
    return files;
}

const slug = (s) => sm.key(s).replace(/ /g, "-").slice(0, 60) || "game";
const library = () => (data.readJson(data.file("games.json"), []) || []).filter((g) => g && g.name && (g.category === "game" || g.category === "vr"));

// Every library game's save files: [{ name, slug, bytes, files: [{ abs, zip }], skipped? }]
async function collect({ fresh = false } = {}) {
    if (process.platform !== "win32" && !process.env.RIFTGATE_SAVES_ANY_OS) return [];
    const idx = await manifest({ fresh });
    const steam = steamLibraries();
    const out = [];
    let total = 0, count = 0;
    const seenSlugs = new Set();
    for (const g of library()) {
        const folders = String(g.path || "").split(/[\\/]/).slice(0, -1);
        const e = sm.find(idx, { name: g.name, steamAppId: steamIdOf(g), folders });
        if (!e) continue;
        const { places, installDir } = placesFor(g, e, steam);
        const files = [], seen = new Set();
        let bytes = 0, tooBig = false;
        for (const p of sm.windowsPatterns(e)) {
            const { root, rest } = sm.split(p.pattern, { installDir, userName: os.userInfo().username });
            for (const start of places[root] || []) {
                for (const f of expand(start, rest, FILES_MAX - count)) {
                    if (seen.has(f.abs.toLowerCase())) continue;
                    seen.add(f.abs.toLowerCase());
                    let size = 0; try { size = fs.statSync(f.abs).size; } catch (err) { continue; }
                    if (bytes + size > GAME_MAX || total + size > ALL_MAX) { tooBig = true; continue; }
                    bytes += size; total += size; count++;
                    files.push({ abs: f.abs, root, rest: f.rest, size });
                }
            }
        }
        if (!files.length) continue;
        let s = slug(g.name);
        while (seenSlugs.has(s)) s += "-2";
        seenSlugs.add(s);
        out.push({ name: g.name, slug: s, bytes, tooBig, files: files.map((f) => ({ abs: f.abs, zip: `saves/${s}/${f.root}/${f.rest}`, size: f.size })) });
    }
    data.saveCache(FOUND, { at: Date.now(), games: out.map((x) => ({ name: x.name, files: x.files.length, bytes: x.bytes, tooBig: x.tooBig })) });
    // the manifest is big: let it go a little after it's used
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { idxP = null; }, 2 * 60 * 1000);
    if (releaseTimer.unref) releaseTimer.unref();
    return out;
}

// Where a save from a backup goes on this PC: saves/<slug>/<root>/<rest> -> absolute path, or null
function placeOnThisPc(zipPath, games) {
    const m = /^saves\/([a-z0-9-]+)\/(\w+)\/(.+)$/.exec(zipPath);
    if (!m || !sm.ROOTS.includes(m[2])) return null;
    const rest = m[3].split("/");
    if (rest.some((p) => !p || p === "." || p === "..")) return null;
    let starts;
    if (m[2] === "base" || m[2] === "root") {
        const info = games.find((x) => x.slug === m[1]);
        const g = info && library().find((x) => x.name === info.name);
        if (!g) return null;
        const steam = steamLibraries();
        const { places } = placesFor(g, null, steam);
        starts = places[m[2]];
    } else starts = userDirs()[m[2]];
    if (!starts || !starts[0]) return null;
    const dest = path.join(starts[0], ...rest);
    return path.relative(starts[0], dest).startsWith("..") ? null : dest;
}

function register(ipcMain) {
    ipcMain.handle("r2-saves-status", async () => data.loadCache(FOUND) || null);
    ipcMain.handle("r2-saves-scan", async () => {
        try {
            const found = await collect();
            return { ok: true, at: Date.now(), games: found.map((x) => ({ name: x.name, files: x.files.length, bytes: x.bytes, tooBig: x.tooBig })) };
        } catch (err) { return { ok: false, error: err.message || String(err) }; }
    });
}

module.exports = { register, collect, placeOnThisPc, expand, manifest };
