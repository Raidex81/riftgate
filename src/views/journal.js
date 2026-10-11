// Riftgate — Journal: everything you're playing, watching and reading,
// what you finished, what's next, and how you rated it, across every world.

import { h, icon, clear } from "../app/dom.js";
import * as journal from "../app/store.js";
import * as D from "../app/data.js";
import { TYPE_LABEL } from "../app/items.js";
import { row } from "../components/row.js";
import { pagedGrid } from "../components/paged.js";
import { hours, plural } from "../app/format.js";
import { sealsSection } from "../components/seals.js";
import { openRewind, rewindSeason, rewindYear } from "../components/rewind.js";

const STATUS_ORDER = ["progress", "planned", "completed", "hold", "dropped"];

export default {
    async render(root) {
        await journal.load();
        const lib = await D.library();
        const libByKey = new Map(lib.map((g) => [g.key, g]));
        let type = "all", status = "all";

        const stats = h("div.stats");
        const breakdown = h("div.stat", { style: { gridColumn: "span 2" } });
        const filters = h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", margin: "8px 0 28px" } });
        const favs = h("div");
        const list = h("div");

        root.append(
            h("div.view-head", null, h("div", null, h("h1", null, "Journal"),
                h("p", null, "Your games, films, series, anime and books in one place. Open anything in Riftgate and set its status, rating and progress.")),
                h("div.actions", null, h("button.btn.primary", { type: "button", onclick: () => openRewind(rewindSeason() ? rewindYear() : new Date().getFullYear()) },
                    icon("rift"), rewindSeason() ? `Rift Rewind ${rewindYear()}` : "Your year so far"))),
            stats, sealsSection(), favs, h("h2", null, "Everything you track"), filters, list);

        // Journal entries become Items again (library items keep their Play button)
        const toItem = (e) => libByKey.get(e.key) || { ...e.item, key: e.key, kind: e.item.kind || "journal", desc: "" };

        function paint() {
            const all = journal.entries().filter((e) => e.item);
            const total = all.length;
            const done = all.filter((e) => e.status === "completed").length;
            const rated = all.filter((e) => e.rating);
            const avg = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : 0;
            const playtime = lib.reduce((s, g) => s + (g.playtime || 0), 0);

            clear(stats).append(
                h("div.stat", null, h("b", null, String(total)), h("span", null, total === 1 ? "thing tracked" : "things tracked")),
                h("div.stat", null, h("b", null, String(done)), h("span", null, "completed"), h("div.bar", null, h("i", { style: { width: `${total ? done / total * 100 : 0}%` } }))),
                h("div.stat", null, h("b", null, avg ? avg.toFixed(1) : "–"), h("span", null, rated.length ? `average of ${plural(rated.length, "rating")} (out of 5)` : "no ratings yet")),
                h("div.stat", null, h("b", null, hours(playtime) || "0 h"), h("span", null, "played in your library")),
                breakdown);

            clear(breakdown).append(h("span", null, "By status"), h("div.status-bars", { style: { marginTop: "10px" } },
                STATUS_ORDER.map((s) => {
                    const n = all.filter((e) => e.status === s).length;
                    return h("div.sb", { style: { "--c": `var(--st-${s})` } },
                        h("span.status", { dataset: { s } }, journal.statusLabel(s, "game") === "Playing" && s === "progress" ? "In progress" : journal.statusLabel(s, "game")),
                        h("div.bar", null, h("i", { style: { width: `${total ? n / total * 100 : 0}%` } })),
                        h("span", null, String(n)));
                })));

            clear(favs);
            const favourites = all.filter((e) => e.favourite).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(toItem);
            if (favourites.length) favs.appendChild(row({ title: "Favourites", icon: "heart", items: favourites, cardOpts: { showType: true } }));

            const types = [...new Set(all.map((e) => e.item.type))];
            clear(filters).append(
                h("div.chips", { role: "group", "aria-label": "Type" },
                    ["all", ...types].map((t) => h("button.chip", { type: "button", "aria-pressed": String(type === t), onclick: () => { type = t; paint(); } },
                        t === "all" ? "All types" : TYPE_LABEL[t] || t,
                        h("span.n", null, String(t === "all" ? total : all.filter((e) => e.item.type === t).length))))),
                h("div.chips", { role: "group", "aria-label": "Status" },
                    ["all", ...STATUS_ORDER].map((s) => h("button.chip", { type: "button", "aria-pressed": String(status === s), onclick: () => { status = s; paint(); } },
                        s === "all" ? "Any status" : (s === "progress" ? "In progress" : journal.statusLabel(s, "game"))))));

            const shown = all
                .filter((e) => (type === "all" || e.item.type === type) && (status === "all" || e.status === status))
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .map(toItem);
            clear(list);
            if (!total) {
                list.appendChild(h("div.empty", null, icon("journal"),
                    h("h3", null, "Your journal starts with one click"),
                    h("p", null, "Open any game, film, series or book and give it a status: Playing, Planned, Completed… It'll appear here with your rating and notes."),
                    h("button.btn.primary", { type: "button", onclick: () => { location.hash = "nexus"; } }, icon("nexus"), "Explore Nexus")));
                return;
            }
            list.appendChild(pagedGrid(shown, { showType: true }, list));
        }

        paint();
        const unsub = journal.subscribe(() => { if (root.isConnected) paint(); });
        return unsub;
    },
    rollTitle: "From your plans",
    async rollPool() {
        await journal.load();
        const lib = await D.library();
        const libByKey = new Map(lib.map((g) => [g.key, g]));
        return journal.entries().filter((e) => e.item && (e.status === "planned" || e.status === "progress"))
            .map((e) => libByKey.get(e.key) || { ...e.item, key: e.key, kind: e.item.kind || "journal" });
    }
};
