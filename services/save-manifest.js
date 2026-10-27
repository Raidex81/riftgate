// Riftgate — where games keep their saves, from the Ludusavi manifest
// (github.com/mtkennerly/ludusavi-manifest, MIT; compiled from PCGamingWiki).
// Pure logic: reading the manifest, finding a game in it, and turning its
// path patterns ("<winAppData>/Studio/Game/*.sav") into real places on this
// PC. engine/game-saves.js downloads it and copies the files.


const key = (s) => String(s || "").toLowerCase().replace(/[®™©]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// ---- A small YAML reader, for the manifest's shapes only -----------------------------------------
// Maps, lists, "quoted" and 'quoted' strings, numbers, true/false, {} and [].
function scalar(raw) {
    const s = raw.trim();
    if (s === "{}") return {};
    if (s === "[]") return [];
    if (s.startsWith("\"")) { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
    if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "null" || s === "~") return null;
    return s;
}
// "key": value | key: value  ->  [key, rest]
function splitKey(text) {
    let k, rest;
    if (text.startsWith("\"")) {
        let i = 1;
        while (i < text.length && text[i] !== "\"") { if (text[i] === "\\") i++; i++; }
        k = JSON.parse(text.slice(0, i + 1)); rest = text.slice(i + 1);
    } else if (text.startsWith("'")) {
        let i = 1;
        while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) { if (text[i] === "'") i++; i++; }
        k = text.slice(1, i).replace(/''/g, "'"); rest = text.slice(i + 1);
    } else {
        const c = text.indexOf(":");
        if (c < 0) return null;
        k = text.slice(0, c); rest = text.slice(c);
    }
    if (!rest.startsWith(":")) return null;
    return [k, rest.slice(1).trim()];
}
// lines: [{ indent, text }] -> value
function block(lines, start, indent) {
    if (start >= lines.length || lines[start].indent < indent) return [null, start];
    if (lines[start].text.startsWith("- ") || lines[start].text === "-") {
        const list = [];
        let i = start;
        while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
            const inner = lines[i].text.slice(2);
            if (!inner.trim()) { const [v, next] = block(lines, i + 1, indent + 2); list.push(v); i = next; continue; }
            const kv = splitKey(inner);
            if (kv) {
                // "- os: windows" then more keys of the same map, two spaces further in
                const sub = [{ indent: indent + 2, text: inner }];
                let j = i + 1;
                while (j < lines.length && lines[j].indent >= indent + 2) { sub.push(lines[j]); j++; }
                list.push(block(sub, 0, indent + 2)[0]);
                i = j;
            } else { list.push(scalar(inner)); i++; }
        }
        return [list, i];
    }
    const map = {};
    let i = start;
    while (i < lines.length && lines[i].indent === indent) {
        const kv = splitKey(lines[i].text);
        if (!kv) { i++; continue; }
        const [k, rest] = kv;
        if (rest) { map[k] = scalar(rest); i++; }
        else {
            const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent;
            if (childIndent > indent || (childIndent === indent && lines[i + 1] && lines[i + 1].text.startsWith("- "))) {
                const [v, next] = block(lines, i + 1, childIndent); map[k] = v; i = next;
            } else { map[k] = null; i++; }
        }
    }
    return [map, i];
}
function parseBlock(rawLines) {
    const lines = rawLines.filter((l) => l.trim() && !l.trim().startsWith("#")).map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }));
    return lines.length ? block(lines, 0, lines[0].indent)[0] : null;
}

// ---- The index: every game's name, Steam ids and install folders -> where its entry is ----------
function index(text) {
    const lines = text.split("\n");
    const starts = [];          // [line, name]
    const byName = new Map(), bySteam = new Map(), bySteamExtra = new Map(), byFolder = new Map(), alias = new Map(), byTight = new Map();
    let cur = -1;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l || l === "---") continue;
        if (l[0] !== " ") {
            const kv = splitKey(l);
            if (!kv) continue;
            cur = starts.length;
            starts.push([i, kv[0]]);
            if (!byName.has(key(kv[0]))) byName.set(key(kv[0]), cur);
            const tight = key(kv[0]).replace(/ /g, "");
            if (!byTight.has(tight)) byTight.set(tight, cur);
            continue;
        }
        if (cur < 0) continue;
        if (l === "  steam:") { const m = /^ {4}id: (\d+)/.exec(lines[i + 1] || ""); if (m) bySteam.set(m[1], cur); }
        else if (l === "    steamExtra:") { for (let j = i + 1; /^ {6}- \d+/.test(lines[j] || ""); j++) bySteamExtra.set(lines[j].trim().slice(2), cur); }
        else if (l === "  installDir:") { for (let j = i + 1; /^ {4}\S/.test(lines[j] || ""); j++) { const kv = splitKey(lines[j].trim()); if (kv) byFolder.set(key(kv[0]), cur); } }
        else if (l.startsWith("  alias: ")) alias.set(cur, scalar(l.slice(9)));
    }
    return { lines, starts, byName, byTight, bySteam, bySteamExtra, byFolder, alias };
}
function entry(idx, n, depth = 0) {
    if (n == null || n < 0 || n >= idx.starts.length) return null;
    const [from, name] = idx.starts[n];
    const to = n + 1 < idx.starts.length ? idx.starts[n + 1][0] : idx.lines.length;
    const value = parseBlock(idx.lines.slice(from + 1, to)) || {};
    // an alias points at the game's real entry
    if (value.alias && depth < 2) { const t = idx.byName.get(key(value.alias)); if (t != null) return entry(idx, t, depth + 1); }
    return { name, ...value };
}
// A Riftgate library game -> its manifest entry, or null
// (its own name first, then its Steam id, then a folder it's installed in;
// a game's extra Steam ids only count when the names share a word)
function find(idx, { name, steamAppId, folders = [] }) {
    const id = steamAppId ? String(steamAppId) : null;
    const n = idx.byName.get(key(name));
    if (n != null) return entry(idx, n);
    if (id && idx.bySteam.has(id)) return entry(idx, idx.bySteam.get(id));
    const t = idx.byTight.get(key(name).replace(/ /g, ""));
    if (t != null) return entry(idx, t);
    if (id && idx.bySteamExtra.has(id)) {
        const e = idx.bySteamExtra.get(id);
        const words = new Set(key(name).split(" ").filter((w) => w.length > 2));
        if (key(idx.starts[e][1]).split(" ").some((w) => words.has(w))) return entry(idx, e);
    }
    for (const f of folders) { const m = idx.byFolder.get(key(f)); if (m != null) return entry(idx, m); }
    return null;
}

// ---- Paths ---------------------------------------------------------------------------------------
// The places on Windows a pattern can start from; <base> and <root> come from the game
const ROOTS = ["home", "winAppData", "winLocalAppData", "winDocuments", "winProgramData", "winDir", "winPublic", "base", "root"];
// The files patterns of an entry that apply on Windows: [{ pattern, tags }]
function windowsPatterns(e) {
    const out = [];
    for (const [pattern, spec] of Object.entries((e && e.files) || {})) {
        const when = spec && Array.isArray(spec.when) ? spec.when : null;
        if (when && !when.some((w) => !w || !w.os || w.os === "windows")) continue;
        if (/<(xdgData|xdgConfig)>/.test(pattern) || /^<home>\/(Library|\.)/.test(pattern)) continue;
        const m = /^<(\w+)>/.exec(pattern);
        if (!m || !ROOTS.includes(m[1])) continue;
        // a whole install or store folder is the game itself, not its saves
        if (/^<(base|root)>\/?$/.test(pattern) || /^<base>\/\*\*?$/.test(pattern)) continue;
        out.push({ pattern, root: m[1], tags: spec && Array.isArray(spec.tags) ? spec.tags : [] });
    }
    return out;
}
// "<winAppData>/Studio/<storeUserId>/*.sav" -> { root: "winAppData", rest: ["Studio", "*", "*.sav"] }
function split(pattern, game) {
    const m = /^<(\w+)>\/?(.*)$/.exec(pattern);
    const rest = (m ? m[2] : pattern).replace(/<storeUserId>|<storeGameId>/g, "*").replace(/<osUserName>/g, game.userName || "*")
        .replace(/<game>/g, game.installDir || "*").split("/").filter(Boolean);
    return { root: m ? m[1] : null, rest };
}
// a path segment with * or ? -> a case-insensitive pattern for one name
function segmentRe(seg) {
    return new RegExp("^" + seg.split("").map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("") + "$", "i");
}
const wild = (seg) => /[*?]/.test(seg);

module.exports = { key, parseBlock, index, entry, find, windowsPatterns, split, segmentRe, wild, ROOTS, scalar, splitKey };
