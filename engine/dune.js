// The Dune: Awakening companion (services/dune.js turns the data into what's
// shown). Everything comes from the Dune: Awakening Community Wiki
// (awakening.wiki, CC BY-NC-SA 4.0): its public API, built from the game's
// files, for weapons and armour, and its pages for dungeons, bosses and
// crafting. It keeps itself up to date with the wiki: the item lists are
// fetched again once a day, and a page Riftgate has read is read again as
// soon as the wiki has a newer edit of it (checked when it's needed, at most
// every six hours). Boss videos come from YouTube, once per boss.
"use strict";
const { httpsGetJson } = require("../services/http");
const dune = require("../services/dune");
const data = require("./core/data");
const providers = require("./providers");

const API = "https://api.awakening.wiki", WIKI_API = "https://awakening.wiki/api.php";
const UA = { "User-Agent": "Riftgate/2 (https://github.com/Raidex81/riftgate; Dune: Awakening companion)", Accept: "application/json" };
const LISTS_FILE = "cache-dune-lists.json", LISTS_TTL = 24 * 3600e3;
const PAGES_FILE = "cache-dune-pages.json", CHECK_EVERY = 6 * 3600e3;
const VIDEO_FILE = "cache-dune-videos.json", VIDEO_V = 3; // 3: boss-fight guides, not first tries or walkthroughs (videos picked before are picked again)

const get = (url) => httpsGetJson(url, UA, 20000).then((r) => { if (r && r.error && !r.query) throw new Error(r.error.info || r.message || "the wiki didn't answer"); return r; });
const wiki = (params) => get(`${WIKI_API}?format=json&formatversion=2&${new URLSearchParams(params).toString()}`);

// ---- Weapons, armour, dungeons (once a day) ------------------------------------------------------
async function listAll(path, fields) {
    const out = [];
    for (let offset = 0; offset < 5000; offset += 1000) {
        const r = await get(`${API}${path}?limit=1000&offset=${offset}${fields ? `&fields=${fields}` : ""}`);
        out.push(...((r && r.list) || []));
        if (!r || !r.pageInfo || r.pageInfo.isLastPage) break;
    }
    return out;
}
async function pagesText(titles) {
    const out = {};
    for (let i = 0; i < titles.length; i += 40) {
        const r = await wiki({ action: "query", prop: "revisions", rvprop: "content|ids|timestamp", rvslots: "main", redirects: "1", titles: titles.slice(i, i + 40).join("|") });
        const pages = (r.query && r.query.pages) || [];
        const back = new Map(((r.query && r.query.redirects) || []).map((x) => [x.to, x.from]));
        for (const p of pages) {
            if (p.missing || !p.revisions) { out[p.title] = null; continue; }
            const rev = p.revisions[0];
            const text = rev.slots && rev.slots.main ? rev.slots.main.content : "";
            out[p.title] = { revid: rev.revid, at: rev.timestamp, text };
            if (back.has(p.title)) out[back.get(p.title)] = out[p.title];
        }
    }
    return out;
}
async function dungeonList() {
    const r = await wiki({ action: "query", list: "categorymembers", cmtitle: "Category:Dungeons", cmlimit: "100" });
    const titles = ((r.query && r.query.categorymembers) || []).filter((m) => m.ns === 0).map((m) => m.title);
    const pages = await pagesText(titles);
    return titles.map((t) => pages[t] && dune.dungeon(t, pages[t].text)).filter(Boolean);
}
let listsP = null;
function lists({ fresh = false } = {}) {
    const saved = data.loadCache(LISTS_FILE);
    if (!fresh && saved && Date.now() - (saved.at || 0) < LISTS_TTL) return Promise.resolve(saved);
    if (!listsP) listsP = (async () => {
        const [w, g, t, items, d] = await Promise.all([listAll("/weapons/"), listAll("/garments/"), listAll("/tools"),
            listAll("/items", "item_id,name,image,item_tags,power_pack_regen,power_pack_maximum_power,unique_schematic"), dungeonList()]);
        const gadgets = [...t, ...items.filter((x) => /UtilityTools\.Power/.test(x.item_tags || ""))].map(dune.gadget).filter(Boolean)
            .sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
        const value = { at: Date.now(), weapons: dune.rankWeapons(w.map(dune.weapon)), garments: g.map(dune.garment).filter(Boolean), gadgets, dungeons: d };
        if (!value.weapons.length) throw new Error("The wiki sent no weapons");
        // where to get each piece: a Unique's schematic drops in the world (its page says where, and how often);
        // the rest are researched with Intel (the Research page says in which tier, for how much)
        const uniques = [...value.weapons, ...value.garments, ...gadgets].filter((x) => x.unique).map((x) => x.name);
        const got = await pagesText(["Research", "Augmentations", "Specializations", ...dune.ARCHETYPES, ...new Set(uniques)]).catch(() => ({}));
        // the five archetypes' skill trees and the Landsraad specializations
        const arch = dune.ARCHETYPES.map((t) => got[t] && dune.skillsOf(t, got[t].text)).filter(Boolean);
        value.archetypes = arch.length ? arch : (saved && saved.archetypes) || [];
        value.specializations = got.Specializations ? dune.specializationsOf(got.Specializations.text) : (saved && saved.specializations) || [];
        value.skillPicks = Object.fromEntries(Object.keys(dune.GOALS).map((g) => [g, dune.skillPicks(value.archetypes, g, 10)]));
        value.goalSpec = Object.fromEntries(Object.entries(dune.GOALS).map(([g, x]) => [g, x.spec]));
        value.research = got.Research ? dune.researchOf(got.Research.text) : (saved && saved.research) || {};
        // the augments the wiki lists, by the weapon family (or armour) they go on
        value.augments = got.Augmentations ? dune.augmentsOf(got.Augmentations.text) : (saved && saved.augments) || [];
        // each weapon and piece of armour: which of those kinds go on it, and the strongest augment among them
        [...value.weapons, ...value.garments].forEach((x) => {
            const kinds = dune.augmentsFor(x, value.augments);
            x.augs = kinds.map((k) => value.augments.indexOf(k));
            const best = dune.bestAugment(kinds.flatMap((k) => k.augments));
            x.bestAug = best ? { name: best.a.name, image: best.a.image, grade: best.grade, score: best.score } : null;
        });
        value.where = {};
        uniques.forEach((n) => { const o = got[n] ? dune.obtainOf(got[n].text) : saved && saved.where && saved.where[n]; if (o) value.where[n] = o; });
        data.saveCache(LISTS_FILE, value);
        return value;
    })().catch((err) => {
        if (saved) { providers.servedSaved(saved.at); return saved; }
        throw err;
    }).finally(() => { listsP = null; });
    return listsP;
}

// ---- Crafting: an item's recipe, down to what you gather ------------------------------------------
// Pages are kept with their edit number; when the wiki has a newer edit, they're read again.
async function pages(names) {
    const all = data.loadCache(PAGES_FILE) || {};
    const now = Date.now();
    const result = {};
    let want = [...new Set(names)];
    for (let depth = 0; depth < 8 && want.length; depth++) {
        const stale = want.filter((n) => !all[n] || now - (all[n].checked || 0) > CHECK_EVERY);
        if (stale.length) {
            // which of them changed on the wiki since they were read (one cheap question for up to 50)
            const changed = [];
            const known = stale.filter((n) => all[n]);
            for (let i = 0; i < known.length; i += 50) {
                const r = await wiki({ action: "query", prop: "revisions", rvprop: "ids", redirects: "1", titles: known.slice(i, i + 50).join("|") }).catch(() => null);
                const revs = new Map(((r && r.query && r.query.pages) || []).map((p) => [p.title, p.revisions ? p.revisions[0].revid : null]));
                known.slice(i, i + 50).forEach((n) => { if (revs.has(n) && revs.get(n) !== all[n].revid) changed.push(n); else if (all[n]) all[n].checked = now; });
            }
            const fetch = [...stale.filter((n) => !all[n]), ...changed];
            if (fetch.length) {
                const got = await pagesText(fetch).catch(() => ({}));
                for (const n of fetch) {
                    const p = got[n];
                    if (p === undefined) continue; // not answered: try again next time
                    all[n] = p ? { revid: p.revid, checked: now, recipes: dune.recipesOf(p.text), where: dune.whereOf(p.text), image: (all[n] && all[n].image) || null } : { revid: null, checked: now, recipes: [], where: null, missing: true };
                }
            }
        }
        const next = [];
        for (const n of want) {
            const p = all[n];
            if (!p) continue;
            result[n] = p;
            const r = dune.pickRecipe(p.recipes, n);
            if (r) r.ingredients.forEach((i) => {
                if (all[i.name] && !all[i.name].image && i.image) all[i.name].image = i.image;
                if (!result[i.name] && !next.includes(i.name)) next.push(i.name);
            });
        }
        want = next;
    }
    for (const n of Object.keys(result)) if (all[n] && all[n].image) result[n] = all[n];
    data.saveCache(PAGES_FILE, all);
    return result;
}

// ---- A boss fight on YouTube ------------------------------------------------------------------------
function register(ipcMain, { youtubeSearch } = {}) {
    // { at, weapons, garments, gadgets, dungeons, research: { name: { tier, cost, prereq } }, augments: [{ title, applies, found, places, augments }], where: { name: { places, exchange, text } } }
    ipcMain.handle("r2-dune-data", async (event, q = {}) => lists({ fresh: !!(q && q.fresh) }).catch((err) => ({ error: err.message || "The wiki couldn't be reached" })));

    // { pages: { name: { recipes, where, image } }, farm: { raw, made, water, time, uncraftable } }
    ipcMain.handle("r2-dune-craft", async (event, wants = []) => {
        const list = (Array.isArray(wants) ? wants : []).filter((w) => w && typeof w.name === "string" && w.name.length < 120).slice(0, 30)
            .map((w) => ({ name: w.name, qty: Math.max(1, Math.min(999, Number(w.qty) || 1)) }));
        if (!list.length) return { pages: {}, farm: null };
        try {
            const p = await pages(list.map((w) => w.name));
            return { pages: p, farm: dune.farmList(list, p) };
        } catch (err) { return { error: err.message || "The wiki couldn't be reached" }; }
    });

    // a boss fight's video: the fight itself, from a guide that shows how to beat it (its title says guide, strategy,
    // how to beat…), never a stream, a blind first try or a walkthrough of the whole dungeon; short and 4-20 minute videos first. Kept; "Not this fight" picks another.
    ipcMain.handle("r2-dune-video", async (event, q = {}) => {
        const boss = typeof q.boss === "string" ? q.boss.slice(0, 80) : "", place = typeof q.place === "string" ? q.place.slice(0, 80) : "";
        if (!boss || !youtubeSearch) return null;
        const all = data.loadCache(VIDEO_FILE) || {};
        const key = `${place}|${boss}`.toLowerCase();
        if (all[key] && all[key].id && all[key].v === VIDEO_V) return all[key];
        const wrong = new Set((all[key] && all[key].wrong) || []);
        const results = [];
        const searches = [[`Dune Awakening ${boss} boss fight guide how to beat`, { duration: "medium" }], [`Dune Awakening ${boss} boss fight strategy`, { duration: "short" }],
            [`Dune Awakening ${place} boss fight guide`, { duration: "medium" }], [`Dune Awakening ${boss} boss fight`, { order: "viewCount" }]];
        let hit = null;
        for (const [query, opts] of searches) {
            results.push(...(await youtubeSearch(query, opts).catch(() => []) || []));
            hit = dune.pickBossVideo(results, { boss, place }, wrong);
            if (hit && hit.score >= 4) break; // a clear guide: no need to look further
        }
        if (hit) { all[key] = { id: hit.id, title: hit.title, channel: hit.channel || "", v: VIDEO_V, wrong: [...wrong] }; data.saveCache(VIDEO_FILE, all); return all[key]; }
        return null;
    });
    ipcMain.handle("r2-dune-video-wrong", async (event, q = {}) => {
        const key = `${q.place || ""}|${q.boss || ""}`.toLowerCase();
        const all = data.loadCache(VIDEO_FILE) || {};
        const cur = all[key] || {};
        all[key] = { wrong: [...new Set([...(cur.wrong || []), String(q.id || "")].filter(Boolean))].slice(-10) };
        data.saveCache(VIDEO_FILE, all);
        return true;
    });
}

module.exports = { register };
