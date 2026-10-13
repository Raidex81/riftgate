// Riftgate — shelves. A row shows the first ROW_LIMIT cards; "See all"
// beside the title opens the browser. Rows backed by an internet list
// (opts.full) page through everything that exists; the rest show every item
// already loaded, 100 per page.
//
// opts: { id, title, icon, note, items (array, promise, or function that
//         returns either — functions repaint when their data refreshes),
//         wide, cardOpts, seeAllTitle, empty, hideEmpty, tools, limit,
//         full: { kind, providerName }, enhance: async (items) => items,
//         seeAll: async () => items (what See all lists, when it's more than the row),
//         quietSource: the section shows its source's state itself (sectionState) }

import { h, icon, clear } from "../app/dom.js";
import { slug } from "../app/items.js";
import * as D from "../app/data.js";
import { card, skeletonCard } from "./card.js";
import { openBrowser } from "./browser.js";
import { describe, retry } from "../app/sources.js";

// The same two states on every row when an outside source fails (sources.js):
// a small "Saved 3 h ago" beside the title when the row shows a saved copy,
// and a clear message with Try again in place of the cards when there's
// nothing to show.
export function sourceNote(state) {
    return h("button.source-chip", { type: "button", title: state.text + " Click to try again.", onclick: (e) => { e.currentTarget.classList.add("is-busy"); retry(); } },
        icon("refresh"), state.label);
}
// For a section fed by one source (Free games, Deals): its state once, beside
// the section's title, instead of on every row. Rows there pass quietSource.
export function sectionState(slot, items) {
    clear(slot);
    const state = describe(D.statusOf(items), (items || []).length);
    if (state && state.kind === "saved") slot.appendChild(sourceNote(state));
    return state;
}
export function sourceFailed(state) {
    return h("div.source-failed", { role: "status" },
        icon(state.label === "Offline" ? "wifi-off" : "alert"),
        h("p", null, state.text),
        h("button.btn.sm", { type: "button", onclick: (e) => { e.currentTarget.disabled = true; retry(); } }, icon("refresh"), "Try again"));
}

export const ROW_LIMIT = 20;

export function row(opts) {
    const track = h("div.row-track", { role: "list" });
    const left = h("button.row-arrow", { type: "button", "aria-label": "Scroll left", onclick: () => page(-1) }, icon("left"));
    const right = h("button.row-arrow", { type: "button", "aria-label": "Scroll right", onclick: () => page(1) }, icon("right"));
    const seeAll = h("button.see-all", { type: "button", hidden: true }, "See all", icon("arrow"));
    const count = h("span.row-note");
    const stateSlot = h("span.row-state");
    const grip = h("button.row-grip", { type: "button", title: "Drag to reorder (or focus and use ↑ ↓)", "aria-label": `Move ${opts.title}` }, icon("grip"));

    const head = h("div.row-head", null,
        grip,
        h("h2", null, opts.icon ? icon(opts.icon) : null, opts.title),
        seeAll,
        opts.note ? h("span.row-note", null, opts.note) : count,
        stateSlot,
        h("div.row-tools", null, opts.tools || null, left, right));
    const el = h("section.row", { "aria-label": opts.title, dataset: { rowId: opts.id || slug(opts.title) } }, head, track);

    function page(dir) { track.scrollBy({ left: dir * (track.clientWidth - 60), behavior: "smooth" }); }

    const limit = opts.limit || ROW_LIMIT;
    const title = opts.seeAllTitle || opts.title;
    if (opts.full) {
        seeAll.hidden = false;
        seeAll.onclick = () => openBrowser({ title, full: opts.full, cardOpts: opts.cardOpts });
    }
    for (let i = 0; i < 7; i++) track.appendChild(skeletonCard());

    let shownKeys = "";
    function paint(items) {
        const state = opts.quietSource ? null : describe(D.statusOf(items), (items || []).filter(Boolean).length);
        items = (items || []).filter(Boolean);
        clear(stateSlot);
        if (state && state.kind === "saved") stateSlot.appendChild(sourceNote(state));
        const keys = items.slice(0, limit).map((i) => i.key + (i.provider ? "@" + i.provider.name : "")).join("|") + (state ? "#" + state.kind : "");
        if (keys === shownKeys && track.firstChild && !track.querySelector(".skeleton")) return;
        shownKeys = keys;
        const x = track.scrollLeft;
        clear(track);
        if (!items.length) {
            left.hidden = right.hidden = true;
            if (state && state.kind === "failed") {
                // a source failed: say so, even on a row that hides when it's simply empty
                el.hidden = false;
                track.appendChild(sourceFailed(state));
                return;
            }
            if (opts.hideEmpty) { el.hidden = true; return; }
            track.appendChild(h("p.row-empty", null, opts.empty || "Nothing here right now."));
            return;
        }
        el.hidden = false;
        left.hidden = right.hidden = false;
        const frag = document.createDocumentFragment();
        items.slice(0, limit).forEach((it) => frag.appendChild(card(it, { wide: opts.wide, ...(opts.cardOpts || {}) })));
        track.appendChild(frag);
        track.scrollLeft = x;
        if (!opts.note) count.textContent = !opts.full && items.length > limit ? items.length.toLocaleString() : "";
        if (opts.seeAll) {
            // a custom "See all" (e.g. everything in your library, not just what the row shows)
            seeAll.hidden = false;
            seeAll.onclick = async () => openBrowser({ title, items: (await opts.seeAll()) || items, cardOpts: opts.cardOpts });
        } else if (!opts.full && items.length > limit) {
            seeAll.hidden = false;
            seeAll.onclick = () => openBrowser({ title, items, cardOpts: opts.cardOpts });
        }
    }

    const get = () => Promise.resolve(typeof opts.items === "function" ? opts.items() : opts.items);
    function load() {
        return get().then((items) => {
            paint(items);
            if (opts.enhance && items && items.length) {
                Promise.resolve(opts.enhance(items)).then((more) => { if (el.isConnected) paint(more || items); }).catch(() => {});
            }
        }).catch((err) => {
            console.error(err);
            clear(track).appendChild(sourceFailed({ label: "Error", text: "This row couldn't load." }));
        });
    }
    load();

    // Function-backed rows repaint when their source refreshes in the background
    if (typeof opts.items === "function") {
        const off = D.onChange(() => { if (el.isConnected) load(); else off(); /* view was left */ });
    }
    return el;
}
