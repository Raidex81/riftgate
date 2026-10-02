// Riftgate 2 — the "See all" browser: every item of a row, 100 per page,
// with a search box and sorting. Closes with Esc or the scrim.

import { h, icon, clear, debounce } from "../app/dom.js";
import { card } from "./card.js";

const PAGE = 100;
const SORTS = {
    default: { label: "Recommended", fn: null },
    az: { label: "Name A–Z", fn: (a, b) => a.title.localeCompare(b.title) },
    rating: { label: "Highest rated", fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
    newest: { label: "Newest", fn: (a, b) => String(b.date || b.firstSeenAt || "").localeCompare(String(a.date || a.firstSeenAt || "")) },
    discount: { label: "Biggest discount", fn: (a, b) => ((b.price && b.price.discount) || 0) - ((a.price && a.price.discount) || 0) }
};

export function openBrowser({ title, items, cardOpts }) {
    const hasPrice = items.some((i) => i.price);
    const hasRating = items.some((i) => i.rating);
    let pageNo = 1, query = "", sort = "default";

    const grid = h("div.grid");
    const pager = h("nav.pager", { "aria-label": "Pages" });
    const countEl = h("span.muted");
    const search = h("input.input", { type: "search", placeholder: `Search ${title}`, "aria-label": "Search this list" });
    const sortSel = h("select.input", { "aria-label": "Sort" },
        Object.entries(SORTS)
            .filter(([k]) => (k !== "discount" || hasPrice) && (k !== "rating" || hasRating))
            .map(([k, s]) => h("option", { value: k }, s.label)));

    const scrim = h("div.scrim", { onclick: close });
    const body = h("div.browser-body", null, grid, pager);
    const panel = h("div.browser", { role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div.browser-head", null,
            h("div", null, h("h2", null, title), countEl),
            h("div.tools", null, search, sortSel,
                h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, icon("x")))),
        body);

    function visible() {
        const q = query.trim().toLowerCase();
        let list = q ? items.filter((i) => (i.title + " " + (i.sub || "")).toLowerCase().includes(q)) : items.slice();
        const fn = SORTS[sort].fn;
        if (fn) list.sort(fn);
        return list;
    }

    function render() {
        const list = visible();
        const pages = Math.max(1, Math.ceil(list.length / PAGE));
        pageNo = Math.min(pageNo, pages);
        countEl.textContent = `${list.length.toLocaleString()} ${list.length === 1 ? "item" : "items"}${pages > 1 ? ` · page ${pageNo} of ${pages}` : ""}`;
        clear(grid);
        const frag = document.createDocumentFragment();
        list.slice((pageNo - 1) * PAGE, pageNo * PAGE).forEach((it) => frag.appendChild(card(it, cardOpts)));
        grid.appendChild(frag);
        if (!list.length) grid.appendChild(h("p.row-empty", null, `Nothing matches “${query}”.`));
        clear(pager);
        if (pages > 1) {
            const btn = (label, n, cur) => h("button", { type: "button", "aria-current": cur ? "page" : null, onclick: () => { pageNo = n; render(); body.scrollTop = 0; } }, label);
            if (pageNo > 1) pager.appendChild(btn("‹", pageNo - 1));
            const near = new Set([1, pages, pageNo - 1, pageNo, pageNo + 1].filter((n) => n >= 1 && n <= pages));
            let last = 0;
            [...near].sort((a, b) => a - b).forEach((n) => {
                if (n - last > 1) pager.appendChild(h("span.muted", null, "…"));
                pager.appendChild(btn(String(n), n, n === pageNo));
                last = n;
            });
            if (pageNo < pages) pager.appendChild(btn("›", pageNo + 1));
        }
    }

    search.addEventListener("input", debounce(() => { query = search.value; pageNo = 1; render(); }, 120));
    sortSel.addEventListener("change", () => { sort = sortSel.value; pageNo = 1; render(); });
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".detail")) close(); };
    document.addEventListener("keydown", onKey);

    function close() { scrim.remove(); panel.remove(); document.removeEventListener("keydown", onKey); }

    document.body.append(scrim, panel);
    render();
    search.focus();
}
