// Riftgate — the ambient background (Riftgate 1.x's "ambient on hover",
// grown up): resting on a card, by mouse or controller, softly fills the
// page behind with that card's artwork, blurred and faint, tinted with its
// type colour, cross-fading from the last one. It stays until another card
// is chosen. Not shown over a theme's own picture, nor with reduced motion.

import { h, coverSrc } from "../app/dom.js";

let layers = null, front = 0, lastKey = null, timer = null;
const TYPE_VAR = { game: "--type-game", app: "--type-app", film: "--type-film", series: "--type-series", anime: "--type-anime", book: "--type-book" };

function ensure() {
    if (layers) return layers;
    const app = document.getElementById("app");
    if (!app) return null;
    layers = [h("div.ambient"), h("div.ambient")];
    app.prepend(...layers);
    return layers;
}

export function ambient(item) {
    if (!item || item.key === lastKey) return;
    if (document.documentElement.hasAttribute("data-wallpaper")) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    clearTimeout(timer);
    // a short delay so sweeping the mouse across a row doesn't flicker
    timer = setTimeout(() => {
        const ls = ensure();
        if (!ls) return;
        lastKey = item.key;
        const art = item.backdrop || item.image;
        const next = ls[1 - front], prev = ls[front];
        next.style.setProperty("--amb-img", art ? `url("${coverSrc(art)}")` : "none");
        next.style.setProperty("--amb-tint", `var(${TYPE_VAR[item.type] || "--amethyst"})`);
        next.classList.add("on"); prev.classList.remove("on");
        front = 1 - front;
    }, 140);
}
