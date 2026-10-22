// node tests/backup.test.js — engine/backup.js without Electron: a backup made
// on one "PC" (data folder A) restored on another (data folder B).
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const AdmZip = require("adm-zip");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rg-backup-"));
const A = path.join(root, "pc-a", "riftgate"), B = path.join(root, "pc-b", "riftgate"), OUT = path.join(root, "out");
for (const d of [A, B, OUT]) fs.mkdirSync(d, { recursive: true });
let userData = A;
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => userData, getVersion: () => "9.9.9", relaunch() {}, exit() {} }, dialog: {} };
    return origLoad.call(this, req, ...rest);
};
const backup = require("../engine/backup");
const write = (dir, rel, v) => { const p = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v)); };
const read = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"));

// PC A: a library, a Journal, shows, an eBook in the dropzone, covers, settings
const book = path.join(A, "Reading Room Dropzone", "Dune.epub");
write(A, "games.json", [{ name: "Beat Saber", path: "C:\\Games\\Beat Saber.exe", image: "covers/beatsaber.png" }]);
write(A, "r2-data.json", { journal: { "game:1": { status: "playing" }, "book:2": { status: "done" } }, prefs: { "hidden:nexus": ["x"] } });
write(A, "watchlist.json", [{ id: 1, name: "Show" }]);
write(A, "ebooks.json", [{ title: "Dune", path: book, cover: "covers/ebook-1.jpg" }]);
write(A, "r2-wishlist.json", { items: [{ id: 1 }, { id: 2 }] });
write(A, "settings.json", { steamId64: "765", usageId: "a".repeat(32), deviceId: "dev-a", usageStats: true, colorTheme: "ember", autoBackupFolder: "/x" });
write(A, "covers/beatsaber.png", Buffer.alloc(300, 1));
write(A, "covers/ebook-1.jpg", Buffer.alloc(200, 2));
write(A, "covers/downloaded-from-the-web.jpg", Buffer.alloc(900, 3));
write(A, "Reading Room Dropzone/Dune.epub", Buffer.alloc(5000, 4));
write(A, "cache-free-games.json", [1, 2, 3]);
write(A, "session.dat", "secret");

(async () => {
    // what goes in
    const g = backup.gather();
    assert.deepStrictEqual(g.files, ["covers/beatsaber.png", "covers/ebook-1.jpg", "ebooks.json", "games.json", "r2-data.json", "r2-wishlist.json", "settings.json", "watchlist.json"]);
    assert.deepStrictEqual(g.counts, { library: 1, journal: 2, shows: 1, ebooks: 1, wishlist: 2, pictures: 2 });
    assert.ok(backup.gather({ ebooks: true }).files.includes("Reading Room Dropzone/Dune.epub"));

    // a backup without the eBook files
    const small = path.join(OUT, "small.riftgate-backup");
    const r = await backup.create(small);
    assert.ok(r.ok && fs.existsSync(small) && !fs.existsSync(`${small}.part`));
    const names = new AdmZip(small).getEntries().map((e) => e.entryName);
    assert.ok(names.includes("manifest.json"));
    assert.ok(!names.some((n) => /session|cache-|downloaded-from|Dune\.epub/.test(n)), "sign-in, saved lists, web covers and eBook files stay out");
    const savedSettings = JSON.parse(new AdmZip(small).getEntry("files/settings.json").getData().toString());
    assert.strictEqual(savedSettings.usageId, undefined); assert.strictEqual(savedSettings.deviceId, undefined);
    assert.strictEqual(savedSettings.steamId64, "765");

    // one with them
    const big = path.join(OUT, "big.riftgate-backup");
    await backup.create(big, { ebooks: true });
    const seen = backup.inspect(big);
    assert.ok(seen.ok && seen.ebooks && seen.appVersion === "9.9.9" && seen.counts.library === 1);

    // not backups
    write(OUT, "note.riftgate-backup", "hello");
    assert.ok(!backup.inspect(path.join(OUT, "note.riftgate-backup")).ok);
    const other = new AdmZip(); other.addFile("manifest.json", Buffer.from("{\"something\":1}")); other.writeZip(path.join(OUT, "other.riftgate-backup"));
    assert.ok(!backup.inspect(path.join(OUT, "other.riftgate-backup")).ok);

    // PC B: its own settings and a library that the backup replaces
    userData = B;
    write(B, "settings.json", { usageId: "b".repeat(32), deviceId: "dev-b", usageStats: false, launchAtStartup: true, colorTheme: "riftgate" });
    write(B, "games.json", [{ name: "Old game" }]);
    const done = backup.restore(big);
    assert.ok(done.ok, done.error);
    assert.ok(fs.existsSync(path.join(done.kept, "games.json")), "what was there is kept aside");
    assert.strictEqual(read(done.kept, "games.json")[0].name, "Old game");
    assert.strictEqual(read(B, "games.json")[0].name, "Beat Saber");
    assert.strictEqual(read(B, "games.json")[0].path, "C:\\Games\\Beat Saber.exe", "paths outside the data folder stay");
    assert.strictEqual(read(B, "ebooks.json")[0].path, path.join(B, "Reading Room Dropzone", "Dune.epub"), "eBook paths point at this PC's data folder");
    assert.ok(fs.existsSync(path.join(B, "Reading Room Dropzone", "Dune.epub")));
    assert.ok(fs.existsSync(path.join(B, "covers", "beatsaber.png")));
    const s = read(B, "settings.json");
    assert.strictEqual(s.colorTheme, "ember");
    assert.strictEqual(s.steamId64, "765");
    assert.strictEqual(s.usageId, "b".repeat(32)); assert.strictEqual(s.deviceId, "dev-b");
    assert.strictEqual(s.usageStats, false); assert.strictEqual(s.launchAtStartup, true);
    assert.strictEqual(s.autoBackupFolder, "", "this PC's backup folder isn't taken from the backup");
    assert.deepStrictEqual(read(B, "r2-data.json").prefs, { "hidden:nexus": ["x"] });

    // a backup with paths that leave the data folder writes none of them
    const evil = new AdmZip();
    evil.addFile("manifest.json", Buffer.from(JSON.stringify({ riftgateBackup: 1, dataDir: A })));
    evil.addFile("files/games.json", Buffer.from("[]"));
    evil.addFile("files/evil.json", Buffer.from("{}"));
    evil.addFile("files/covers/x.exe", Buffer.from("MZ"));
    evil.addFile("files/Reading Room Dropzone/../../../escape.txt", Buffer.from("x"));
    evil.writeZip(path.join(OUT, "evil.riftgate-backup"));
    // adm-zip may tidy "../" away when writing; check the rule directly too
    for (const bad of ["../x.json", "evil.json", "covers/x.exe", "Reading Room Dropzone/../../x", "covers/../settings.json", "/etc/passwd", "a//b"]) assert.ok(!backup.allowed(bad), bad);
    for (const ok of ["games.json", "covers/a b.jpg", "Reading Room Dropzone/sub/Book.epub", "downloaded-ebooks/x.pdf"]) assert.ok(backup.allowed(ok), ok);
    assert.ok(backup.restore(path.join(OUT, "evil.riftgate-backup")).ok);
    assert.ok(!fs.existsSync(path.join(B, "evil.json")) && !fs.existsSync(path.join(B, "covers", "x.exe")) && !fs.existsSync(path.join(root, "escape.txt")));

    // a Riftgate 1.x .json backup
    write(OUT, "old.json", { riftgateBackup: true, exportedAt: "2025-01-01T00:00:00Z", appVersion: "1.9.0", data: {
        games: [{ name: "Old favourite" }, { name: "Another" }], watchlist: [], settings: { colorTheme: "frost", usageId: "z".repeat(32) },
        ebooks: [{ title: "Emma", path: "C:\\Users\\x\\AppData\\Roaming\\riftgate\\Reading Room Dropzone\\Emma.epub" }] } });
    const legacy = backup.inspect(path.join(OUT, "old.json"));
    assert.ok(legacy.ok && legacy.legacy && legacy.counts.library === 2 && legacy.files === 4, JSON.stringify(legacy));
    assert.ok(backup.restore(path.join(OUT, "old.json")).ok);
    assert.strictEqual(read(B, "games.json")[0].name, "Old favourite");
    assert.strictEqual(read(B, "ebooks.json")[0].path, path.join(B, "Reading Room Dropzone", "Emma.epub"));
    assert.strictEqual(read(B, "settings.json").colorTheme, "frost");
    assert.strictEqual(read(B, "settings.json").usageId, "b".repeat(32));
    write(OUT, "random.json", { hello: 1 });
    assert.ok(!backup.inspect(path.join(OUT, "random.json")).ok);
    assert.strictEqual(backup.repoint("D:\\Games\\Reading Room Dropzone\\x.epub", "", B), undefined, "only Riftgate's own folders are repointed");
    assert.ok(fs.readdirSync(B).filter((n) => n.startsWith("before-restore-")).length <= 3);

    // automatic copies: off, then into a folder, once a day, the last 5 kept
    assert.strictEqual((await backup.autoBackup()).skipped, "off");
    const settings = require("../engine/core/settings");
    const keep = path.join(root, "OneDrive");
    fs.mkdirSync(keep);
    for (let i = 0; i < 6; i++) write(keep, `Riftgate backup 2020-01-0${i + 1} 10.00.riftgate-backup`, "old");
    write(keep, "my notes.txt", "mine");
    settings.update({ autoBackupFolder: keep, lastAutoBackupAt: null });
    const a1 = await backup.autoBackup();
    assert.ok(a1.ok, a1.error);
    assert.strictEqual((await backup.autoBackup()).skipped, "recent");
    const left = fs.readdirSync(keep);
    assert.strictEqual(left.filter((n) => n.endsWith(".riftgate-backup")).length, 5);
    assert.ok(left.includes("my notes.txt"), "other files in the folder are never touched");
    assert.ok(left.includes(path.basename(a1.path)));
    settings.update({ autoBackupFolder: path.join(root, "unplugged") });
    assert.ok((await backup.autoBackup({ force: true })).error);

    fs.rmSync(root, { recursive: true, force: true });
    console.log("backup: ok");
})().catch((err) => { console.error(err); process.exit(1); });
