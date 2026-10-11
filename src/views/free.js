// Riftgate — Free games: everything free to keep or free to play, from
// every store, refreshed by the engine. Newly added first, then VR (every
// VR game from every store), then one row per platform. Pick a platform (or
// VR) to see all of it, with genre and sort; 100 per page.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as D from "../app/data.js";
import { row } from "../components/row.js";
import { shelf } from "../components/shelf.js";
import { pagedGrid } from "../components/paged.js";
import { toast } from "../components/toast.js";
import { plural } from "../app/format.js";
import { askButton } from "../components/today.js";
import { giveawayStrip } from "../components/giveaways.js";
import { openDetail } from "../components/detail.js";
import { slug } from "../app/items.js";

const SORTS = {
    popular: { label: "Most popular", fn: (a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0) || b.popularity - a.popularity || (b.firstSeenAt || 0) - (a.firstSeenAt || 0) },
    newest: { label: "Newest", fn: (a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0) || b.popularity - a.popularity },
    az: { label: "Name A–Z", fn: (a, b) => a.title.localeCompare(b.title) },
    za: { label: "Name Z–A", fn: (a, b) => b.title.localeCompare(a.title) }
};

export default {
    async render(root) {
        let platform = "all", query = "", genre = "all", sort = "popular";
        const chips = h("div.chips", { role: "group", "aria-label": "Platform" });
        const search = h("input.input", { type: "search", placeholder: "Search free games", "aria-label": "Search free games", style: { width: "240px" } });
        const refresh = h("button.btn", { type: "button" }, icon("refresh"), "Refresh");
        const summary = h("p");
        const body = h("div");
        // the giveaways running today, with their deadlines (a card opens the game's details when Riftgate has it)
        const strip = giveawayStrip({ onOpen: (g) => { const it = all.find((x) => slug(x.title) === slug(g.name)); if (it) openDetail(it); else if (g.url) import("../app/api.js").then((m) => m.openExternal(g.url)); } });
        root.append(
            h("div.view-head", null, h("div", null, h("h1", null, "Free games"), summary), h("div.actions", null, askButton("free"), search, refresh)),
            strip,
            h("div", { style: { marginBottom: "36px" } }, chips),
            body);

        let all = [], newSet = new Set();
        async function load(fresh) {
            if (fresh) {
                refresh.disabled = true;
                const r = await call(platform !== "all" && platform !== "VR" ? "force-refresh-free-games-platform" : "force-refresh-free-games", platform !== "all" && platform !== "VR" ? platform : undefined);
                forget("get-free-games");
                if (!r) toast("Refresh didn't finish. Showing the last list.", "err");
                refresh.disabled = false;
            }
            all = await D.freeGames({ fresh });
            newSet = new Set(D.newFreeGames(all));
            const n = newSet.size;
            summary.textContent = `${plural(all.length, "free game")} right now${n ? `, ${n} added this week` : ""}. Free to keep or free to play, from every store.`;
            paint();
        }
        const isNew = (g) => newSet.has(g);
        // A stray store entry literally named "VR" belongs to the VR list, not a platform of its own
        const platformOf = (g) => (g.source === "VR" ? null : g.source);

        function paint() {
            const q = query.trim().toLowerCase();
            const list = all.filter((g) => !q || g.title.toLowerCase().includes(q));
            const by = new Map();
            list.forEach((g) => { const p = platformOf(g); if (!p) return; if (!by.has(p)) by.set(p, []); by.get(p).push(g); });
            const vr = list.filter((g) => g.vr);
            const platforms = [...by.entries()].sort((a, b) => b[1].length - a[1].length);

            clear(chips);
            const chip = (id, label, n, ico) => chips.appendChild(h("button.chip", { type: "button", "aria-pressed": String(platform === id),
                onclick: () => { platform = id; genre = "all"; paint(); } }, ico ? icon(ico) : null, label, h("span.n", null, n.toLocaleString())));
            chip("all", "All platforms", list.length);
            if (vr.length) chip("VR", "VR", vr.length, "vr");
            platforms.forEach(([src, l]) => chip(src, src, l.length));

            clear(body);
            if (platform !== "all") return paintOne(platform === "VR" ? vr : (by.get(platform) || []));

            const rows = [];
            const fresh = list.filter(isNew).sort(SORTS.newest.fn);
            if (fresh.length) rows.push(row({ title: "Newly added", icon: "sparkles", items: fresh, seeAllTitle: "Free games added this week" }));
            if (vr.length) rows.push(row({ title: "VR", icon: "vr", note: `${vr.length.toLocaleString()} from every store`,
                items: vr.slice().sort((a, b) => (a.vr === "native" ? 0 : 1) - (b.vr === "native" ? 0 : 1) || SORTS.popular.fn(a, b)), seeAllTitle: "Every free VR game" }));
            platforms.forEach(([src, l]) => {
                // itch.io has far more free games than any list can hold: its See all pages through all of them
                const itch = /^itch/i.test(src) && !q;
                rows.push(row({ title: src, icon: "gift", items: l.slice().sort(SORTS.popular.fn), note: `${l.length.toLocaleString()} free`,
                    seeAllTitle: itch ? "Free on itch.io, newest and popular" : `Free on ${src}`, full: itch ? { kind: "itch" } : null }));
            });
            if (rows.length) body.appendChild(shelf("free", rows));
            if (!list.length) body.appendChild(h("div.empty", null, icon("gift"), h("h3", null, q ? `No free game matches “${query}”` : "No free games loaded yet"), h("p", null, q ? "Try another name." : "Press Refresh to check every store now.")));
        }

        // One platform (or VR): every game, with genre and sort
        function paintOne(items) {
            const genres = new Map();
            items.forEach((g) => { if (g.genre) genres.set(g.genre, (genres.get(g.genre) || 0) + 1); });
            const shown = items.filter((g) => genre === "all" || g.genre === genre).sort(SORTS[sort].fn);
            const sortSel = h("select.input", { "aria-label": "Sort" }, Object.entries(SORTS).map(([k, s]) => h("option", { value: k }, s.label)));
            sortSel.value = sort;
            sortSel.onchange = () => { sort = sortSel.value; paint(); };
            const genreSel = h("select.input", { "aria-label": "Genre", hidden: genres.size < 2 },
                h("option", { value: "all" }, "All genres"),
                [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => h("option", { value: g }, `${g} (${n})`)));
            genreSel.value = genre;
            genreSel.onchange = () => { genre = genreSel.value; paint(); };
            body.appendChild(h("div.free-one-head", null,
                h("h2", null, platform === "VR" ? "VR" : platform, h("span.muted", null, ` · ${plural(shown.length, "game")}`)),
                h("div.actions", null, genreSel, sortSel)));
            if (platform === "VR") {
                // made for VR (headset needed) and ordinary games you can also play in VR
                const native = shown.filter((g) => g.vr === "native"), adapted = shown.filter((g) => g.vr === "adapted");
                if (native.length) body.append(h("h3.free-sub", null, `Made for VR · ${native.length.toLocaleString()}`), pagedGrid(native, {}, body));
                if (adapted.length) body.append(h("h3.free-sub", null, `Also playable in VR · ${adapted.length.toLocaleString()}`), pagedGrid(adapted, {}, body));
                if (!shown.length) body.appendChild(h("p.row-empty", null, "Nothing matches."));
                return;
            }
            body.appendChild(pagedGrid(shown, {}, body));
        }

        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 150));
        refresh.onclick = () => load(true);
        // The last known list shows at once; the fresh one repaints when it lands
        const off = D.onChange((name) => { if (!root.isConnected) return off(); if (name === "free") load(false); });
        await load(false);
    },
    rollTitle: "Free game time",
    async rollPool() { return D.freeGames(); }
};
