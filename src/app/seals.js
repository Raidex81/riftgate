// Riftgate — Seals: small achievements across every world, the kind no other
// launcher can give because none has your games, films, series and books in
// one place. Earned once, kept forever (with the date), shown in the Journal.
// Three are secrets: they show as "???" until found.

import * as journal from "./store.js";
import * as D from "./data.js";

const DAY = 86400e3;
const done = (es) => es.filter((e) => e.status === "completed" && e.item);
const kindOf = (e) => (e.item && e.item.type) || "";
const isScreen = (t) => t === "film" || t === "series" || t === "anime";

// count:<name> counters the app keeps (asks, rolls, claims...)
export const count = (name) => journal.pref(`count:${name}`, 0) || 0;
export function bump(name, by = 1) { const n = count(name) + by; journal.setPref(`count:${name}`, n); return n; }
export function flag(name) { if (!journal.pref(`flag:${name}`, false)) journal.setPref(`flag:${name}`, true); }
const flagged = (name) => !!journal.pref(`flag:${name}`, false);

// rarity: 1 common, 2 rare, 3 epic, 4 legendary (the gem's colour)
export const SEALS = [
    { id: "first-step", name: "First step", hint: "Add anything to your Journal", icon: "journal", rarity: 1, test: (s) => s.tracked >= 1 },
    { id: "finisher", name: "Finisher", hint: "Complete 10 things, of any kind", icon: "check", rarity: 1, test: (s) => s.done >= 10, progress: (s) => [s.done, 10] },
    { id: "hundred", name: "A hundred worlds", hint: "Complete 100 things", icon: "trophy", rarity: 3, test: (s) => s.done >= 100, progress: (s) => [s.done, 100] },
    { id: "triad", name: "Triad", hint: "Finish a game, a film or series, and a book within the same week", icon: "rift", rarity: 3, test: (s) => s.triad },
    { id: "bookworm", name: "Bookworm", hint: "Finish 10 books", icon: "book", rarity: 2, test: (s) => s.books >= 10, progress: (s) => [s.books, 10] },
    { id: "finale", name: "To the finale", hint: "Watch 5 series or anime to the end", icon: "tv", rarity: 2, test: (s) => s.series >= 5, progress: (s) => [s.series, 5] },
    { id: "cinephile", name: "Cinephile", hint: "Watch 25 films", icon: "film", rarity: 2, test: (s) => s.films >= 25, progress: (s) => [s.films, 25] },
    { id: "gamer", name: "Seasoned player", hint: "Finish 25 games", icon: "library", rarity: 2, test: (s) => s.games >= 25, progress: (s) => [s.games, 25] },
    { id: "collector", name: "Collector", hint: "Have 50 games and apps in your Library", icon: "library", rarity: 1, test: (s) => s.library >= 50, progress: (s) => [s.library, 50] },
    { id: "treasure", name: "Treasure hunter", hint: "Claim 10 free games through Riftgate", icon: "gift", rarity: 1, test: (s) => s.claims >= 10, progress: (s) => [s.claims, 10] },
    { id: "hoard", name: "Dragon's hoard", hint: "Claim 50 free games through Riftgate", icon: "gift", rarity: 3, test: (s) => s.claims >= 50, progress: (s) => [s.claims, 50] },
    { id: "patience", name: "Patience pays", hint: "See a game on your wishlist drop in price", icon: "tag", rarity: 1, test: (s) => s.dropSeen },
    { id: "critic", name: "Critic", hint: "Rate 25 things", icon: "star", rarity: 1, test: (s) => s.rated >= 25, progress: (s) => [s.rated, 25] },
    { id: "rift-walker", name: "Rift walker", hint: "Ask the Rift 10 times", icon: "sparkles", rarity: 1, test: (s) => s.asks >= 10, progress: (s) => [s.asks, 10] },
    { id: "fate", name: "Trust in fate", hint: "Open 10 things the rift chose for you", icon: "dice", rarity: 2, test: (s) => s.rolls >= 10, progress: (s) => [s.rolls, 10] },
    { id: "night-owl", name: "Night owl", hint: "Open Riftgate between 2 and 5 in the morning", icon: "clock", rarity: 1, test: (s) => s.nightOwl },
    { id: "hallowed", name: "Hallowed", hint: "Be there while the Hallowed Rift is open (late October)", icon: "flame", rarity: 2, test: (s) => s.halloween },
    // secrets
    { id: "old-code", name: "The old code", hint: "Some codes are older than Riftgate itself", icon: "gem", rarity: 4, secret: true, test: (s) => s.oldCode },
    { id: "golden", name: "Golden strike", hint: "Lightning, but not as you know it", icon: "star", rarity: 4, secret: true, test: (s) => s.golden },
    { id: "knock", name: "Seven knocks", hint: "Knock on the door, and keep knocking", icon: "rift", rarity: 3, secret: true, test: (s) => s.knock }
];

export async function stats() {
    await journal.load();
    const es = journal.entries();
    const fin = done(es);
    const lib = await D.library().catch(() => []);
    const at = (e) => e.completedAt || e.updatedAt || 0;
    // a game, something to watch and a book, all finished within 7 days of one another
    let triad = false;
    const g = fin.filter((e) => kindOf(e) === "game"), w = fin.filter((e) => isScreen(kindOf(e))), b = fin.filter((e) => kindOf(e) === "book");
    for (const x of g) { if (triad) break; for (const y of w) { if (Math.abs(at(x) - at(y)) > 7 * DAY) continue; if (b.some((z) => Math.max(at(x), at(y), at(z)) - Math.min(at(x), at(y), at(z)) <= 7 * DAY)) { triad = true; break; } } }
    return {
        tracked: es.filter((e) => e.item).length, done: fin.length, rated: es.filter((e) => e.rating).length,
        games: g.length, films: fin.filter((e) => kindOf(e) === "film").length, series: fin.filter((e) => kindOf(e) === "series" || kindOf(e) === "anime").length, books: b.length,
        library: lib.length, triad,
        claims: count("claims"), asks: count("asks"), rolls: count("rolls"),
        dropSeen: flagged("drop-seen"), nightOwl: flagged("night-owl"), halloween: flagged("hallowed"),
        oldCode: flagged("old-code"), golden: flagged("golden"), knock: flagged("knock")
    };
}

export const earned = () => journal.pref("seals", {}) || {};
const listeners = new Set();
export function onEarned(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Checks every seal; the newly earned are saved and announced
let checking = null;
export function check() {
    if (checking) return checking;
    checking = (async () => {
        const s = await stats();
        const have = { ...earned() };
        const fresh = SEALS.filter((x) => !have[x.id] && x.test(s));
        if (fresh.length) {
            fresh.forEach((x) => { have[x.id] = Date.now(); });
            await journal.setPref("seals", have);
            fresh.forEach((x) => listeners.forEach((fn) => { try { fn(x); } catch (e) { console.error(e); } }));
        }
        return fresh;
    })().finally(() => { checking = null; });
    return checking;
}
