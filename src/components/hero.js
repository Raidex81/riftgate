// Riftgate — the Nexus hero: the living rift on the right, a featured
// item's art and copy on the left. Rotates through a few highlights.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { Rift } from "./rift.js";
import { createIntroSound } from "./intro-sound.js";
import { settings } from "../app/api.js";
import { openDetail } from "./detail.js";
import * as journal from "../app/store.js";
import { flag } from "../app/seals.js";
import { toast } from "./toast.js";

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
    requestAnimationFrame(() => { rift = new Rift(canvas); rift.setRelics(relics()); });
    // your rift grows: everything you finish becomes a relic orbiting it
    const offJournal = journal.subscribe((k) => { if (rift && !String(k).startsWith("pref:")) rift.setRelics(relics()); });
    // the old code (secrets.js): a golden storm
    const onSecret = (e) => {
        if (!rift || !el.isConnected || !e.detail || e.detail.id !== "old-code") return;
        let n = 0; const storm = setInterval(() => { if (!el.isConnected || ++n > 14) return clearInterval(storm); rift.strikeNow({ golden: true }); if (n % 3 === 1) zap(); }, 380);
    };
    window.addEventListener("r2-secret", onSecret);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (window.__pendingStorm) { window.__pendingStorm = false; setTimeout(() => onSecret({ detail: { id: "old-code" } }), 700); } }));

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

    // Click the gem: it strikes, with the opening's lightning sound
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let lastZap = 0;
    el.addEventListener("pointermove", (e) => { if (rift) el.classList.toggle("gem-hover", rift.hitGem(...local(e))); });
    el.addEventListener("pointerleave", () => el.classList.remove("gem-hover"));
    el.addEventListener("click", (e) => {
        if (!rift || e.target.closest("button, a") || !rift.hitGem(...local(e))) return;
        if (performance.now() - lastZap < 220) return;
        lastZap = performance.now();
        // one strike in forty is golden (a secret Seal)
        const golden = Math.random() < 1 / 40;
        rift.strikeNow({ golden });
        zap();
        if (golden) { flag("golden"); toast("A golden strike. One in forty."); }
    });

    el.destroy = () => { clearInterval(timer); offJournal(); window.removeEventListener("r2-secret", onSecret); rift && rift.destroy(); };
    return el;
}

// Relics: one per thing you've completed, in its kind's colour, oldest first
function relics() {
    return journal.entries().filter((e) => e.status === "completed" && e.item).sort((a, b) => (a.completedAt || a.updatedAt || 0) - (b.completedAt || b.updatedAt || 0))
        .map((e) => ({ type: e.item.type || "game", at: e.completedAt || e.updatedAt || 0 }));
}

// The opening's thunder, on one shared audio context (made on the
// first click; silent when the opening is set to play without sound)
let sound = null;
function zap() {
    settings().then((s) => {
        if (s.startupSound === false) return;
        if (!sound) { const AC = window.AudioContext || window.webkitAudioContext; sound = createIntroSound(new AC({ latencyHint: "interactive" }), { volume: .6 }); }
        sound.cue("thunder");
    }).catch(() => { /* no sound */ });
}
