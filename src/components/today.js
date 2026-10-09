// Riftgate 2 — "What do you want to do today?", the heart of Riftgate.
// Step 1: pick a mood (Play, Play free, Watch, Read, or let the rift decide).
// Step 2: narrow it down (pick up where you left off, something new, a film
// in cinemas, a free classic…). Then the rift rolls and lands on one thing.
// What you've finished or dropped is skipped, and the last picks don't come
// straight back. Also available inline on Nexus (todayBand).

import * as gate from "../app/mature.js";
import { h, icon, clear } from "../app/dom.js";
import { cached, country } from "../app/api.js";
import * as D from "../app/data.js";
import * as journal from "../app/store.js";
import { fromProviderTitle } from "../app/items.js";
import { Rift } from "./rift.js";
import * as interests from "../app/interests.js";
import { openRoll } from "./roll.js";

const DAY = 86400000;
const fromJournal = (types, status = "planned") => journal.entries()
    .filter((e) => e.item && e.status === status && types.includes(e.item.type))
    .map((e) => ({ ...e.item, key: e.key, kind: e.item.kind || "journal" }));
const settled = (p) => p.catch(() => []);
const games = (l) => l.filter((g) => g.type === "game");
async function streaming() {
    const cc = await country();
    const providers = ((await cached("get-watch-providers", [cc])) || []).slice(0, 3);
    const lists = await Promise.all(providers.map((p) => cached("get-trending-by-provider", [{ providerName: p.name, countryCode: cc }])
        .then((l) => (l || []).map((t) => ({ ...fromProviderTitle(t), sub: `On ${p.name}` }))).catch(() => [])));
    return lists.flat();
}

// Each mood: tile copy, then its options (id, label, icon, pool()).
export const MOODS = [
    { id: "play", interests: ["games"], label: "Play", hint: "Something from your library", icon: "library",
        options: [
            { id: "any", label: "Anything I own", pool: async () => games(await D.library()) },
            { id: "continue", label: "Pick up where I left off", icon: "rift", pool: async () => {
                const lib = games(await D.library());
                const inProgress = new Set(journal.entries().filter((e) => e.status === "progress").map((e) => e.key));
                return lib.filter((g) => inProgress.has(g.key) || (g.lastPlayed && Date.now() - g.lastPlayed < 45 * DAY));
            } },
            { id: "unplayed", label: "Something I've never played", icon: "sparkles", pool: async () => games(await D.library()).filter((g) => !g.playtime && !g.lastPlayed) },
            { id: "favs", label: "One of my favourites", icon: "heart", pool: async () => {
                const fav = new Set(journal.entries().filter((e) => e.favourite || e.rating >= 4).map((e) => e.key));
                return games(await D.library()).filter((g) => g.favourite || fav.has(g.key));
            } },
            { id: "vr", label: "VR", icon: "vr", pool: async () => (await D.library()).filter((g) => g.vr) }
        ] },
    { id: "free", interests: ["free"], label: "Play free", hint: "Claim it or jump straight in", icon: "gift",
        options: [
            { id: "any", label: "Any free game", pool: () => D.freeGames() },
            { id: "new", label: "New this week", icon: "sparkles", pool: async () => D.newFreeGames(await D.freeGames()) },
            { id: "keep", label: "Free to keep", icon: "gift", pool: async () => (await D.freeGames()).filter((g) => !g.alwaysFree) },
            { id: "f2p", label: "Free to play", icon: "play", pool: async () => (await D.freeGames()).filter((g) => g.alwaysFree) },
            { id: "vr", label: "VR", icon: "vr", pool: async () => (await D.freeGames()).filter((g) => g.vr) }
        ] },
    { id: "watch", interests: ["screen", "anime"], label: "Watch", hint: "Films, series and anime", icon: "film",
        options: [
            { id: "any", label: "Anything", pool: async () => [...await settled(D.inCinemas()), ...await settled(D.newSeries()), ...await settled(D.newAnime()), ...await settled(streaming())] },
            { id: "cinema", label: "A film in cinemas", icon: "ticket", pool: () => D.inCinemas() },
            { id: "stream", label: "Something streaming", icon: "tv", pool: streaming },
            { id: "series", label: "A new series", icon: "tv", pool: () => D.newSeries() },
            { id: "anime", label: "Anime", icon: "sparkles", pool: () => D.newAnime() },
            { id: "list", label: "From my watch list", icon: "journal", pool: async () => [...fromJournal(["film", "series", "anime"]), ...await settled(D.watchlist())] }
        ] },
    { id: "read", interests: ["books"], label: "Read", hint: "Books, manga, comics, classics", icon: "book",
        options: [
            { id: "any", label: "Anything", pool: async () => [...await settled(D.ebooks()), ...await settled(D.booksPopular()), ...await settled(D.classics()), ...await settled(D.mangaPopular())] },
            { id: "mine", label: "My eBooks", icon: "book", pool: () => D.ebooks() },
            { id: "classic", label: "A free classic", icon: "gift", pool: () => D.classics() },
            { id: "popular", label: "Popular right now", icon: "flame", pool: async () => [...await settled(D.booksPopular()), ...await settled(D.booksBest())] },
            { id: "manga", label: "Manga or comics", icon: "sparkles", pool: async () => [...await settled(D.mangaPopular()), ...await settled(D.comicsPopular())] },
            { id: "list", label: "From my reading list", icon: "journal", pool: async () => fromJournal(["book"]) }
        ] },
    { id: "any", label: "Surprise me", hint: "Let the rift decide", icon: "dice", energy: true,
        options: [
            { id: "any", label: "Truly anything", pool: async () => {
                const [lib, free, films, series, books] = await Promise.all([settled(D.library()), settled(D.freeGames()), settled(D.inCinemas()), settled(D.newSeries()), settled(D.booksPopular())]);
                // a balanced mix, so one huge list (free games) doesn't drown the rest
                const take = (l, n) => l.slice().sort(() => Math.random() - .5).slice(0, n);
                const n = (id, base) => [0, base, base * 2][interests.level(id)];
                return [...take(games(lib), n("games", 20)), ...take(free, n("free", 20)), ...take(films, n("screen", 15)), ...take(series, n("screen", 15)), ...take(books, n("books", 15))];
            } },
            { id: "planned", label: "Something I planned", icon: "journal", pool: async () => fromJournal(["game", "film", "series", "anime", "book"]) },
            { id: "progress", label: "Something I started", icon: "rift", pool: async () => fromJournal(["game", "film", "series", "anime", "book"], "progress") }
        ] }
];

const ROLL_TITLES = { play: "Tonight you play…", free: "Free, and it's yours…", watch: "Tonight you watch…", read: "Your next read…", any: "The rift has chosen…" };

async function poolFor(mood, option, { skipDone }) {
    let items = ((await option.pool()) || []).filter((i) => i && i.title && !gate.hidden(i));
    const seen = new Set();
    items = items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
    if (skipDone) items = items.filter((i) => { const e = journal.entry(i.key); return !e || (e.status !== "completed" && e.status !== "dropped"); });
    // Don't hand back one of the last few picks when there's plenty else
    const recent = journal.pref("today:recent", []) || [];
    const fresh = items.filter((i) => !recent.includes(i.key));
    return fresh.length >= 3 ? fresh : items;
}
function remember(item) {
    const recent = (journal.pref("today:recent", []) || []).filter((k) => k !== item.key);
    journal.setPref("today:recent", [item.key, ...recent].slice(0, 12));
}

// ---- The portal ------------------------------------------------------------------
let openNow = null;
export function openToday(startMood) {
    if (openNow) openNow.close();
    const canvas = h("canvas", { "aria-hidden": "true" });
    const stage = h("div.today-stack");
    const wrap = h("div.today", { role: "dialog", "aria-modal": "true", "aria-label": "What do you want to do today?", onclick: (e) => { if (e.target === wrap) close(); } },
        canvas, stage,
        h("button.icon-btn.today-close", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x")));
    const rift = new Rift(canvas, { cx: .5, cy: .5, scale: 1.25, intensity: .9 });
    const onKey = (e) => {
        if (e.key !== "Escape" || document.querySelector(".rift-roll")) return;
        e.stopPropagation();
        if (stage.dataset.step === "2" && !startMood) moods(); else close();
    };
    document.addEventListener("keydown", onKey);
    function close() { rift.destroy(); wrap.remove(); document.removeEventListener("keydown", onKey); openNow = null; }
    openNow = { close };
    document.body.appendChild(wrap);

    function moods() {
        stage.dataset.step = "1";
        clear(stage).append(
            h("p.today-kicker", null, icon("rift"), "Riftgate"),
            h("h1.today-title", null, "What do you want to do today?"),
            moodTiles((m) => options(m), true),
            h("p.today-hint", null, "Pick a mood. The rift finds the one thing for you."));
        stage.querySelector(".mood")?.focus();
    }

    function options(mood) {
        startMood = null;
        stage.dataset.step = "2";
        let chosen = mood.options[0];
        let skipDone = journal.pref("today:skipDone", true);
        const counts = new Map();
        const chips = h("div.today-options", { role: "group", "aria-label": "Narrow it down" });
        const go = h("button.btn.primary.xl.today-go", { type: "button" }, icon("rift"), "Open the rift");
        const skip = h("label.today-skip", null,
            h("input", { type: "checkbox", checked: skipDone ? true : null, onchange: (e) => { skipDone = e.target.checked; journal.setPref("today:skipDone", skipDone); } }),
            "Skip what I've finished or dropped");
        const paint = () => {
            clear(chips);
            mood.options.forEach((o) => {
                const n = counts.get(o.id);
                chips.appendChild(h("button.chip.lg", { type: "button", "aria-pressed": String(o === chosen), disabled: n === 0 ? true : null,
                    onclick: () => { chosen = o; paint(); } },
                    o.icon ? icon(o.icon) : null, o.label, h("span.n", null, n === undefined ? "…" : n.toLocaleString())));
            });
        };
        paint();
        mood.options.forEach((o) => poolFor(mood, o, { skipDone }).then((l) => { counts.set(o.id, l.length); if (stage.dataset.step === "2") paint(); }).catch(() => { counts.set(o.id, 0); paint(); }));

        go.onclick = async () => {
            go.disabled = true; go.lastChild.textContent = "Opening…";
            const pool = await poolFor(mood, chosen, { skipDone });
            go.disabled = false; go.lastChild.textContent = "Open the rift";
            if (pool.length < 2) {
                chips.after(h("p.today-empty", null, pool.length ? "Only one thing fits, so here it is." : "Nothing fits that yet. Try another option."));
                if (!pool.length) return;
            }
            wrap.hidden = true;
            const ok = openRoll(pool.length === 1 ? [pool[0], pool[0]] : pool, ROLL_TITLES[mood.id], {
                onPick: remember,
                back: { label: "Change my mind", run: () => { wrap.hidden = false; } },
                onClose: () => { if (!wrap.hidden) return; close(); }
            });
            if (!ok) { wrap.hidden = false; }
        };

        clear(stage).append(
            h("button.btn.ghost.today-back", { type: "button", onclick: moods }, icon("left"), "Moods"),
            h("p.today-kicker", null, icon(mood.icon), mood.label),
            h("h1.today-title", null, mood.id === "any" ? "Anything goes. Narrow it down?" : "How about…"),
            chips, skip, go);
        go.focus();
    }

    const m = startMood && MOODS.find((x) => x.id === startMood);
    if (m) options(m); else moods();
}

// The mood tiles, shared by the portal and the Nexus band
export function moodTiles(onPick, big) {
    const moods = interests.byInterest(MOODS.filter((m) => !m.interests || interests.wants(...m.interests)), (m) => m.interests || ["__"]);
    const any = moods.findIndex((m) => m.id === "any");
    if (any >= 0) moods.push(moods.splice(any, 1)[0]); // the wild card always last
    return h(`div.moods${big ? ".big" : ""}`, { style: { "--n": String(moods.length) } }, moods.map((m) =>
        h(`button.mood${m.energy ? ".energy" : ""}`, { type: "button", onclick: () => onPick(m) },
            h("span.mood-gem", null, icon(m.icon)),
            h("span.mood-label", null, m.label),
            h("span.mood-hint", null, m.hint))));
}

// Inline on Nexus: the question, always one click away
export function todayBand() {
    return h("section.today-band", { "aria-label": "What do you want to do today?" },
        h("div.today-band-copy", null,
            h("h2", null, "What do you want to do today?"),
            h("p", null, "Pick a mood and the rift picks the one thing worth your time.")),
        moodTiles((m) => openToday(m.id)));
}
