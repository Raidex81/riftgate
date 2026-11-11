// node tests/steam-ids.test.js — a Steam desktop shortcut dropped on
// Riftgate is the Steam game itself (steam://rungameid/<id>), so its details
// show its achievements and news.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-steamids-"));
const orig = Module._load;
Module._load = function (req, ...rest) { if (req === "electron") return { shell: {} }; return orig.call(this, req, ...rest); };
const win = require("../services/platform/windows");

// a Steam desktop shortcut, as Steam writes it
const url = path.join(tmp, "Dune Awakening.url");
fs.writeFileSync(url, "[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,0\r\n[InternetShortcut]\r\nIDList=\r\nIconIndex=0\r\nURL=steam://rungameid/1172710\r\nIconFile=C:\\Program Files (x86)\\Steam\\steam\\games\\abc.ico\r\n");
const site = path.join(tmp, "A site.url");
fs.writeFileSync(site, "[InternetShortcut]\r\nURL=https://example.com/\r\n");
assert.strictEqual(win.steamIdFromUrlFile(url), "1172710");
assert.strictEqual(win.resolveShortcut(url), "steam://rungameid/1172710", "dropping it adds the game itself");
assert.strictEqual(win.steamIdFromUrlFile(site), null);
assert.strictEqual(win.resolveShortcut(site), site, "any other internet shortcut stays as it is");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("steam-ids: all checks passed");
