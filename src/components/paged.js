// Riftgate — an inline grid that shows 100 items per page with page
// buttons below (used when a section is narrowed to one source).

import { h, clear } from "../app/dom.js";
import { card } from "./card.js";

export const PAGE = 100;

export function pagedGrid(items, cardOpts, scroller) {
    const grid = h("div.grid");
    const pager = h("nav.pager", { "aria-label": "Pages" });
    const el = h("div", null, grid, pager);
    let page = 1;
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    function render() {
        clear(grid);
        const frag = document.createDocumentFragment();
        items.slice((page - 1) * PAGE, page * PAGE).forEach((it) => frag.appendChild(card(it, cardOpts)));
        grid.appendChild(frag);
        clear(pager);
        if (pages < 2) return;
        const btn = (label, n, cur) => h("button", { type: "button", "aria-current": cur ? "page" : null, onclick: () => { page = n; render(); (scroller || grid).scrollIntoView({ block: "start", behavior: "smooth" }); } }, label);
        if (page > 1) pager.appendChild(btn("‹", page - 1));
        let last = 0;
        [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b).forEach((n) => {
            if (n - last > 1) pager.appendChild(h("span.muted", null, "…"));
            pager.appendChild(btn(String(n), n, n === page));
            last = n;
        });
        if (page < pages) pager.appendChild(btn("›", page + 1));
    }
    if (!items.length) grid.appendChild(h("p.row-empty", null, "Nothing matches."));
    else render();
    return el;
}
