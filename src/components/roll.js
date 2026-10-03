// Riftgate 2 — "Open a random rift" (Surprise Me). Picks from the current
// view's list: a reel of cards streaks past in front of the portal and
// decelerates onto the winner, which lands with a flare. Instant with
// reduced motion. Esc or the backdrop closes it.

import { h, icon, clear } from "../app/dom.js";
import { card } from "./card.js";
import { Rift } from "./rift.js";
import { openDetail } from "./detail.js";

// opts: { onPick(item), back: { label, run }, onClose() }
export function openRoll(items, title = "Open a random rift", opts = {}) {
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
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(opts.back ? "back" : "done"); } };
    document.addEventListener("keydown", onKey);
    // how: "done" (closed or opened it), "again" (roll again), "back"
    function close(how = "done") {
        rift.destroy(); wrap.remove(); document.removeEventListener("keydown", onKey);
        if (how === "back" && opts.back) opts.back.run();
        else if (how === "done" && opts.onClose) opts.onClose();
    }
    document.body.appendChild(wrap);

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    function land(c) {
        heading.textContent = winner.title;
        wrap.classList.add("landed");
        if (c) { c.classList.add("win"); c.onclick = () => { close(); openDetail(winner); }; }
        if (opts.onPick) opts.onPick(winner);
        clear(result).append(
            h("button.btn.primary.lg", { type: "button", onclick: () => { close(); openDetail(winner); } }, icon("rift"), "Open it"),
            h("button.btn.lg", { type: "button", onclick: () => { close("again"); openRoll(items, title, opts); } }, icon("dice"), "Roll again"),
            opts.back ? h("button.btn.lg", { type: "button", onclick: () => close("back") }, icon("left"), opts.back.label) : null,
            h("button.btn.lg.ghost", { type: "button", onclick: () => close() }, "Close"));
        result.firstChild.focus();
    }

    if (reduced) { const c = card(winner); c.onclick = null; reel.appendChild(c); land(c); return true; }

    // A slot reel: a long strip of real cards slides through the gate, fast
    // and sharp-eyed at first, easing out until the winner stops in the middle.
    // Every card stays readable; the one passing the gate is lit up.
    const strip = h("div.reel-strip");
    reel.classList.add("is-slot");
    reel.appendChild(h("div.reel-gate", { "aria-hidden": "true" }));
    reel.appendChild(strip);
    const others = pool.filter((x) => x !== winner);
    const seq = [];
    while (seq.length < 34) seq.push(others[seq.length % others.length]);
    const winAt = seq.length;
    seq.push(winner, others[0], others[1 % others.length], others[2 % others.length]);
    const cards = seq.map((it) => { const c = card(it, { watched: false }); c.onclick = null; c.tabIndex = -1; strip.appendChild(c); return c; });

    requestAnimationFrame(() => {
        const step = cards[1].offsetLeft - cards[0].offsetLeft;
        const cw = cards[0].offsetWidth;
        const view = reel.clientWidth;
        const xFor = (i) => view / 2 - (i * step + cw / 2);
        const from = xFor(1.5), to = xFor(winAt);
        const dur = 3600, t0 = performance.now();
        let lastX = from, lit = -1;
        const ease = (t) => 1 - Math.pow(1 - t, 4);
        const frame = (now) => {
            if (!wrap.isConnected) return;
            const t = Math.min(1, (now - t0) / dur);
            const x = from + (to - from) * ease(t);
            strip.style.transform = `translate3d(${x}px,0,0)`;
            const speed = Math.abs(x - lastX); lastX = x;
            strip.style.filter = speed > 30 ? `blur(${Math.min(1, (speed - 30) / 30).toFixed(2)}px)` : "";
            const centre = Math.round((view / 2 - x - cw / 2) / step);
            if (centre !== lit) {
                if (cards[lit]) cards[lit].classList.remove("in-gate");
                if (cards[centre]) cards[centre].classList.add("in-gate");
                lit = centre;
                reel.classList.remove("tick"); void reel.offsetWidth; reel.classList.add("tick");
            }
            if (t < 1) requestAnimationFrame(frame);
            else { strip.style.filter = ""; land(cards[winAt]); }
        };
        requestAnimationFrame(frame);
    });
    return true;
}
