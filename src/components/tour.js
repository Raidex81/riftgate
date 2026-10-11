// Riftgate — the guided tour. A first start gets the whole walk-through
// (after the opening and "What are you into?"); later, anything new that you
// haven't been shown yet gets a short tour of just that. Each step lights up
// the real thing on screen; steps whose target isn't there are skipped.
// Keys: → or Enter next, ← back, Esc ends it. Settings and Ctrl K replay it.

import { h, icon } from "../app/dom.js";
import * as journal from "../app/store.js";

// The walk-through for a first start
const GENERAL = [
    { at: ".search-trigger", title: "Search your universe", text: "Games, films, series, books and every command in one box. Press Ctrl K from anywhere." },
    { at: ".rail .nav", title: "Your sections", text: "Everything Riftgate brings together. Drag a section to reorder it; keys 1 to 9 jump straight to one." },
    { at: ".nav-item[data-view='library']", title: "Your Library", text: "Your games and apps, with your hours. Drop a shortcut or an .exe anywhere on Riftgate to add one." },
    { at: ".nav-item[data-view='journal']", title: "Your Journal", text: "Track anything: playing, watching, reading, finished, with your rating and notes. Open any card to start." },
    { at: ".today-btn", title: "Can't decide?", text: "Surprise me asks what you're in the mood for and picks the one thing for you. Or just press R." },
    { at: ".nav-item[data-view='themes']", title: "Make it yours", text: "Themes, your own pictures, and themes shared by other people." },
    { at: ".account-chip", title: "Your account", text: "Optional. Sign in to share themes and send suggestions under your name." },
    { at: ".facts", title: "Did you know?", text: "A fact from the world you're in. Point at it to keep it; the arrow shows another." },
    { at: ".gh-star", title: "Like Riftgate?", text: "Give the project a star on GitHub. It helps more than you'd think." },
    { at: ".bell", title: "What's new", text: "Every change in every version. The dot lights up when there's something you haven't read." }
];

// Shown once to people who already use Riftgate, when the feature arrives.
// Ids are permanent; add new steps with new ids.
const FEATURES = [
    { id: "rail-drag", at: ".rail .nav", title: "Your order", text: "New: drag the sections in the menu to put them in your own order (or Ctrl + ↑ ↓)." },
    { id: "gh-star", at: ".gh-star", title: "Star on GitHub is back", text: "The project's star count, and one click to add yours." },
    { id: "facts", at: ".facts", title: "Did you know?", text: "New: a fact from the world you're in, along the bottom. The × turns it off." },
    { id: "card-size", at: ".nav-item[href='#settings']", title: "Bigger or smaller cards", text: "New in Settings: choose the card size, and whether cards are coloured by kind." },
    { id: "ask-rift", at: ".today-btn", title: "Ask the Rift", text: "New: tell the rift what you feel like, in your own words, and it picks three, by real reviews. It's in Surprise me and in each section." },
    { id: "free-alerts", at: ".nav-item[href='#free']", title: "Never miss a free game", text: "New: Riftgate tells you when a game goes free and reminds you on its last day. Claim it from Free to keep right now." },
    { id: "wishlist", at: ".nav-item[href='#deals']", title: "Your wishlist", text: "New: add a game to your wishlist from its details, and Riftgate tells you when its price drops." },
    { id: "seals", at: ".nav-item[href='#journal']", title: "Your rift grows", text: "New: everything you finish becomes a relic orbiting the Nexus rift, and Seals mark what you achieve. A few are secret." }
];

const done = () => new Set(journal.pref("tour:done", []) || []);

let active = null;

function run(steps, onEnd) {
    if (active || !steps.length) return Promise.resolve();
    return new Promise((resolve) => {
        const hole = h("div.tour-hole");
        const tip = h("div.tour-tip", { role: "dialog", "aria-modal": "true" });
        const wrap = h("div.tour", null, hole, tip);
        let i = 0;
        const onKey = (e) => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); }
            else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); go(i + 1, 1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(i - 1, -1); }
        };
        const onResize = () => place(i);
        function target(k) { const t = document.querySelector(steps[k].at); return t && t.offsetParent !== null && t.getBoundingClientRect().width ? t : null; }
        function go(k, dir) {
            while (k >= 0 && k < steps.length && !target(k)) k += dir;
            if (k < 0) return;
            if (k >= steps.length) return end();
            i = k; paint();
        }
        function place(k) {
            const t = target(k);
            if (!t) return;
            const r = t.getBoundingClientRect(), pad = 6;
            Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
            const tw = tip.offsetWidth, th = tip.offsetHeight, W = innerWidth, H = innerHeight;
            // beside it if there's room (the rail), else under, else above
            let x, y;
            if (r.right + 16 + tw < W && r.width < W * .4 && (r.height > 60 || r.right < W * .25)) { x = r.right + 16; y = Math.min(Math.max(12, r.top), H - th - 12); }
            else if (r.bottom + 14 + th < H) { y = r.bottom + 14; x = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12); }
            else { y = Math.max(12, r.top - th - 14); x = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12); }
            Object.assign(tip.style, { left: `${x}px`, top: `${y}px` });
        }
        function paint() {
            const s = steps[i];
            const shown = steps.filter((_, k) => target(k));
            const n = shown.indexOf(s) + 1;
            const last = !steps.slice(i + 1).some((_, k) => target(i + 1 + k));
            tip.setAttribute("aria-label", s.title);
            tip.replaceChildren(
                h("p.tour-count", null, icon("compass"), `${n} of ${shown.length}`),
                h("h3", null, s.title), h("p", null, s.text),
                h("div.tour-btns", null,
                    last ? h("span") : h("button.link-btn", { type: "button", onclick: end }, "Skip the tour"),
                    n > 1 ? h("button.btn", { type: "button", onclick: () => go(i - 1, -1) }, icon("left"), "Back") : null,
                    h("button.btn.primary", { type: "button", onclick: () => go(i + 1, 1) }, last ? "Done" : "Next", last ? icon("check") : icon("right"))));
            tip.classList.remove("in"); void tip.offsetWidth; tip.classList.add("in");
            place(i);
            tip.querySelector(".btn.primary").focus();
        }
        function end() {
            document.removeEventListener("keydown", onKey, true); removeEventListener("resize", onResize);
            wrap.classList.add("out"); setTimeout(() => wrap.remove(), 220);
            active = null; if (onEnd) onEnd(); resolve();
        }
        active = wrap;
        document.addEventListener("keydown", onKey, true); addEventListener("resize", onResize);
        document.body.appendChild(wrap);
        go(0, 1);
    });
}

// The whole walk-through (first start, or "Take the tour" in Settings)
export function startTour() {
    return run(GENERAL, () => journal.setPref("tour:done", [...new Set([...done(), "general", ...FEATURES.map((f) => f.id)])]));
}

// At start: the walk-through the first time, otherwise only what's new to you
export function maybeTour({ firstStart }) {
    const seen = done();
    if (!seen.has("general") && firstStart) return startTour();
    const fresh = FEATURES.filter((f) => !seen.has(f.id) && document.querySelector(f.at));
    if (!seen.has("general") && !firstStart) seen.add("general"); // used Riftgate before tours existed
    if (!fresh.length) { journal.setPref("tour:done", [...seen]); return Promise.resolve(); }
    return run(fresh, () => journal.setPref("tour:done", [...new Set([...seen, ...fresh.map((f) => f.id)])]));
}
