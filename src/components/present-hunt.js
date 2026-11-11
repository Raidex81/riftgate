// Riftgate — the Christmas Rift's hidden presents (season.js). Now and then,
// when you open a section, a small present is hidden somewhere on the page:
// scroll, look around, click it. It bursts open with a Christmas fact inside.
// The elf who peeks up from the bottom of the window sometimes holds one too
// (yuletide.js). Find 12 in one Christmas for the Present hunter seal.
// At most four are hidden a day, one page at a time, and only on the
// season's own dates (not through the Christmas Rift theme).

import { h } from "../app/dom.js";
import * as season from "../app/season.js";
import * as journal from "../app/store.js";
import { flag } from "../app/seals.js";
import { christmasFacts } from "../app/facts.js";
import { presentSVG } from "./yule-art.js";

export const GOAL = 12;
const MAX_A_DAY = 4;
const on = () => season.onDates("christmas");
const key = () => `xmas:presents:${season.seasonYear()}`;
const dayKey = () => `xmas:hidden:${season.seasonYear()}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export const found = () => journal.pref(key(), 0) || 0;

// "3 of 12 presents found"
export function huntLine() {
    const n = found();
    return n >= GOAL ? `${n} presents found this Christmas, Present hunter` : `${n} of ${GOAL} hidden presents found`;
}

// confetti and snow from a point
export function burst(x, y, n = 28) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cols = ["#ff4a5a", "#ffd25a", "#7dff9a", "#5ad1ff", "#ffffff", "#ff8af0"];
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 90;
        const b = h("i.burst");
        b.style.cssText = `left:${x}px;top:${y}px;--c:${cols[i % cols.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--rot:${Math.random() * 540}deg`;
        if (i % 3 === 0) b.style.borderRadius = "50%";
        b.addEventListener("animationend", () => b.remove(), { once: true });
        document.body.appendChild(b);
    }
}

let say = () => {};
function reward(x, y, from) {
    burst(x, y);
    const n = found() + 1;
    journal.setPref(key(), n);
    if (n >= GOAL) flag("present-hunter");
    const facts = christmasFacts();
    const fact = facts[(n * 5 + Math.floor(Math.random() * facts.length)) % facts.length];
    const head = from === "elf" ? "The elf gave you a present!" : "You found a present!";
    const count = n < GOAL ? ` ${n} of ${GOAL}.` : n === GOAL ? ` That's all ${GOAL}!` : ` That's ${n} this Christmas.`;
    say(`${head}${count} Inside: ${fact}`, "ok", 10000);
}

function hide() {
    if (!on()) return;
    const stage = document.getElementById("stage");
    const view = stage && stage.querySelector(".view");
    if (!view || stage.querySelector(".hidden-present")) return;
    const d = journal.pref(dayKey(), null);
    const n = d && d.day === today() ? d.n : 0;
    if (n >= MAX_A_DAY || Math.random() > .42) return;
    const tall = Math.max(stage.clientHeight, Math.min(view.scrollHeight, 3200));
    const btn = h("button.hidden-present", { type: "button", "aria-label": "A hidden present", title: "A present!" });
    btn.innerHTML = presentSVG(Math.floor(Math.random() * 6));
    btn.style.cssText = `top:${Math.round(220 + Math.random() * Math.max(80, tall - 320))}px;left:${(3 + Math.random() * 90).toFixed(1)}%;--r:${Math.round((Math.random() - .5) * 24)}deg;--d:${(-Math.random() * 6).toFixed(1)}s`;
    btn.addEventListener("click", () => {
        const r = btn.getBoundingClientRect();
        btn.classList.add("open");
        btn.addEventListener("animationend", (e) => { if (e.animationName === "present-gone") btn.remove(); });
        reward(r.left + r.width / 2, r.top + r.height / 2, "page");
    }, { once: true });
    stage.appendChild(btn);
    journal.setPref(dayKey(), { day: today(), n: n + 1 });
}

let mounted = false;
export function mountPresentHunt({ toast } = {}) {
    if (mounted) return;
    mounted = true;
    if (toast) say = toast;
    let tm = null;
    const later = (ms) => { clearTimeout(tm); tm = setTimeout(hide, ms); };
    window.addEventListener("hashchange", () => later(2500 + Math.random() * 3500));
    later(9000);
    window.addEventListener("r2-elf-present", () => {
        if (!on()) return;
        const el = document.querySelector(".elf-peek.gift");
        const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight - 80, width: 0, height: 0 };
        reward(r.left + 20, r.top + 70, "elf");
    });
}
