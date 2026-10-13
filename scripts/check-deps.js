// Keeps Riftgate's sections independent: fails (exit 1) when code links two
// sections in a way scripts/deps-rules.js doesn't allow.
//
//   node scripts/check-deps.js
//
// What it checks:
//  * engine: which modules require which (services → core → providers →
//    sections → main.js); sections never require each other;
//  * interface: which modules import which (app → components → views →
//    entry); sections (views) never import each other;
//  * IPC: every channel is handled once; everything the interface calls is
//    allowed by preload.js and handled; everything the engine sends to the
//    window is allowed to be heard; no new handler nothing calls;
//  * window events and storage keys shared between files are declared.
"use strict";
const fs = require("fs");
const path = require("path");
const rules = require("./deps-rules");

const root = path.resolve(__dirname, "..");
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const problems = [];
const problem = (msg) => problems.push(msg);

function files(dir, ext = ".js") {
    const out = [];
    const walk = (d) => {
        for (const f of fs.readdirSync(path.join(root, d))) {
            const p = `${d}/${f}`;
            if (fs.statSync(path.join(root, p)).isDirectory()) walk(p);
            else if (p.endsWith(ext)) out.push(p);
        }
    };
    if (fs.existsSync(path.join(root, dir))) walk(dir);
    return out;
}
// comments out of the way, so a "require(...)" in a comment doesn't count.
// Strings stay as they are ("image/*" or "https://…" aren't comments).
function code(src) {
    let out = "", i = 0;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
        if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; continue; }
        if (c === '"' || c === "'" || c === "`") {
            let j = i + 1;
            while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; if (c !== "`" && src[j] === "\n") break; j++; }
            out += src.slice(i, j + 1); i = j + 1; continue;
        }
        // a regex literal after an operator or bracket: copy it whole
        if (c === "/" && /[(,=:[!&|?{};]\s*$/.test(out.slice(-20))) {
            let j = i + 1, inClass = false;
            while (j < src.length && src[j] !== "\n") {
                if (src[j] === "\\") { j += 2; continue; }
                if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
                else if (src[j] === "/" && !inClass) break;
                j++;
            }
            out += src.slice(i, j + 1); i = j + 1; continue;
        }
        out += c; i++;
    }
    return out;
}

// ---- engine ----------------------------------------------------------------------
const engineFiles = ["main.js", "preload.js", ...files("services"), ...files("engine")];
const layerOf = (list, f) => list.find((l) => l.match.test(f));
for (const f of engineFiles) {
    const me = layerOf(rules.engineLayers, f);
    if (!me) { problem(`${f}: not in any engine layer (scripts/deps-rules.js)`); continue; }
    for (const m of code(read(f)).matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
        if (!m[1].startsWith(".")) continue; // built-ins, electron, packages
        let target = rel(path.resolve(path.dirname(path.join(root, f)), m[1]));
        if (fs.existsSync(path.join(root, target)) && fs.statSync(path.join(root, target)).isDirectory()) target += "/index.js";
        else if (!target.endsWith(".js")) target += ".js";
        const them = layerOf(rules.engineLayers, target);
        if (!them) { problem(`${f} requires ${target}, which isn't in any engine layer`); continue; }
        if (them.name === "section" && me.name === "section" && target !== f) {
            problem(`${f} requires ${target}: engine sections never require each other. Pass what's needed in from main.js when registering, or move it to engine/core/.`);
        } else if (them.name !== me.name || me.name === "section") {
            if (them.name !== me.name && !me.mayRequire.includes(them.name)) problem(`${f} (${me.name}) requires ${target} (${them.name}): not allowed`);
        } else if (!me.mayRequire.includes(me.name)) {
            problem(`${f} requires ${target}: ${me.name} modules don't require each other`);
        }
    }
}

// ---- interface -------------------------------------------------------------------
const uiFiles = files("src");
for (const f of uiFiles) {
    const me = layerOf(rules.interfaceLayers, f);
    if (!me) { problem(`${f}: not in any interface layer`); continue; }
    const src = code(read(f));
    const targets = [...src.matchAll(/^\s*import\s[^;]*?from\s*["']([^"']+)["']/gm), ...src.matchAll(/^\s*import\s*["']([^"']+)["']/gm), ...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    for (const t of targets) {
        if (!t.startsWith(".")) continue;
        const target = rel(path.resolve(path.dirname(path.join(root, f)), t));
        const them = layerOf(rules.interfaceLayers, target);
        if (!them) { problem(`${f} imports ${target}, which isn't in any interface layer`); continue; }
        const link = `${f} -> ${target}`;
        if (rules.interfaceExceptions[link]) continue;
        if (them.name === "views" && me.name === "views" && target !== f) problem(`${link}: sections never import each other. Share it through src/app/ or src/components/.`);
        else if (!me.mayImport.includes(them.name)) problem(`${link}: ${me.name} can't import ${them.name}. Add it to interfaceExceptions in scripts/deps-rules.js only if it's on purpose.`);
    }
}
for (const k of Object.keys(rules.interfaceExceptions)) {
    const [a, b] = k.split(" -> ");
    if (!fs.existsSync(path.join(root, a)) || !new RegExp(`["']\\.{1,2}/[^"']*${path.basename(b).replace(".", "\\.")}["']`).test(read(a))) problem(`interfaceExceptions has "${k}", which no longer exists: remove it`);
}

// ---- IPC ---------------------------------------------------------------------------
const pre = read("preload.js");
const setOf = (name) => new Set([...(pre.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`)) || [, ""])[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
const invokable = setOf("INVOKABLE_CHANNELS"), listenable = setOf("LISTENABLE_CHANNELS"), sendable = setOf("SENDABLE_CHANNELS");
const handled = new Map(); // channel -> [file]
for (const f of ["main.js", ...files("engine"), ...files("services")]) {
    for (const m of code(read(f)).matchAll(/ipcMain\.(?:handle|on|once)\(\s*["']([^"']+)["']/g)) {
        handled.set(m[1], [...(handled.get(m[1]) || []), f]);
    }
    // services that register their own handlers (r2-store.js)
    for (const m of code(read(f)).matchAll(/\b(?:handle|ipc\.handle)\(\s*["'](r2-[a-z0-9-]+)["']/g)) if (!handled.has(m[1])) handled.set(m[1], [f]);
}
for (const [c, where] of handled) if (where.length > 1) problem(`IPC "${c}" is handled ${where.length} times (${where.join(", ")}): one section owns each channel`);
const uiSrc = uiFiles.map((f) => code(read(f))).join("\n");
const called = new Set([...uiSrc.matchAll(/\b(?:call|cached|callMeta|invoke|invokeMeta)\(\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]));
for (const c of called) {
    if (!invokable.has(c)) problem(`the interface calls "${c}", which preload.js doesn't allow`);
    if (!handled.has(c)) problem(`the interface calls "${c}", which nothing in the engine handles`);
}
const sent = new Set();
for (const f of ["main.js", ...files("engine")]) {
    for (const m of code(read(f)).matchAll(/(?:\.send|\bsendToRenderer|\br2SendToWindow)\(\s*["']([a-z0-9-]+)["']/g)) sent.add(m[1]);
}
for (const c of sent) if (!listenable.has(c)) problem(`the engine sends "${c}" to the window, but preload.js doesn't let the interface hear it`);
const heard = new Set([...uiSrc.matchAll(/\bon\(\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]));
for (const c of heard) if (!listenable.has(c)) problem(`the interface listens for "${c}", which preload.js doesn't allow`);
for (const m of uiSrc.matchAll(/\bsend\(\s*["']([a-z0-9-]+)["']/g)) if (!sendable.has(m[1])) problem(`the interface sends "${m[1]}", which preload.js doesn't allow`);
const named = (c) => new RegExp(`["'\`]${c}["'\`]`).test(uiSrc);
const unused = [...handled.keys()].filter((c) => !named(c));
if (unused.length > rules.unusedHandlersAllowed) problem(`${unused.length} IPC handlers aren't used by the interface (allowed: ${rules.unusedHandlersAllowed}). A new feature's handler that nothing calls? ${unused.slice(-5).join(", ")}…`);

// ---- window events and storage keys -------------------------------------------------
const fired = new Map(), listened = new Map();
for (const f of uiFiles) {
    const src = code(read(f));
    for (const m of src.matchAll(/new (?:Custom)?Event\(\s*["'](r2-[a-z0-9-]+)["']/g)) fired.set(m[1], [...(fired.get(m[1]) || []), f]);
    for (const m of src.matchAll(/addEventListener\(\s*["'](r2-[a-z0-9-]+)["']/g)) listened.set(m[1], [...(listened.get(m[1]) || []), f]);
}
for (const e of new Set([...fired.keys(), ...listened.keys()])) {
    if (!rules.windowEvents[e]) problem(`window event "${e}" links ${[...new Set([...(fired.get(e) || []), ...(listened.get(e) || [])])].join(", ")} but isn't declared in windowEvents (scripts/deps-rules.js)`);
    else if (!fired.has(e)) problem(`window event "${e}" is listened for but never fired`);
    else if (!listened.has(e)) problem(`window event "${e}" is fired but nothing listens`);
}
for (const e of Object.keys(rules.windowEvents)) if (!fired.has(e) && !listened.has(e)) problem(`windowEvents declares "${e}", which nothing uses any more: remove it`);
const keys = new Map();
for (const f of uiFiles) for (const m of code(read(f)).matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*["'`]([^"'`]+)["'`]/g)) keys.set(m[1], new Set([...(keys.get(m[1]) || []), f]));
for (const [k, where] of keys) if (where.size > 1 && !rules.sharedStorageKeys[k]) problem(`storage key "${k}" is shared by ${[...where].join(", ")} but isn't declared in sharedStorageKeys`);

// ---------------------------------------------------------------------------------------
if (problems.length) {
    console.error(`check-deps: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n` + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
}
console.log(`check-deps: ok (${engineFiles.length} engine and ${uiFiles.length} interface files, ${handled.size} IPC channels, ${fired.size} window events)`);
