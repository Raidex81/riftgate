// Guides & mods for a game in your Library (services/game-guides.js picks and
// orders them). What this looks up, all free and without keys:
//  * Wikidata, by the game's Steam id: its own wiki, its wiki.gg and Fandom
//    wikis, its PCGamingWiki page, and its mod.io and Thunderstore pages;
//  * Nexus Mods' public list of games (kept a week);
//  * Steam: whether the game has a Workshop.
// What a game has is kept for 30 days, so opening the menu again costs nothing.
"use strict";
const { httpsGetJson, httpsGetJsonPlain } = require("../services/http");
const { normalizeName } = require("../services/alerts");
const guides = require("../services/game-guides");
const data = require("./core/data");

const FILE = "cache-game-guides.json", TTL = 30 * 86400e3, KEEP = 500;
const NEXUS_FILE = "cache-nexus-games.json", NEXUS_TTL = 7 * 86400e3;
const ID_FILE = "cache-steam-ids.json";
const UA = { "User-Agent": "Riftgate/2 (https://github.com/Raidex81/riftgate; game guides)", Accept: "application/sparql-results+json" };

// Wikidata properties: Fandom wiki, wiki.gg wiki, official wiki URL, PCGamingWiki, mod.io, Thunderstore
const PROPS = { P4073: "fandom", P11994: "wikigg", P12203: "official", P6337: "pcgw", P12303: "modio", P13395: "thunderstore" };
async function wikidata(appid) {
    const q = `SELECT ?p ?v WHERE { ?g wdt:P1733 "${appid}" . VALUES ?p { ${Object.keys(PROPS).map((p) => `wdt:${p}`).join(" ")} } ?g ?p ?v . }`;
    const r = await httpsGetJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, UA, 15000);
    const rows = (r && r.results && r.results.bindings) || [];
    const out = { fandom: [], wikigg: [], official: [], pcgw: null, modio: null, thunderstore: null };
    for (const b of rows) {
        const key = PROPS[String(b.p && b.p.value).split("/").pop()];
        const v = b.v && b.v.value;
        if (!key || !v) continue;
        if (Array.isArray(out[key])) { if (!out[key].includes(v)) out[key].push(v); } else if (!out[key]) out[key] = v;
    }
    return out;
}

let nexusP = null;
function nexusGames() {
    const saved = data.loadCache(NEXUS_FILE);
    if (saved && Date.now() - (saved.at || 0) < NEXUS_TTL) return Promise.resolve(saved.games);
    if (!nexusP) nexusP = httpsGetJsonPlain("https://data.nexusmods.com/file/nexus-data/games.json", 20000)
        .then((list) => {
            const games = (Array.isArray(list) ? list : []).filter((g) => g && g.domain_name && g.name && (g.mods || 0) > 0)
                .map((g) => ({ name: g.name, domain_name: g.domain_name, mods: g.mods }));
            data.saveCache(NEXUS_FILE, { at: Date.now(), games });
            return games;
        })
        .catch(() => (saved ? saved.games : []))
        .finally(() => { nexusP = null; });
    return nexusP;
}

async function workshopOf(appid) {
    const r = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, 12000);
    const d = r && r[appid] && r[appid].success ? r[appid].data : null;
    return !!(d && Array.isArray(d.categories) && d.categories.some((c) => c && c.id === 30));
}

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

// What a game has (kept 30 days); a part that couldn't be looked up is tried again next time
async function factsFor(title, appid) {
    const key = appid ? `steam:${appid}` : `name:${normalizeName(title)}`;
    const all = data.loadCache(FILE) || {};
    const saved = all[key];
    if (saved && Date.now() - (saved.at || 0) < TTL && saved.complete) return saved;
    const [wd, workshop, games] = await Promise.all([
        appid ? wikidata(appid).catch(() => undefined) : null,
        appid ? workshopOf(appid).catch(() => undefined) : false,
        nexusGames()
    ]);
    const index = guides.nexusIndex(games);
    const nexus = index.get(guides.norm(title)) || index.get(guides.norm(String(title).replace(/^the /i, ""))) || null;
    const facts = { at: Date.now(), wd: wd === undefined ? (saved && saved.wd) || null : wd, workshop: workshop === undefined ? !!(saved && saved.workshop) : workshop, nexus, complete: wd !== undefined && workshop !== undefined };
    const now = data.loadCache(FILE) || {};
    now[key] = facts;
    const keys = Object.keys(now);
    if (keys.length > KEEP) keys.sort((a, b) => (now[a].at || 0) - (now[b].at || 0)).slice(0, keys.length - KEEP).forEach((k) => delete now[k]);
    data.saveCache(FILE, now);
    return facts;
}

function register(ipcMain) {
    // { best, groups: [{ id, label, links: [{ label, url, note }] }] }
    ipcMain.handle("r2-game-guides", async (event, q = {}) => {
        const title = typeof q.title === "string" ? q.title.trim().slice(0, 200) : "";
        if (!title) return null;
        let appid = /^\d{1,10}$/.test(String(q.steamAppId || "")) ? String(q.steamAppId) : null;
        const lang = typeof q.lang === "string" && /^[a-z]{2}$/.test(q.lang) ? q.lang : "en";
        try { if (!appid) appid = await steamIdFor(title); } catch (e) { /* no Steam id: the rest still works */ }
        const f = await factsFor(title, appid).catch(() => ({}));
        return guides.build({ title, appid, wd: f.wd || null, nexus: f.nexus || null, workshop: !!f.workshop, lang });
    });
}

module.exports = { register };
