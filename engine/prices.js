// "Buy now or wait?" for a game: its best price right now across the stores
// CheapShark follows, the lowest it has ever been, and a plain verdict; and
// whether it's included with PC Game Pass, so you don't pay for something
// you already have. Prices come in US dollars and are shown in your currency
// (the Deals rate). Each game's answer is kept for 12 hours, the Game Pass
// list for a week.
"use strict";
const { httpsGetJsonPlain } = require("../services/http");
const { findCheapSharkGame, normalizeName } = require("../services/alerts");
const data = require("./core/data");
const settings = require("./core/settings");
const providers = require("./providers");

const PRICE_FILE = "cache-price-check.json", PRICE_TTL = 12 * 3600e3;
const PASS_FILE = "cache-gamepass.json", PASS_TTL = 7 * 86400e3;
const PASS_LIST = "fdd9e2a7-0fee-49f6-ad69-4354098401ff"; // Microsoft's own "All PC games" list
const STORES_FILE = "cache-cheapshark-stores.json", STORES_TTL = 30 * 86400e3;

// The same game across stores: no ™, no "(Game Preview)", no edition name
const EDITIONS = /\b(standard|deluxe|ultimate|gold|premium|definitive|complete|enhanced|anniversary|remastered|game of the year|goty|digital|special|collector'?s)\s+edition\b|\b(for windows( 10| 11)?|pc|windows)\b|\(game preview\)|\(pc\)/g;
function passKey(title) {
    return normalizeName(String(title || "").toLowerCase().replace(/[™®©]/g, "").replace(EDITIONS, " "));
}

// What to say about a price: { verdict, saving, overLowest }
// verdict: "lowest" (at or within a hair of its lowest ever), "good" (close to
// it), "wait" (on sale, but it has been much cheaper), "full" (not on sale,
// and it does go on sale), "steady" (it hardly ever changes price)
function verdict({ price, retail, lowest }) {
    if (!(price >= 0)) return null;
    const off = retail > 0 ? Math.round((1 - price / retail) * 100) : 0;
    if (!(lowest >= 0) || lowest >= price) return { verdict: off > 0 ? "lowest" : "steady", off };
    const over = price - lowest;
    if (over <= Math.max(0.5, price * 0.03)) return { verdict: "lowest", off };
    if (retail > 0 && lowest > retail * 0.9) return { verdict: "steady", off };
    if (price <= lowest * 1.3) return { verdict: "good", off };
    return { verdict: off > 0 ? "wait" : "full", off, lowestOff: retail > 0 ? Math.round((1 - lowest / retail) * 100) : null };
}

async function storeNames() {
    const saved = data.loadCache(STORES_FILE);
    if (saved && Date.now() - (saved.at || 0) < STORES_TTL) return saved.names;
    try {
        const list = await httpsGetJsonPlain("https://www.cheapshark.com/api/1.0/stores", 10000);
        const names = {};
        (Array.isArray(list) ? list : []).forEach((s) => { if (s && s.storeID) names[s.storeID] = s.storeName; });
        data.saveCache(STORES_FILE, { at: Date.now(), names });
        return names;
    } catch (err) { return (saved && saved.names) || {}; }
}

// ---- PC Game Pass ------------------------------------------------------------------
let passLoading = null;
async function gamePass(market) {
    const saved = data.loadCache(PASS_FILE);
    if (saved && saved.market === market && Date.now() - (saved.at || 0) < PASS_TTL) return saved.keys;
    if (passLoading) return passLoading;
    passLoading = (async () => {
        const lang = "en-us";
        const list = await httpsGetJsonPlain(`https://catalog.gamepass.com/sigls/v2?id=${PASS_LIST}&language=${lang}&market=${market}`, 15000);
        const ids = (Array.isArray(list) ? list : []).map((x) => x && x.id).filter((id) => /^[0-9A-Z]{12}$/.test(id || ""));
        if (!ids.length) throw new Error("empty Game Pass list");
        const keys = [];
        for (let i = 0; i < ids.length; i += 100) {
            const r = await httpsGetJsonPlain(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.slice(i, i + 100).join(",")}&market=${market}&languages=${lang}`, 20000);
            for (const p of (r && r.Products) || []) {
                const t = p && p.LocalizedProperties && p.LocalizedProperties[0] && p.LocalizedProperties[0].ProductTitle;
                if (t) keys.push(passKey(t));
            }
        }
        data.saveCache(PASS_FILE, { at: Date.now(), market, keys: [...new Set(keys)] });
        return [...new Set(keys)];
    })().catch((err) => {
        if (saved && saved.keys) { providers.servedSaved(saved.at); return saved.keys; }
        throw err;
    }).finally(() => { passLoading = null; });
    return passLoading;
}

// ---- One game's price ----------------------------------------------------------------
async function priceOf({ title, steamAppId }) {
    const key = steamAppId ? `steam:${steamAppId}` : `t:${normalizeName(title)}`;
    const all = data.loadCache(PRICE_FILE) || {};
    const saved = all[key];
    if (saved && Date.now() - (saved.at || 0) < PRICE_TTL) return saved.value;
    try {
        const found = await findCheapSharkGame({ title, steamAppId });
        let value = null;
        if (found) {
            const g = await httpsGetJsonPlain(`https://www.cheapshark.com/api/1.0/games?id=${encodeURIComponent(found.id)}`, 12000);
            const deals = (g && Array.isArray(g.deals) ? g.deals : []).filter((d) => Number(d.price) >= 0);
            if (deals.length) {
                const best = deals.reduce((m, d) => (Number(d.price) < Number(m.price) ? d : m));
                const names = await storeNames();
                value = {
                    id: found.id, name: (g.info && g.info.title) || found.name,
                    price: Number(best.price), retail: Number(best.retailPrice), store: names[best.storeID] || null, dealID: best.dealID,
                    lowest: g.cheapestPriceEver ? Number(g.cheapestPriceEver.price) : null,
                    lowestAt: g.cheapestPriceEver && g.cheapestPriceEver.date ? Number(g.cheapestPriceEver.date) * 1000 : null,
                    stores: deals.length
                };
            }
        }
        const now = data.loadCache(PRICE_FILE) || {};
        now[key] = { at: Date.now(), value };
        // keep the file small: the 300 most recent answers
        const keys = Object.keys(now);
        if (keys.length > 300) keys.sort((a, b) => (now[a].at || 0) - (now[b].at || 0)).slice(0, keys.length - 300).forEach((k) => delete now[k]);
        data.saveCache(PRICE_FILE, now);
        return value;
    } catch (err) {
        if (saved) { providers.servedSaved(saved.at); return saved.value; }
        throw err;
    }
}

function register(ipcMain, { usdRate, currencyFor }) {
    // { price: {...} | null, verdict, money: { currency, rate }, gamePass: true|false|null }
    ipcMain.handle("r2-price-check", async (event, q = {}) => {
        const title = typeof q.title === "string" ? q.title.trim().slice(0, 200) : "";
        const steamAppId = /^\d{1,10}$/.test(String(q.steamAppId || "")) ? String(q.steamAppId) : null;
        if (!title && !steamAppId) return { price: null, gamePass: null };
        const s = settings.read();
        const market = /^[A-Z]{2}$/.test(s.country || "") ? s.country : "US";
        const [price, pass] = await Promise.all([
            priceOf({ title, steamAppId }).catch(() => null),
            gamePass(market).catch(() => null)
        ]);
        const cur = currencyFor(s.country) || "USD";
        const rate = await Promise.resolve(usdRate(cur)).catch(() => null);
        const want = passKey(title || (price && price.name));
        return {
            price,
            ...(price ? verdict(price) : {}),
            money: typeof rate === "number" ? { currency: cur, rate } : { currency: "USD", rate: 1 },
            gamePass: pass ? (!!want && pass.includes(want)) || (!!price && pass.includes(passKey(price.name))) : null
        };
    });
}

module.exports = { register, verdict, passKey, gamePass, priceOf };
