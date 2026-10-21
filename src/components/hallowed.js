// Riftgate — the Hallowed Rift's decorations (season.js): jack-o'-lanterns
// glowing by the Nexus rift, each with its own carved face and its own candle
// flicker, and cobwebs in the corners of the page with a small spider
// dangling from one of them. They come and go with the season by themselves.
// Nothing here can be clicked (it never gets in the way), and with reduced
// motion the candles burn steadily and the spider stays still.

import { h } from "../app/dom.js";
import * as season from "../app/season.js";

// ---- Jack-o'-lanterns ------------------------------------------------------------
// A pumpkin: ribbed body, a curled stem, a carved face that glows from inside.
// face: [left eye, right eye, mouth] as SVG paths on a 100 x 90 pumpkin.
const FACES = [
    // grinning: triangle eyes and nose, a toothy smile
    ["M22 38 L40 38 L31 22 Z", "M60 38 L78 38 L69 22 Z", "M17 52 Q50 86 83 52 L76 53 L72 62 L64 57 L57 67 L50 60 L43 67 L36 57 L28 62 L24 53 Z M45 50 L55 50 L50 42 Z"],
    // sly: slanted eyes, a crooked grin
    ["M19 30 L42 37 L24 44 Z", "M81 30 L58 37 L76 44 Z", "M24 56 Q52 80 78 54 L71 61 L62 58 L55 68 L46 61 L36 65 Z"],
    // wicked: angry eyes under the brows, a wide jagged mouth with fangs
    ["M18 27 L42 37 L37 44 L22 41 Z", "M82 27 L58 37 L63 44 L78 41 Z", "M16 54 L28 58 L32 66 L38 59 L50 63 L62 59 L68 66 L72 58 L84 54 Q76 82 50 82 Q24 82 16 54 Z"]
];
let uid = 0;
function pumpkin(face) {
    const id = `jol${++uid}`;
    const [e1, e2, m] = FACES[face % FACES.length];
    const svg = `<svg viewBox="0 0 100 92" aria-hidden="true">
      <defs>
        <radialGradient id="${id}b" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#d9620f"/><stop offset=".6" stop-color="#a8400a"/><stop offset="1" stop-color="#4f1604"/></radialGradient>
        <radialGradient id="${id}f" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffab2e"/></radialGradient>
      </defs>
      <path class="jol-stem" d="M48 16 C46 10 47 5 52 2 C55 1 57 3 55 5 C52 7 52 11 54 16 Z"/>
      <ellipse cx="26" cy="54" rx="22" ry="31" fill="url(#${id}b)"/>
      <ellipse cx="74" cy="54" rx="22" ry="31" fill="url(#${id}b)"/>
      <ellipse cx="38" cy="53" rx="20" ry="34" fill="url(#${id}b)"/>
      <ellipse cx="62" cy="53" rx="20" ry="34" fill="url(#${id}b)"/>
      <ellipse cx="50" cy="52" rx="17" ry="35" fill="url(#${id}b)"/>
      <path class="jol-ribs" d="M38 21 C30 36 30 72 38 86 M62 21 C70 36 70 72 62 86 M50 17 C47 40 47 66 50 87"/>
      <g class="jol-face" fill="url(#${id}f)"><path d="${e1}"/><path d="${e2}"/><path d="${m}"/></g>
    </svg>`;
    const el = h("div.jol");
    el.innerHTML = svg;
    return el;
}
// three of them on the ground by the rift: a big one, a small one, a middling one
export function lanterns() {
    const box = h("div.jols", { "aria-hidden": "true" });
    [{ x: 55, size: 96, face: 0, flick: 2.6 }, { x: 62.5, size: 60, face: 1, flick: 1.9 }, { x: 84, size: 80, face: 2, flick: 3.1 }].forEach((p, i) => {
        const j = pumpkin(p.face);
        j.style.cssText = `--x:${p.x}%;--size:${p.size}px;--flick:${p.flick}s;--delay:${-i * .7}s`;
        box.appendChild(j);
    });
    const sync = () => { box.hidden = !season.is("halloween"); };
    sync();
    const off = season.onChange(() => { if (!box.isConnected) return off(); sync(); });
    return box;
}

// ---- Cobwebs and a spider ------------------------------------------------------------
// a web in a corner: spokes from the corner, sagging threads between them
function web(size) {
    const spokes = [0, 15, 32, 50, 68, 90].map((d) => (d * Math.PI) / 180);
    const R = 100;
    let d = "";
    spokes.forEach((a) => { d += `M0 0 L${(Math.cos(a) * R).toFixed(1)} ${(Math.sin(a) * R).toFixed(1)} `; });
    [22, 40, 58, 76, 94].forEach((r, k) => {
        for (let i = 0; i < spokes.length - 1; i++) {
            const a0 = spokes[i], a1 = spokes[i + 1], mid = (a0 + a1) / 2, sag = r * (.78 - k * .01);
            const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
            d += `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${(Math.cos(mid) * sag).toFixed(1)} ${(Math.sin(mid) * sag).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)} `;
        }
    });
    const el = h("div.web");
    el.style.setProperty("--size", `${size}px`);
    el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;
    return el;
}
function spider() {
    const el = h("div.spider");
    el.innerHTML = `<div class="spider-thread"></div><svg viewBox="0 0 40 34" aria-hidden="true">
      <g class="spider-legs"><path d="M15 15 C9 10 5 9 1 12 M15 18 C9 16 4 17 1 21 M16 21 C11 22 7 26 5 31 M25 15 C31 10 35 9 39 12 M25 18 C31 16 36 17 39 21 M24 21 C29 22 33 26 35 31"/></g>
      <ellipse cx="20" cy="21" rx="7" ry="8"/><circle cx="20" cy="11" r="4.5"/>
      <circle class="spider-eye" cx="18.3" cy="10.5" r="1"/><circle class="spider-eye" cx="21.7" cy="10.5" r="1"/>
    </svg>`;
    return el;
}

let layer = null;
export function mountHallowed() {
    const sync = () => {
        if (season.is("halloween")) {
            if (layer) return;
            const right = web(150); right.classList.add("tr");
            const left = web(110); left.classList.add("tl");
            layer = h("div.hallowed", { "aria-hidden": "true" }, left, right, spider());
            document.body.appendChild(layer);
        } else if (layer) { layer.remove(); layer = null; }
    };
    sync();
    season.onChange(sync);
}
