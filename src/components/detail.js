// Riftgate — the detail panel. Opens for any item; shows the art, the
// trailer, what you can do with it here, and the Journal controls.

import * as D from "../app/data.js";
import { h, icon, art, clear, coverSrc } from "../app/dom.js";
import { openTickets, ticketsHint } from "../app/regions.js";
import * as seen from "../app/seen.js";
import { manageBox } from "../app/library-tools.js";
import { call, cached, openExternal, forget, country } from "../app/api.js";
import * as journal from "../app/store.js";
import { TYPE_LABEL } from "../app/items.js";
import { hours, ago, dateLong, money, score, countdown, tickCountdowns } from "../app/format.js";
import { toast } from "./toast.js";
import { coverQuery } from "./card.js";
import { recordView } from "../app/foryou.js";
import * as gate from "../app/mature.js";
import * as admin from "../app/admin.js";
import * as alerts from "../app/alerts.js";
import { achievementsBox } from "./achievements.js";
import { newsBox } from "./game-news.js";

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
    recordView(item); // what you look at shapes "Picked for you" (kept on this PC only)
    const returnFocus = document.activeElement;

    const cover = h("div.detail-cover");
    const bg = item.backdrop || item.image;
    if (bg) cover.style.backgroundImage = `url("${coverSrc(bg)}")`;
    if (!item.backdrop && item.image) cover.style.filter = "blur(2px) saturate(1.2)";

    const closeBtn = h("button.icon-btn.detail-close", { type: "button", "aria-label": "Close", onclick: closeDetail }, icon("x"));
    const poster = h("div.detail-poster.card", { style: { cursor: "default" } },
        h("div.card-frame", null, h("div.card-body", null, art(item.image, item.title, item.fallback, coverQuery(item)))));

    const meta = h("div.detail-meta", null,
        h("span.type", { dataset: { t: item.type } }, TYPE_LABEL[item.type] || ""),
        item.source ? h("span", null, item.source) : null,
        item.date ? h("span", null, /^\d{4}$/.test(item.date) ? item.date : dateLong(item.date)) : null,
        item.rating ? h("span", null, `★ ${score(item.rating)}${item.ratingText ? " · " + item.ratingText : ""}`) : null,
        item.playtime || item.playtimeFrom === "Steam" ? h("span", null, `${hours(item.playtime) || "0 h"} played${item.playtimeFrom === "Steam" ? " on Steam" : ""}`) : null,
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
        achievementsBox(item),
        newsBox(item),
        nextEpisodeBox(item),
        h("div.detail-section", null, h("h3", null, "About"), desc),
        item.kind === "library" ? manageBox(item, () => closeDetail()) : null,
        adminBox(item));

    const onKey = (e) => { if (e.key === "Escape") closeDetail(); };
    document.addEventListener("keydown", onKey);
    current = { scrim, panel, onKey, returnFocus };
    document.body.append(scrim, panel);
    closeBtn.focus();

    buildActions(item, actions, cover);
    if (!item.desc) fillDescription(item, desc);
}

// JustWatch in your own country. Its search page is locale-prefixed and
// translated in a few markets (same verified mapping as Riftgate 1.8):
// Portugal and Brazil "busca", Spain "buscar", France "recherche", Germany
// "Suche", Italy "cerca", everywhere else "search"; the UK is "uk", not "gb".
const JW_LOCALE = { GB: "uk" };
const JW_SEARCH = { PT: "busca", BR: "busca", ES: "buscar", FR: "recherche", DE: "Suche", IT: "cerca" };
async function openWhereToWatch(title) {
    const cc = (await country()).toUpperCase();
    const locale = (JW_LOCALE[cc] || cc).toLowerCase();
    openExternal(`https://www.justwatch.com/${locale}/${JW_SEARCH[cc] || "search"}?q=${encodeURIComponent(title)}`);
}

// Straight to the title on the streaming service, for the services whose
// search page takes the title in the address. Any other service goes
// through JustWatch, which links to it.
const WATCH_ON = [
    [/youtube/i, (q) => `https://www.youtube.com/results?search_query=${q}`],
    [/netflix/i, (q) => `https://www.netflix.com/search?q=${q}`],
    [/prime video|amazon video/i, (q) => `https://www.primevideo.com/search?phrase=${q}`],
    [/disney/i, (q) => `https://www.disneyplus.com/search?q=${q}`],
    [/apple tv/i, (q) => `https://tv.apple.com/search?term=${q}`],
    [/crunchyroll/i, (q) => `https://www.crunchyroll.com/search?q=${q}`]
];
const streamService = (item) => (item.streamOn && item.streamOn.name) || (item.provider && item.provider.how !== "buy" && item.provider.name) || null;
function watchOnButton(item, btn, primary) {
    const name = streamService(item);
    if (!name) return null;
    const known = WATCH_ON.find(([re]) => re.test(name));
    return btn(`Watch on ${name}`, "play", () => (known ? openExternal(known[1](encodeURIComponent(item.title))) : openWhereToWatch(item.title)), primary);
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
            // claiming it here means no last-day reminder for it
            add(btn("Get it free", "gift", () => { openExternal(item.url); if (!item.alwaysFree) alerts.claim(item.title); }, true));
            break;
        case "wish":
            if (item.url) add(btn("See the best deal", "tag", () => openExternal(item.url), true));
            break;
        case "deal":
            add(btn(`View deal on ${item.source || "store"}`, "tag", () => openExternal(item.url), true));
            break;
        case "film": {
            // tickets only for a film that's in cinemas now; a film from a
            // streaming service opens on that service
            const watch = watchOnButton(item, btn, !item.inCinemas);
            if (item.inCinemas) add(btn("Find tickets", "ticket", () => openTickets(item.title), true));
            if (watch) add(watch);
            add(btn("Where to watch", "tv", () => openWhereToWatch(item.title), !item.inCinemas && !watch));
            if (seen.canMark(item)) add(watchedButton(item, false));
            break;
        }
        case "episode":
            add(watchedButton(item, true));
            add(btn("Where to watch", "tv", () => openWhereToWatch(item.title)));
            break;
        case "series": case "anime": case "show": {
            add(trackButton(item));
            const watch = watchOnButton(item, btn, false);
            if (watch) add(watch);
            add(btn("Where to watch", "tv", () => openWhereToWatch(item.title)));
            break;
        }
        case "ebook":
            add(btn("Read", "book", () => call("launch-ebook", item.raw.path), true));
            add(watchedButton(item, false));
            break;
        case "book": case "search":
            if (item.url) add(item.listen
                ? btn("Listen free", "play", () => openExternal(item.url), true)
                : btn(item.access === "public" ? "Read free" : "Open", "book", () => openExternal(item.url), true));
            if (seen.canMark(item)) add(watchedButton(item, !item.url));
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
        case "news":
            // a post from the game's developers: read it on Steam, or open the game
            add(btn("Read it on Steam", "external", () => openExternal(item.url), true));
            if (item.game) add(btn(`Open ${item.game.title}`, "play", () => openDetail(item.game)));
            break;
    }
    if (item.url && !["free", "deal", "upcoming", "book", "search", "community", "news"].includes(item.kind)) {
        add(h("button.icon-btn", { type: "button", "aria-label": "Open web page", title: "Open web page", onclick: () => openExternal(item.url) }, icon("external")));
    }
    if (item.type === "game" && ["deal", "upcoming", "search", "wish"].includes(item.kind)) add(wishButton(item, btn));
    trailerButton(item, box, cover);
}

// The wishlist: Riftgate watches its price and tells you when it drops
function wishButton(item, btn) {
    const b = btn("Add to wishlist", "heart", null, false);
    let on = false;
    const paint = () => { clear(b).append(icon(on ? "check" : "heart"), on ? "On your wishlist" : "Add to wishlist"); b.classList.toggle("is-on", on); b.title = on ? "Riftgate tells you when its price drops. Click to take it off" : "Riftgate tells you when its price drops"; };
    alerts.onWishlist(item.key).then((v) => { on = v; paint(); });
    b.onclick = async () => {
        b.disabled = true;
        if (on) { await alerts.unwish(item.key); on = false; toast(`${item.title} is off your wishlist`); }
        else {
            const r = await alerts.wish(item);
            if (r && r.item) { on = true; toast(r.priced === false ? `${item.title} is on your wishlist. Riftgate will look for its price.` : `${item.title} is on your wishlist: you'll hear when its price drops`); }
            else toast((r && r.error) || "It couldn't be added. Try again.", "err");
        }
        b.disabled = false; paint();
    };
    paint();
    return b;
}

// The seal, as a button: "Watched it?" until you have
function watchedButton(item, primary) {
    const b = h(`button.btn.lg.seal-btn${primary ? ".primary" : ""}`, { type: "button" });
    const paint = () => {
        const on = seen.isSeen(item);
        const book = seen.isBook(item);
        clear(b).append(icon(on ? "seen" : book ? "book" : "eye"), on ? (book ? "Already read" : "Watched") : (book ? "Mark as already read" : item.kind === "episode" ? "Mark episode as watched" : "Mark as watched"));
        b.classList.toggle("is-on", on); b.classList.toggle("primary", primary && !on);
        b.setAttribute("aria-pressed", String(on));
    };
    seen.load().then(paint);
    paint();
    b.onclick = async () => {
        const now = await seen.toggle(item); paint();
        b.classList.remove("pop"); void b.offsetWidth; if (now) b.classList.add("pop");
        toast(seen.isBook(item) ? (now ? `${item.title}: already read` : `${item.title}: back to unread`) : (now ? `${item.title}: watched` : `${item.title}: back to unwatched`));
    };
    return b;
}

// The next episode of a show you track, with a live countdown
function nextEpisodeBox(item) {
    const n = item.next;
    const at = n && Date.parse(n.airstamp);
    if (!at || at <= Date.now()) return null;
    tickCountdowns();
    return h("section.detail-section.next-episode", null,
        h("h3", null, "Next episode"),
        h("div.next-ep-row", null,
            h("b.next-ep-code", null, n.code),
            h("div.grow", null, h("div", null, n.name || "Title not announced yet"),
                h("div.muted", null, new Date(at).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))),
            h("b.next-ep-count", { dataset: { countdown: String(at) } }, countdown(at))));
}

function trackButton(item) {
    const b = h("button.btn.primary.lg", { type: "button" }, icon("plus"), "Track this show");
    let showId = null;
    const paint = () => { b.classList.toggle("primary", !showId); clear(b).append(icon(showId ? "check" : "plus"), showId ? "In My shows" : "Track this show"); b.title = showId ? "Click to stop following it" : "Add it to My shows: its new episodes show up in Nexus"; };
    cached("get-watchlist").then((list) => {
        const s = (list || []).find((x) => (item.tvmazeId && x.id === item.tvmazeId) || (x.name && x.name.toLowerCase() === item.title.toLowerCase()));
        if (s) { showId = s.id; paint(); }
    });
    b.onclick = async () => {
        b.disabled = true;
        if (showId) {
            await call("remove-from-watchlist", showId);
            toast(`${item.title} is no longer in My shows`);
            showId = null;
        } else {
            const found = item.tvmazeId ? [{ id: item.tvmazeId, name: item.title, image: item.image, premiered: item.date }] : await call("search-tv-shows", item.title);
            const show = (found || [])[0];
            if (!show) { toast(`Couldn't find ${item.title} on TVMaze. Try Add a show in the Theatre.`, "err"); b.disabled = false; return; }
            await call("add-to-watchlist", { id: show.id, name: show.name, image: show.image, premiered: show.premiered });
            toast(`${show.name} is in My shows: new episodes will show up in Nexus`);
            showId = show.id;
        }
        b.disabled = false; paint();
        D.watchlistChanged();
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
    // a way out for a video that can't play inside Riftgate ("Video unavailable")
    const onYouTube = isUrl ? null : h("button.btn.sm.trailer-youtube", { type: "button", title: "Open this trailer on YouTube, in your browser",
        onclick: () => { openExternal(`https://www.youtube.com/watch?v=${raw}`); close(); } }, icon("external"), "Watch on YouTube");
    const stage = h("div.trailer-stage", { role: "dialog", "aria-modal": "true", "aria-label": `${title} trailer`, onclick: (e) => { if (e.target === stage) close(); } },
        h("div.trailer-frame", null, player),
        onYouTube,
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
    const raw = item.raw || {};
    return { title: item.title, type: item.type, kind: item.kind, image: item.image || null, backdrop: item.backdrop || null, sub: item.sub || "", url: item.url || null, tmdbId: item.tmdbId || null,
        // what it's like, so Ask the Rift can learn your taste from what you rate
        genres: (item.genres || []).slice(0, 6), tags: (Array.isArray(raw.tags) ? raw.tags : item.genre ? [item.genre] : []).slice(0, 6).map(String),
        subjects: (item.subjects || []).slice(0, 10), about: String(item.desc || raw.description || "").slice(0, 400) };
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

        // Remove from your Journal: status, rating, favourite, progress and note
        // all go at once (with a few seconds to undo)
        if (journal.entry(item.key)) {
            const removeBtn = h("button.link-btn.jb-remove", { type: "button" }, icon("trash"), "Remove from your Journal");
            removeBtn.onclick = async () => {
                const before = { ...journal.entry(item.key) };
                await journal.update(item.key, { status: null, rating: 0, favourite: false, progress: 0, note: "" });
                render();
                const undo = h("button.link-btn", { type: "button", onclick: async () => {
                    const { item: snap, updatedAt, ...back } = before;
                    await journal.update(item.key, back, snap || snapshot(item));
                    render(); toast(`${item.title} is back in your Journal`);
                } }, "Undo");
                const gone = h("p.jb-removed", null, icon("check"), `Removed from your Journal. `, undo);
                box.appendChild(gone);
                setTimeout(() => gone.remove(), 8000);
            };
            box.appendChild(h("div.jb-foot", null, removeBtn));
        }
    };
    journal.load().then(render);
    return box;
}

// Admins only: mark a title as mature (or clear it), or remove it from
// Riftgate for everyone. Same server lists as Riftgate 1.x, so a decision
// made in either app applies in both.
function adminBox(item) {
    if (!gate.isAdmin() || !gate.modKeys(item).length) return null;
    const matureBtn = h("button.btn", { type: "button" });
    const paint = () => { clear(matureBtn).append(icon("eye"), gate.markedMature(item) ? "Clear the mature mark" : "Mark as mature"); };
    paint();
    matureBtn.onclick = async () => {
        matureBtn.disabled = true;
        const r = await gate.adminToggleMature(item, admin.run);
        matureBtn.disabled = false;
        if (r && r.success) { paint(); toast(r.isMature ? "Marked as mature: only adults who turned mature titles on see it" : "Mature mark cleared"); }
        else if (r) toast(r.error || "That didn't work", "err");
    };
    let armed = 0;
    const removeBtn = h("button.btn.danger", { type: "button" }, icon("trash"), "Remove from Riftgate");
    removeBtn.onclick = async () => {
        if (Date.now() - armed > 4000) { armed = Date.now(); clear(removeBtn).append(icon("trash"), "Click again: removes it for everyone"); return; }
        removeBtn.disabled = true;
        const r = await gate.adminRemove(item, admin.run);
        removeBtn.disabled = false;
        if (r && r.success) { toast(`${item.title} is removed from Riftgate for everyone`); closeDetail(); }
        else { armed = 0; clear(removeBtn).append(icon("trash"), "Remove from Riftgate"); if (r) toast(r.error || "That didn't work", "err"); }
    };
    return h("div.detail-section.admin-box", null, h("h3", null, icon("shield"), "Admin"),
        h("p.muted", null, "Applies to everyone, in every version of Riftgate."),
        h("div.admin-actions", null, matureBtn, removeBtn));
}
