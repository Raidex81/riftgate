// Riftgate — the Nexus hero: the living rift on the right, a featured
// item's art and copy on the left. Rotates through a few highlights.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { Rift } from "./rift.js";
import { openDetail } from "./detail.js";

// slides: [{ item, kicker, kickerIcon, action: { label, icon, run } }]
export function hero(slidesPromise) {
    const canvas = h("canvas", { "aria-hidden": "true" });
    const artA = h("div.hero-art"), artB = h("div.hero-art");
    const kicker = h("div.hero-kicker");
    const title = h("h1.hero-title", null, "All your worlds.");
    const desc = h("p.hero-desc", null, "One gateway to your games, films, series, anime and books: what's free, what's on sale, what's showing and what's next.");
    const actions = h("div.hero-actions");
    const dots = h("div.hero-dots", { role: "tablist", "aria-label": "Highlights" });
    const el = h("section.hero", { "aria-label": "Highlights" }, artA, artB, canvas,
        h("div.hero-copy", null, kicker, title, desc, actions), dots);

    let rift = null, slides = [], i = 0, timer = null, front = artA;
    requestAnimationFrame(() => { rift = new Rift(canvas); });

    function show(n) {
        if (!slides.length) return;
        i = (n + slides.length) % slides.length;
        const s = slides[i];
        const back = front === artA ? artB : artA;
        const bg = s.item.backdrop || null; // wide pictures only (see landscape.js)
        back.style.backgroundImage = bg ? `url("${coverSrc(bg)}")` : "none";
        back.classList.add("on"); front.classList.remove("on"); front = back;
        clear(kicker).append(icon(s.kickerIcon || "sparkles"), s.kicker);
        title.textContent = s.item.title;
        desc.textContent = s.item.desc || s.item.sub || "";
        clear(actions).append(
            s.action ? h("button.btn.primary.lg", { type: "button", onclick: s.action.run }, icon(s.action.icon || "play"), s.action.label) : null,
            h("button.btn.lg", { type: "button", onclick: () => openDetail(s.item) }, "Details"));
        [...dots.children].forEach((d, k) => d.setAttribute("aria-current", String(k === i)));
    }
    function auto() { clearInterval(timer); timer = setInterval(() => { if (el.isConnected) show(i + 1); else clearInterval(timer); }, 9000); }

    Promise.resolve(slidesPromise).then((list) => {
        slides = (list || []).filter((s) => s && s.item);
        if (!slides.length) return;
        clear(dots);
        slides.forEach((s, k) => dots.appendChild(h("button", { type: "button", role: "tab", "aria-label": s.item.title, onclick: () => { show(k); auto(); } })));
        show(0); auto();
    });

    el.destroy = () => { clearInterval(timer); rift && rift.destroy(); };
    return el;
}
