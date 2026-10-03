// Riftgate 2 — the universal card. One frame for every kind of content,
// states from the Riftgate board: default, hover, favourite, continue
// (progress ring), featured. Journal status shows as a crystal on the art.

import { h, icon, art, coverSrc } from "../app/dom.js";
import * as journal from "../app/store.js";
import { money, score, hours, countdown, tickCountdowns } from "../app/format.js";
import { TYPE_LABEL } from "../app/items.js";
import * as seen from "../app/seen.js";
import { ambient } from "./ambient.js";

let openDetail = () => {};
export function setDetailOpener(fn) { openDetail = fn; }

// Live cards by Journal key, so a status/rating change updates every card
// showing that item, wherever it is.
const live = new Map();
journal.subscribe((key) => {
    const set = live.get(key);
    if (!set) return;
    for (const el of [...set]) {
        if (!el.isConnected) { set.delete(el); continue; }
        paintJournal(el, el._item);
    }
});

const NS = "http://www.w3.org/2000/svg";
function ring(pct) {
    const r = 15, c = 2 * Math.PI * r;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 38 38");
    svg.setAttribute("class", "progress-ring");
    const mk = (cls, extra) => {
        const el = document.createElementNS(NS, "circle");
        el.setAttribute("cx", 19); el.setAttribute("cy", 19); el.setAttribute("r", r); el.setAttribute("class", cls);
        Object.entries(extra || {}).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    };
    svg.appendChild(mk("track"));
    svg.appendChild(mk("fill", { "stroke-dasharray": c, "stroke-dashoffset": c * (1 - pct / 100) }));
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", 19); t.setAttribute("y", 19.5);
    t.textContent = Math.round(pct);
    svg.appendChild(t);
    return svg;
}

function paintJournal(el, item) {
    const e = journal.entry(item.key);
    el.querySelectorAll(".status, .progress-ring").forEach((n) => n.remove());
    el.classList.toggle("is-favourite", !!(e && e.favourite) || !!item.favourite);
    if (!e) return;
    const artEl = el.querySelector(".card-art");
    if (e.status) {
        artEl.appendChild(h("span.status", { dataset: { s: e.status } }, journal.statusLabel(e.status, item.type)));
    }
    if (e.status === "progress" && e.progress > 0) artEl.appendChild(ring(e.progress));
}

// What to search for when a card has no picture (or a broken one)
export function coverQuery(item) {
    if (!item || !item.title || ["community", "search"].includes(item.kind)) return null;
    const kind = item.kind === "episode" ? "series" : item.type || item.kind;
    const year = item.kind === "episode" ? null : (String(item.date || item.year || "").match(/^\d{4}/) || [null])[0];
    return { kind, year };
}

export function card(item, opts) {
    opts = opts || {};
    const el = h("button.card", {
        type: "button",
        class: [opts.wide ? "wide" : "", opts.featured ? "is-featured" : ""].filter(Boolean).join(" ") || undefined,
        "aria-label": `${item.title}${item.sub ? ", " + item.sub : ""}`,
        onclick: () => openDetail(item)
    });
    el._item = item;
    el.addEventListener("pointerenter", () => ambient(item));

    const image = opts.wide ? (item.backdrop || item.image) : item.image;
    const a = art(image, item.title, item.fallback, coverQuery(item));

    // Top-left: where it's from (or the content type when mixing kinds)
    // (a series or anime shows the service it streams on, with its logo)
    const tagText = opts.showType ? TYPE_LABEL[item.type] : (item.source || null);
    if (!opts.showType && item.provider && item.provider.name) {
        a.appendChild(h("span.tag.provider", { title: `${item.provider.how === "buy" ? "Rent or buy on" : "Streaming on"} ${item.provider.name}` },
            item.provider.logo ? h("img", { src: coverSrc(item.provider.logo), alt: "" }) : null, item.provider.name));
    } else if (tagText) a.appendChild(h("span.tag", null, tagText));

    // Top-right: the one number that matters for this kind
    if (item.price && item.price.discount) a.appendChild(h("span.tag.right.hot", null, `−${item.price.discount}%`));
    else if (item.kind === "free") a.appendChild(h("span.tag.right.hot", null, "Free"));
    else if (item.rating) a.appendChild(h("span.tag.right.score", null, `★ ${score(item.rating)}`));

    const info = h("div.card-info", null,
        h("div.card-title", null, item.title),
        item.sub ? h("div.card-sub", null, item.sub) : null
    );

    const foot = footFor(item, opts);
    if (foot) info.appendChild(foot);
    // Episodes and released films: the seal on the art marks them as watched
    if (seen.canMark(item) && opts.watched !== false) {
        const t = h("span.seal", { role: "button", tabindex: "-1" }, h("span.seal-face", null, icon(seen.isBook(item) ? "book" : "eye")), h("span.seal-label"));
        t.addEventListener("click", async (e) => { e.stopPropagation(); e.preventDefault(); await sealToggle(el, item); });
        a.appendChild(t);
    }

    el.appendChild(h("div.card-frame", null, h("div.card-body", null, a, info)));

    paintJournal(el, item);
    if (seen.canMark(item) && opts.watched !== false) paintSeen(el, item);
    if (!live.has(item.key)) live.set(item.key, new Set());
    live.get(item.key).add(el);
    return el;
}

function footFor(item, opts) {
    if (opts.foot) return h("div.card-foot", null, opts.foot);
    if (opts.reasons && item.reason) return h("div.card-foot.reason", { title: item.reason }, icon("sparkles"), h("span", null, item.reason));
    if (item.price && typeof item.price.final === "number") {
        return h("div.card-foot", null,
            item.price.original ? h("s.muted", null, money(item.price.original, item.price.currency)) : null,
            h("b", null, money(item.price.final, item.price.currency)));
    }
    if (item.kind === "community" && item.visits) {
        return h("div.card-foot", null, icon("arrow"), `${item.visits.toLocaleString()} ${item.visits === 1 ? "visit" : "visits"}`);
    }
    if (item.kind === "episode" && item.next) {
        const at = Date.parse(item.next.airstamp);
        if (at > Date.now()) {
            tickCountdowns();
            return h("div.card-foot.next-ep", { title: `Next: ${item.next.code}${item.next.name ? " · " + item.next.name : ""}\n${new Date(at).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` },
                icon("clock"), h("span", null, `${item.next.code} `), h("b", { dataset: { countdown: String(at) } }, countdown(at)));
        }
    }
    if (item.kind === "library" && item.playtime) {
        return h("div.card-foot", null, icon("clock"), hours(item.playtime) || "0 h", item.playtimeFrom === "Steam" ? h("span.on-steam", null, "on Steam") : null);
    }
    return null;
}

function paintSeen(el, item) {
    const on = seen.isSeen(item);
    el.classList.toggle("is-watched", on);
    const t = el.querySelector(".seal");
    if (!t) return;
    t.querySelector(".seal-face").replaceChildren(icon(on ? "seen" : seen.isBook(item) ? "book" : "eye"));
    const book = seen.isBook(item);
    el.querySelector(".card-art").dataset.seenLabel = book ? "Read" : "Watched";
    t.querySelector(".seal-label").textContent = on ? (book ? "Read" : "Watched") : (book ? "Read it?" : item.kind === "episode" ? "Seen it?" : "Watched it?");
    t.title = book ? (on ? "Already read. Click to mark as not read (W)" : "Mark as already read (W)") : (on ? "Watched. Click to mark as not watched (W)" : "Mark as watched (W)");
    t.setAttribute("aria-label", t.title);
    t.setAttribute("aria-pressed", String(on));
}
// The rift closes over the art when you mark it; it reopens when you unmark it
async function sealToggle(el, item) {
    const now = await seen.toggle(item);
    el.classList.remove("seal-in", "seal-out");
    void el.offsetWidth;
    el.classList.add(now ? "seal-in" : "seal-out");
    setTimeout(() => el.classList.remove("seal-in", "seal-out"), 900);
}
// W marks the card under the pointer (or the focused one) as watched
let hovered = null;
document.addEventListener("pointerover", (e) => { hovered = e.target.closest && e.target.closest(".card"); });
document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "w" || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || "")) return;
    const el = document.querySelector("body.gp-nav .card.gp-focus") || (hovered && hovered.isConnected && hovered.matches(":hover") ? hovered : null)
        || (document.activeElement && document.activeElement.closest && document.activeElement.closest(".card"));
    if (!el || !el._item || !el.querySelector(".seal")) return;
    e.preventDefault();
    sealToggle(el, el._item);
});
seen.load().then(() => document.querySelectorAll(".card").forEach((el) => { if (el._item && seen.canMark(el._item)) paintSeen(el, el._item); }));
seen.onChange(() => document.querySelectorAll(".card").forEach((el) => { if (el._item && seen.canMark(el._item)) paintSeen(el, el._item); }));

export function skeletonCard() {
    return h("div.card.skeleton", null, h("div.card-frame", null, h("div.card-body", null,
        h("div.card-art.skel"), h("div.card-info", null, h("div.card-title.skel"), h("div.card-sub.skel")))));
}
