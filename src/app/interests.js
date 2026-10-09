// Riftgate — what you're into. Each interest is "Love it" (2), "Sometimes"
// (1, the default) or "Not for me" (0). Riftgate follows it everywhere:
// sections you don't care about leave the rail, Nexus leads with what you
// love and drops what you don't, the banner and the moods do the same.

import { h, icon, clear } from "./dom.js";
import * as journal from "./store.js";

export const INTERESTS = [
    { id: "games", label: "Games", hint: "Your library and what's coming", icon: "library" },
    { id: "free", label: "Free games", hint: "Free to keep and free to play", icon: "gift" },
    { id: "deals", label: "Game deals", hint: "Big discounts worth taking", icon: "tag" },
    { id: "screen", label: "Films & series", hint: "Cinemas, streaming, your shows", icon: "film" },
    { id: "anime", label: "Anime", hint: "New seasons and series", icon: "sparkles" },
    { id: "books", label: "Books & comics", hint: "Best sellers, manga, classics", icon: "book" }
];
export const LEVELS = [
    { v: 2, label: "Love it", icon: "heartFill" },
    { v: 1, label: "Sometimes" },
    { v: 0, label: "Not for me", icon: "x" }
];

export function all() { return { ...Object.fromEntries(INTERESTS.map((i) => [i.id, 1])), ...(journal.pref("interests", null) || {}) }; }
export function chosen() { return !!journal.pref("interests", null); }
export function level(...ids) { if (!ids.length) return 3; /* not tied to an interest: always leads */ const a = all(); return Math.max(...ids.map((id) => (id in a ? a[id] : 1))); }
export const wants = (...ids) => !ids.length || level(...ids) > 0;
export function set(id, v) { return journal.setPref("interests", { ...all(), [id]: v }); }
export function onChange(fn) { return journal.subscribe((k) => { if (k === "pref:interests") fn(); }); }

// Stable sort: things you love first, the rest keep their order.
export function byInterest(list, idsOf) {
    return list.map((x, i) => ({ x, i, l: level(...idsOf(x)) }))
        .sort((a, b) => b.l - a.l || a.i - b.i).map((o) => o.x);
}

// The picker: one card per interest with Love it / Sometimes / Not for me.
export function interestPicker() {
    const el = h("div.interests");
    const paint = () => {
        const a = all();
        clear(el);
        INTERESTS.forEach((it) => {
            const card = h("div.interest", { dataset: { level: String(a[it.id]) } },
                h("span.interest-gem", null, icon(it.icon)),
                h("div.interest-copy", null, h("b", null, it.label), h("span", null, it.hint)),
                h("div.interest-levels", { role: "radiogroup", "aria-label": it.label },
                    LEVELS.map((L) => h("button", { type: "button", role: "radio", "aria-checked": String(a[it.id] === L.v), dataset: { v: String(L.v) },
                        onclick: async () => { await set(it.id, L.v); paint(); } }, L.icon ? icon(L.icon) : null, L.label))));
            el.appendChild(card);
        });
    };
    paint();
    return el;
}

// First launch (and any time from Settings or Ctrl K): make Riftgate yours.
export function openInterests({ first = false } = {}) {
    if (document.querySelector(".interests-portal")) return;
    const done = h("button.btn.primary.xl", { type: "button", onclick: () => close() }, icon("check"), first ? "That's me" : "Done");
    const wrap = h("div.interests-portal", { role: "dialog", "aria-modal": "true", "aria-label": "Make Riftgate yours" },
        h("div.interests-box", null,
            first ? h("img.account-gem", { src: "assets/riftgate-gem-mark.png", alt: "" }) : null,
            h("p.today-kicker", null, icon("gem"), first ? "Welcome to Riftgate" : "Your interests"),
            h("h1.today-title", null, "What are you into?"),
            h("p.muted", null, "Riftgate leads with what you love and keeps out of the way what you don't. Change it any time in Settings."),
            interestPicker(),
            done));
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey);
    function close() {
        wrap.remove(); document.removeEventListener("keydown", onKey);
        if (!chosen()) journal.setPref("interests", all()); // keep the defaults, don't ask again
    }
    document.body.appendChild(wrap);
    done.focus();
}
