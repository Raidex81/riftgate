// Riftgate 2 — Free games: everything free to keep or free to play, from
// every store, refreshed by the engine. Newly added first, then one row per
// platform; pick a platform to see all of its games, 100 per page.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as D from "../app/data.js";
import { row } from "../components/row.js";
import { pagedGrid } from "../components/paged.js";
import { toast } from "../components/toast.js";
import { plural } from "../app/format.js";

const WEEK = 7 * 86400000;

export default {
    async render(root) {
        let platform = "all", query = "";
        const chips = h("div.chips", { role: "group", "aria-label": "Platform" });
        const search = h("input.input", { type: "search", placeholder: "Search free games", "aria-label": "Search free games", style: { width: "240px" } });
        const refresh = h("button.btn", { type: "button" }, icon("refresh"), "Refresh");
        const summary = h("p");
        const body = h("div");
        root.append(
            h("div.view-head", null, h("div", null, h("h1", null, "Free games"), summary), h("div.actions", null, search, refresh)),
            h("div", { style: { marginBottom: "36px" } }, chips),
            body);

        let all = [];
        async function load(fresh) {
            if (fresh) {
                refresh.disabled = true;
                const r = await call("force-refresh-free-games");
                forget("get-free-games");
                if (!r) toast("Refresh didn't finish. Showing the last list.", "err");
                refresh.disabled = false;
            }
            all = await D.freeGames({ fresh });
            const fresh7 = all.filter((g) => !g.alwaysFree && g.firstSeenAt && Date.now() - g.firstSeenAt < WEEK).length;
            summary.textContent = `${plural(all.length, "free game")} right now${fresh7 ? `, ${fresh7} added this week` : ""}. Free to keep or free to play, from every store.`;
            paint();
        }

        function paint() {
            const q = query.trim().toLowerCase();
            const match = (g) => !q || g.title.toLowerCase().includes(q);
            const list = all.filter(match);
            const by = new Map();
            list.forEach((g) => { if (!by.has(g.source)) by.set(g.source, []); by.get(g.source).push(g); });
            const vr = list.filter((g) => g.vr);

            clear(chips);
            const chip = (id, label, n) => chips.appendChild(h("button.chip", { type: "button", "aria-pressed": String(platform === id), onclick: () => { platform = id; paint(); } }, label, h("span.n", null, n.toLocaleString())));
            chip("all", "All platforms", list.length);
            [...by.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([src, l]) => chip(src, src, l.length));
            if (vr.length) chip("VR", "VR", vr.length);

            clear(body);
            if (platform !== "all") {
                const items = platform === "VR" ? vr : (by.get(platform) || []);
                body.appendChild(h("h2", { style: { marginBottom: "20px" } }, `${platform} · ${plural(items.length, "game")}`));
                body.appendChild(pagedGrid(items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), null, body));
                return;
            }
            const fresh = list.filter((g) => !g.alwaysFree && g.firstSeenAt && Date.now() - g.firstSeenAt < WEEK)
                .sort((a, b) => b.firstSeenAt - a.firstSeenAt);
            if (fresh.length) body.appendChild(row({ title: "Newly added", icon: "sparkles", items: fresh, seeAllTitle: "Free games added this week" }));
            if (vr.length) body.appendChild(row({ title: "VR", icon: "vr", items: vr, seeAllTitle: "Free VR games" }));
            [...by.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([src, l]) => {
                body.appendChild(row({ title: src, icon: "gift", items: l.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), seeAllTitle: `Free on ${src}` }));
            });
            if (!list.length) body.appendChild(h("div.empty", null, icon("gift"), h("h3", null, q ? `No free game matches “${query}”` : "No free games loaded yet"), h("p", null, q ? "Try another name." : "Press Refresh to check every store now.")));
        }

        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 150));
        refresh.onclick = () => load(true);
        await load(false);
    },
    rollTitle: "Free game time",
    async rollPool() { return D.freeGames(); }
};
