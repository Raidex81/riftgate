// Riftgate 2 — the "See all" browser. Two modes:
//   • full: { kind, providerName } — the complete list from the internet
//     (TMDB, RAWG, Open Library, Gutenberg, itch.io), about 100 per page,
//     every page reachable, nothing capped;
//   • items — everything already loaded, 100 per page.
// Search and sorting apply to the page you're on (full) or the whole list.
// Closes with Esc or the scrim.

import { h, icon, clear, debounce } from "../app/dom.js";
import { card, skeletonCard } from "./card.js";
import * as D from "../app/data.js";

const PAGE = 100;
const SORTS = {
    default: { label: "Recommended", fn: null },
    az: { label: "Name A–Z", fn: (a, b) => a.title.localeCompare(b.title) },
    rating: { label: "Highest rated", fn: (a, b) => (b.rating || 0) - (a.rating || 0) },
    newest: { label: "Newest", fn: (a, b) => String(b.date || b.firstSeenAt || "").localeCompare(String(a.date || a.firstSeenAt || "")) },
    soonest: { label: "Soonest", fn: (a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")) },
    discount: { label: "Biggest discount", fn: (a, b) => ((b.price && b.price.discount) || 0) - ((a.price && a.price.discount) || 0) }
};

export function openBrowser({ title, items = [], full = null, cardOpts }) {
    let pageNo = 1, pages = full ? null : 1, total = null, query = "", sort = "default";
    let pageItems = full ? [] : items;
    let loading = false, error = null, ticket = 0;
    const pageCache = new Map();

    const grid = h("div.grid");
    const pager = h("nav.pager", { "aria-label": "Pages" });
    const countEl = h("span.muted");
    const search = h("input.input", { type: "search", placeholder: full ? "Filter this page" : `Search ${title}`, "aria-label": full ? "Filter this page" : "Search this list" });
    const sortSel = h("select.input", { "aria-label": "Sort" });
    const fillSorts = () => {
        const list = full ? pageItems : items;
        const has = { discount: list.some((i) => i.price), rating: list.some((i) => i.rating), soonest: list.some((i) => i.date && i.date > new Date().toISOString().slice(0, 10)) };
        clear(sortSel).append(...Object.entries(SORTS).filter(([k]) => has[k] !== false).map(([k, s]) => h("option", { value: k }, s.label)));
        sortSel.value = SORTS[sort] && [...sortSel.options].some((o) => o.value === sort) ? sort : "default";
        sort = sortSel.value;
    };

    const scrim = h("div.scrim", { onclick: close });
    const body = h("div.browser-body", null, grid, pager);
    const panel = h("div.browser", { role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div.browser-head", null,
            h("div", null, h("h2", null, title), countEl),
            h("div.tools", null, search, sortSel,
                h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, icon("x")))),
        body);

    async function go(n) {
        pageNo = Math.max(1, n);
        body.scrollTop = 0;
        if (!full) return render();
        const my = ++ticket;
        if (pageCache.has(pageNo)) { apply(pageCache.get(pageNo)); return; }
        loading = true; error = null; render();
        const r = await D.fullPage(full, pageNo);
        if (my !== ticket || !panel.isConnected) return;
        if (!r.error) pageCache.set(pageNo, r);
        apply(r);
        // Warm the next page so turning it is instant
        if ((r.pages === null || pageNo < r.pages) && !pageCache.has(pageNo + 1)) {
            D.fullPage(full, pageNo + 1).then((nx) => { if (!nx.error) pageCache.set(pageNo + 1, nx); }).catch(() => {});
        }
    }
    function apply(r) {
        loading = false;
        error = r.error;
        pageItems = r.items;
        if (r.pages !== undefined) pages = r.pages;
        if (r.total !== null && r.total !== undefined) total = r.total;
        fillSorts();
        render();
    }

    function visible() {
        const q = query.trim().toLowerCase();
        const src = full ? pageItems : items;
        let list = q ? src.filter((i) => (i.title + " " + (i.sub || "") + " " + ((i.provider && i.provider.name) || "")).toLowerCase().includes(q)) : src.slice();
        const fn = SORTS[sort] && SORTS[sort].fn;
        if (fn) list.sort(fn);
        return list;
    }

    function render() {
        clear(grid);
        if (loading) {
            for (let i = 0; i < 24; i++) grid.appendChild(skeletonCard());
            countEl.textContent = `Loading page ${pageNo.toLocaleString()}…`;
            paintPager();
            return;
        }
        let list = visible();
        let shown;
        if (full) {
            shown = list;
            const totalTxt = total ? `${total.toLocaleString()} titles` : "Everything available online";
            countEl.textContent = `${totalTxt} · page ${pageNo.toLocaleString()}${pages ? ` of ${pages.toLocaleString()}` : ""}`;
        } else {
            pages = Math.max(1, Math.ceil(list.length / PAGE));
            pageNo = Math.min(pageNo, pages);
            shown = list.slice((pageNo - 1) * PAGE, pageNo * PAGE);
            countEl.textContent = `${list.length.toLocaleString()} ${list.length === 1 ? "item" : "items"}${pages > 1 ? ` · page ${pageNo} of ${pages}` : ""}`;
        }
        const frag = document.createDocumentFragment();
        shown.forEach((it) => frag.appendChild(card(it, cardOpts)));
        grid.appendChild(frag);
        if (error) {
            grid.appendChild(h("div.empty", { style: { gridColumn: "1 / -1" } }, icon("info"), h("h3", null, error),
                h("button.btn", { type: "button", onclick: () => go(pageNo) }, icon("refresh"), "Try again")));
        } else if (!shown.length) {
            grid.appendChild(h("p.row-empty", null, query ? `Nothing on this page matches “${query}”.` : "Nothing on this page."));
        }
        paintPager();
    }

    function paintPager() {
        clear(pager);
        const known = pages || pageNo + 1; // unknown end: always offer the next page
        if (known < 2) return;
        const btn = (label, n, cur, aria) => h("button", { type: "button", "aria-current": cur ? "page" : null, "aria-label": aria || `Page ${n}`, disabled: loading && !cur, onclick: () => go(n) }, label);
        if (pageNo > 1) pager.appendChild(btn("‹", pageNo - 1, false, "Previous page"));
        const near = new Set([1, pageNo - 2, pageNo - 1, pageNo, pageNo + 1, pageNo + 2].filter((n) => n >= 1 && n <= known));
        if (pages) near.add(pages);
        let last = 0;
        [...near].sort((a, b) => a - b).forEach((n) => {
            if (n - last > 1) pager.appendChild(h("span.muted", null, "…"));
            pager.appendChild(btn(n.toLocaleString(), n, n === pageNo));
            last = n;
        });
        if (!pages || pageNo < pages) pager.appendChild(btn("›", pageNo + 1, false, "Next page"));
        if (pages && pages > 7) {
            const jump = h("input.input.page-jump", { type: "number", min: 1, max: pages, placeholder: "Page", "aria-label": `Go to page (1 to ${pages})` });
            jump.addEventListener("keydown", (e) => {
                if (e.key !== "Enter") return;
                const n = Math.min(pages, Math.max(1, parseInt(jump.value, 10) || 1));
                go(n);
            });
            pager.appendChild(jump);
        }
    }

    search.addEventListener("input", debounce(() => { query = search.value; if (!full) pageNo = 1; render(); }, 120));
    sortSel.addEventListener("change", () => { sort = sortSel.value; if (!full) pageNo = 1; render(); });
    const onKey = (e) => {
        if (document.querySelector(".detail, .trailer-stage")) return;
        if (e.key === "Escape") close();
        else if (e.target === search || e.target.tagName === "INPUT") return;
        else if (e.key === "ArrowRight" && (!pages || pageNo < pages) && !loading) go(pageNo + 1);
        else if (e.key === "ArrowLeft" && pageNo > 1 && !loading) go(pageNo - 1);
    };
    document.addEventListener("keydown", onKey);

    function close() { ticket++; scrim.remove(); panel.remove(); document.removeEventListener("keydown", onKey); }

    document.body.append(scrim, panel);
    fillSorts();
    go(1);
    search.focus();
}
