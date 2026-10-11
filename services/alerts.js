// Riftgate — alerts: free games worth knowing about, and price drops on
// your wishlist. Pure logic plus the two small feeds it reads; main.js does
// the scheduling, the notifications and the files.
//
// Free games: Epic's own promotions feed and GamerPower (which follows the
// giveaways on Steam, GOG, Epic, itch.io and more) both say when a giveaway
// ends. A game that's newly free to keep gets one alert; a free game you
// haven't claimed gets one reminder on its last day.
//
// Wishlist: CheapShark knows every store's current price for a game (in US
// dollars; main.js converts). A game you wished for gets an alert when its
// best price drops.

const { httpsGetJsonPlain } = require("./http");

const DAY = 86400000;

function normalizeName(name) {
    return String(name || "").toLowerCase().replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
// The same game is the same giveaway whichever feed reports it
const giveawayKey = (g) => normalizeName(g.name);

// ---- Free games -------------------------------------------------------------------
async function fetchEpicGiveaways(get = httpsGetJsonPlain) {
    const data = await get("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US", 15000);
    const els = (data && data.data && data.data.Catalog && data.data.Catalog.searchStore && data.data.Catalog.searchStore.elements) || [];
    const now = Date.now();
    const out = [];
    for (const el of els) {
        for (const w of (el.promotions && el.promotions.promotionalOffers) || []) {
            for (const o of w.promotionalOffers || []) {
                const start = Date.parse(o.startDate), end = Date.parse(o.endDate);
                const pct = o.discountSetting && o.discountSetting.discountPercentage;
                if (pct !== 0 || !(now >= start && now <= end)) continue;
                const slug = (Array.isArray(el.offerMappings) && el.offerMappings.find((m) => m && m.pageSlug) || {}).pageSlug
                    || (el.catalogNs && Array.isArray(el.catalogNs.mappings) && (el.catalogNs.mappings.find((m) => m && m.pageSlug) || {}).pageSlug)
                    || (el.productSlug && el.productSlug !== "[]" ? el.productSlug : "");
                const img = (el.keyImages || []).find((i) => i.type === "OfferImageWide" || i.type === "Thumbnail");
                out.push({
                    name: el.title, store: "Epic Games",
                    url: slug ? `https://store.epicgames.com/en-US/p/${String(slug).replace(/\/home$/, "")}` : "https://store.epicgames.com/en-US/free-games",
                    image: img ? img.url : null, endsAt: isFinite(end) ? end : null
                });
            }
        }
    }
    return out;
}

const GP_STORES = [[/epic/i, "Epic Games"], [/steam/i, "Steam"], [/gog/i, "GOG"], [/itch/i, "itch.io"], [/ubisoft/i, "Ubisoft"], [/(^|\W)ea(\W|$)|origin/i, "EA"], [/battle\.?net/i, "Battle.net"], [/prime|amazon/i, "Prime Gaming"], [/indiegala/i, "IndieGala"]];
async function fetchGamerPowerGiveaways(get = httpsGetJsonPlain) {
    const data = await get("https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date", 15000);
    const list = Array.isArray(data) ? data : [];
    return list.filter((g) => g && g.status !== "Expired" && (!g.type || g.type === "Game")).map((g) => {
        const plats = String(g.platforms || "").split(",").map((p) => p.trim()).filter((p) => p && !/^pc$/i.test(p));
        const store = (GP_STORES.find(([re]) => plats.some((p) => re.test(p))) || [null, plats[0] || "PC"])[1];
        // GamerPower gives "YYYY-MM-DD HH:MM:SS" (UTC) or "N/A"
        const end = /^\d{4}-\d\d-\d\d/.test(g.end_date || "") ? Date.parse(String(g.end_date).replace(" ", "T") + "Z") : null;
        return {
            // "Pixel Crypt (Steam) Giveaway" -> "Pixel Crypt"
            name: String(g.title || "").replace(/\s*giveaway\s*$/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim(),
            store, url: g.open_giveaway_url || g.gamerpower_url || null, image: g.image || g.thumbnail || null,
            endsAt: isFinite(end) ? end : null
        };
    }).filter((g) => g.name);
}

// Both feeds, one entry per game (Epic's own data wins for Epic games)
async function fetchGiveaways(get = httpsGetJsonPlain) {
    const [epic, gp] = await Promise.allSettled([fetchEpicGiveaways(get), fetchGamerPowerGiveaways(get)]);
    const a = epic.status === "fulfilled" ? epic.value : [], b = gp.status === "fulfilled" ? gp.value : [];
    if (epic.status === "rejected" && gp.status === "rejected") throw new Error("no giveaway feed answered");
    const byKey = new Map();
    for (const g of [...a, ...b]) {
        const k = giveawayKey(g);
        if (!k) continue;
        const had = byKey.get(k);
        if (!had) byKey.set(k, { ...g, key: k });
        else if (!had.endsAt && g.endsAt) had.endsAt = g.endsAt;
    }
    return [...byKey.values()];
}

// What to tell the user now. state = { initialized, seen: {key: {at, name, store, url, endsAt}}, reminded: {key: 1}, claimed: {key: at} }
// Returns { fresh: [giveaway], ending: [giveaway], state }
function diffGiveaways(state, list, now = Date.now()) {
    const s = { initialized: !!(state && state.initialized), seen: { ...(state && state.seen) }, reminded: { ...(state && state.reminded) }, claimed: { ...(state && state.claimed) } };
    const fresh = [], ending = [];
    const live = new Set();
    for (const g of list) {
        live.add(g.key);
        const had = s.seen[g.key];
        // the first look only learns what's already out there: no flood of alerts
        if (!had && s.initialized) fresh.push(g);
        s.seen[g.key] = { at: had ? had.at : now, name: g.name, store: g.store, url: g.url, image: g.image || null, endsAt: g.endsAt || null, live: true };
        const left = g.endsAt ? g.endsAt - now : null;
        if (s.initialized && left !== null && left > 0 && left <= 26 * 3600e3 && !s.claimed[g.key] && !s.reminded[g.key] && !fresh.includes(g)) {
            ending.push(g); s.reminded[g.key] = now;
        }
    }
    // giveaways that ended: kept a month (so they aren't "new" if a feed hiccups), then forgotten
    for (const [k, v] of Object.entries(s.seen)) {
        if (live.has(k)) continue;
        v.live = false;
        if (now - (v.goneAt || (v.goneAt = now)) > 30 * DAY) { delete s.seen[k]; delete s.reminded[k]; delete s.claimed[k]; }
    }
    s.initialized = true;
    return { fresh, ending, state: s };
}

// The giveaways live right now, for the app (welcome back, the Free games banner)
function liveGiveaways(state) {
    return Object.entries((state && state.seen) || {}).filter(([, v]) => v.live).map(([key, v]) => ({ key, ...v, claimed: !!(state.claimed && state.claimed[key]) }));
}

// ---- Wishlist ---------------------------------------------------------------------
// Find a game on CheapShark: by Steam app id when known, else by title
async function findCheapSharkGame({ title, steamAppId }, get = httpsGetJsonPlain) {
    const url = steamAppId
        ? `https://www.cheapshark.com/api/1.0/games?steamAppID=${encodeURIComponent(steamAppId)}`
        : `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(String(title).slice(0, 80))}&limit=10`;
    const list = await get(url, 12000);
    if (!Array.isArray(list) || !list.length) return null;
    const want = normalizeName(title);
    const hit = list.find((g) => normalizeName(g.external) === want) || (steamAppId ? list[0] : list.find((g) => normalizeName(g.external).startsWith(want)) || null);
    return hit ? { id: String(hit.gameID), name: hit.external, thumb: hit.thumb || null } : null;
}

// Current best price for each CheapShark id (up to 25 per call): { id: { price, retail, dealID, storeID } }
async function cheapSharkPrices(ids, get = httpsGetJsonPlain) {
    const out = {};
    for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const data = await get(`https://www.cheapshark.com/api/1.0/games?ids=${chunk.join(",")}`, 15000);
        for (const id of chunk) {
            const g = data && data[id];
            if (!g || !Array.isArray(g.deals) || !g.deals.length) continue;
            const best = g.deals.reduce((m, d) => (Number(d.price) < Number(m.price) ? d : m));
            out[id] = { price: Number(best.price), retail: Number(best.retailPrice), dealID: best.dealID, storeID: best.storeID, lowest: g.cheapestPriceEver ? Number(g.cheapestPriceEver.price) : null };
        }
    }
    return out;
}

// Which wished-for games just got cheaper. A drop counts when the best price
// falls at least 10% below the last one we told you about (or below the
// price when you added it). Returns { drops: [{item, price, was, retail}], items }
function diffPrices(items, prices, now = Date.now()) {
    const drops = [];
    const next = items.map((it) => {
        const p = it.cheapsharkId && prices[it.cheapsharkId];
        if (!p || !isFinite(p.price)) return it;
        const ref = typeof it.alertPrice === "number" ? it.alertPrice : (typeof it.price === "number" ? it.price : null);
        const n = { ...it, price: p.price, retail: p.retail, dealID: p.dealID, lowest: p.lowest, checkedAt: now };
        if (ref === null) { n.alertPrice = p.price; return n; }
        if (p.price <= ref * .9 && p.price < p.retail) { drops.push({ item: n, price: p.price, was: ref, retail: p.retail }); n.alertPrice = p.price; n.droppedAt = now; n.droppedFrom = ref; }
        // the price went back up: alert again next time it falls
        else if (p.price > ref) n.alertPrice = p.price;
        return n;
    });
    return { drops, items: next };
}

module.exports = { normalizeName, fetchEpicGiveaways, fetchGamerPowerGiveaways, fetchGiveaways, diffGiveaways, liveGiveaways, findCheapSharkGame, cheapSharkPrices, diffPrices };
