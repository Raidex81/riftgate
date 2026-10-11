// Riftgate — alerts and the wishlist, from the app's side. The engine
// watches the giveaways and the prices (main.js, services/alerts.js) and
// sends the notifications; this keeps the app's own view of them.

import { call, on, saveSettings, settings } from "./api.js";
import { bump, flag } from "./seals.js";

// ---- Free to keep right now -------------------------------------------------------
let gw = null;
export function giveaways({ fresh = false } = {}) {
    if (!gw || fresh) gw = call("r2-alerts-giveaways").then((r) => r || { live: [], events: [] }).catch(() => ({ live: [], events: [] }));
    return gw;
}
export async function claim(nameOrKey) {
    const ok = await call("r2-alerts-claim", String(nameOrKey || ""));
    if (ok) { bump("claims"); bump(`claims-${new Date().getFullYear()}`); }
    gw = null;
    return ok;
}
// "2 days left", "Last day", "11 h left"
export function timeLeft(endsAt, now = Date.now()) {
    if (!endsAt) return null;
    const ms = endsAt - now;
    if (ms <= 0) return "Ended";
    const h = ms / 3600e3;
    if (h < 1) return "Less than an hour left";
    if (h < 24) return `${Math.floor(h)} h left`;
    const d = Math.floor(h / 24);
    return d === 1 ? "1 day left" : `${d} days left`;
}

// ---- The wishlist ----------------------------------------------------------------
let wl = null;
const listeners = new Set();
export function wishlist({ fresh = false } = {}) {
    if (!wl || fresh) wl = call("r2-wishlist-get").then((r) => r || { items: [], money: { currency: "USD", rate: 1 } }).catch(() => ({ items: [], money: { currency: "USD", rate: 1 } }))
        .then((w) => { if ((w.items || []).some((it) => it.droppedAt)) flag("drop-seen"); return w; });
    return wl;
}
export async function onWishlist(key) { return (await wishlist()).items.some((it) => it.key === key); }
export async function wish(item) {
    const raw = item.raw || {};
    const r = await call("r2-wishlist-add", { key: item.key, title: item.title, image: item.image || null, steamAppId: raw.steamAppId || raw.steamAppID || null });
    wl = null; listeners.forEach((fn) => fn());
    return r;
}
export async function unwish(key) { await call("r2-wishlist-remove", key); wl = null; listeners.forEach((fn) => fn()); }
export function onWishlistChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function money(usd, m) {
    if (typeof usd !== "number") return "";
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency }).format(usd * m.rate); } catch (e) { return `$${usd.toFixed(2)}`; }
}
// A wishlist entry as a card item (opens like any game)
export function wishItem(it, m) {
    const off = it.retail && it.price < it.retail ? Math.round((1 - it.price / it.retail) * 100) : 0;
    return {
        key: it.key, kind: "wish", type: "game", title: it.title,
        sub: typeof it.price !== "number" ? "Price not found yet" : it.droppedAt && Date.now() - it.droppedAt < 7 * 86400e3 ? "Price dropped" : "On your wishlist",
        image: it.image || null,
        price: typeof it.price === "number" ? { final: it.price * m.rate, original: (it.retail || it.price) * m.rate, currency: m.currency, discount: off } : null,
        url: it.dealID ? `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(it.dealID)}` : null,
        dropped: it.droppedAt && Date.now() - it.droppedAt < 7 * 86400e3,
        raw: it
    };
}

// ---- Settings ---------------------------------------------------------------------
export async function alertSettings() {
    const s = await settings({ fresh: true });
    return { free: s.freeGameAlerts !== false, wishlist: s.wishlistAlerts !== false, background: !!s.runInBackground, startup: !!s.launchAtStartup };
}
// Keep running in the tray (so alerts reach you with the window closed) and start with Windows
export async function keepWatching(on) {
    await saveSettings({ runInBackground: !!on });
    await call("set-run-in-background", !!on);
}
export async function startWithWindows(on) {
    await saveSettings({ launchAtStartup: !!on });
    await call("set-launch-at-startup", !!on);
}

export function onAlertsChanged(fn) { return on("r2-alerts-changed", (d) => { gw = null; wl = null; fn(d); }); }
