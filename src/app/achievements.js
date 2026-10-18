// Riftgate — Steam achievements: the shared logic. engine/achievements.js
// fetches; this decides how they're grouped and ordered, everywhere they
// show (the game's details, the Journal's Trophy room, Nexus, cards, Seals).
//
// Organised for playing, not for listing:
//   Next up   what you haven't got yet, the most-earned first: the ones
//             within reach come before the ones almost nobody gets
//   Recent    what you unlocked, newest first, by day
//   Rarest    your unlocks, the rarest first: what you can be proud of
//   All       everything, unlocked first
// Each one has a rarity tier from how many Steam players have it, drawn
// as a gem in the tier's colour. Hidden achievements stay veiled until
// you choose to see them.

import { call, on } from "./api.js";
import { flag } from "./seals.js";

export const TIERS = [
    { id: "legendary", label: "Legendary", max: 1, hint: "fewer than 1% of players" },
    { id: "epic", label: "Epic", max: 5, hint: "1–5% of players" },
    { id: "rare", label: "Rare", max: 20, hint: "5–20% of players" },
    { id: "uncommon", label: "Uncommon", max: 50, hint: "20–50% of players" },
    { id: "common", label: "Common", max: 101, hint: "more than half of players" }
];
export function tierOf(percent) {
    if (typeof percent !== "number") return null;
    return TIERS.find((t) => percent < t.max) || TIERS[TIERS.length - 1];
}

export const game = (appid, { fresh = false } = {}) => call("r2-achievements-game", String(appid), { fresh });

// ---- ordering --------------------------------------------------------------------
const byPercentDesc = (a, b) => (b.percent ?? -1) - (a.percent ?? -1) || a.name.localeCompare(b.name);
export function nextUp(items) {
    // reachable first; hidden ones last (you chose not to know what they are)
    return items.filter((a) => !a.achieved).sort((a, b) => (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0) || byPercentDesc(a, b));
}
export function recent(items) {
    return items.filter((a) => a.achieved).sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0));
}
export function rarest(items) {
    return items.filter((a) => a.achieved).sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
}
export function all(items) {
    return items.slice().sort((a, b) => (b.achieved ? 1 : 0) - (a.achieved ? 1 : 0) || byPercentDesc(a, b));
}
// "Today", "Yesterday", "Monday", "12 October"
export function dayLabel(ts) {
    if (!ts) return "Date unknown";
    const d = new Date(ts), now = new Date();
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400e3);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
// How your unlocks split across tiers: [{ tier, n }]
export function tierCounts(items) {
    const got = items.filter((a) => a.achieved);
    return TIERS.map((t) => ({ tier: t, n: got.filter((a) => tierOf(a.percent) === t).length })).filter((x) => x.n);
}

// ---- the summary across your games ----------------------------------------------
let summaryP = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function summary({ fresh = false } = {}) {
    if (!summaryP || fresh) {
        summaryP = call("r2-achievements-summary").then((s) => {
            s = s || { games: {}, recent: [] };
            noteSeals(s);
            return s;
        });
        summaryP.then(() => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } });
    }
    return summaryP;
}
// a look at the games you've played lately (the engine also does this by itself)
export async function sweep() {
    const s = await call("r2-achievements-sweep");
    if (s) { summaryP = Promise.resolve(s); noteSeals(s); for (const fn of [...listeners]) { try { fn(); } catch (e) { /* */ } } }
    return s;
}
on("r2-achievements-changed", () => summary({ fresh: true }));

// what the summary says about one game
let perfectSet = new Set();
export const isPerfect = (appid) => perfectSet.has(String(appid));
export function progressOf(s, appid) {
    const g = s && s.games && s.games[String(appid)];
    return g && g.total ? { unlocked: g.unlocked || 0, total: g.total, pct: Math.round(((g.unlocked || 0) / g.total) * 100) } : null;
}
function noteSeals(s) {
    perfectSet = new Set(Object.entries(s.games || {}).filter(([, g]) => g.total && g.unlocked === g.total).map(([id]) => id));
    if (perfectSet.size) flag("ach-perfect");
    if (Object.values(s.games || {}).some((g) => g.rarest && typeof g.rarest.percent === "number" && g.rarest.percent < 1)) flag("ach-legendary");
}

// Games closest to 100% (at least 60% done, not finished), fewest left first
export function almostThere(s) {
    return Object.entries((s && s.games) || {})
        .filter(([, g]) => g.total && g.unlocked < g.total && g.unlocked / g.total >= 0.6)
        .map(([appid, g]) => ({ appid, ...g, left: g.total - g.unlocked }))
        .sort((a, b) => a.left - b.left || b.unlocked / b.total - a.unlocked / a.total);
}

// The Trophy room's numbers
export function totals(s) {
    const games = Object.values((s && s.games) || {}).filter((g) => g.total);
    const unlocked = games.reduce((n, g) => n + (g.unlocked || 0), 0);
    const total = games.reduce((n, g) => n + g.total, 0);
    const perfect = games.filter((g) => g.unlocked === g.total).length;
    const rarest = games.map((g) => g.rarest && { ...g.rarest, game: g.name }).filter((r) => r && typeof r.percent === "number").sort((a, b) => a.percent - b.percent)[0] || null;
    const started = games.filter((g) => g.unlocked > 0);
    const avg = started.length ? Math.round(started.reduce((n, g) => n + g.unlocked / g.total, 0) / started.length * 100) : 0;
    return { games: games.length, unlocked, total, perfect, rarest, avg };
}
