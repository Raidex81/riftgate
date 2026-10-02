// Riftgate 2 — "Open a random rift" (Surprise Me). Picks from the current
// view's list: a reel of cards streaks past in front of the portal and
// decelerates onto the winner, which lands with a flare. Instant with
// reduced motion. Esc or the backdrop closes it.

import { h, icon, clear } from "../app/dom.js";
import { card } from "./card.js";
import { Rift } from "./rift.js";
import { openDetail } from "./detail.js";

export function openRoll(items, title = "Open a random rift") {
    items = (items || []).filter((i) => i && i.title);
    if (items.length < 2) return false;

    // A fresh random selection every time (never the same few in a row)
    const pool = items.slice().sort(() => Math.random() - .5).slice(0, 24);
    const winner = pool[Math.floor(Math.random() * pool.length)];

    const canvas = h("canvas", { "aria-hidden": "true" });
    const reel = h("div.reel");
    const heading = h("h2", null, title);
    const result = h("div", { style: { display: "flex", gap: "12px", minHeight: "46px" } });
    const wrap = h("div.rift-roll", { role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e) => { if (e.target === wrap) close(); } },
        canvas, h("div.stack", null, heading, reel, result));
    const rift = new Rift(canvas, { cx: .5, cy: .55, scale: 1.05, intensity: 1.5 });
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    function close() { rift.destroy(); wrap.remove(); document.removeEventListener("keydown", onKey); }
    document.body.appendChild(wrap);

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = (it, cls) => { clear(reel); const c = card(it); if (cls) c.classList.add(cls); c.onclick = null; reel.appendChild(c); };

    function land() {
        clear(reel);
        const c = card(winner); c.classList.add("win"); c.onclick = () => { close(); openDetail(winner); };
        reel.appendChild(c);
        heading.textContent = winner.title;
        clear(result).append(
            h("button.btn.primary.lg", { type: "button", onclick: () => { close(); openDetail(winner); } }, icon("rift"), "Open it"),
            h("button.btn.lg", { type: "button", onclick: () => { close(); openRoll(items, title); } }, icon("dice"), "Roll again"),
            h("button.btn.lg.ghost", { type: "button", onclick: close }, "Close"));
    }

    if (reduced) { land(); return true; }

    // Decelerating flicker: fast at first, slowing toward the winner.
    let step = 0;
    const total = 22;
    const tick = () => {
        if (!wrap.isConnected) return;
        if (step >= total) return land();
        show(pool[step % pool.length], step > total - 4 ? null : "dim");
        step++;
        setTimeout(tick, 45 + Math.pow(step / total, 3) * 420);
    };
    tick();
    return true;
}
