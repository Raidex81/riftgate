// Riftgate 2 — shelves. A row shows the first ROW_LIMIT cards; "See all"
// beside the title opens the browser with everything, 100 per page.

import { h, icon, clear } from "../app/dom.js";
import { card, skeletonCard } from "./card.js";
import { openBrowser } from "./browser.js";

export const ROW_LIMIT = 20;

// opts: { title, icon, note, items (array or promise), wide, cardOpts,
//         seeAllTitle, empty, tools (element), limit }
export function row(opts) {
    const track = h("div.row-track", { role: "list" });
    const left = h("button.row-arrow", { type: "button", "aria-label": "Scroll left", onclick: () => page(-1) }, icon("left"));
    const right = h("button.row-arrow", { type: "button", "aria-label": "Scroll right", onclick: () => page(1) }, icon("right"));
    const seeAll = h("button.see-all", { type: "button", hidden: true }, "See all", icon("arrow"));
    const count = h("span.row-note");

    const head = h("div.row-head", null,
        h("h2", null, opts.icon ? icon(opts.icon) : null, opts.title),
        seeAll,
        opts.note ? h("span.row-note", null, opts.note) : count,
        h("div.row-tools", null, opts.tools || null, left, right));
    const el = h("section.row", { "aria-label": opts.title }, head, track);

    function page(dir) { track.scrollBy({ left: dir * (track.clientWidth - 60), behavior: "smooth" }); }

    const limit = opts.limit || ROW_LIMIT;
    for (let i = 0; i < 7; i++) track.appendChild(skeletonCard());

    Promise.resolve(opts.items).then((items) => {
        items = (items || []).filter(Boolean);
        clear(track);
        if (!items.length) {
            if (opts.hideEmpty) { el.remove(); return; }
            track.appendChild(h("p.row-empty", null, opts.empty || "Nothing here right now."));
            left.hidden = right.hidden = true;
            return;
        }
        const frag = document.createDocumentFragment();
        items.slice(0, limit).forEach((it) => frag.appendChild(card(it, { wide: opts.wide, ...(opts.cardOpts || {}) })));
        track.appendChild(frag);
        if (!opts.note) count.textContent = items.length > limit ? `${items.length.toLocaleString()}` : "";
        if (items.length > limit) {
            seeAll.hidden = false;
            seeAll.onclick = () => openBrowser({ title: opts.seeAllTitle || opts.title, items, cardOpts: opts.cardOpts });
        }
    }).catch((err) => {
        console.error(err);
        clear(track).appendChild(h("p.row-empty", null, "This row couldn't load. Check your connection, then refresh."));
    });

    return el;
}
