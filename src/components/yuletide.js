// Riftgate — the Christmas Rift's decorations (season.js). By the Nexus rift:
// a tree with twinkling lights and a star, presents at its foot, an elf
// waving, a snowman, and a fireplace with a crackling fire, stockings and
// candles on its mantel, all standing in the snow. Over the whole app: snow
// falling, a garland of lights along the top of the page, holly in its
// corners, a Santa hat on the gem in the corner, Santa's sleigh crossing now
// and then (with a trail of stardust), and an elf who peeks up from the bottom
// of the window, sometimes with a present for you (present-hunt.js).
// Everything comes and goes with the season by itself, nothing gets in the
// way of a click (the elf aside), and with reduced motion nothing moves: no
// snow, no sleigh, no elf, the lights stay lit.

import { h } from "../app/dom.js";
import * as season from "../app/season.js";
import * as journal from "../app/store.js";
import { candle } from "./hallowed.js";
import { humbugVisit, setHumbug } from "./humbug.js";
import { sleighSVG, treeSVG, presentSVG, fireplaceSVG, elfSVG, snowmanSVG, hatSVG, hollySVG } from "./yule-art.js";

const XMAS = () => season.is("christmas");
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Snow can be turned off on its own (Settings → Seasonal events)
export const snowOn = () => journal.pref("snow", true) !== false;
const busy = () => document.hidden || !!document.querySelector(".today, .rift-roll, .detail, .wn-modal, #intro, .advent, .rw");
const art = (cls, svg, style) => { const el = h(`div.${cls}`); el.innerHTML = svg; if (style) el.style.cssText = style; return el; };

// ---- By the Nexus rift ----------------------------------------------------------------
export function yuleScene() {
    const box = h("div.yule-scene", { "aria-hidden": "true" }, h("div.yule-drift"));
    box.append(
        art("yule-tree", treeSVG(), "--x:55.5%;--w:clamp(110px, 15vh, 150px)"),
        ...[[49.6, 0, 46, -6], [52.6, 3, 38, 4], [59.4, 2, 50, -3], [62.4, 5, 34, 8], [55.8, 4, 30, 0]].map(([x, k, w, r]) =>
            art("yule-present", presentSVG(k), `--x:${x}%;--w:${w}px;--r:${r}deg`)),
        art("yule-elf", elfSVG(), "--x:66.5%;--w:62px"),
        art("yule-snowman", snowmanSVG(), "--x:80.5%;--w:72px"));
    // the fireplace, with two candles on its mantel
    const fp = art("yule-fp", fireplaceSVG(), "--x:92%;--w:clamp(150px, 20vh, 190px)");
    [[17, 34, 1.3], [84, 26, 1.7]].forEach(([x, hgt, flick], i) => {
        const c = candle(hgt);
        c.style.cssText += `;--x:${x}%;--flick:${flick}s;--delay:${-i * .5}s`;
        fp.appendChild(c);
    });
    box.appendChild(fp);
    const sync = () => { box.hidden = !XMAS(); };
    sync();
    const off = season.onChange(() => { if (!box.isConnected) return off(); sync(); });
    return box;
}

// ---- Snow ------------------------------------------------------------------------------
// A canvas over the whole window; small flakes, a few big soft ones in front,
// drifting with a little wind. 30 frames a second is plenty for snow.
function snowfall() {
    const c = h("canvas.snowfall", { "aria-hidden": "true" });
    const ctx = c.getContext("2d");
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, flakes = [], gustUntil = 0;
    const make = (y) => {
        const big = Math.random() < .06;
        return { x: Math.random() * W, y: y ?? Math.random() * H, r: big ? 3 + Math.random() * 2.5 : .7 + Math.random() ** 2 * 2.2, big,
            vy: (big ? 38 : 14) + Math.random() * (big ? 30 : 30), sw: .4 + Math.random() * .9, amp: 6 + Math.random() * 16, ph: Math.random() * 6.28 };
    };
    const size = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        W = window.innerWidth; H = window.innerHeight;
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        const n = Math.round(Math.min(160, W * H / 9500));
        while (flakes.length < n) flakes.push(make());
        flakes.length = n;
    };
    const draw = (now) => {
        raf = requestAnimationFrame(draw);
        if (now - last < 33) return;
        const dt = Math.min(.1, (now - last) / 1000); last = now;
        if (document.hidden) return;
        const t = now / 1000, wind = Math.sin(t * .13) * 10;
        const ink = document.documentElement.dataset.tone === "light" ? "150,180,215" : "255,255,255"; // on a light theme, white snow would vanish
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (const f of flakes) {
            // (the Humbug can blow it all back up into the sky for a few seconds)
            const up = now < gustUntil;
            f.y += (up ? -f.vy * 2.4 : f.vy) * dt; f.x += (up ? wind * 4 + 40 : wind) * dt * (f.big ? 1.6 : 1);
            if (f.y > H + 8) Object.assign(f, make(-8));
            else if (f.y < -10) f.y = H + 6;
            if (f.x < -10) f.x += W + 20; else if (f.x > W + 10) f.x -= W + 20;
            const x = f.x + Math.sin(t * f.sw + f.ph) * f.amp;
            if (f.big) {
                const g = ctx.createRadialGradient(x, f.y, 0, x, f.y, f.r * 2.2);
                g.addColorStop(0, `rgba(${ink},.55)`); g.addColorStop(1, `rgba(${ink},0)`);
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, f.y, f.r * 2.2, 0, 6.283); ctx.fill();
            } else {
                ctx.fillStyle = `rgba(${ink},${(.35 + f.r / 4).toFixed(2)})`;
                ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, 6.283); ctx.fill();
            }
        }
    };
    size();
    window.addEventListener("resize", size);
    raf = requestAnimationFrame(draw);
    c.gust = (ms) => { gustUntil = performance.now() + ms; };
    c.stop = () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); c.remove(); };
    return c;
}

// ---- A garland of lights along the top of the page ------------------------------------------
const BULBS = ["#ff4a5a", "#ffd25a", "#5ad1ff", "#7dff9a", "#ff8af0", "#fff4d6"];
function garland() {
    const el = h("div.yule-garland");
    const build = () => {
        const W = el.clientWidth || (window.innerWidth - 232);
        const n = Math.max(3, Math.round(W / 150)), sw = W / n;
        let d = "";
        const bulbs = [];
        for (let i = 0; i < n; i++) {
            const x0 = i * sw, x1 = x0 + sw;
            d += `${i ? "" : `M${x0} 2`} Q${x0 + sw / 2} 30 ${x1} 2 `;
            // bulbs along the swag (a quadratic: x, y at t)
            for (const t of [.2, .5, .8]) {
                const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * (x0 + sw / 2) + t * t * x1;
                const y = (1 - t) ** 2 * 2 + 2 * (1 - t) * t * 30 + t * t * 2;
                bulbs.push([x, y]);
            }
        }
        el.innerHTML = `<svg class="yule-wire" width="${W}" height="40" viewBox="0 0 ${W} 40" aria-hidden="true"><path d="${d}"/></svg>`;
        bulbs.forEach(([x, y], i) => {
            const b = h("i.yule-bulb");
            b.style.cssText = `left:${x.toFixed(1)}px;top:${(y + 1).toFixed(1)}px;--c:${BULBS[i % BULBS.length]};--d:${((i * .53) % 3).toFixed(2)}s`;
            el.appendChild(b);
        });
        // a red bow at each end
        el.append(art("yule-bow l", bowSVG()), art("yule-bow r", bowSVG()));
    };
    requestAnimationFrame(build);
    let tm = null;
    const onResize = () => { clearTimeout(tm); tm = setTimeout(build, 200); };
    window.addEventListener("resize", onResize);
    el.stop = () => window.removeEventListener("resize", onResize);
    return el;
}
const bowSVG = () => `<svg viewBox="0 0 60 50" aria-hidden="true"><path d="M30 18 C18 2 2 6 6 18 C9 27 22 24 30 18 Z M30 18 C42 2 58 6 54 18 C51 27 38 24 30 18 Z" fill="#d61f33"/><path d="M28 20 L18 46 L24 42 L28 48 L31 22 Z M32 20 L42 46 L36 42 L32 48 L29 22 Z" fill="#b5121f"/><circle cx="30" cy="19" r="5" fill="#e8323d"/></svg>`;

// ---- Santa's sleigh, now and then ---------------------------------------------------------------
let flying = null;
function sleighFlight(layer) {
    if (!XMAS() || busy() || flying) return;
    const ltr = Math.random() < .7;
    const w = 260 + Math.random() * 140;
    const el = art(`sleigh-fly${ltr ? "" : ".rtl"}`, sleighSVG("both"),
        `--w:${w}px;--top:${8 + Math.random() * 26}vh;--rise:${-(4 + Math.random() * 10)}vh;--dur:${10 + Math.random() * 4}s`);
    layer.appendChild(el);
    flying = el;
    // stardust from the back of the runners
    const dust = setInterval(() => {
        if (!el.isConnected) return clearInterval(dust);
        const r = el.getBoundingClientRect();
        const x = ltr ? r.left + r.width * .03 : r.right - r.width * .03, y = r.top + r.height * .82;
        for (let i = 0; i < 2; i++) {
            const s = h("i.stardust");
            s.style.cssText = `left:${x + (Math.random() - .5) * 10}px;top:${y + (Math.random() - .5) * 8}px;--dx:${(ltr ? -1 : 1) * (20 + Math.random() * 50)}px;--dy:${20 + Math.random() * 50}px;--c:${Math.random() < .72 ? "#ffd25a" : "#bfe6ff"}`;
            s.addEventListener("animationend", () => s.remove(), { once: true });
            layer.appendChild(s);
        }
    }, 70);
    el.addEventListener("animationend", (e) => { if (e.target !== el) return; clearInterval(dust); el.remove(); flying = null; });
}

// ---- An elf, peeking up from the bottom of the window --------------------------------------------------
// He waves, and one time in three he's holding a present: click it before he
// ducks back down (present-hunt.js listens for "r2-elf-present").
let peeking = null;
function elfPeek(layer) {
    if (!XMAS() || busy() || peeking) return;
    const gift = season.onDates("christmas") && Math.random() < .34; // (the hunt is on the season's dates only)
    const el = art(`elf-peek${gift ? ".gift" : ""}`, elfSVG(), `--x:${12 + Math.random() * 70}%`);
    if (gift) {
        el.title = "The elf has a present for you";
        el.setAttribute("role", "button");
        el.addEventListener("click", () => {
            if (el.dataset.given) return;
            el.dataset.given = "1";
            el.classList.add("given");
            window.dispatchEvent(new CustomEvent("r2-elf-present"));
        }, { once: true });
    }
    layer.appendChild(el);
    peeking = el;
    el.addEventListener("animationend", (e) => { if (e.target !== el) return; el.remove(); peeking = null; });
}

// ---- Mount ------------------------------------------------------------------------------------
let layer = null, snow = null, hat = null, timers = [];
export function mountYuletide() {
    const motion = !still();
    const syncSnow = () => {
        const want = XMAS() && motion && snowOn();
        if (want && !snow) { snow = snowfall(); document.body.appendChild(snow); }
        else if (!want && snow) { snow.stop(); snow = null; }
    };
    const sync = () => {
        if (XMAS()) {
            if (layer) return syncSnow();
            const top = garland();
            layer = h("div.yuletide", { "aria-hidden": "true" }, top,
                art("yule-holly tl", hollySVG()), art("yule-holly tr", hollySVG()));
            layer.stopAll = () => top.stop();
            document.body.appendChild(layer);
            // the hat on the gem
            const brand = document.querySelector(".brand");
            if (brand && !brand.querySelector(".santa-hat")) { hat = art("santa-hat", hatSVG()); brand.appendChild(hat); }
            if (motion) {
                const every = (fn, first, min, spread) => {
                    let id = setTimeout(function go() { fn(layer); id = setTimeout(go, (min + Math.random() * spread) * 1000); timers[k] = id; }, first * 1000);
                    const k = timers.push(id) - 1;
                };
                every(sleighFlight, 30, 110, 120);
                every(elfPeek, 75, 150, 150);
                every(() => humbugVisit(), 120, 200, 220); // the Humbug, up to no good
            }
            syncSnow();
        } else if (layer) {
            timers.forEach(clearTimeout); timers = [];
            layer.stopAll(); layer.remove(); layer = null;
            if (hat) { hat.remove(); hat = null; }
            syncSnow();
        }
    };
    setHumbug({ snow: () => snow });
    sync();
    season.onChange(sync);
    window.addEventListener("r2-snow-changed", syncSnow);
    // the rail is rebuilt now and then (interests, admin): the hat goes back on
    new MutationObserver(() => {
        if (!layer) return;
        const brand = document.querySelector(".brand");
        if (brand && !brand.querySelector(".santa-hat")) { hat = art("santa-hat", hatSVG()); brand.appendChild(hat); }
    }).observe(document.getElementById("rail") || document.body, { childList: true });
}

// For checking: send the sleigh or the elf right now
export function yuleNow(what, only) { if (what === "humbug") return humbugVisit({ only }); if (layer) (what === "elf" ? elfPeek : sleighFlight)(layer); }
