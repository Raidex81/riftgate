// Riftgate 2 — the universal card. One frame for every kind of content,
// states from the Riftgate board: default, hover, favourite, continue
// (progress ring), featured. Journal status shows as a crystal on the art.

import { h, icon, art, coverSrc } from "../app/dom.js";
import * as journal from "../app/store.js";
import { money, score, hours } from "../app/format.js";
import { TYPE_LABEL } from "../app/items.js";

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

export function card(item, opts) {
    opts = opts || {};
    const el = h("button.card", {
        type: "button",
        class: [opts.wide ? "wide" : "", opts.featured ? "is-featured" : ""].filter(Boolean).join(" ") || undefined,
        "aria-label": `${item.title}${item.sub ? ", " + item.sub : ""}`,
        onclick: () => openDetail(item)
    });
    el._item = item;

    const image = opts.wide ? (item.backdrop || item.image) : item.image;
    const a = art(image, item.title, item.fallback);

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

    el.appendChild(h("div.card-frame", null, h("div.card-body", null, a, info)));

    paintJournal(el, item);
    if (!live.has(item.key)) live.set(item.key, new Set());
    live.get(item.key).add(el);
    return el;
}

function footFor(item, opts) {
    if (opts.foot) return h("div.card-foot", null, opts.foot);
    if (item.price && typeof item.price.final === "number") {
        return h("div.card-foot", null,
            item.price.original ? h("s.muted", null, money(item.price.original, item.price.currency)) : null,
            h("b", null, money(item.price.final, item.price.currency)));
    }
    if (item.kind === "community" && item.visits) {
        return h("div.card-foot", null, icon("arrow"), `${item.visits.toLocaleString()} ${item.visits === 1 ? "visit" : "visits"}`);
    }
    if (item.kind === "library" && item.playtime) {
        return h("div.card-foot", null, icon("clock"), hours(item.playtime));
    }
    return null;
}

export function skeletonCard() {
    return h("div.card.skeleton", null, h("div.card-frame", null, h("div.card-body", null,
        h("div.card-art.skel"), h("div.card-info", null, h("div.card-title.skel"), h("div.card-sub.skel")))));
}
