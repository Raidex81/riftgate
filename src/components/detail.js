// Riftgate 2 — the detail panel. Opens for any item; shows the art, the
// trailer, what you can do with it here, and the Journal controls.

import { h, icon, art, clear, coverSrc } from "../app/dom.js";
import { showtimesUrl } from "../app/regions.js";
import { call, cached, openExternal, forget, country } from "../app/api.js";
import * as journal from "../app/store.js";
import { TYPE_LABEL } from "../app/items.js";
import { hours, ago, dateLong, money, score } from "../app/format.js";
import { toast } from "./toast.js";

let current = null;

export function closeDetail() {
    if (!current) return;
    current.scrim.remove(); current.panel.remove();
    document.removeEventListener("keydown", current.onKey);
    if (current.returnFocus && current.returnFocus.isConnected) current.returnFocus.focus();
    current = null;
}

export function openDetail(item) {
    closeDetail();
    const returnFocus = document.activeElement;

    const cover = h("div.detail-cover");
    const bg = item.backdrop || item.image;
    if (bg) cover.style.backgroundImage = `url("${coverSrc(bg)}")`;
    if (!item.backdrop && item.image) cover.style.filter = "blur(2px) saturate(1.2)";

    const closeBtn = h("button.icon-btn.detail-close", { type: "button", "aria-label": "Close", onclick: closeDetail }, icon("x"));
    const poster = h("div.detail-poster.card", { style: { cursor: "default" } },
        h("div.card-frame", null, h("div.card-body", null, art(item.image, item.title, item.fallback))));

    const meta = h("div.detail-meta", null,
        h("span.type", { dataset: { t: item.type } }, TYPE_LABEL[item.type] || ""),
        item.source ? h("span", null, item.source) : null,
        item.date ? h("span", null, /^\d{4}$/.test(item.date) ? item.date : dateLong(item.date)) : null,
        item.rating ? h("span", null, `★ ${score(item.rating)}${item.ratingText ? " · " + item.ratingText : ""}`) : null,
        item.playtime ? h("span", null, `${hours(item.playtime)} played`) : null,
        item.lastPlayed ? h("span", null, `Last played ${ago(item.lastPlayed)}`) : null,
        item.price && typeof item.price.final === "number"
            ? h("span", null, h("b", { style: { color: "var(--starlight)" } }, money(item.price.final, item.price.currency)),
                item.price.original ? ` instead of ${money(item.price.original, item.price.currency)}` : "")
            : null);

    const actions = h("div.detail-actions");
    const desc = h("p.detail-desc", null, item.desc || "");
    const head = h("div", null, h("h1", null, item.title), item.sub ? h("p.muted", { style: { marginTop: "6px" } }, item.sub) : null, meta, actions);

    const scrim = h("div.scrim", { onclick: closeDetail });
    const panel = h("aside.detail", { role: "dialog", "aria-modal": "true", "aria-label": item.title },
        cover, closeBtn,
        h("div.detail-main", null, poster, head),
        journalBox(item),
        h("div.detail-section", null, h("h3", null, "About"), desc));

    const onKey = (e) => { if (e.key === "Escape") closeDetail(); };
    document.addEventListener("keydown", onKey);
    current = { scrim, panel, onKey, returnFocus };
    document.body.append(scrim, panel);
    closeBtn.focus();

    buildActions(item, actions, cover);
    if (!item.desc) fillDescription(item, desc);
}

// JustWatch in your own country (it calls the UK "uk")
async function openWhereToWatch(title) {
    const cc = (await country()).toLowerCase();
    openExternal(`https://www.justwatch.com/${cc === "gb" ? "uk" : cc}/search?q=${encodeURIComponent(title)}`);
}

// ---- Actions per kind --------------------------------------------------------
function buildActions(item, box, cover) {
    const add = (el) => box.appendChild(el);
    const btn = (label, ico, onclick, primary) => h(`button.btn${primary ? ".primary.lg" : ".lg"}`, { type: "button", onclick }, ico ? icon(ico) : null, label);

    switch (item.kind) {
        case "library":
            add(btn("Play", "play", async () => {
                const r = await call("launch-app", item.raw.path);
                if (!r || r.started === false) toast(`Couldn't start ${item.title}. Check it's still installed.`, "err");
                else toast(r.alreadyRunning ? `${item.title} is already running` : `Starting ${item.title}`);
            }, true));
            break;
        case "free":
            add(btn("Get it free", "gift", () => openExternal(item.url), true));
            break;
        case "deal":
            add(btn(`View deal on ${item.source || "store"}`, "tag", () => openExternal(item.url), true));
            break;
        case "film":
            add(btn("Find tickets", "ticket", () => openExternal(showtimesUrl(item.title)), true));
            add(btn("Where to watch", "tv", () => openWhereToWatch(item.title)));
            break;
        case "series": case "anime": case "show": case "episode":
            add(trackButton(item));
            add(btn("Where to watch", "tv", () => openWhereToWatch(item.title)));
            break;
        case "ebook":
            add(btn("Read", "book", () => call("launch-ebook", item.raw.path), true));
            break;
        case "book": case "search":
            if (item.url) add(btn(item.access === "public" ? "Read free" : "Open", "book", () => openExternal(item.url), true));
            break;
        case "community":
            add(btn(item.source === "GitHub" ? "Open on GitHub" : "Visit", "external", () => {
                if (item.appId != null) call("increment-community-app-visit", item.appId);
                openExternal(item.url);
            }, true));
            break;
        case "upcoming":
            if (item.url) add(btn("Open on RAWG", "external", () => openExternal(item.url), true));
            break;
    }
    if (item.url && !["free", "deal", "upcoming", "book", "search", "community"].includes(item.kind)) {
        add(h("button.icon-btn", { type: "button", "aria-label": "Open web page", title: "Open web page", onclick: () => openExternal(item.url) }, icon("external")));
    }
    trailerButton(item, box, cover);
}

function trackButton(item) {
    const b = h("button.btn.primary.lg", { type: "button" }, icon("plus"), "Track this show");
    cached("get-watchlist").then((list) => {
        if ((list || []).some((s) => s.name && s.name.toLowerCase() === item.title.toLowerCase())) {
            b.classList.remove("primary"); clear(b).append(icon("check"), "Tracking");
            b.disabled = true;
        }
    });
    b.onclick = async () => {
        b.disabled = true;
        const found = await call("search-tv-shows", item.title);
        const show = (found || [])[0];
        if (!show) { toast(`Couldn't find ${item.title} on TVMaze.`, "err"); b.disabled = false; return; }
        await call("add-to-watchlist", { id: show.id, name: show.name, image: show.image, premiered: show.premiered });
        forget("get-watchlist"); forget("get-latest-episodes");
        b.classList.remove("primary"); clear(b).append(icon("check"), "Tracking");
        toast(`Tracking ${show.name}: new episodes will show in Nexus`);
    };
    return b;
}

async function trailerButton(item, box, cover) {
    let idP = null;
    if (item.type === "film" && item.tmdbId) idP = call("get-movie-trailer", item.tmdbId);
    else if ((item.type === "series" || item.type === "anime") && item.tmdbShowId) idP = call("get-tv-show-trailer", item.tmdbShowId);
    else if (item.type === "series" || item.type === "anime") idP = call("get-show-trailer", item.title);
    else if (item.type === "game") idP = call("fetch-trailer", item.title, "game", item.desc || "", item.key, item.raw && item.raw.steamAppId);
    if (!idP) return;
    const res = await idP;
    // Either a YouTube id (string or { videoId }) or a Steam-hosted video URL.
    const raw = typeof res === "string" ? res : (res && (res.videoId || res.key || res.id));
    if (!raw || !box.isConnected) return;
    const isUrl = /^https:\/\/[\w.-]+\.steamstatic\.com\//i.test(raw);
    if (!isUrl && !/^[\w-]{6,20}$/.test(raw)) return;
    box.appendChild(h("button.btn.lg", { type: "button", onclick: () => playTrailer(raw, isUrl, item.title) }, icon("play"), "Watch trailer"));
}

// Trailers play in a large theatre overlay, never squeezed into the panel:
// the bigger player lets YouTube pick HD, and nothing sits on top of it.
function playTrailer(raw, isUrl, title) {
    const player = isUrl
        ? h("video", { src: raw, autoplay: true, controls: true })
        : h("iframe", {
            src: `https://www.youtube.com/embed/${raw}?autoplay=1&rel=0&modestbranding=1&vq=hd1080&playsinline=1`,
            allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
            allowfullscreen: true, title: `${title} trailer`
        });
    const stage = h("div.trailer-stage", { role: "dialog", "aria-modal": "true", "aria-label": `${title} trailer`, onclick: (e) => { if (e.target === stage) close(); } },
        h("div.trailer-frame", null, player),
        h("button.icon-btn.trailer-close", { type: "button", "aria-label": "Close trailer", onclick: () => close() }, icon("x")));
    // Esc closes the trailer only (the panel underneath stays open)
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey, true);
    function close() { window.removeEventListener("keydown", onKey, true); stage.remove(); }
    document.body.appendChild(stage);
}

async function fillDescription(item, el) {
    let text = null;
    if (item.kind === "library") text = await call("fetch-description", item.title);
    else if (item.workKey) text = await call("get-openlibrary-description", item.workKey);
    else if (item.type === "game") text = await call("fetch-description", item.title);
    if (!el.isConnected) return;
    el.textContent = text || "No description available yet.";
    if (!text) el.classList.add("muted");
}

// ---- Journal controls -----------------------------------------------------------
function snapshot(item) {
    return { title: item.title, type: item.type, kind: item.kind, image: item.image || null, backdrop: item.backdrop || null, sub: item.sub || "", url: item.url || null, tmdbId: item.tmdbId || null };
}

function journalBox(item) {
    const box = h("section.journal-box", { "aria-label": "Journal" });
    const render = () => {
        const e = journal.entry(item.key) || {};
        clear(box);
        const fav = h("button.icon-btn" + (e.favourite ? ".on" : ""), {
            type: "button", "aria-pressed": String(!!e.favourite), "aria-label": "Favourite",
            onclick: () => journal.update(item.key, { favourite: !e.favourite }, snapshot(item)).then(render)
        }, icon(e.favourite ? "heartFill" : "heart"));

        const gems = h("div.gems", { role: "group", "aria-label": "Your rating" });
        for (let n = 1; n <= 5; n++) {
            gems.appendChild(h("button" + (e.rating >= n ? ".on" : ""), {
                type: "button", "aria-label": `${n} of 5`, title: `${n} of 5`,
                onclick: () => journal.update(item.key, { rating: e.rating === n ? 0 : n }, snapshot(item)).then(render)
            }, icon("gemSolid")));
        }

        const statuses = h("div.status-pick", { role: "group", "aria-label": "Status" },
            journal.STATUSES.map((s) => h("button.status", {
                type: "button", dataset: { s: s.id }, "aria-pressed": String(e.status === s.id),
                onclick: async () => {
                    const next = e.status === s.id ? null : s.id;
                    await journal.update(item.key, { status: next, progress: next === "completed" ? 100 : e.progress }, snapshot(item));
                    if (next) toast(`${item.title}: ${journal.statusLabel(next, item.type)}`);
                    render();
                }
            }, journal.statusLabel(s.id, item.type))));

        box.append(h("div.head", null, h("h3", null, "Your journal"), fav, gems), statuses);

        if (e.status === "progress") {
            const val = h("b", null, `${e.progress || 0}%`);
            const range = h("input", { type: "range", min: 0, max: 100, step: 5, value: e.progress || 0, "aria-label": "Progress" });
            range.addEventListener("input", () => { val.textContent = `${range.value}%`; });
            range.addEventListener("change", () => journal.update(item.key, { progress: Number(range.value) }, snapshot(item)));
            box.appendChild(h("div.progress-edit", null, "Progress", range, val));
        }
        const note = h("textarea.note-input", { placeholder: "A note to yourself: where you stopped, what you thought…", "aria-label": "Note" });
        note.value = e.note || "";
        note.addEventListener("change", () => journal.update(item.key, { note: note.value.trim() }, snapshot(item)));
        box.appendChild(note);
    };
    journal.load().then(render);
    return box;
}
