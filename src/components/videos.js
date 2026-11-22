// Riftgate — a YouTube video as a card (the Watch page and Nexus's strip), the
// videos you've seen and the ones you saved for later, and a player that says
// when its video ends (YouTube's embed talks to the page by postMessage, so no
// script of YouTube's ever runs in Riftgate's window).

import { h, icon, clear } from "../app/dom.js";
import { call } from "../app/api.js";
import * as interests from "../app/interests.js";
import * as journal from "../app/store.js";
import { locale } from "../app/i18n.js";
import { ago } from "../app/format.js";

export const thumb = (id, q = "mqdefault") => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
export const views = (n) => { try { return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n || 0); } catch (e) { return String(n || 0); } };

// ---- Seen, and saved for later (in your Journal's settings) ---------------------------------------------------
const SEEN = "watch:seen", LATER = "watch:later";
export const isSeen = (id) => (journal.pref(SEEN, null) || []).includes(id);
export function markSeen(id) {
    const list = (journal.pref(SEEN, null) || []).filter((x) => x !== id);
    journal.setPref(SEEN, [id, ...list].slice(0, 500));
}
export const later = () => (journal.pref(LATER, null) || []).filter((v) => v && v.id);
export const isLater = (id) => later().some((v) => v.id === id);
export function toggleLater(v) {
    const list = later();
    const on = !list.some((x) => x.id === v.id);
    const keep = ({ id, title, channel, views: n, published, description, section }) => ({ id, title, channel, views: n, published, description: (description || "").slice(0, 300), section });
    journal.setPref(LATER, on ? [keep(v), ...list].slice(0, 60) : list.filter((x) => x.id !== v.id));
    return on;
}

// Nexus's strip asks Watch to play a video when the page opens
export function playOnOpen(v) { try { sessionStorage.setItem("watch:open", JSON.stringify(v)); } catch (e) { /* */ } location.hash = "watch"; }

// a card: the picture, its rank and views, the title and channel; a tick once you've seen it
export function videoCard(v, { rank = null, onClick } = {}) {
    const seen = isSeen(v.id);
    return h(`button.wt-card${seen ? ".seen" : ""}`, { type: "button", dataset: { id: v.id }, title: v.title, onclick: () => onClick && onClick(v) },
        h("span.wt-thumb", null, h("img", { src: thumb(v.id), alt: "", loading: "lazy", onerror: (e) => { e.target.style.visibility = "hidden"; } }),
            rank ? h("span.wt-rank", null, `#${rank}`) : null,
            h("span.wt-views", null, icon("eye"), views(v.views)),
            seen ? h("span.wt-seen", null, icon("check"), h("span", null, "Seen")) : null,
            h("span.wt-hover", null, icon("play"))),
        h("span.wt-title", { translate: "no" }, v.title),
        h("span.wt-sub", null, h("span", { translate: "no" }, v.channel), " · ", h("span", null, ago(v.published))));
}

// A player that tells the page what happens: onEnd when the video finishes, onError when YouTube
// won't play it here (its owner doesn't allow it outside YouTube). Returns the iframe and a stop().
export function player(id, { title = "", onEnd, onError } = {}) {
    const origin = location.origin && location.origin !== "null" ? location.origin : "";
    const frame = h("iframe", { src: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`,
        title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true });
    let done = false;
    const listen = () => { try { frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: "rg", channel: "widget" }), "https://www.youtube.com"); } catch (e) { /* */ } };
    frame.addEventListener("load", () => { listen(); setTimeout(listen, 800); });
    const onMsg = (e) => {
        if (e.origin !== "https://www.youtube.com" || e.source !== frame.contentWindow || done) return;
        let m = e.data;
        if (typeof m === "string") { try { m = JSON.parse(m); } catch (err) { return; } }
        if (!m || typeof m !== "object") return;
        const state = m.event === "onStateChange" ? m.info : m.event === "infoDelivery" && m.info && typeof m.info.playerState === "number" ? m.info.playerState : null;
        if (state === 0) { done = true; if (onEnd) onEnd(); }
        if (m.event === "onError") { done = true; if (onError) onError(m.info); }
    };
    window.addEventListener("message", onMsg);
    return { el: frame, stop: () => window.removeEventListener("message", onMsg) };
}

// Nexus: the most watched videos right now, from the sections you're into; a click plays it in Watch
export function watchStrip() {
    const track = h("div.wt-track");
    const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" });
    const el = h("section.wt-row.nx-watch", { hidden: true },
        h("div.wt-rowhead", null, h("div", null, h("h2", null, icon("play"), h("span", null, "Most watched now")), h("p.muted", null, "The videos everyone is watching from game, film, TV and book channels.")),
            h("div.actions", null, h("button.icon-btn", { type: "button", "aria-label": "Back", onclick: () => step(-1) }, icon("left")), h("button.icon-btn", { type: "button", "aria-label": "More", onclick: () => step(1) }, icon("right")),
                h("button.btn.ghost", { type: "button", onclick: () => { location.hash = "watch"; } }, "Open Watch", icon("right")))),
        track);
    call("r2-videos", { days: 14 }).then((r) => {
        if (!r || !r.sections) return;
        const picked = [];
        for (const s of r.sections) if (interests.level(s.interest) > 0) picked.push(...s.videos.slice(0, 6).map((v) => ({ ...v, section: s.label })));
        const top = picked.sort((a, b) => b.views - a.views).slice(0, 14);
        if (top.length < 4) return;
        clear(track).append(...top.map((v, i) => videoCard(v, { rank: i + 1, onClick: playOnOpen })));
        el.hidden = false;
    }).catch(() => { /* no strip */ });
    return el;
}
