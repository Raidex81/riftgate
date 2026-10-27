// node tests/game-saves.test.js — finding games' save files with a (small)
// Ludusavi manifest, carrying them in a backup and putting them back on
// another "PC".
"use strict";
process.env.RIFTGATE_SAVES_ANY_OS = "1";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const Module = require("module");
const { EventEmitter } = require("events");
const AdmZip = require("adm-zip");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rg-saves-"));
const pcA = path.join(root, "A"), pcB = path.join(root, "B");
let pc = pcA;
const setPc = (dir) => {
    pc = dir;
    process.env.HOME = path.join(dir, "home"); process.env.USERPROFILE = process.env.HOME;
    process.env.APPDATA = path.join(dir, "home", "AppData", "Roaming");
    process.env.LOCALAPPDATA = path.join(dir, "home", "AppData", "Local");
};
setPc(pcA);
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: (k) => (k === "documents" ? path.join(pc, "home", "Documents") : path.join(pc, "riftgate")), getVersion: () => "9.9.9", relaunch() {}, exit() {} }, dialog: {} };
    return origLoad.call(this, req, ...rest);
};
const write = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, v); };

// the manifest, as the server answers it
const MANIFEST = `---
Hollow Knight:
  files:
    "<base>/hollow_knight_Data/Config.ini":
      tags:
        - config
      when:
        - os: windows
        - os: linux
    "<home>/AppData/LocalLow/Team Cherry/Hollow Knight/*.dat":
      tags:
        - save
      when:
        - os: windows
    "<home>/Library/Application Support/unity.Team Cherry.Hollow Knight":
      tags:
        - save
      when:
        - os: mac
  installDir:
    Hollow Knight: {}
  steam:
    id: 367520
"Elden Ring":
  files:
    "<winAppData>/EldenRing/<storeUserId>":
      tags:
        - save
  installDir:
    ELDEN RING: {}
  steam:
    id: 1245620
Klaus:
  alias: Hollow Knight
"No Saves Here":
  steam:
    id: 1
`;
let served = 0, etagAsked = null;
const https = require("https");
https.get = function (url, opts, cb) {
    cb = typeof opts === "function" ? opts : cb;
    served++; etagAsked = opts && opts.headers && opts.headers["If-None-Match"];
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req;
    setImmediate(() => {
        const res = new EventEmitter();
        if (etagAsked === "\"v1\"") { res.statusCode = 304; res.headers = {}; res.resume = () => {}; cb(res); return; }
        res.statusCode = 200; res.headers = { "content-encoding": "gzip", etag: "\"v1\"" };
        res.pipe = (dest) => { setImmediate(() => { dest.end(zlib.gzipSync(MANIFEST)); }); return dest; };
        cb(res);
    });
    return req;
};

const saves = require("../engine/game-saves");
const backup = require("../engine/backup");
backup.useSaves({ collect: () => saves.collect(), placeOnThisPc: (z, g) => saves.placeOnThisPc(z, g) });

(async () => {
    // PC A: two games in the library, their saves where the manifest says
    const hk = path.join(pcA, "Games", "Hollow Knight");
    write(path.join(pcA, "riftgate", "games.json"), JSON.stringify([
        { name: "Hollow Knight", path: path.join(hk, "hollow_knight.exe"), category: "game" },
        { name: "ELDEN RING", path: "steam://rungameid/1245620", category: "game" },
        { name: "Notepad", path: "C:\\\\Windows\\\\notepad.exe", category: "app" }
    ]));
    write(path.join(pcA, "riftgate", "settings.json"), "{}");
    write(path.join(hk, "hollow_knight_Data", "Config.ini"), "vsync=1");
    write(path.join(hk, "hollow_knight.exe"), "MZ");
    write(path.join(pcA, "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "user1.dat"), "progress-A");
    write(path.join(pcA, "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "notes.txt"), "not a save");
    write(path.join(pcA, "home", "AppData", "Roaming", "EldenRing", "76561198000000001", "ER0000.sl2"), "tarnished");

    const found = await saves.collect();
    assert.strictEqual(served, 1, "the manifest is downloaded once");
    const byName = Object.fromEntries(found.map((g) => [g.name, g]));
    assert.deepStrictEqual(byName["Hollow Knight"].files.map((f) => f.zip).sort(), ["saves/hollow-knight/base/hollow_knight_Data/Config.ini", "saves/hollow-knight/home/AppData/LocalLow/Team Cherry/Hollow Knight/user1.dat"]);
    assert.deepStrictEqual(byName["ELDEN RING"].files.map((f) => f.zip), ["saves/elden-ring/winAppData/EldenRing/76561198000000001/ER0000.sl2"], "a folder pattern takes the whole folder; a store user id is any");
    assert.ok(!byName.Notepad, "apps aren't games");

    // a week later only if it changed (304: kept as it is)
    const meta = JSON.parse(fs.readFileSync(path.join(pcA, "riftgate", "cache-save-manifest.json"), "utf8"));
    meta.at = 0; fs.writeFileSync(path.join(pcA, "riftgate", "cache-save-manifest.json"), JSON.stringify(meta));
    await saves.manifest({ fresh: true });
    assert.strictEqual(etagAsked, "\"v1\"");

    // a backup with them
    const file = path.join(root, "b.riftgate-backup");
    const r = await backup.create(file, { gameSaves: true });
    assert.ok(r.ok && r.counts.saves === 2);
    const names = new AdmZip(file).getEntries().map((e) => e.entryName);
    assert.ok(names.includes("saves/hollow-knight/home/AppData/LocalLow/Team Cherry/Hollow Knight/user1.dat"));
    const seen = backup.inspect(file);
    assert.deepStrictEqual(seen.saves.sort(), ["ELDEN RING", "Hollow Knight"]);
    assert.strictEqual((await backup.create(path.join(root, "c.riftgate-backup"), {})).counts.saves, undefined, "only when asked");

    // PC B: Hollow Knight installed somewhere else, an older save already there
    setPc(pcB);
    const hkB = path.join(pcB, "D", "Hollow Knight");
    write(path.join(pcB, "riftgate", "settings.json"), "{}");
    write(path.join(hkB, "hollow_knight.exe"), "MZ");
    write(path.join(pcB, "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "user1.dat"), "progress-B-old");
    // restore without the saves first: they stay as they are
    let done = backup.restore(file);
    assert.ok(done.ok);
    assert.strictEqual(fs.readFileSync(path.join(pcB, "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "user1.dat"), "utf8"), "progress-B-old");
    // the library from the backup points at PC A's install folder, which this PC doesn't have:
    // what goes into a game's install folder is left out, everything else goes back
    fs.renameSync(path.join(pcA, "Games"), path.join(pcA, "Games-gone"));
    done = backup.restore(file, { gameSaves: true });
    assert.ok(done.ok);
    assert.deepStrictEqual(done.saves, { put: 2, skipped: 1 });
    assert.strictEqual(fs.readFileSync(path.join(pcB, "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "user1.dat"), "utf8"), "progress-A");
    assert.ok(!fs.existsSync(path.join(hkB, "hollow_knight_Data", "Config.ini")));
    // once the library knows where the game is on this PC, its install folder works too
    const lib = JSON.parse(fs.readFileSync(path.join(pcB, "riftgate", "games.json"), "utf8"));
    lib[0].path = path.join(hkB, "hollow_knight.exe");
    fs.writeFileSync(path.join(pcB, "riftgate", "games.json"), JSON.stringify(lib));
    assert.strictEqual(saves.placeOnThisPc("saves/hollow-knight/base/hollow_knight_Data/Config.ini", [{ name: "Hollow Knight", slug: "hollow-knight" }]), path.join(hkB, "hollow_knight_Data", "Config.ini"));
    assert.strictEqual(fs.readFileSync(path.join(pcB, "home", "AppData", "Roaming", "EldenRing", "76561198000000001", "ER0000.sl2"), "utf8"), "tarnished");
    assert.strictEqual(fs.readFileSync(path.join(done.kept, "saves", "hollow-knight", "home", "AppData", "LocalLow", "Team Cherry", "Hollow Knight", "user1.dat"), "utf8"), "progress-B-old", "what was there is kept aside");

    // nothing outside the right folders, whatever a backup says
    assert.strictEqual(saves.placeOnThisPc("saves/x/home/../../evil.txt", []), null);
    assert.strictEqual(saves.placeOnThisPc("saves/x/system32/evil.dll", []), null);
    assert.strictEqual(saves.placeOnThisPc("saves/unknown-game/base/a.sav", []), null);

    fs.rmSync(root, { recursive: true, force: true });
    console.log("game-saves: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
