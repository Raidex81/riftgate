// Riftgate — a small notice under the title bar while outside sources are
// failing: who isn't answering, that rows show what Riftgate saved where they
// can, and Try again. It goes away by itself once they answer again, and when
// the computer comes back online Riftgate tries again on its own.

import { h, icon, clear } from "../app/dom.js";
import { on } from "../app/api.js";
import { failingNow, noteHealth, retry, clearFailing } from "../app/sources.js";

export function mountSourcesBanner(parent) {
    const el = h("div.source-banner", { role: "status", "aria-live": "polite", hidden: true });
    parent.appendChild(el);
    let dismissed = "";

    function paint() {
        const { list, offline } = failingNow();
        const key = list.map((f) => f.id).sort().join(",") + (offline ? "!" : "");
        if (!list.length || key === dismissed) { el.hidden = true; return; }
        clear(el);
        const labels = [...new Set(list.map((f) => f.label))];
        const who = labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
        el.append(
            icon(offline ? "wifi-off" : "alert"),
            h("span", null, offline
                ? "You're offline. Riftgate is showing what it saved, and fills in the rest once you're back."
                : `${who} ${labels.length === 1 ? "isn't" : "aren't"} answering right now. Rows show what Riftgate saved where they can.`),
            h("button.source-banner-retry", { type: "button", onclick: () => { clearFailing(); retry(); } }, icon("refresh"), "Try again"),
            h("button.source-banner-close", { type: "button", "aria-label": "Hide this notice", onclick: () => { dismissed = key; el.hidden = true; } }, icon("x")));
        el.hidden = false;
    }

    window.addEventListener("r2-sources-changed", paint);
    on("r2-provider-status-changed", (list) => noteHealth(list));
    // back online: try everything again without being asked
    window.addEventListener("online", () => { if (failingNow().list.length) { clearFailing(); retry(); } });
    return el;
}
