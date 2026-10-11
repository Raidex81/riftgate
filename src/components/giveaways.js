// Riftgate — "Free to keep right now": the giveaways running today on every
// store, with how long each one lasts and a Claim button (which opens the
// store page and remembers you claimed it, so its last-day reminder never
// comes). Under it, the switch that keeps the alerts coming.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { openExternal } from "../app/api.js";
import * as A from "../app/alerts.js";
import { toast } from "./toast.js";

export function giveawayStrip({ onOpen } = {}) {
    const track = h("div.gw-track", { role: "list" });
    const nudge = h("div.gw-nudge");
    const el = h("section.gw", { "aria-label": "Free to keep right now" },
        h("div.gw-head", null, h("h2", null, icon("gift"), "Free to keep right now"), h("span.row-note.gw-note")), track, nudge);

    async function paint() {
        const { live } = await A.giveaways({ fresh: true });
        const list = live.filter((g) => !g.endsAt || g.endsAt > Date.now())
            .sort((a, b) => (a.claimed - b.claimed) || ((a.endsAt || 9e15) - (b.endsAt || 9e15)));
        el.hidden = !list.length;
        el.querySelector(".gw-note").textContent = list.length ? `${list.length} giveaway${list.length === 1 ? "" : "s"}, soonest to end first` : "";
        clear(track);
        list.slice(0, 18).forEach((g) => {
            const left = A.timeLeft(g.endsAt);
            const urgent = g.endsAt && g.endsAt - Date.now() < 24 * 3600e3;
            const btn = h(`button.btn${g.claimed ? ".claimed" : ".primary"}`, { type: "button" }, icon(g.claimed ? "check" : "gift"), g.claimed ? "Claimed" : "Claim");
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (g.url) openExternal(g.url);
                if (!g.claimed) { await A.claim(g.key); g.claimed = true; btn.className = "btn claimed"; clear(btn).append(icon("check"), "Claimed"); toast(`${g.name}: claimed. No reminder for this one.`); }
            };
            track.appendChild(h("div.gw-card", { role: "listitem", tabIndex: 0, title: g.claimed ? "You claimed this one" : "Open its details",
                onclick: () => (onOpen ? onOpen(g) : g.url && openExternal(g.url)), onkeydown: (e) => { if (e.key === "Enter") e.currentTarget.click(); } },
                h("div.gw-art", null, g.image ? h("img", { src: coverSrc(g.image), alt: "", loading: "lazy", onerror: (ev) => ev.target.remove() }) : icon("gift")),
                h("div.gw-body", null,
                    h("span.gw-store", null, g.store),
                    h("b.gw-name", null, g.name),
                    left ? h(`span.gw-left${urgent ? ".urgent" : ""}`, null, icon("clock"), left) : h("span.gw-left", null, "Free for now")),
                btn));
        });
        paintNudge();
    }

    // Alerts: on, and reaching you with the window closed?
    async function paintNudge() {
        const s = await A.alertSettings();
        clear(nudge);
        if (s.free && s.background) return;
        const turnOn = h("button.btn.primary", { type: "button", onclick: async () => {
            const { saveSettings } = await import("../app/api.js");
            await saveSettings({ freeGameAlerts: true });
            await A.keepWatching(true);
            toast("Free-game alerts are on, even with Riftgate's window closed. It waits in the tray.");
            paintNudge();
        } }, icon("bell"), s.free ? "Keep watching in the tray" : "Turn on alerts");
        nudge.append(h("div.gw-nudge-box", null, icon("bell"),
            h("p", null, s.free
                ? "Riftgate tells you when a game goes free and reminds you on its last day. To hear about it with Riftgate's window closed, let it keep watching from the tray."
                : "Free-game alerts are off. Turn them on and Riftgate tells you when a game goes free, and reminds you on its last day."),
            turnOn));
    }

    paint();
    A.onAlertsChanged(() => { if (el.isConnected) paint(); });
    return el;
}
