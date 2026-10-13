// Release notes and CHANGELOG.md, both made from the in-app changelog
// (src/app/changelog.js + changelog-history.js), so the release page, the
// repository's changelog and "What's new" inside Riftgate always say the
// same thing.
//
//   node scripts/release-notes.js 2.0.2            -> notes for that release (stdout)
//   node scripts/release-notes.js 2.0.2 --sizes assets.json
//                                                  -> same, with file sizes
//                                                     (assets.json: GitHub's
//                                                     release "assets" array)
//   node scripts/release-notes.js --changelog      -> writes CHANGELOG.md
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.resolve(__dirname, "..");
const REPO = "https://github.com/Raidex81/riftgate";

// changelog.js is an ES module for the interface; copy it next to its history
// as .mjs so Node can import it without a build step.
async function loadNotes() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rg-notes-"));
    const fix = (s) => s.replace(/from\s+"\.\/changelog-history\.js"/, 'from "./changelog-history.mjs"');
    fs.writeFileSync(path.join(dir, "changelog.mjs"), fix(fs.readFileSync(path.join(root, "src/app/changelog.js"), "utf8")));
    fs.copyFileSync(path.join(root, "src/app/changelog-history.js"), path.join(dir, "changelog-history.mjs"));
    const mod = await import(pathToFileURL(path.join(dir, "changelog.mjs")).href);
    return { current: mod.CURRENT_NOTES || {}, history: mod.HISTORY || (await import(pathToFileURL(path.join(dir, "changelog-history.mjs")).href)).HISTORY || {} };
}

// "New: x" / "Changed: x" / "Fixed: x" -> grouped; anything else is an intro line.
function group(lines) {
    const out = { intro: [], New: [], Changed: [], Fixed: [] };
    for (const raw of lines) {
        const m = /^(New|Changed|Fixed)(?: for [^:]+)?:\s*(.*)$/s.exec(raw);
        const text = (m ? m[2] : raw).trim();
        const line = text.charAt(0).toUpperCase() + text.slice(1);
        if (!m) out.intro.push(line);
        else out[m[1]].push(raw.startsWith(m[1] + " for ") ? `${raw.slice(m[1].length + 1, raw.indexOf(":"))}: ${line}` : line);
    }
    return out;
}
const end = (s) => (/[.!?]\)?$/.test(s) ? s : s + ".");

function mb(bytes) { return bytes ? ` (${Math.round(bytes / 1048576)} MB)` : ""; }

function releaseNotes(version, lines, assets) {
    const size = (name) => { const a = (assets || []).find((x) => x.name === name); return a ? mb(a.size) : ""; };
    const g = group(lines);
    const parts = [];
    parts.push(`## Riftgate ${version}`, "");
    if (g.intro.length) parts.push(g.intro.map(end).join(" "), "");
    parts.push("### Which file do I download?", "");
    parts.push("| Your computer | Download |", "|---|---|");
    parts.push(`| Windows 10 or 11 | [\`Riftgate-Setup-${version}.exe\`](${REPO}/releases/download/v${version}/Riftgate-Setup-${version}.exe)${size(`Riftgate-Setup-${version}.exe`)} |`);
    parts.push(`| Mac with an Apple chip (M1 or newer) | [\`Riftgate-${version}-arm64.dmg\`](${REPO}/releases/download/v${version}/Riftgate-${version}-arm64.dmg)${size(`Riftgate-${version}-arm64.dmg`)} |`);
    parts.push(`| Mac with an Intel chip | [\`Riftgate-${version}.dmg\`](${REPO}/releases/download/v${version}/Riftgate-${version}.dmg)${size(`Riftgate-${version}.dmg`)} |`);
    parts.push("");
    parts.push("Not sure which Mac you have? Apple menu → **About This Mac**: \"Chip: Apple M…\" means Apple chip, \"Processor: Intel…\" means Intel.");
    parts.push("");
    parts.push("The other files here (`.zip`, `.blockmap`, `latest.yml`, `latest-mac.yml`) are what Riftgate's automatic updates use. You don't need to download them.");
    parts.push("");
    parts.push("**Already have Riftgate on Windows?** You don't need to download anything: Riftgate offers this version by itself, asks before installing, and keeps your library, shows, books and settings.");
    parts.push("");
    parts.push("**Windows first install:** a blue \"Windows protected your PC\" screen may appear the first time. Riftgate isn't digitally signed yet. Click **More info → Run anyway**. It only happens once, because later updates install through the app.");
    parts.push("");
    parts.push("**Mac first install:** open the `.dmg` and drag Riftgate into Applications. The first time, **right-click → Open** (or System Settings → Privacy & Security → **Open Anyway**). If macOS says the app \"is damaged\", run `xattr -cr /Applications/Riftgate.app` in Terminal and open it again. The Mac version can't update itself yet: download the new `.dmg` for each new version. Your library and settings are kept.");
    parts.push("");
    for (const k of ["New", "Changed", "Fixed"]) {
        if (!g[k].length) continue;
        parts.push(`### ${k}`, "", ...g[k].map((l) => `- ${end(l)}`), "");
    }
    parts.push(`Every version's changes: [CHANGELOG.md](${REPO}/blob/main/CHANGELOG.md)`);
    return parts.join("\n") + "\n";
}

const cmpVer = (a, b) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    return 0;
};

// Versions in the in-app history that never had a release of their own.
const NOT_RELEASED = { "1.8.3": "2.0.0" };

function changelog(all) {
    const parts = ["# Changelog", "",
        "Every Riftgate version, newest first. This file is made from the same notes as **What's new** inside Riftgate (`src/app/changelog.js`) by `node scripts/release-notes.js --changelog`, so don't edit it by hand.", "",
        `Downloads for every version are on the [releases page](${REPO}/releases).`, ""];
    for (const v of Object.keys(all).sort(cmpVer)) {
        const g = group(all[v]);
        parts.push(`## ${v}`, "");
        if (NOT_RELEASED[v]) parts.push(`*Never released on its own: these changes shipped in ${NOT_RELEASED[v]}.*`, "");
        if (g.intro.length) parts.push(g.intro.map(end).join(" "), "");
        for (const k of ["New", "Changed", "Fixed"]) if (g[k].length) parts.push(`**${k}**`, "", ...g[k].map((l) => `- ${end(l)}`), "");
    }
    return parts.join("\n").replace(/\n+$/, "\n");
}

(async () => {
    const args = process.argv.slice(2);
    const { current, history } = await loadNotes();
    const all = { ...history, ...current };
    if (args[0] === "--changelog") {
        fs.writeFileSync(path.join(root, "CHANGELOG.md"), changelog(all));
        console.error(`CHANGELOG.md: ${Object.keys(all).length} versions`);
        return;
    }
    const version = (args[0] || require(path.join(root, "package.json")).version).replace(/^v/, "");
    if (!all[version]) { console.error(`No notes for ${version} in src/app/changelog.js`); process.exit(1); }
    const si = args.indexOf("--sizes");
    const assets = si >= 0 ? JSON.parse(fs.readFileSync(args[si + 1], "utf8")) : null;
    process.stdout.write(releaseNotes(version, all[version], assets));
})().catch((err) => { console.error(err); process.exit(1); });
