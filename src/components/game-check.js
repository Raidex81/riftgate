// Riftgate — two questions a game's details answer before you buy it:
// "Buy now or wait?" (its best price now, the lowest it has ever been, and
// whether PC Game Pass already includes it; engine/prices.js) and "Will it
// run on this PC?" (its Steam requirements against this PC; engine/pc-check.js).

import { h, icon } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import { money, dateLong } from "../app/format.js";
import { steamIdOf } from "../app/items.js";

// ---- Buy now or wait? -----------------------------------------------------------------
const PRICE_KINDS = new Set(["deal", "wish", "search", "upcoming", "journal"]);
const VERDICT = {
    lowest: { cls: "good", icon: "check", say: () => "Lowest price ever. A great time to buy." },
    good: { cls: "good", icon: "check", say: (p, m) => `Close to its lowest (${m(p.lowest)}). A good price.` },
    wait: { cls: "wait", icon: "clock", say: (p, m) => `On sale, but it has been ${m(p.lowest)}. Wait if you can.` },
    full: { cls: "wait", icon: "clock", say: (p, m, r) => `Full price. It has been ${m(p.lowest)}${r.lowestOff ? ` (−${r.lowestOff}%)` : ""}: wait for a sale.` },
    steady: { cls: "even", icon: "info", say: () => "Its price hardly ever changes, so there's no need to wait." }
};

export function priceBox(item) {
    if (!item || item.type !== "game" || !PRICE_KINDS.has(item.kind)) return null;
    const body = h("div.check-body", null, h("p.muted", null, "Comparing prices…"));
    const box = h("section.detail-section.game-check.price-check", { "aria-label": "Buy now or wait?" },
        h("div.check-head", null, h("h3", null, icon("tag"), "Buy now or wait?"), h("span.muted", null, "Every store CheapShark follows")), body);
    call("r2-price-check", { title: item.title, steamAppId: steamIdOf(item) }).then((r) => {
        body.replaceChildren();
        if (!r || (!r.price && !r.gamePass)) { box.remove(); return; }
        const m = (usd) => money(usd * r.money.rate, r.money.currency);
        if (r.gamePass) body.append(h("p.check-line.pass", null, icon("gem"), h("b", null, "Included with PC Game Pass"), h("span.muted", null, " · if you have it, there's nothing to buy")));
        const p = r.price;
        if (!p) return;
        const v = VERDICT[r.verdict];
        if (v) body.append(h(`p.check-verdict.${v.cls}`, null, icon(v.icon), v.say(p, m, r)));
        body.append(
            h("div.check-facts", null,
                h("div", null, h("span.muted", null, "Now"), h("b", null, m(p.price)), p.store ? h("small.muted", null, `at ${p.store}${r.off > 0 ? ` (−${r.off}%)` : ""}`) : null),
                p.lowest != null ? h("div", null, h("span.muted", null, "Lowest ever"), h("b", null, m(p.lowest)), p.lowestAt ? h("small.muted", null, dateLong(new Date(p.lowestAt).toISOString())) : null) : null,
                p.retail > 0 ? h("div", null, h("span.muted", null, "Usual price"), h("b", null, m(p.retail)), h("small.muted", null, `${p.stores} ${p.stores === 1 ? "store" : "stores"} compared`)) : null),
            p.dealID ? h("button.linkish.check-link", { type: "button", onclick: () => openExternal(`https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(p.dealID))}`) }, `Open the best price${p.store ? ` (${p.store})` : ""}`, icon("external")) : null);
    }).catch(() => box.remove());
    return box;
}

// ---- Will it run on this PC? --------------------------------------------------------------
const RUN = {
    great: { cls: "good", icon: "check", say: "Runs well: this PC beats the recommended requirements." },
    ok: { cls: "good", icon: "check", say: "Runs: this PC meets the minimum, so expect lower settings in places." },
    below: { cls: "bad", icon: "alert", say: "Below the minimum: it may not run well, or at all." },
    unknown: { cls: "even", icon: "info", say: "Riftgate couldn't compare everything. The requirements are below." }
};
const PART = { gpu: "Graphics", cpu: "Processor", ram: "Memory" };
const mark = (s) => (s === "great" ? icon("check") : s === "ok" ? icon("check") : s === "below" ? icon("x") : icon("info"));

export function pcBox(item) {
    if (!item || item.type !== "game") return null;
    if (["news", "free"].includes(item.kind) && !steamIdOf(item)) return null;
    const body = h("div.check-body", null, h("p.muted", null, "Comparing with this PC…"));
    const box = h("section.detail-section.game-check.pc-check", { "aria-label": "Will it run on this PC?" },
        h("div.check-head", null, h("h3", null, icon("app"), "Will it run on this PC?"), h("span.muted", null, "An estimate, from Steam's requirements")), body);
    call("r2-pc-check", { title: item.title, steamAppId: steamIdOf(item) }).then((r) => {
        body.replaceChildren();
        if (!r || !r.verdict) { box.remove(); return; }
        const v = RUN[r.verdict] || RUN.unknown;
        body.append(h(`p.check-verdict.${v.cls}`, null, icon(v.icon), v.say));
        if (r.weakest && r.verdict === "below") body.append(h("p.muted", null, `What holds it back: ${PART[r.weakest] ? PART[r.weakest].toLowerCase() : r.weakest}.`));
        const rows = h("div.check-parts");
        for (const p of r.parts || []) {
            rows.append(h(`div.check-part.${p.state || "unknown"}`, null,
                h("span.check-mark", { "aria-hidden": "true" }, mark(p.state)),
                h("div", null, h("b", null, PART[p.id] || p.id), h("span", null, p.yours || "Not detected")),
                h("div.check-need", null,
                    p.min ? h("small", null, h("span.muted", null, "Minimum: "), p.min) : null,
                    p.rec ? h("small", null, h("span.muted", null, "Recommended: "), p.rec) : null)));
        }
        body.append(rows);
        if (r.notes) body.append(h("p.muted.check-note", null, r.notes));
    }).catch(() => box.remove());
    return box;
}
