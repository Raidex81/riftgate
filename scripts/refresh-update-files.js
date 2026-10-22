// After SignPath signs the Windows installer, its bytes have changed, so the
// files the auto-updater checks against have to follow: this rebuilds the
// installer's .blockmap (for small updates) and puts its new size and
// sha512 into latest.yml (electron-updater refuses an installer whose hash
// doesn't match). Used by .github/workflows/release-windows.yml.
//
//   node scripts/refresh-update-files.js dist
"use strict";
const fs = require("fs");
const path = require("path");
const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap");

async function refresh(dir) {
    const version = require("../package.json").version;
    const exe = path.join(dir, `Riftgate-Setup-${version}.exe`);
    const yml = path.join(dir, "latest.yml");
    if (!fs.existsSync(exe)) throw new Error(`${exe} isn't there`);
    if (!fs.existsSync(yml)) throw new Error(`${yml} isn't there`);
    const text = fs.readFileSync(yml, "utf8");
    if ((text.match(/^\s*- url:/gm) || []).length !== 1 || !text.includes(path.basename(exe))) throw new Error("latest.yml doesn't list exactly this installer");

    const { sha512, size } = await buildBlockMap(exe, "gzip", `${exe}.blockmap`);
    const next = text.replace(/^(\s*sha512:\s*).+$/gm, `$1${sha512}`).replace(/^(\s*size:\s*)\d+$/gm, `$1${size}`);
    fs.writeFileSync(yml, next);
    console.log(`latest.yml and ${path.basename(exe)}.blockmap now match the signed installer (${size} bytes)`);
    return { sha512, size };
}

if (require.main === module) {
    refresh(process.argv[2] || "dist").catch((err) => { console.error(err.message || err); process.exit(1); });
}
module.exports = { refresh };
