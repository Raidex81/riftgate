// Riftgate — the Hallowed Rift's bats (season.js): now and then, a small
// flock crosses the window, high up, wings flapping, and is gone. Never over
// a dialog, never with reduced motion, never while you're in a game's details.

import { h } from "../app/dom.js";
import * as season from "../app/season.js";

const BAT = '<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 12c-2-4-5-5-7-4 1-3 0-6-3-8-1 3-3 5-7 5-3 0-6-2-8-5-2 6 1 11 6 12-2 2-2 5-1 7 3-3 7-3 10-1 2 1 3 3 4 5h12c1-2 2-4 4-5 3-2 7-2 10 1 1-2 1-5-1-7 5-1 8-6 6-12-2 3-5 5-8 5-4 0-6-2-7-5-3 2-4 5-3 8-2-1-5 0-7 4z"/></svg>';

let timer = null, layer = null;
function flock() {
    if (!season.is("halloween") || document.hidden || document.querySelector(".today, .rift-roll, .detail, .wn-modal, #intro")) return;
    const n = 3 + Math.floor(Math.random() * 3);
    const fromLeft = Math.random() < .5;
    const top = 6 + Math.random() * 22; // % of the window, high up
    for (let i = 0; i < n; i++) {
        const b = h("div.bat");
        b.innerHTML = BAT;
        const size = 18 + Math.random() * 16;
        b.style.cssText = `--top:${top + (Math.random() - .5) * 10}vh;--size:${size}px;--dur:${7 + Math.random() * 3}s;--delay:${i * (.25 + Math.random() * .4)}s;--flap:${.18 + Math.random() * .1}s;--rise:${(Math.random() - .5) * 18}vh`;
        b.classList.add(fromLeft ? "ltr" : "rtl");
        b.addEventListener("animationend", () => b.remove(), { once: true });
        layer.appendChild(b);
    }
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => { flock(); schedule(); }, (70 + Math.random() * 80) * 1000); }

export function mountBats() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sync = () => {
        if (season.is("halloween")) {
            if (!layer) { layer = h("div.bats", { "aria-hidden": "true" }); document.body.appendChild(layer); setTimeout(flock, 25000); schedule(); }
        } else if (layer) { layer.remove(); layer = null; clearTimeout(timer); }
    };
    sync();
    season.onChange(sync);
}
