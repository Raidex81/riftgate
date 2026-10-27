// Riftgate's backups: everything that is yours (Library, Journal, shows,
// eBooks list, wishlist, alerts, themes, covers you picked, settings) in one
// .riftgate-backup file, and putting it back on this PC or a new one.
// Nothing that Riftgate can fetch again goes in (saved lists, downloaded
// covers), and neither does your sign-in. The eBook files themselves go in
// only when you ask (they can be large).
//
// A backup is a zip: manifest.json plus files/<path in the data folder>.
// Restoring keeps a copy of what was there first (before-restore-<date> in
// the data folder), points eBook paths at this PC's data folder, keeps this
// PC's own ids, and restarts Riftgate.
//
// "Keep a copy automatically": once a day at most, a fresh backup goes into
// a folder you choose (OneDrive, Dropbox, a USB drive…), keeping the last 5.
"use strict";
const { app, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const data = require("./core/data");
const settings = require("./core/settings");
const windowRef = require("./core/window");

const EXT = "riftgate-backup";
const FORMAT = 1;
const USER_FILES = ["r2-data.json", "games.json", "overrides.json", "r2-covers.json", "r2-categories.json", "watchlist.json", "ebooks.json", "settings.json", "r2-themes.json", "r2-alerts.json", "r2-wishlist.json"];
const EBOOK_FOLDERS = ["Reading Room Dropzone", "downloaded-ebooks"];
// settings that belong to this PC, not to you: never taken from a backup
const THIS_PC = ["usageStats", "usageId", "usageLastWeek", "deviceId", "launchAtStartup", "lastSeenVersion", "autoBackupFolder", "autoBackupEbooks", "lastAutoBackupAt"];
// ...and the ids that don't go into a backup at all
const NOT_SAVED = ["usageId", "usageLastWeek", "deviceId"];
const PICTURE_RE = /^covers\/[^/\\]+\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const ALREADY_SMALL = /\.(jpe?g|png|webp|gif|avif|epub|pdf|mobi|azw3?|cbz|cbr|zip|mp3|m4b)$/i;
const AUTO_KEEP = 5;
const AUTO_EVERY = 24 * 3600e3;
const MAX_BACKUP = 3 * 1024 ** 3;

const posix = (p) => p.split(/[\\/]+/).join("/");
const sameStart = (s, dir) => process.platform === "win32" || /^[a-z]:\\/i.test(dir)
    ? s.toLowerCase().startsWith(dir.toLowerCase()) : s.startsWith(dir);

// every string in a JSON value, changed by fn (or seen, when fn returns nothing)
function mapStrings(v, fn) {
    if (typeof v === "string") { const r = fn(v); return r === undefined ? v : r; }
    if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = mapStrings(v[k], fn); return o; }
    return v;
}

// the place inside the data folder a string points at ("covers/x.jpg", or a
// full path into the data folder), as a/b/c -- or null
function inDataFolder(s, dir) {
    if (s.length > 600) return null;
    if (PICTURE_RE.test(s)) return s;
    const root = dir.replace(/[\\/]+$/, "");
    if (!sameStart(s, root) || !/[\\/]/.test(s[root.length] || "")) return null;
    return posix(s.slice(root.length + 1));
}

// a path from a backup that may be written into the data folder
function allowed(rel) {
    if (typeof rel !== "string" || !rel || rel.length > 400 || rel.includes("\0")) return false;
    const parts = rel.split("/");
    if (parts.some((p) => !p || p === "." || p === "..")) return false;
    if (parts.length === 1) return USER_FILES.includes(rel);
    if (PICTURE_RE.test(rel)) return true;
    return EBOOK_FOLDERS.includes(parts[0]);
}

const stamp = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

function listFolder(dir, rel, out) {
    let names = [];
    try { names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch (e) { return; }
    for (const d of names) {
        const r = `${rel}/${d.name}`;
        if (d.isDirectory()) listFolder(dir, r, out);
        else if (d.isFile()) out.add(r);
    }
}

// What a backup made now would hold: { files: [rel], counts, bytes }
function gather({ ebooks = false } = {}) {
    const dir = data.dir();
    const files = new Set();
    const counts = {};
    for (const name of USER_FILES) {
        const p = path.join(dir, name);
        const json = data.readJson(p, undefined);
        if (json === undefined) continue;
        files.add(name);
        if (name === "games.json" && Array.isArray(json)) counts.library = json.length;
        if (name === "watchlist.json" && Array.isArray(json)) counts.shows = json.length;
        if (name === "ebooks.json" && Array.isArray(json)) counts.ebooks = json.length;
        if (name === "r2-data.json" && json && json.journal) counts.journal = Object.keys(json.journal).length;
        if (name === "r2-wishlist.json" && json && Array.isArray(json.items)) counts.wishlist = json.items.length;
        // the covers and eBooks these files point at
        mapStrings(json, (s) => {
            const rel = inDataFolder(s, dir);
            if (!rel || !allowed(rel)) return;
            if (rel.includes("/") && !PICTURE_RE.test(rel) && !ebooks) return;
            if (fs.existsSync(path.join(dir, ...rel.split("/")))) files.add(rel);
        });
    }
    if (ebooks) for (const f of EBOOK_FOLDERS) listFolder(dir, f, files);
    let bytes = 0;
    for (const rel of files) { try { bytes += fs.statSync(path.join(dir, ...rel.split("/"))).size; } catch (e) { files.delete(rel); } }
    counts.pictures = [...files].filter((r) => PICTURE_RE.test(r)).length;
    if (ebooks) counts.ebookFiles = [...files].filter((r) => EBOOK_FOLDERS.includes(r.split("/")[0])).length;
    return { files: [...files].sort(), counts, bytes };
}

// Game saves come from engine/game-saves.js (given by main.js)
let saves = null;

// Writes a backup to target. Resolves to { ok, path, counts, bytes }.
async function create(target, { ebooks = false, gameSaves = false } = {}) {
    const dir = data.dir();
    const { files, counts } = gather({ ebooks });
    if (!files.includes("settings.json") && !files.includes("games.json") && !files.includes("r2-data.json")) return { ok: false, error: "There's nothing to back up yet." };
    const zip = new AdmZip();
    for (const rel of files) {
        let buf = fs.readFileSync(path.join(dir, ...rel.split("/")));
        if (rel === "settings.json") {
            const s = JSON.parse(buf.toString("utf8"));
            for (const k of NOT_SAVED) delete s[k];
            buf = Buffer.from(JSON.stringify(s, null, 2));
        }
        zip.addFile(`files/${rel}`, buf);
        if (ALREADY_SMALL.test(rel)) { const e = zip.getEntry(`files/${rel}`); if (e) e.header.method = 0; }
    }
    // your games' save files, each under saves/<game>/<kind of folder>/<path>
    let savedGames = [];
    if (gameSaves && saves) {
        const found = await saves.collect().catch((err) => { console.error("[backup] game saves:", err.message || err); return []; });
        for (const g of found) {
            const ok = [];
            for (const f of g.files) {
                try { zip.addFile(f.zip, fs.readFileSync(f.abs)); ok.push(f); } catch (err) { /* in use or gone: skipped */ }
            }
            if (ok.length) savedGames.push({ name: g.name, slug: g.slug, files: ok.length, bytes: ok.reduce((n, f) => n + (f.size || 0), 0) });
        }
        if (savedGames.length) counts.saves = savedGames.length;
    }
    const manifest = { riftgateBackup: FORMAT, appVersion: app.getVersion(), createdAt: new Date().toISOString(), platform: process.platform, dataDir: dir, ebooks: !!ebooks, counts, files, saves: savedGames.length ? { games: savedGames } : undefined };
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    const tmp = `${target}.part`;
    await zip.writeZipPromise(tmp);
    fs.renameSync(tmp, target);
    return { ok: true, path: target, counts, bytes: fs.statSync(target).size };
}

// Opens a backup: { manifest, entries: [{ rel, read() }] }. Also takes the
// .json backups Riftgate 1.x made (library, settings, shows and eBooks list).
const LEGACY = { games: "games.json", settings: "settings.json", overrides: "overrides.json", watchlist: "watchlist.json", ebooks: "ebooks.json" };
function open(file) {
    if (!file || fs.statSync(file).size > MAX_BACKUP) throw new Error("too large");
    const head = Buffer.alloc(2);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
    if (head.toString() !== "PK") {
        const old = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!old || old.riftgateBackup !== true || !old.data || typeof old.data !== "object") return null;
        const entries = Object.keys(LEGACY).filter((k) => old.data[k] !== undefined).map((k) => ({ rel: LEGACY[k], read: () => Buffer.from(JSON.stringify(old.data[k])) }));
        const d = old.data;
        const counts = { library: Array.isArray(d.games) ? d.games.length : 0, shows: Array.isArray(d.watchlist) ? d.watchlist.length : 0, ebooks: Array.isArray(d.ebooks) ? d.ebooks.length : 0 };
        return { manifest: { riftgateBackup: FORMAT, createdAt: old.exportedAt, appVersion: old.appVersion, counts, legacy: true }, entries };
    }
    const zip = new AdmZip(file);
    const m = zip.getEntry("manifest.json");
    const manifest = m ? JSON.parse(m.getData().toString("utf8")) : null;
    if (!manifest || typeof manifest.riftgateBackup !== "number") return null;
    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.startsWith("files/") && allowed(e.entryName.slice(6)))
        .map((e) => ({ rel: e.entryName.slice(6), read: () => e.getData() }));
    const saveEntries = zip.getEntries().filter((e) => !e.isDirectory && /^saves\/[a-z0-9-]+\/\w+\/./.test(e.entryName) && !e.entryName.split("/").some((p) => p === ".." || p === "."))
        .map((e) => ({ zip: e.entryName, read: () => e.getData() }));
    return { manifest, entries, saveEntries };
}

// Reads a backup's manifest without changing anything.
function inspect(file) {
    let b;
    try { b = open(file); } catch (err) {
        return { ok: false, error: err.message === "too large" ? "That file is too large to be a Riftgate backup." : "That backup couldn't be read. It may be damaged or not a Riftgate backup." };
    }
    if (!b) return { ok: false, error: "That isn't a Riftgate backup." };
    const m = b.manifest;
    if (m.riftgateBackup > FORMAT) return { ok: false, error: "That backup was made by a newer Riftgate. Update Riftgate first." };
    if (!b.entries.length) return { ok: false, error: "That backup is empty." };
    const savedGames = m.saves && Array.isArray(m.saves.games) ? m.saves.games.map((g) => String(g.name || "")).filter(Boolean).slice(0, 200) : [];
    return { ok: true, path: file, name: path.basename(file), createdAt: m.createdAt || null, appVersion: m.appVersion || null, ebooks: !!m.ebooks, legacy: !!m.legacy, counts: m.counts || {}, files: b.entries.length, saves: (b.saveEntries || []).length ? savedGames : [] };
}

// a path into the backup's data folder (or, for old backups, into any
// Riftgate data folder's eBook folders), pointed at this PC's data folder
function repoint(s, oldDir, dir) {
    if (s.length > 600 || !/[\\/]/.test(s)) return undefined;
    if (oldDir && sameStart(s, oldDir) && /[\\/]/.test(s[oldDir.length] || "")) return path.join(dir, ...s.slice(oldDir.length + 1).split(/[\\/]+/));
    if (sameStart(s, dir)) return undefined;
    const m = /[\\/](Reading Room Dropzone|downloaded-ebooks)[\\/](.+)$/.exec(s);
    return m && /[\\/]riftgate[\\/]?$/i.test(s.slice(0, m.index + 1)) ? path.join(dir, m[1], ...m[2].split(/[\\/]+/)) : undefined;
}

// Puts a backup back. The current files are kept in before-restore-<date>
// first. With gameSaves, the games' save files go back too (a save already
// there is kept aside first, in before-restore-<date>/saves). Resolves to
// { ok, kept, saves: { put, skipped } } (the caller restarts Riftgate).
function restore(file, { gameSaves = false } = {}) {
    const seen = inspect(file);
    if (!seen.ok) return seen;
    const dir = data.dir();
    const { manifest, entries, saveEntries } = open(file);
    const oldDir = typeof manifest.dataDir === "string" ? manifest.dataDir.replace(/[\\/]+$/, "") : "";

    // 1. what's here now, kept aside
    const kept = path.join(dir, `before-restore-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`);
    fs.mkdirSync(kept, { recursive: true });
    for (const name of USER_FILES) { try { fs.copyFileSync(path.join(dir, name), path.join(kept, name)); } catch (e) { /* not there yet */ } }
    pruneKept(dir);

    // 2. the backup's files, with paths into the old data folder pointed here
    const here = settings.read();
    for (const e of entries) {
        const dest = path.join(dir, ...e.rel.split("/"));
        if (path.relative(dir, dest).startsWith("..")) continue;
        const buf = e.read();
        if (e.rel.endsWith(".json")) {
            let json;
            try { json = JSON.parse(buf.toString("utf8")); } catch (err) { continue; }
            if (oldDir !== dir) json = mapStrings(json, (s) => repoint(s, oldDir, dir));
            if (e.rel === "settings.json") {
                for (const k of THIS_PC) { if (here[k] === undefined) delete json[k]; else json[k] = here[k]; }
            }
            data.writeJson(dest, json);
            continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
    }

    // 3. the games' save files, into this PC's own folders
    const put = { put: 0, skipped: 0 };
    if (gameSaves && saves && saveEntries && saveEntries.length) {
        const games = manifest.saves && Array.isArray(manifest.saves.games) ? manifest.saves.games : [];
        for (const e of saveEntries) {
            const dest = saves.placeOnThisPc(e.zip, games);
            if (!dest) { put.skipped++; continue; }
            try {
                if (fs.existsSync(dest)) {
                    const aside = path.join(kept, ...e.zip.split("/"));
                    fs.mkdirSync(path.dirname(aside), { recursive: true });
                    fs.copyFileSync(dest, aside);
                }
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, e.read());
                put.put++;
            } catch (err) { put.skipped++; }
        }
    }
    return { ok: true, kept, saves: put };
}

// keep the three newest before-restore copies
function pruneKept(dir) {
    try {
        const old = fs.readdirSync(dir).filter((n) => n.startsWith("before-restore-")).sort().reverse().slice(3);
        for (const n of old) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
    } catch (e) { /* fine */ }
}

// ---- Keep a copy automatically ------------------------------------------------------
const AUTO_RE = new RegExp(`^Riftgate backup .+\\.${EXT}$`);
async function autoBackup({ force = false } = {}) {
    const s = settings.read();
    const folder = s.autoBackupFolder;
    if (!folder) return { ok: false, skipped: "off" };
    if (!force && s.lastAutoBackupAt && Date.now() - s.lastAutoBackupAt < AUTO_EVERY) return { ok: false, skipped: "recent" };
    if (!fs.existsSync(folder)) return { ok: false, error: "The folder for automatic backups can't be found. Is the drive connected?" };
    const r = await create(path.join(folder, `Riftgate backup ${stamp()}.${EXT}`), { ebooks: !!s.autoBackupEbooks, gameSaves: s.backupGameSaves !== false });
    if (!r.ok) return r;
    settings.update({ lastAutoBackupAt: Date.now() });
    try {
        const mine = fs.readdirSync(folder).filter((n) => AUTO_RE.test(n)).sort().reverse();
        for (const n of mine.slice(AUTO_KEEP)) fs.unlinkSync(path.join(folder, n));
    } catch (e) { /* the copies stay */ }
    return r;
}

function status() {
    const s = settings.read();
    return { folder: s.autoBackupFolder || "", ebooks: !!s.autoBackupEbooks, gameSaves: s.backupGameSaves !== false, lastAt: s.lastAutoBackupAt || null, now: gather({ ebooks: false }), ebookBytes: gather({ ebooks: true }).bytes };
}

function register(ipcMain, deps = {}) {
    saves = deps.saves || null;
    ipcMain.handle("r2-backup-status", async () => status());
    ipcMain.handle("r2-backup-create", async (event, opts = {}) => {
        const r = await dialog.showSaveDialog(windowRef.get(), {
            title: "Back up Riftgate",
            defaultPath: path.join(app.getPath("documents"), `Riftgate backup ${stamp()}.${EXT}`),
            filters: [{ name: "Riftgate backup", extensions: [EXT] }]
        });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        try { return await create(r.filePath, { ebooks: !!(opts && opts.ebooks), gameSaves: !!(opts && opts.gameSaves) }); } catch (err) { return { ok: false, error: `The backup couldn't be saved: ${err.message || err}` }; }
    });
    ipcMain.handle("r2-backup-pick", async () => {
        const r = await dialog.showOpenDialog(windowRef.get(), { title: "Restore from a backup", properties: ["openFile"], filters: [{ name: "Riftgate backup", extensions: [EXT, "json"] }] });
        if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
        return inspect(r.filePaths[0]);
    });
    ipcMain.handle("r2-backup-restore", async (event, file, opts = {}) => {
        let r;
        try { r = restore(String(file || ""), { gameSaves: !!(opts && opts.gameSaves) }); } catch (err) { r = { ok: false, error: `Restoring stopped: ${err.message || err}. What you had is in the before-restore folder.` }; }
        if (r.ok) setTimeout(() => { app.relaunch(); app.exit(0); }, 700);
        return r;
    });
    ipcMain.handle("r2-backup-auto-folder", async (event, opts = {}) => {
        if (opts && opts.off) { settings.update({ autoBackupFolder: "" }); return status(); }
        if (opts && typeof opts.ebooks === "boolean") { settings.update({ autoBackupEbooks: opts.ebooks }); return status(); }
        if (opts && typeof opts.gameSaves === "boolean") { settings.update({ backupGameSaves: opts.gameSaves }); return status(); }
        const r = await dialog.showOpenDialog(windowRef.get(), { title: "Keep Riftgate backups in…", properties: ["openDirectory", "createDirectory"] });
        if (r.canceled || !r.filePaths[0]) return status();
        settings.update({ autoBackupFolder: r.filePaths[0], lastAutoBackupAt: null });
        await autoBackup({ force: true }).catch(() => {});
        return status();
    });
    // once a day, a little after Riftgate opens (and every few hours while it runs)
    const tick = () => autoBackup().catch((err) => console.error("[backup] automatic copy failed:", err.message || err));
    setTimeout(tick, 3 * 60 * 1000);
    setInterval(tick, 6 * 3600e3);
}

module.exports = { register, gather, create, inspect, restore, autoBackup, allowed, repoint, useSaves: (x) => { saves = x; } };
