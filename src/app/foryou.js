// Riftgate — "Picked for you": suggestions from how you actually use Riftgate.
//
// Everything happens on this PC, from lists Riftgate has already loaded
// (no extra internet requests):
//   what you play (hours, how often, how recently, favourites), your Journal
//   (playing / completed / planned / dropped, ratings), the shows you track
//   and the episodes you've watched, books you've read, and what you open to
//   look at in Riftgate (kept here, fading after a couple of weeks).
// Those become a taste profile: the words and genres of everything you're
// into, weighted by how much. Each candidate (free games, deals, films in
// cinemas, new series and anime, upcoming games, books) is scored by how
// close it is to that profile, how much you use that kind of thing, whether
// it continues something you love (a sequel, the same series), and a little
// for quality and freshness. Each pick says why it's there.

import * as D from "./data.js";
import * as journal from "./store.js";
import * as seen from "./seen.js";
import * as interests from "./interests.js";

// ---- What you look at ------------------------------------------------------------------
const VIEWS = "usage:views";
export function recordView(item) {
    if (!item || !item.key || !item.title || ["community", "search"].includes(item.kind)) return;
    const list = (journal.pref(VIEWS, []) || []).filter((v) => v.key !== item.key);
    list.unshift({ key: item.key, type: item.type, kind: item.kind, title: item.title, text: [item.sub, item.genre, (item.desc || "").slice(0, 400)].filter(Boolean).join(" "), at: Date.now() });
    journal.setPref(VIEWS, list.slice(0, 150));
}

// ---- Text -------------------------------------------------------------------------------
const STOP = new Set("the and for with from that this into your you are was were has have had its it's their they them his her him she not but all any can will just more most over than then when where which who what why how out off our one two new now get got also about after before back being both each few here many much only other some such very well while game games play player players world film series season story book books edition remastered collection".split(" "));
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
function words(text) {
    return norm(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}
// "Hades II", "Hades 2: ..." -> "hades": what makes two titles the same series
function franchise(title) {
    const t = norm(title).replace(/[:\-–—(].*$/, "").replace(/\b(the|a|an)\b/g, " ").replace(/\b([ivx]+|\d+)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").trim().replace(/\s+/g, " ");
    return t.length >= 4 ? t : null;
}
const groupOf = (it) => (it.type === "anime" ? "anime" : it.type === "film" || it.type === "series" ? "screen" : it.type === "book" ? "books" : it.kind === "free" ? "free" : it.kind === "deal" ? "deals" : "games");
const world = (g) => (g === "screen" || g === "anime" ? "screen" : g === "books" ? "books" : "games");
const VERB = { games: "played", free: "played", deals: "played", screen: "watched", anime: "watched", books: "read" };

// ---- The taste profile --------------------------------------------------------------------
async function seeds() {
    await Promise.all([journal.load(), seen.load()]);
    const out = [];
    const add = (item, w, how) => { if (item && item.title && w) out.push({ item, w, how, text: [item.title, item.title, item.sub, item.genre, item.desc].filter(Boolean).join(" ") }); };
    const lib = await D.library().catch(() => []);
    const DAY = 86400000;
    lib.forEach((g) => {
        const h = (g.playtime || 0) / 3600;
        let w = 0.6 + Math.log1p(h) + 0.3 * Math.log1p(g.launches || 0) + (g.favourite ? 2 : 0);
        if (g.lastPlayed && Date.now() - g.lastPlayed < 30 * DAY) w += 1;
        add(g, w, g.type === "app" ? "use" : "played");
    });
    journal.entries().forEach((e) => {
        if (!e.item) return;
        const it = { ...e.item, key: e.key };
        let w = { progress: 2.5, completed: 2, planned: 1.5, hold: 0.6, dropped: -1.5 }[e.status] || 0.8;
        if (e.rating) w += (e.rating - 3) * 0.8;
        if (e.favourite) w += 2;
        add(it, w, e.status === "dropped" ? "dropped" : e.rating >= 4 || e.favourite ? "loved" : e.status === "planned" ? "planned" : "journal");
    });
    const shows = await D.watchlist().catch(() => []);
    shows.forEach((s) => add(s, 2, "watching"));
    const views = journal.pref(VIEWS, []) || [];
    views.forEach((v) => { const age = (Date.now() - v.at) / DAY; add({ key: v.key, type: v.type, kind: v.kind, title: v.title, desc: v.text }, 0.7 * Math.pow(0.5, age / 14), "looked"); });
    return out;
}

async function candidates() {
    const W = interests.wants;
    const take = (p) => p.catch(() => []);
    const lists = await Promise.all([
        W("free") ? take(D.freeGames()).then((l) => l.slice().sort((a, b) => b.popularity - a.popularity).slice(0, 700)) : [],
        W("deals") ? take(D.deals()) : [],
        W("games") ? take(D.upcomingGames()) : [],
        W("screen") ? take(D.inCinemas()) : [],
        W("screen") ? take(D.newSeries()) : [],
        W("anime") ? take(D.newAnime()) : [],
        W("books") ? take(D.booksPopular()) : [],
        W("books") ? take(D.booksBest()) : []
    ]);
    const seenKeys = new Set();
    const out = [];
    lists.flat().forEach((it) => { if (it && it.title && !seenKeys.has(it.key)) { seenKeys.add(it.key); out.push(it); } });
    return out;
}

// ---- Picks ------------------------------------------------------------------------------------
let cached = null, cachedAt = 0;
export function forget() { cached = null; }

export async function picks({ limit = 60 } = {}) {
    if (cached && Date.now() - cachedAt < 5 * 60 * 1000) return cached.slice(0, limit);
    const [S, C, lib] = await Promise.all([seeds(), candidates(), D.library().catch(() => [])]);
    const owned = new Set(lib.map((g) => norm(g.title)));
    const libKeys = new Set(lib.map((g) => g.key));
    const pool = C.filter((it) => {
        if (it.mature || libKeys.has(it.key) || owned.has(norm(it.title))) return false;
        if (seen.canMark(it) && seen.isSeen(it)) return false;
        const e = journal.entry(it.key);
        return !(e && ["completed", "dropped", "progress"].includes(e.status));
    });

    // document frequencies over everything involved
    const docs = [...S.map((s) => words(s.text)), ...pool.map((it) => words([it.title, it.sub, it.genre, it.desc].join(" ")))];
    const df = new Map();
    docs.forEach((ws) => new Set(ws).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
    const N = docs.length;
    const vec = (ws) => { const v = new Map(); ws.forEach((w) => v.set(w, (v.get(w) || 0) + 1)); let n2 = 0;
        v.forEach((tf, w) => { const x = (1 + Math.log(tf)) * Math.log(1 + N / (df.get(w) || 1)); v.set(w, x); n2 += x * x; });
        const n = Math.sqrt(n2) || 1; v.forEach((x, w) => v.set(w, x / n)); return v; };
    const dot = (a, b) => { let s = 0; const [sm, lg] = a.size < b.size ? [a, b] : [b, a]; sm.forEach((x, w) => { const y = lg.get(w); if (y) s += x * y; }); return s; };

    const seedVecs = S.map((s, i) => ({ ...s, v: vec(docs[i]), fr: franchise(s.item.title), group: groupOf(s.item) }));
    // one taste profile overall, and one per world (games / films & series / books):
    // a game is judged mostly against the games you play, a show against your shows
    const makeProfile = (list) => {
        const p = new Map();
        list.forEach((sd) => sd.v.forEach((x, w) => p.set(w, (p.get(w) || 0) + x * sd.w)));
        let n = 0; p.forEach((x) => { n += x * x; }); n = Math.sqrt(n) || 1; p.forEach((x, w) => p.set(w, x / n));
        return p;
    };
    const profile = makeProfile(seedVecs);
    const profiles = Object.fromEntries(["games", "screen", "books"].map((wd) => [wd, makeProfile(seedVecs.filter((sd) => world(sd.group) === wd))]));

    // how much you use each kind of thing (with your "Love it / Not for me" choices)
    // (playing games counts for free games and deals too: same world)
    const use = {};
    seedVecs.forEach((s) => { if (s.w > 0) use[world(s.group)] = (use[world(s.group)] || 0) + s.w; });
    const total = Object.values(use).reduce((a, b) => a + b, 0) || 1;
    const affinity = (g) => ((use[world(g)] || 0) / total) * 0.7 + (interests.level(g) === 2 ? 0.3 : interests.level(g) === 1 ? 0.12 : 0);
    // what you already have going (a show you track, a game you own) isn't a suggestion
    const have = new Set(seedVecs.filter((s) => ["watching", "played", "use"].includes(s.how)).map((s) => `${world(s.group)}|${s.fr || norm(s.item.title)}`));
    // nor is anything already in your Journal (by its exact title)
    const inJournal = new Set(seedVecs.filter((s) => s.how !== "looked").map((s) => `${world(s.group)}|${norm(s.item.title)}`));
    const loved = seedVecs.filter((s) => s.w >= 1.5 && s.fr);
    const fresh = new Set(D.newFreeGames(C.filter((x) => x.kind === "free")).map((x) => x.key));
    const today = new Date().toISOString().slice(0, 10);

    const scored = pool.map((it, i) => {
        if (have.has(`${world(groupOf(it))}|${franchise(it.title) || norm(it.title)}`) && !/\b(2|3|4|5|ii|iii|iv)\b/i.test(it.title)) return null;
        if (inJournal.has(`${world(groupOf(it))}|${norm(it.title)}`)) return null;
        const v = vec(docs[S.length + i]);
        const g = groupOf(it);
        const sim = 0.75 * dot(v, profiles[world(g)]) + 0.25 * dot(v, profile);
        const fr = franchise(it.title);
        // a sequel / the same series, in the same world (a game for a game, a show for a show)
        const sequelOf = fr ? loved.find((s) => world(s.group) === world(g) && (s.fr === fr || (s.fr.length >= 5 && (fr.startsWith(s.fr + " ") || s.fr.startsWith(fr + " "))))) : null;
        const quality = it.rating ? Math.min(1, it.rating / 10) : (it.popularity ? Math.min(1, it.popularity / 100) : 0.3);
        const isNew = fresh.has(it.key) || (it.date && it.date <= today && Date.now() - Date.parse(it.date) < 60 * 86400000) || (it.kind === "deal" && (it.price && it.price.discount >= 75));
        const score = 0.62 * sim + 0.28 * affinity(g) + (sequelOf ? 0.55 : 0) + 0.08 * quality + (isNew ? 0.04 : 0) - (interests.level(g) === 0 ? 1 : 0);
        return { it, v, g, score, sequelOf };
    }).filter((x) => x && x.score > 0.06).sort((a, b) => b.score - a.score);

    // keep it varied: no kind of thing takes more than half of the first picks
    const out = [], perGroup = {}, perSeed = {};
    for (const x of scored) {
        if (out.length >= 80) break;
        if ((perGroup[x.g] || 0) >= Math.max(4, Math.ceil(out.length / 2) + 2)) continue;
        // why: the thing you use that this is closest to
        let because = x.sequelOf, best = 0;
        if (!because) seedVecs.forEach((sd) => { if (sd.w <= 0) return; const c = dot(x.v, sd.v) * Math.sqrt(sd.w) * (world(sd.group) === world(x.g) ? 1 : 0.35); if (c > best) { best = c; because = sd; } });
        if (x.sequelOf && (perSeed[x.sequelOf.item.title] || 0) >= 3) continue; // a couple from each series is enough
        if (because && (perSeed[because.item.title] || 0) >= 4 && !x.sequelOf) because = null;
        if (because) perSeed[because.item.title] = (perSeed[because.item.title] || 0) + 1;
        const verb = because ? ({ played: "played", use: "use", watching: "watch", loved: "loved", planned: "plan", looked: "looked at", journal: VERB[because.group] || "liked" }[because.how] || "liked") : null;
        const reason = x.sequelOf ? `More ${x.sequelOf.item.title}` : because && best > 0.05 ? `Because you ${verb} ${because.item.title}` : `Popular in ${({ games: "games", free: "free games", deals: "deals", screen: "films & series", anime: "anime", books: "books" })[x.g]}`;
        out.push({ ...x.it, reason });
        perGroup[x.g] = (perGroup[x.g] || 0) + 1;
    }
    cached = out; cachedAt = Date.now();
    return out.slice(0, limit);
}
