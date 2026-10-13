// Alerts: free games and wishlist price drops (the feeds and comparisons are
// in services/alerts.js).
//
// Checked a minute after start, then every three hours while Riftgate runs
// (in the tray too, when "Keep running in the background" is on). A game
// newly free to keep gets one notification; one you haven't claimed gets a
// reminder on its last day; a game on your wishlist gets one when its best
// price drops. Each can be turned off in Settings.
//
// Needs from other sections (given by main.js): usdRate(currency) from
// Deals, currencyFor(country), iconPath() for the notification icon.
"use strict";
const { Notification, shell } = require("electron");
const alerts = require("../services/alerts");
const data = require("./core/data");
const settings = require("./core/settings");
const windowRef = require("./core/window");

const ALERTS_FILE = () => data.file("r2-alerts.json");
const WISHLIST_FILE = () => data.file("r2-wishlist.json");

function register(ipcMain, { usdRate, currencyFor, iconPath }) {
    let busy = false;

    function notify({ title, body, onClick }) {
        try {
            if (!Notification.isSupported()) return;
            const n = new Notification({ title, body, icon: iconPath(), silent: false });
            n.on("click", () => { try { onClick && onClick(); } catch (e) { /* */ } });
            n.show();
        } catch (e) { console.error("[alerts] notification failed:", e.message || e); }
    }
    const log = (state, event) => { state.events = [{ ...event, at: Date.now() }, ...(state.events || [])].slice(0, 60); };

    async function checkGiveaways() {
        const s = settings.read();
        const st = data.readJson(ALERTS_FILE(), {});
        let list;
        try { list = await alerts.fetchGiveaways(); } catch (e) { console.error("[alerts] giveaways:", e.message || e); return; }
        const { fresh, ending, state } = alerts.diffGiveaways(st.giveaways, list);
        st.giveaways = state;
        fresh.forEach((g) => log(st, { type: "free", key: g.key, name: g.name, store: g.store, url: g.url, image: g.image || null, endsAt: g.endsAt || null }));
        data.writeJson(ALERTS_FILE(), st);
        windowRef.send("r2-alerts-changed", { fresh: fresh.length, ending: ending.length });
        if (s.freeGameAlerts === false) return;
        const until = (g) => (g.endsAt ? ` until ${new Date(g.endsAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}` : "");
        const claimIt = (g) => () => { claim(g.key); if (g.url) shell.openExternal(g.url); };
        if (fresh.length > 2) {
            notify({ title: `${fresh.length} games just went free`, body: fresh.slice(0, 3).map((g) => g.name).join(", ") + (fresh.length > 3 ? "…" : "") + ". Free to keep, in Riftgate's Free games.",
                onClick: () => { windowRef.show(); windowRef.send("r2-alert-open", { view: "free" }); } });
        } else fresh.forEach((g) => notify({ title: `Free to keep: ${g.name}`, body: `On ${g.store}${until(g)}. Click to claim it.`, onClick: claimIt(g) }));
        ending.forEach((g) => notify({ title: `Last day: ${g.name} is free`, body: `Free to keep on ${g.store} until ${new Date(g.endsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. Click to claim it before it's gone.`, onClick: claimIt(g) }));
    }

    function claim(keyOrName) {
        const st = data.readJson(ALERTS_FILE(), {});
        const g = st.giveaways || (st.giveaways = { seen: {}, reminded: {}, claimed: {} });
        const key = g.seen && g.seen[keyOrName] ? keyOrName : alerts.normalizeName(keyOrName);
        g.claimed = { ...(g.claimed || {}), [key]: Date.now() };
        data.writeJson(ALERTS_FILE(), st);
        return true;
    }

    async function wishlistRate() {
        const cur = currencyFor(settings.read().country) || "USD";
        const rate = await usdRate(cur);
        return typeof rate === "number" ? { currency: cur, rate } : { currency: "USD", rate: 1 };
    }
    const money = (usd, { currency, rate }) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(usd * rate); } catch (e) { return `$${usd.toFixed(2)}`; } };

    async function checkWishlist(force) {
        const wl = data.readJson(WISHLIST_FILE(), { items: [] });
        const ids = (wl.items || []).map((it) => it.cheapsharkId).filter(Boolean);
        if (!ids.length || (!force && Date.now() - (wl.checkedAt || 0) < 6 * 3600e3)) return;
        let prices;
        try { prices = await alerts.cheapSharkPrices([...new Set(ids)]); } catch (e) { console.error("[alerts] wishlist prices:", e.message || e); return; }
        const { drops, items } = alerts.diffPrices(wl.items, prices);
        data.writeJson(WISHLIST_FILE(), { ...wl, items, checkedAt: Date.now() });
        if (!drops.length) return;
        const st = data.readJson(ALERTS_FILE(), {});
        drops.forEach((d) => log(st, { type: "drop", key: d.item.key, name: d.item.title, price: d.price, was: d.was, retail: d.retail, image: d.item.image || null }));
        data.writeJson(ALERTS_FILE(), st);
        windowRef.send("r2-alerts-changed", { drops: drops.length });
        if (settings.read().wishlistAlerts === false) return;
        const m = await wishlistRate();
        drops.forEach((d) => notify({
            title: `${d.item.title} is ${Math.round((1 - d.price / d.retail) * 100)}% off`,
            body: `${money(d.price, m)} (was ${money(d.was, m)}). On your Riftgate wishlist. Click to see the deal.`,
            onClick: () => shell.openExternal(d.item.dealID ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(d.item.dealID)}` : `https://www.cheapshark.com/search#q:${encodeURIComponent(d.item.title)}`)
        }));
    }

    async function run() {
        if (busy) return;
        busy = true;
        try { await checkGiveaways(); await checkWishlist(false); } finally { busy = false; }
    }
    setTimeout(run, 60 * 1000);
    setInterval(run, 3 * 3600e3);

    ipcMain.handle("r2-alerts-giveaways", async () => {
        const st = data.readJson(ALERTS_FILE(), {});
        return { live: alerts.liveGiveaways(st.giveaways), events: st.events || [] };
    });
    ipcMain.handle("r2-alerts-claim", async (event, keyOrName) => (typeof keyOrName === "string" && keyOrName.length < 300 ? claim(keyOrName) : false));
    ipcMain.handle("r2-alerts-check", async () => { await run(); return true; });
    ipcMain.handle("r2-wishlist-get", async () => {
        const wl = data.readJson(WISHLIST_FILE(), { items: [] });
        return { items: wl.items || [], checkedAt: wl.checkedAt || null, money: await wishlistRate() };
    });
    ipcMain.handle("r2-wishlist-add", async (event, item = {}) => {
        const title = typeof item.title === "string" ? item.title.trim().slice(0, 200) : "";
        const key = typeof item.key === "string" ? item.key.slice(0, 300) : "";
        if (!title || !key) return { error: "That game can't be added." };
        const wl = data.readJson(WISHLIST_FILE(), { items: [] });
        if ((wl.items || []).some((it) => it.key === key)) return { item: wl.items.find((it) => it.key === key) };
        let found = null;
        try { found = await alerts.findCheapSharkGame({ title, steamAppId: /^\d{1,10}$/.test(String(item.steamAppId || "")) ? String(item.steamAppId) : null }); } catch (e) { /* offline: kept, priced later */ }
        const it = { key, title, image: typeof item.image === "string" ? item.image.slice(0, 1000) : (found && found.thumb) || null, cheapsharkId: found ? found.id : null, addedAt: Date.now() };
        if (found) {
            try { const p = (await alerts.cheapSharkPrices([found.id]))[found.id]; if (p) Object.assign(it, { price: p.price, retail: p.retail, dealID: p.dealID, lowest: p.lowest, alertPrice: p.price, checkedAt: Date.now() }); } catch (e) { /* priced on the next check */ }
        }
        wl.items = [it, ...(wl.items || [])].slice(0, 300);
        data.writeJson(WISHLIST_FILE(), wl);
        return { item: it, priced: !!found };
    });
    ipcMain.handle("r2-wishlist-remove", async (event, key) => {
        const wl = data.readJson(WISHLIST_FILE(), { items: [] });
        wl.items = (wl.items || []).filter((it) => it.key !== key);
        data.writeJson(WISHLIST_FILE(), wl);
        return true;
    });
}

module.exports = { register };
