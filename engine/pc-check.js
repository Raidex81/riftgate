// "Will it run on this PC?": this PC's graphics card, processor and memory
// against a game's Steam requirements (services/hardware.js compares them).
// The graphics card comes from Chromium's own GPU report and, on Windows,
// from Windows' list of video cards (a laptop's fast card may not be the one
// Riftgate's window runs on, so the fastest one counts). A game's
// requirements are kept for 30 days; a title Riftgate has no Steam id for is
// looked up on Steam's store search once.
"use strict";
const { app } = require("electron");
const os = require("os");
const { execFile } = require("child_process");
const { httpsGetJsonPlain } = require("../services/http");
const { normalizeName } = require("../services/alerts");
const hw = require("../services/hardware");
const data = require("./core/data");
const providers = require("./providers");

const REQ_FILE = "cache-requirements.json", REQ_TTL = 30 * 86400e3, REQ_KEEP = 400;
const ID_FILE = "cache-steam-ids.json";

// ---- This PC ------------------------------------------------------------------------------------
function videoCards() {
    if (process.platform !== "win32") return Promise.resolve([]);
    return new Promise((resolve) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController).Name"],
            { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? [] : String(out || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
    });
}

let pcP = null;
function thisPc() {
    if (!pcP) pcP = (async () => {
        const names = new Set();
        try {
            const info = await app.getGPUInfo("complete");
            const r = hw.gpuFromRenderer(info && info.auxAttributes && info.auxAttributes.glRenderer);
            if (r) names.add(r);
        } catch (e) { /* no GPU report */ }
        (await videoCards()).forEach((n) => names.add(n));
        // the fastest card Riftgate recognises (a laptop has a built-in one too)
        const cards = [...names].filter((n) => !/basic display|remote|virtual|parsec|meta virtual/i.test(n)).map((name) => ({ name, score: hw.gpuScore(name) }));
        cards.sort((a, b) => (b.score || 0) - (a.score || 0));
        const cpus = os.cpus();
        const cpuName = cpus.length ? String(cpus[0].model || "").replace(/\s+/g, " ").replace(/\s*\d+-Core Processor$/i, "").trim() : null;
        return {
            gpu: cards[0] || null,
            cpu: cpuName ? { name: cpuName.replace(/\(R\)|\(TM\)/g, "").replace(/\s+CPU\s+@.*$/i, "").replace(/\s+/g, " ").trim(), score: hw.cpuScore(cpuName), threads: cpus.length } : null,
            ramGb: os.totalmem() / 1024 ** 3
        };
    })().catch((err) => { pcP = null; throw err; });
    return pcP;
}

// ---- A game's requirements ---------------------------------------------------------------------
async function steamIdFor(title) {
    const key = normalizeName(title);
    if (!key) return null;
    const all = data.loadCache(ID_FILE) || {};
    if (key in all) return all[key];
    const r = await httpsGetJsonPlain(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(String(title).slice(0, 80))}&cc=us&l=english`, 10000);
    const hit = ((r && r.items) || []).find((it) => normalizeName(it.name) === key);
    const now = data.loadCache(ID_FILE) || {};
    now[key] = hit ? String(hit.id) : null;
    data.saveCache(ID_FILE, now);
    return now[key];
}

async function requirements(appid) {
    const all = data.loadCache(REQ_FILE) || {};
    const saved = all[appid];
    if (saved && Date.now() - (saved.at || 0) < REQ_TTL) return saved.value;
    try {
        const r = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, 12000);
        const d = r && r[appid] && r[appid].success ? r[appid].data : null;
        const req = d && d.pc_requirements && !Array.isArray(d.pc_requirements) ? d.pc_requirements : null;
        const value = req ? { minimum: req.minimum || "", recommended: req.recommended || "" } : null;
        const now = data.loadCache(REQ_FILE) || {};
        now[appid] = { at: Date.now(), value };
        const keys = Object.keys(now);
        if (keys.length > REQ_KEEP) keys.sort((a, b) => (now[a].at || 0) - (now[b].at || 0)).slice(0, keys.length - REQ_KEEP).forEach((k) => delete now[k]);
        data.saveCache(REQ_FILE, now);
        return value;
    } catch (err) {
        if (saved) { providers.servedSaved(saved.at); return saved.value; }
        throw err;
    }
}

// Extra lines from the requirements worth knowing ("SSD required", 64-bit only)
function notesOf(html) {
    const t = hw.plain(html);
    const out = [];
    if (/ssd required|requires? (an )?ssd/i.test(t)) out.push("Needs an SSD.");
    if (/requires a 64-bit/i.test(t) && process.arch !== "x64" && process.arch !== "arm64") out.push("Needs a 64-bit Windows.");
    return out.join(" ");
}

function register(ipcMain) {
    ipcMain.handle("r2-pc-info", async () => thisPc().catch(() => null));
    // { verdict, parts, weakest, notes, appid } or { verdict: null }
    ipcMain.handle("r2-pc-check", async (event, q = {}) => {
        let appid = /^\d{1,10}$/.test(String(q.steamAppId || "")) ? String(q.steamAppId) : null;
        const title = typeof q.title === "string" ? q.title.trim().slice(0, 200) : "";
        try {
            if (!appid && title) appid = await steamIdFor(title);
            if (!appid) return { verdict: null };
            const [req, pc] = await Promise.all([requirements(appid), thisPc()]);
            if (!req || (!req.minimum && !req.recommended)) return { verdict: null, appid };
            const result = hw.compare(pc, hw.readRequirements(req.minimum), hw.readRequirements(req.recommended));
            return { ...result, notes: notesOf(req.minimum + " " + req.recommended) || null, appid };
        } catch (err) {
            return { verdict: null };
        }
    });
}

module.exports = { register, thisPc };
