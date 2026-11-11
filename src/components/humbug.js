// Riftgate — the Humbug (season.js, yuletide.js): the Christmas Rift's own
// troublemaker, a scruffy little snow imp who sneaks in now and then to be
// naughty. He unscrews a light from the garland and runs off with it, steals
// a present from under the Nexus tree, blows out the candles on the mantel,
// pinches the Santa hat off the gem (and wears it), throws a snowball at the
// glass, or blows the snow back up into the sky. Whatever he takes comes back
// by itself after a while, but click him in the act and he drops it, says
// "Bah!" and runs. A present he drops is yours (present-hunt.js). Catch him
// three times, on the season's dates, for a secret seal.
// Never over a dialog, never with reduced motion.

import { h } from "../app/dom.js";
import * as season from "../app/season.js";
import * as journal from "../app/store.js";
import { flag } from "../app/seals.js";
import { humbugSVG, hatSVG } from "./yule-art.js";
import { givePresent } from "./present-hunt.js";

const busy = () => document.hidden || !!document.querySelector(".today, .rift-roll, .detail, .wn-modal, #intro, .advent, .rw, .palette, .browser");
const seen = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.bottom > 40 && r.top < innerHeight - 30 && r.right > 0 && r.left < innerWidth ? r : null; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// caught in the act: whatever he was about to do next doesn't happen
const halt = () => { if (job && job.caught) throw new Error("caught"); };
const wait = (ms) => sleep(ms).then(halt);
const catchKey = () => `xmas:humbug:${season.seasonYear()}`;

let say = () => {};
let job = null; // the mischief going on now

// ---- Him ------------------------------------------------------------------------------
function imp(size, j) {
    const el = h("div.humbug", { role: "button", title: "Catch him!", "aria-label": "The Humbug: catch him!", onclick: (e) => caught(j, e) });
    el.innerHTML = humbugSVG("both");
    el.style.width = `${size}px`;
    document.body.appendChild(el);
    return el;
}
const place = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; el._x = x; el._y = y; };
// walk (or run) to x, y; feet at y + his height
async function go(el, x, y, speed = .16, { free = false } = {}) {
    const d = Math.hypot(x - el._x, y - el._y);
    el.classList.toggle("left", x < el._x);
    el.classList.add("walking");
    const a = el.animate([{ transform: `translate(${el._x}px, ${el._y}px)` }, { transform: `translate(${x}px, ${y}px)` }], { duration: Math.max(200, d / speed), easing: "linear", fill: "forwards" });
    el._anim = a;
    await a.finished;
    place(el, x, y);
    a.cancel();
    el.classList.remove("walking");
    if (!free) halt();
}
function bubble(el, text, ms = 1600) {
    const b = h("span.humbug-say", null, text);
    el.appendChild(b);
    setTimeout(() => b.remove(), ms);
}
function puff(x, y) {
    for (let i = 0; i < 10; i++) {
        const p = h("i.humbug-puff");
        const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 26;
        p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 10}px`;
        p.addEventListener("animationend", () => p.remove(), { once: true });
        document.body.appendChild(p);
    }
}
function carry(el, node) { const c = h("div.humbug-loot"); c.appendChild(node); el.appendChild(c); return c; }

// Each mischief: can it happen now? then do it; `undo` puts things right
// (later by itself, or at once when he's caught)
const MISCHIEF = {
    // a light from the garland
    bulb: {
        can: () => [...document.querySelectorAll(".yule-bulb:not(.stolen)")].filter((b) => { const r = seen(b); return r && r.left > 280 && r.left < innerWidth - 120; }),
        async run(j, bulbs) {
            const bulb = pick(bulbs), r = bulb.getBoundingClientRect(), s = 46, y = r.top + 10;
            j.el = imp(s, j); j.what = "bulb";
            const from = Math.random() < .5 ? -s - 10 : innerWidth + 10;
            place(j.el, from, y);
            await go(j.el, r.left - (from < 0 ? s * .9 : -s * .1), y);
            j.el.classList.add("reach"); await wait(500);
            bulb.classList.add("stolen");
            const loot = h("i.yule-bulb.loot"); loot.style.setProperty("--c", getComputedStyle(bulb).getPropertyValue("--c"));
            carry(j.el, loot);
            j.undo = () => bulb.classList.remove("stolen");
            j.later = 45000;
            j.el.classList.remove("reach"); bubble(j.el, "Hee hee!");
            await wait(500);
            await go(j.el, from, y, .22);
        }
    },
    // a present from under the tree
    present: {
        can: () => { const p = [...document.querySelectorAll(".yule-scene:not([hidden]) .yule-present:not(.stolen)")].filter((x) => seen(x)); return p.length ? p : null; },
        async run(j, presents) {
            const present = pick(presents), r = present.getBoundingClientRect(), s = 62, y = r.bottom - s * 1.19;
            j.el = imp(s, j); j.what = "present";
            place(j.el, innerWidth + 10, y);
            await go(j.el, r.right - s * .35, y);
            j.el.classList.add("left", "reach"); await wait(450);
            present.classList.add("stolen");
            const box = h("div"); box.innerHTML = present.innerHTML; carry(j.el, box.firstElementChild);
            j.undo = () => present.classList.remove("stolen");
            j.later = 60000;
            j.el.classList.remove("reach"); bubble(j.el, "Mine now!");
            await wait(600);
            await go(j.el, -s - 20, y, .2);
        }
    },
    // the candles on the mantel
    candles: {
        can: () => { const c = [...document.querySelectorAll(".yule-scene:not([hidden]) .yule-fp .candle:not(.out)")].filter((x) => seen(x)); return c.length ? c : null; },
        async run(j, candles) {
            const fp = document.querySelector(".yule-fp").getBoundingClientRect(), s = 50, y = candles[0].getBoundingClientRect().bottom - s * 1.19;
            j.el = imp(s, j); j.what = "candles";
            const x = fp.left + fp.width / 2 - s / 2;
            place(j.el, x, y);
            j.el.classList.add("pop"); puff(x + s / 2, y + s);
            await wait(900);
            j.el.classList.add("blow"); bubble(j.el, "Fwoooo!");
            await wait(700);
            candles.forEach((c) => c.classList.add("out"));
            j.undo = () => candles.forEach((c) => c.classList.remove("out"));
            j.later = 30000;
            await wait(800);
            j.el.classList.remove("blow", "pop");
            await go(j.el, innerWidth + 10, y + 30, .24);
        }
    },
    // the hat off the gem: he wears it
    hat: {
        can: () => { const hat = document.querySelector(".santa-hat:not(.stolen)"); return seen(hat) ? hat : null; },
        async run(j, hat) {
            const r = hat.getBoundingClientRect(), s = 48, x = r.right + 6, y = r.top + 4;
            j.el = imp(s, j); j.what = "hat";
            place(j.el, x, y);
            j.el.classList.add("pop", "left"); puff(x + s / 2, y + s / 2);
            await wait(800);
            j.el.classList.add("reach"); await wait(350);
            hat.classList.add("stolen");
            const worn = h("div.humbug-hat"); worn.innerHTML = hatSVG(); j.el.appendChild(worn);
            j.undo = () => hat.classList.remove("stolen");
            j.later = 60000;
            j.el.classList.remove("reach", "pop"); bubble(j.el, "Ho ho… no!");
            await wait(900);
            await go(j.el, innerWidth + 10, y + 24, .22);
        }
    },
    // a snowball at the glass
    snowball: {
        can: () => true,
        async run(j) {
            const s = 64, x = 300 + Math.random() * (innerWidth - 500), y = innerHeight - s * .95;
            j.el = imp(s, j); j.what = "snowball";
            j.el.classList.add("peek");
            place(j.el, x, innerHeight + 4);
            await go(j.el, x, y, .12);
            j.el.classList.add("throw"); bubble(j.el, "Heh!");
            await wait(380);
            const tx = 260 + Math.random() * (innerWidth - 520), ty = 120 + Math.random() * (innerHeight * .45);
            const ball = h("i.snowball");
            ball.style.cssText = `left:${x + s * .8}px;top:${y}px`;
            document.body.appendChild(ball);
            await ball.animate([{ transform: "translate(0,0) scale(.5)" }, { transform: `translate(${tx - x - s * .8}px, ${ty - y}px) scale(2.4)` }], { duration: 520, easing: "cubic-bezier(.3,.1,.6,1)", fill: "forwards" }).finished.catch(() => {});
            ball.remove();
            splat(tx, ty);
            await wait(500);
            j.el.classList.remove("throw");
            await go(j.el, x, innerHeight + 4, .14);
        }
    },
    // the snow blown back up into the sky
    gust: {
        can: () => (MISCHIEF.gust.snow && MISCHIEF.gust.snow() ? true : null),
        async run(j) {
            const s = 64, x = 20 + Math.random() * 30 + 232, y = innerHeight - s * .95;
            j.el = imp(s, j); j.what = "snow";
            j.el.classList.add("peek");
            place(j.el, x, innerHeight + 4);
            await go(j.el, x, y, .12);
            j.el.classList.add("blow"); bubble(j.el, "Whoooo!", 2400);
            const snow = MISCHIEF.gust.snow();
            if (snow && snow.gust) snow.gust(5000);
            await wait(2600);
            j.el.classList.remove("blow");
            await go(j.el, x, innerHeight + 4, .14);
        }
    }
};
// a splat of snow on the glass that slides down and melts away
function splat(x, y) {
    const el = h("div.splat", { "aria-hidden": "true" });
    el.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 18 C70 30 86 14 90 30 C94 44 112 40 104 56 C98 68 116 78 100 86 C88 92 92 110 76 102 C64 96 58 114 46 102 C36 92 18 104 18 88 C18 76 4 70 14 58 C22 48 8 36 22 30 C34 24 36 8 48 18 C52 22 56 14 60 18 Z" fill="#f4faff"/>
      <circle cx="12" cy="20" r="5" fill="#f4faff"/><circle cx="108" cy="22" r="4" fill="#f4faff"/><circle cx="110" cy="100" r="6" fill="#f4faff"/><circle cx="8" cy="104" r="4" fill="#f4faff"/>
      <path d="M44 100 L44 118 Q46 122 48 118 L49 100 Z M74 100 L74 112 Q76 116 78 112 L78 100 Z" fill="#e6f2fc"/>
      <ellipse cx="50" cy="48" rx="16" ry="10" fill="#fff" opacity=".8"/></svg>`;
    el.style.cssText = `left:${x}px;top:${y}px`;
    el.addEventListener("animationend", (e) => { if (e.animationName === "splat-melt") el.remove(); });
    document.body.appendChild(el);
}

// ---- Caught! -------------------------------------------------------------------------------
const CAUGHT = {
    bulb: "You caught the Humbug! He dropped the light he stole.",
    candles: "You caught the Humbug! The candles are lit again.",
    hat: "You caught the Humbug! The gem has its hat back.",
    snowball: "You caught the Humbug! Bah, he says.",
    snow: "You caught the Humbug! The snow falls the right way again."
};
async function caught(j, e) {
    if (j.caught || !j.el) return;
    j.caught = true;
    if (j.el._anim) { const m = new DOMMatrixReadOnly(getComputedStyle(j.el).transform); j.el._anim.cancel(); place(j.el, m.m41, m.m42); }
    if (j.undo) { j.undo(); j.undo = null; }
    j.el.querySelector(".humbug-loot, .humbug-hat")?.remove();
    j.el.classList.remove("reach", "blow", "throw", "pop");
    j.el.classList.add("caught");
    bubble(j.el, "Bah!", 1200);
    const r = j.el.getBoundingClientRect();
    puff(r.left + r.width / 2, r.top + r.height / 2);
    if (j.what === "present") givePresent(e.clientX, e.clientY, "humbug");
    else say(CAUGHT[j.what] || CAUGHT.snowball, "ok", 6000);
    if (season.onDates("christmas")) {
        const n = (journal.pref(catchKey(), 0) || 0) + 1;
        journal.setPref(catchKey(), n);
        if (n >= 3) flag("humbug");
    }
    j.fled = (async () => {
        await sleep(700);
        j.el.classList.remove("caught");
        const right = r.left > innerWidth / 2;
        await go(j.el, right ? innerWidth + 20 : -r.width - 20, j.el._y, .5, { free: true }).catch(() => {});
    })();
}

// ---- One visit ----------------------------------------------------------------------------
export async function humbugVisit({ only } = {}) {
    if (job || !season.is("christmas") || busy() || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const options = Object.entries(MISCHIEF).filter(([k]) => !only || k === only).map(([k, m]) => [k, m.can()]).filter(([, ok]) => ok && (!Array.isArray(ok) || ok.length));
    if (!options.length) return;
    // the places he can do the most damage first: what's on screen at the moment
    const [k, arg] = pick(options);
    const j = job = { what: null, el: null, undo: null, later: 0 };
    try {
        await MISCHIEF[k].run(j, arg).catch(() => {});
        if (j.fled) await j.fled;
    } finally {
        if (j.el) j.el.remove();
        if (j.undo) { const undo = j.undo; setTimeout(() => { undo(); flash(k); }, j.later || 30000); }
        job = null;
    }
}
// what he took is back: a little sparkle where it returns
function flash(k) {
    const el = k === "bulb" ? null : document.querySelector(k === "hat" ? ".santa-hat" : k === "candles" ? ".yule-fp" : ".yule-scene");
    const r = el && seen(el);
    if (r) puff(r.left + r.width / 2, r.top + r.height / 2);
}

export function setHumbug({ toast, snow }) { if (toast) say = toast; if (snow) MISCHIEF.gust.snow = snow; }
