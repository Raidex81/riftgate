// Riftgate 2 — the command palette (Ctrl+K / "/"): one box to search your
// library, your Journal, everything loaded in the app, and the web (Steam,
// TMDB, Open Library), plus jump to any section.

import { h, icon, clear, coverSrc, debounce } from "../app/dom.js";
import { call } from "../app/api.js";
import { fromSearchHit, TYPE_LABEL } from "../app/items.js";
import { openDetail } from "./detail.js";

// Views register what they've loaded, so search is instant for those.
const sources = new Map(); // name -> () => Item[]
export function registerSource(name, getItems) { sources.set(name, getItems); }

let commands = [];
export function setCommands(list) { commands = list; }

let open = null;

export function openPalette(initial = "") {
    if (open) { open.input.focus(); return; }
    const input = h("input", { type: "text", placeholder: "Search games, films, series, books, or type a command", "aria-label": "Search", autocomplete: "off", spellcheck: "false" });
    const body = h("div.palette-body", { role: "listbox" });
    const scrim = h("div.scrim", { onclick: close, style: { zIndex: 69 } });
    const panel = h("div.palette", { role: "dialog", "aria-modal": "true", "aria-label": "Search" },
        h("div.palette-input", null, icon("search"), input, h("kbd", null, "Esc")),
        body,
        h("div.palette-hint", null, h("span", null, "↑ ↓ to move"), h("span", null, "Enter to open"), h("span", null, "Online results appear as you pause")));

    let rows = [], sel = 0, token = 0;

    function close() { scrim.remove(); panel.remove(); document.removeEventListener("keydown", onKey, true); open = null; }

    function select(i) {
        sel = Math.max(0, Math.min(rows.length - 1, i));
        rows.forEach((r, n) => r.el.setAttribute("aria-selected", String(n === sel)));
        rows[sel] && rows[sel].el.scrollIntoView({ block: "nearest" });
    }

    function render(groups) {
        clear(body); rows = [];
        groups.forEach(([label, list]) => {
            if (!list.length) return;
            body.appendChild(h("div.palette-group", null, label));
            list.forEach((r) => {
                const el = h("button.palette-item", { type: "button", role: "option", onclick: () => { close(); r.run(); } },
                    r.image ? h("img", { src: coverSrc(r.image), alt: "", loading: "lazy" }) : h("span.thumb", null, icon(r.icon || "gem")),
                    h("span.t", null, h("b", null, r.title), r.sub ? h("span", null, r.sub) : null));
                el.addEventListener("mousemove", () => select(rows.findIndex((x) => x.el === el)));
                rows.push({ el, run: r.run });
                body.appendChild(el);
            });
        });
        if (!rows.length) body.appendChild(h("div.palette-group", null, input.value.trim() ? "Searching online…" : "Type to search"));
        select(0);
    }

    function local(q) {
        const ql = q.toLowerCase();
        const cmd = commands.filter((c) => !q || c.title.toLowerCase().includes(ql)).slice(0, q ? 5 : 8)
            .map((c) => ({ ...c }));
        if (!q) return [["Go to", cmd]];
        const seen = new Set();
        const found = [];
        for (const [, get] of sources) {
            for (const it of get() || []) {
                if (found.length >= 40) break;
                const k = it.key + it.kind;
                if (seen.has(k)) continue;
                if (it.title && it.title.toLowerCase().includes(ql)) {
                    seen.add(k);
                    found.push(it);
                }
            }
        }
        found.sort((a, b) => a.title.toLowerCase().indexOf(ql) - b.title.toLowerCase().indexOf(ql));
        const asRow = (it) => ({ title: it.title, sub: `${TYPE_LABEL[it.type] || ""}${it.sub ? " · " + it.sub : ""}`, image: it.image, run: () => openDetail(it) });
        return [["In Riftgate", found.slice(0, 12).map(asRow)], ["Go to", cmd]];
    }

    const online = debounce(async (q) => {
        const my = ++token;
        if (q.trim().length < 2) return;
        const res = await call("web-search-all", { query: q.trim(), includeMature: false });
        if (my !== token || !panel.isConnected) return;
        const hits = ((res && res.results) || []).map(fromSearchHit);
        const groups = local(q);
        const by = (t) => hits.filter((x) => x.type === t).slice(0, 5)
            .map((it) => ({ title: it.title, sub: it.sub || TYPE_LABEL[it.type], image: it.image, run: () => openDetail(it) }));
        render([groups[0], ["Games online", by("game")], ["Films", by("film")], ["Series", by("series")], ["Books", by("book")], groups[1]]);
    }, 380);

    input.addEventListener("input", () => { token++; render(local(input.value.trim())); online(input.value); });

    function onKey(e) {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); select(sel + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); select(sel - 1); }
        else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); const r = rows[sel]; close(); r.run(); }
    }
    document.addEventListener("keydown", onKey, true);

    document.body.append(scrim, panel);
    open = { input };
    input.value = initial;
    render(local(initial));
    if (initial) online(initial);
    input.focus();
}
