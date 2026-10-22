// Riftgate — Journal → Import: your history from Letterboxd, Goodreads, IMDb
// and MyAnimeList (the export file each site gives you), and your public
// Steam wishlist. Nothing you already set in your Journal is changed; things
// only get what they're missing. engine/imports.js reads the files.

import { h, icon, clear } from "../app/dom.js";
import { call, on, openExternal } from "../app/api.js";
import * as journal from "../app/store.js";
import * as alerts from "../app/alerts.js";
import { journalKey, tmdbGenres } from "../app/items.js";
import { plural } from "../app/format.js";
import { toast } from "./toast.js";

const SOURCES = [
    { id: "letterboxd", name: "Letterboxd", what: "films you watched, rated, liked and want to see", how: "On letterboxd.com: Settings → Data → Export your data. Pick the zip it gives you.", url: "https://letterboxd.com/settings/data/" },
    { id: "goodreads", name: "Goodreads", what: "books you read, are reading and want to read", how: "On goodreads.com: My Books → Import and export → Export Library. Pick the .csv file.", url: "https://www.goodreads.com/review/import" },
    { id: "imdb", name: "IMDb", what: "films and series you rated, and your watchlist", how: "On imdb.com: Your ratings (or your Watchlist) → the ⋯ menu → Export. Pick the .csv file.", url: "https://www.imdb.com/list/ratings" },
    { id: "myanimelist", name: "MyAnimeList", what: "anime you watched, are watching and plan to watch", how: "On myanimelist.net: Profile → Export → Anime list. Pick the .xml.gz file.", url: "https://myanimelist.net/panel.php?go=export" }
];
const NAMES = Object.fromEntries(SOURCES.map((s) => [s.id, s.name]));
const NOUN = { film: ["film", "films"], series: ["series", "series"], anime: ["anime", "anime"], book: ["book", "books"], game: ["game", "games"] };

// one listener for the engine's progress, handed to whichever import runs
let progressFn = null;
let listening = false;
function onProgress(fn) {
    if (!listening) { on("r2-import-progress", (p) => progressFn && progressFn(p)); listening = true; }
    progressFn = fn;
}

// an imported item as a Journal entry
export function toEntry(it) {
    const m = it.match || null;
    const yearOf = (d) => (d ? String(d).slice(0, 4) : it.year ? String(it.year) : "");
    let key, item;
    if (it.type === "film") {
        key = m ? `film:${m.tmdbId}` : journalKey("film", it.title, it.year);
        item = { title: m ? m.title : it.title, type: "film", kind: "film", sub: yearOf(m && m.date) || "Film", image: m ? m.image : null, backdrop: m ? m.backdrop : null,
            url: m ? `https://www.themoviedb.org/movie/${m.tmdbId}` : it.url || null, tmdbId: m ? m.tmdbId : null, genres: m ? tmdbGenres(m.genreIds) : [] };
    } else if (it.type === "series" || it.type === "anime") {
        const title = m ? m.title : it.title;
        key = journalKey(it.type, title);
        item = { title, type: it.type, kind: it.type, sub: m && m.date ? `First aired ${yearOf(m.date)}` : it.type === "anime" ? "Anime" : "Series", image: m ? m.image : null, backdrop: m ? m.backdrop : null,
            url: m ? `https://www.themoviedb.org/tv/${m.tmdbShowId}` : it.url || null, tmdbShowId: m ? m.tmdbShowId : null, genres: m ? tmdbGenres(m.genreIds) : [] };
    } else if (it.type === "book") {
        key = journalKey("book", it.title, it.author);
        item = { title: it.title, type: "book", kind: "book", sub: it.author || "Book", image: it.isbn ? `https://covers.openlibrary.org/b/isbn/${it.isbn}-L.jpg?default=false` : null, url: it.url || null, author: it.author || "" };
    } else {
        key = journalKey("game", it.title);
        item = { title: it.title, type: "game", kind: "journal", sub: it.year ? String(it.year) : "Game", image: null, url: it.url || null };
    }
    return {
        key, item,
        status: it.status || null, rating: it.rating || 0, note: it.note || "", favourite: !!it.favourite,
        progress: it.status === "completed" ? 100 : it.progress || 0,
        completedAt: it.status === "completed" ? it.at || null : null,
        at: it.at || it.added || null
    };
}

function what(r) {
    const parts = Object.entries(r.counts || {}).map(([t, n]) => `${n.toLocaleString()} ${(NOUN[t] || [t, t])[n === 1 ? 0 : 1]}`);
    const more = [];
    if (r.completed) more.push(`${r.completed.toLocaleString()} finished`);
    if (r.rated) more.push(`${r.rated.toLocaleString()} rated`);
    if (r.planned) more.push(`${r.planned.toLocaleString()} for later`);
    return `${parts.join(", ")}${more.length ? ` (${more.join(", ")})` : ""}`;
}

export function openImport() {
    if (document.querySelector(".import-box")) return;
    const body = h("div.import-body");
    const box = h("div.wn-box.import-box", null,
        h("div.wn-head", null, h("h2", null, "Import your history"),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
        body);
    const wrap = h("div.wn-modal", { role: "dialog", "aria-modal": "true", "aria-label": "Import your history", onclick: (e) => { if (e.target === wrap && !busy) close(); } }, box);
    let busy = false;
    const onKey = (e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); close(); } };
    function close() { progressFn = null; document.removeEventListener("keydown", onKey, true); wrap.remove(); }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);

    const status = h("p.import-status", { role: "status" });
    const bar = h("div.bar.import-bar", { hidden: true }, h("i"));
    const setBar = (done, total) => { bar.hidden = !total; bar.firstChild.style.width = `${total ? Math.round(done / total * 100) : 0}%`; };

    function start() {
        busy = false;
        clear(body).append(
            h("p.muted", null, "Bring in what you've already watched, read and rated on other sites. Your Journal keeps everything you set in Riftgate: things only get what they're missing."),
            h("div.import-sources", null, SOURCES.map((s) => h("div.import-source", null,
                h("b", null, s.name), h("span", null, s.what),
                h("small.muted", null, s.how, " ", h("button.linkish", { type: "button", onclick: () => openExternal(s.url) }, "Open", icon("external")))))),
            h("div.import-actions", null,
                h("button.btn.primary", { type: "button", onclick: pick }, icon("import"), "Choose the file…"),
                h("button.btn", { type: "button", onclick: steam }, icon("heart"), "Bring in my Steam wishlist")),
            status, bar);
    }

    async function pick() {
        status.textContent = "";
        const r = await call("r2-import-pick").catch((err) => ({ error: err.message }));
        if (!r || r.canceled) return;
        if (r.error) { status.textContent = r.error; return; }
        const go = h("button.btn.primary", { type: "button" }, icon("journal"), "Add to my Journal");
        clear(body).append(
            h("p", null, h("b", null, `${NAMES[r.source] || "Your file"}: `), what(r)),
            h("p.muted", null, r.counts.film || r.counts.series || r.counts.anime
                ? "Films and series are looked up on TMDB first, so they open like everything else in Riftgate. A long list can take a minute; it only happens once."
                : "Nothing you already set in your Journal is changed."),
            h("div.import-actions", null, h("button.btn", { type: "button", onclick: start }, "Back"), go),
            status, bar);
        go.onclick = () => run(r, go);
    }

    async function run(r, go) {
        busy = true;
        go.disabled = true;
        let items = r.items;
        if (items.some((it) => it.type === "film" || it.type === "series" || it.type === "anime")) {
            status.textContent = "Looking them up…";
            onProgress((p) => { status.textContent = p.total ? `Looking them up: ${p.done.toLocaleString()} of ${p.total.toLocaleString()}` : "Looking them up…"; setBar(p.done, p.total); });
            const m = await call("r2-import-match", items).catch(() => null);
            if (m && Array.isArray(m.items)) items = m.items;
        }
        status.textContent = "Adding them to your Journal…";
        await journal.load();
        const res = await journal.importEntries(items.map(toEntry));
        busy = false;
        setBar(0, 0);
        if (!res.ok) { status.textContent = res.error; go.disabled = false; return; }
        clear(body).append(
            h("p.import-done", null, icon("check"), res.added ? `${plural(res.added, "new entry", "new entries")} in your Journal.` : "Nothing new to add."),
            h("p.muted", null, [res.updated ? `${plural(res.updated, "entry", "entries")} you already had got what was missing.` : "", res.already ? `${plural(res.already, "was", "were")} already there as they are.` : ""].filter(Boolean).join(" ") || " "),
            h("div.import-actions", null, h("button.btn", { type: "button", onclick: start }, "Import another"), h("button.btn.primary", { type: "button", onclick: close }, "Done")));
        if (res.added || res.updated) toast(`Imported from ${NAMES[r.source] || "your file"}`, "ok");
    }

    async function steam() {
        busy = true;
        status.textContent = "Asking Steam for your wishlist…";
        const r = await call("r2-import-steam-wishlist").catch((err) => ({ error: err.message }));
        if (!r || r.error) { busy = false; status.textContent = (r && r.error) || "Steam didn't answer."; return; }
        const have = new Set(((await alerts.wishlist({ fresh: true })).items || []).map((it) => it.key));
        const todo = r.items.map((g) => ({ key: journalKey("game", g.title), title: g.title, image: g.image, raw: { steamAppId: g.steamAppId } })).filter((g) => !have.has(g.key));
        let n = 0;
        for (const g of todo) {
            status.textContent = `Adding ${g.title} (${n + 1} of ${todo.length})`;
            setBar(n, todo.length);
            await alerts.wish(g).catch(() => {});
            n++;
        }
        busy = false;
        setBar(0, 0);
        status.textContent = todo.length
            ? `${plural(todo.length, "game")} from your Steam wishlist ${todo.length === 1 ? "is" : "are"} now on your Riftgate wishlist: Riftgate tells you when one gets cheaper.`
            : `All ${plural(r.items.length, "game")} on your Steam wishlist ${r.items.length === 1 ? "was" : "were"} already on your Riftgate wishlist.`;
        if (todo.length) toast("Steam wishlist imported", "ok");
    }

    start();
}
