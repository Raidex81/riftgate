// Riftgate — covers for things that have none, or whose picture won't load.
// Asked only when the card is actually on screen, a few at a time, and once
// per title per session (the engine keeps the answers on disk for good), so
// a missing cover costs the APIs a single request, ever.

import { call } from "./api.js";

const known = new Map();      // key -> Promise<url|null>
const queue = [];
let running = 0;
const MAX = 3;

function pump() {
    while (running < MAX && queue.length) {
        const { args, resolve } = queue.shift();
        running++;
        call("r2-find-cover", args).then((u) => resolve(typeof u === "string" && u ? u : null), () => resolve(null))
            .finally(() => { running--; pump(); });
    }
}

export function findCover(title, kind, year) {
    if (!title) return Promise.resolve(null);
    const key = `${kind || ""}|${String(title).toLowerCase()}|${year || ""}`;
    if (!known.has(key)) known.set(key, new Promise((resolve) => { queue.push({ args: { title: String(title), kind: kind || "", year: year || null }, resolve }); pump(); }));
    return known.get(key);
}

// Wait until the element is (nearly) on screen before asking
const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); const fn = e.target._whenSeen; e.target._whenSeen = null; fn && fn(); } });
}, { rootMargin: "300px" }) : null;
export function whenSeen(el, fn) {
    if (!io) { fn(); return; }
    el._whenSeen = fn;
    io.observe(el);
}
