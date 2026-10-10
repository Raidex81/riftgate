// Riftgate — "What do you want to do today?", the heart of Riftgate.
// Step 1: pick a mood (Play, Play free, Watch, Read, or let the rift decide).
// Step 2: narrow it down (pick up where you left off, something new, a film
// in cinemas, a free classic…). Then the rift rolls and lands on one thing.
// What you've finished or dropped is skipped, and the last picks don't come
// straight back. Also available inline on Nexus (todayBand).

import * as gate from "../app/mature.js";
import { h, icon, clear, coverSrc } from "../app/dom.js";
import { cached, country } from "../app/api.js";
import * as D from "../app/data.js";
import * as journal from "../app/store.js";
import { fromProviderTitle } from "../app/items.js";
import { Rift } from "./rift.js";
import * as interests from "../app/interests.js";
import { openRoll } from "./roll.js";
import { openDetail } from "./detail.js";
import * as ask from "../app/ask.js";

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
        .then((l) => (l || []).map((t) => ({ ...fromProviderTitle(t), sub: `On ${p.name}`, streamOn: { name: p.name, logo: p.logo || null } }))).catch(() => [])));
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

// Everything Riftgate can suggest, for Ask the Rift when the request
// reaches beyond the mood you're in ("a film" asked from the Reading room)
const EVERYTHING = { id: "everything", pool: async () => {
    const lists = await Promise.all([D.library(), D.freeGames(), D.inCinemas(), D.newSeries(), D.newAnime(), streaming(), D.booksPopular(), D.booksBest(), D.classics(), D.mangaPopular(), D.comicsPopular(), D.ebooks(), D.watchlist()].map(settled));
    return [...lists.flat(), ...fromJournal(["game", "film", "series", "anime", "book"])];
} };
const KIND_MOODS = { play: ["game"], free: ["game"], watch: ["film", "series", "anime"], read: ["book", "manga", "comic"] };

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
// opts.ask: open straight on Ask the Rift (the "Ask the Rift" buttons in each section)
export function openToday(startMood, opts = {}) {
    if (openNow) openNow.close();
    const canvas = h("canvas", { "aria-hidden": "true" });
    const stage = h("div.today-stack");
    const wrap = h("div.today", { role: "dialog", "aria-modal": "true", "aria-label": "What do you want to do today?", onclick: (e) => { if (e.target === wrap) close(); } },
        canvas, stage,
        h("button.icon-btn.today-close", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x")));
    const rift = new Rift(canvas, { cx: .5, cy: .5, scale: 1.25, intensity: .9 });
    const onKey = (e) => {
        if (e.key !== "Escape" || document.querySelector(".rift-roll, .detail")) return;
        e.stopPropagation();
        if (stage.dataset.step === "ask" && back) back();
        else if (stage.dataset.step === "2" && !startMood) moods(); else close();
    };
    let back = null; // where Esc goes from the answers
    document.addEventListener("keydown", onKey);
    function close() { rift.destroy(); wrap.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("asking"); openNow = null; }
    openNow = { close };
    document.body.appendChild(wrap);

    function moods() {
        stage.dataset.step = "1";
        clear(stage).append(
            h("p.today-kicker", null, icon("rift"), "Riftgate"),
            h("h1.today-title", null, "What do you want to do today?"),
            moodTiles((m) => options(m), true),
            h("p.today-hint", null, "Pick a mood. The rift finds the one thing for you."),
            askBox(MOODS.find((m) => m.id === "any"), () => MOODS.find((m) => m.id === "any").options[0], () => journal.pref("today:skipDone", true), moods));
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

        const box = askBox(mood, () => chosen, () => skipDone, () => options(mood));
        clear(stage).append(
            h("button.btn.ghost.today-back", { type: "button", onclick: moods }, icon("left"), "Moods"),
            h("p.today-kicker", null, icon(mood.icon), mood.label),
            h("h1.today-title", null, mood.id === "any" ? "Anything goes. Narrow it down?" : "How about…"),
            chips, skip, go, box);
        if (opts.ask) { opts.ask = false; box.querySelector("input").focus(); } else go.focus();
    }

    // ---- Ask the Rift: say what you feel like, in your own words ----------------
    function askBox(mood, option, skipDone, backTo) {
        const input = h("input.input.ask-input", { type: "text", maxlength: 160, autocomplete: "off", spellcheck: "false",
            placeholder: "Or tell the rift what you feel like…", "aria-label": "Tell the rift what you feel like" });
        const submit = (q) => { q = String(q || "").trim(); if (q) answer(mood, option(), skipDone(), q, backTo); };
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(input.value); } });
        return h("div.ask", null,
            h("p.ask-kicker", null, icon("sparkles"), "Ask the Rift"),
            h("div.ask-bar", null, input,
                h("button.btn.primary", { type: "button", onclick: () => submit(input.value) }, icon("rift"), "Ask")),
            h("div.ask-examples", null, (ask.EXAMPLES[mood.id] || ask.EXAMPLES.any).map((t) =>
                h("button.chip", { type: "button", onclick: () => submit(t) }, t))));
    }

    async function answer(mood, option, skipDone, q, backTo, req = ask.understand(q)) {
        stage.dataset.step = "ask";
        back = backTo;
        document.body.classList.add("asking"); // a details panel opens above the portal
        const status = h("p.today-hint", null, "The rift is looking…");
        clear(stage).append(
            h("button.btn.ghost.today-back", { type: "button", onclick: backTo }, icon("left"), "Change my request"),
            h("p.today-kicker", null, icon("sparkles"), "Ask the Rift"),
            h("h1.today-title.ask-title", null, `“${q}”`),
            status);

        if (ask.isEmpty(req)) {
            status.replaceWith(h("div.ask-empty", null,
                h("p", null, "The rift didn't catch that. Try words like funny, scary, cosy, short, co-op, sci-fi, a book, a film, top rated, a hidden gem… or one of these:"),
                h("div.ask-examples", null, (ask.EXAMPLES[mood.id] || ask.EXAMPLES.any).map((t) => h("button.chip", { type: "button", onclick: () => answer(mood, option, skipDone, t, backTo) }, t)))));
            return;
        }
        // Which shelves to look on: the mood you're in, unless you asked for another kind
        const own = KIND_MOODS[mood.id];
        const wide = mood.id === "any" || (req.kinds.size && own && ![...req.kinds].every((k) => own.includes(k)));
        let pool;
        try { pool = await poolFor(mood, wide ? EVERYTHING : option, { skipDone }); } catch { pool = []; }
        if (stage.dataset.step !== "ask") return;
        const { picks, likeItem, likeMissing } = ask.rank(req, pool, { limit: 30 });

        const understood = h("div.ask-understood", { "aria-label": "What the rift understood" },
            h("span.muted", null, "I understood:"),
            ask.summary(req).map((c) => h(`button.chip.ask-chip.${c.type}`, { type: "button", title: "Remove this and ask again",
                onclick: () => answer(mood, option, skipDone, q, backTo, ask.drop(req, c)) }, c.label, icon("x"))));
        const notes = [];
        if (likeMissing) notes.push(`“${req.like}” isn't in Riftgate's lists, so the rift went by the rest of your words.`);
        if (likeItem) notes.push(`Going by what ${likeItem.title} is like.`);
        if (wide && mood.id !== "any") notes.push("Looked everywhere in Riftgate, not only in " + mood.label + ".");

        const grid = h("div.ask-picks");
        let page = 0;
        const paint = () => {
            clear(grid);
            picks.slice(page * 3, page * 3 + 3).forEach((p, n) => grid.appendChild(pickCard(p, n)));
            more.hidden = picks.length <= (page + 1) * 3;
        };
        const more = h("button.btn.lg", { type: "button", onclick: () => { page++; paint(); } }, icon("refresh"), "Three others");
        const roll = h("button.btn.lg", { type: "button", onclick: () => {
            wrap.hidden = true;
            const ok = openRoll(picks.slice(0, 12).map((p) => p.item), "The rift has chosen…", {
                onPick: remember, back: { label: "Back to my answers", run: () => { wrap.hidden = false; } },
                onClose: () => { if (!wrap.hidden) return; close(); } });
            if (!ok) wrap.hidden = false;
        } }, icon("dice"), "Let the rift choose");
        const refine = askBox(mood, () => option, () => skipDone, backTo);
        refine.querySelector("input").value = q;
        refine.querySelector("input").placeholder = "Ask something else…";
        refine.querySelector(".ask-examples").remove();

        status.replaceWith(understood,
            notes.length ? h("p.ask-note", null, notes.join(" ")) : "",
            picks.length ? grid : h("p.today-empty.ask-none", null, "Nothing in Riftgate fits all of that. Remove one of the ideas above, or ask with fewer words."),
            picks.length ? h("div.ask-actions", null, more, picks.length > 3 ? roll : null) : "",
            refine);
        if (picks.length) { paint(); grid.querySelector("button")?.focus(); }
    }

    function pickCard(p, n) {
        const it = p.item;
        const kind = { game: "Game", app: "App", film: "Film", series: "Series", anime: "Anime", book: "Book" }[it.type] || "";
        const where = it.streamOn ? `On ${it.streamOn.name}` : it.inCinemas ? "In cinemas" : it.kind === "free" ? (it.source ? `Free on ${it.source}` : "Free")
            : it.kind === "library" ? "In your library" : it.kind === "ebook" ? "In your eBooks" : it.sub || "";
        const art = it.image || it.fallback;
        return h("button.ask-pick", { type: "button", style: { "--i": String(n) }, "data-type": it.type,
            onclick: () => { remember(it); openDetail(it); } },
            h("span.ask-art", null, art ? h("img", { src: coverSrc(art), alt: "", loading: "lazy", onerror: (e) => { e.target.remove(); } }) : icon(it.type === "book" ? "book" : it.type === "game" ? "gem" : "film")),
            h("span.ask-body", null,
                h("span.ask-kind", null, [kind, where].filter(Boolean).join(" · ")),
                h("b.ask-name", null, it.title),
                p.why.length ? h("span.ask-why", null, p.why.join(" · ")) : null,
                p.quality ? h("span.ask-score", null, icon("star"), p.quality) : null));
    }

    const m = startMood && MOODS.find((x) => x.id === startMood);
    if (opts.ask && !m) { moods(); stage.querySelector(".ask-input")?.focus(); return; }
    if (m) options(m); else moods();
}

// "Ask the Rift" in a section: Surprise me, on that section's mood, with the box ready
export function openAsk(moodId) { openToday(moodId, { ask: true }); }
export function askButton(moodId) {
    return h("button.btn.ask-btn", { type: "button", title: "Tell the rift what you feel like, and it picks for you", onclick: () => openAsk(moodId) }, icon("sparkles"), "Ask the Rift");
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
