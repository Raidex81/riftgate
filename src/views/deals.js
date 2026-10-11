// Riftgate — Deals: the biggest current PC game discounts across Steam
// and dozens of stores, priced in your region's currency.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call, forget, country } from "../app/api.js";
import * as D from "../app/data.js";
import { row } from "../components/row.js";
import { shelf } from "../components/shelf.js";
import { pagedGrid } from "../components/paged.js";
import { toast } from "../components/toast.js";
import { plural } from "../app/format.js";
import * as alerts from "../app/alerts.js";

const TIERS = [
    { id: 0, label: "Any discount" },
    { id: 50, label: "50% or more" },
    { id: 75, label: "75% or more" },
    { id: 90, label: "90% or more" }
];

export default {
    async render(root) {
        let tier = 0, store = "all", query = "";
        const tierChips = h("div.chips", { role: "group", "aria-label": "Discount" });
        const storeSel = h("select.input", { "aria-label": "Store" });
        const search = h("input.input", { type: "search", placeholder: "Search deals", "aria-label": "Search deals", style: { width: "220px" } });
        const refresh = h("button.btn", { type: "button" }, icon("refresh"), "Refresh");
        const summary = h("p");
        const body = h("div");
        root.append(
            h("div.view-head", null, h("div", null, h("h1", null, "Deals"), summary), h("div.actions", null, search, refresh)),
            h("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "36px" } }, tierChips, storeSel),
            body);

        let all = [];
        async function load(fresh) {
            if (fresh) {
                refresh.disabled = true;
                await call("force-refresh-store-deals", await country());
                forget("get-store-deals");
                refresh.disabled = false;
                toast("Deals refreshed");
            }
            all = await D.deals({ fresh });
            const stores = [...new Set(all.map((d) => d.source))].sort();
            clear(storeSel).append(h("option", { value: "all" }, "All stores"), ...stores.map((s) => h("option", { value: s }, s)));
            storeSel.value = store;
            summary.textContent = `${plural(all.length, "deal")} across ${plural(stores.length, "store")}, in your currency.`;
            paint();
        }

        function paint() {
            clear(tierChips);
            TIERS.forEach((t) => tierChips.appendChild(h("button.chip", { type: "button", "aria-pressed": String(tier === t.id), onclick: () => { tier = t.id; paint(); } }, t.label)));
            const q = query.trim().toLowerCase();
            const list = all.filter((d) => (d.price.discount || 0) >= tier && (store === "all" || d.source === store) && (!q || d.title.toLowerCase().includes(q)));
            clear(body);
            if (!list.length) { body.appendChild(h("div.empty", null, icon("tag"), h("h3", null, "No deals match"), h("p", null, "Lower the discount or pick another store."))); return; }
            if (store !== "all" || q) {
                body.appendChild(pagedGrid(list.sort((a, b) => (b.price.discount || 0) - (a.price.discount || 0)), {}, body));
                return;
            }
            const byPop = list.slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            // your wishlist first: what you're waiting on, at today's best price
            const wished = alerts.wishlist({ fresh: true }).then((w) => w.items.map((it) => alerts.wishItem(it, w.money)).sort((a, b) => (b.dropped ? 1 : 0) - (a.dropped ? 1 : 0) || (b.price ? b.price.discount : 0) - (a.price ? a.price.discount : 0)));
            body.append(shelf("deals", [
                row({ title: "My wishlist", icon: "heart", id: "wishlist", items: wished, hideEmpty: true, note: "Riftgate tells you when a price drops" }),
                row({ title: "Most popular on sale", icon: "flame", items: byPop }),
                row({ title: "Best reviewed", icon: "star", items: list.filter((d) => d.rating).sort((a, b) => b.rating - a.rating || (b.popularity || 0) - (a.popularity || 0)) }),
                row({ title: "Biggest discounts", icon: "tag", items: list.slice().sort((a, b) => (b.price.discount || 0) - (a.price.discount || 0)) }),
                row({ title: "Cheapest right now", icon: "gem", items: list.filter((d) => typeof d.price.final === "number").sort((a, b) => a.price.final - b.price.final) }),
                row({ title: "Newly added", icon: "sparkles", items: list.filter((d) => d.firstSeenAt).sort((a, b) => b.firstSeenAt - a.firstSeenAt), hideEmpty: true })]));
        }

        storeSel.addEventListener("change", () => { store = storeSel.value; paint(); });
        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 150));
        refresh.onclick = () => load(true);
        // The last known deals show at once; the fresh list repaints when it lands
        const off = D.onChange((name) => { if (!root.isConnected) return off(); if (name === "deals") load(false); });
        await load(false);
    },
    rollTitle: "A deal worth taking",
    async rollPool() { return (await D.deals()).filter((d) => (d.price.discount || 0) >= 50); }
};
