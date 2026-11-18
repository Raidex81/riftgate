// Riftgate — Guides & mods for a game in your Library: one click opens the
// best site for it (a database like Method.gg's for Dune: Awakening, or the
// game's own wiki), and the arrow lists them all: wikis and databases, where
// its mods are (Nexus Mods, Steam Workshop, mod.io, Thunderstore…) and its
// community guides. engine/game-guides.js finds them.

import { h, icon, clear } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import { language } from "../app/i18n.js";

// a game in your Library (not an app, not "Other")
export const hasGuides = (item) => !!item && item.kind === "library" && item.type === "game" && !(item.raw && item.raw.category === "other");

const found = new Map();
function guidesOf(item) {
    const k = item.key || item.title;
    if (!found.has(k)) found.set(k, call("r2-game-guides", { title: item.title, steamAppId: item.steamAppId || (item.raw && item.raw.steamAppId) || null, lang: language() })
        .then((r) => r || { best: null, groups: [] }).catch(() => { found.delete(k); return { best: null, groups: [] }; }));
    return found.get(k);
}
const GROUP_ICON = { guides: "book", mods: "grid", community: "chat" };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };

// ---- The list --------------------------------------------------------------------------
let openMenu = null;
function closeMenu() { if (openMenu) { openMenu.close(); openMenu = null; } }
export async function showGuides(anchor, item) {
    if (openMenu && openMenu.anchor === anchor) return closeMenu();
    closeMenu();
    const menu = h("div.guides-menu", { role: "menu", "aria-label": `Guides and mods for ${item.title}` },
        h("div.guides-head", null, icon("compass"), h("b", null, "Guides & mods"), h("span.muted", { translate: "no" }, item.title)),
        h("div.guides-loading", null, h("span.skeleton-line"), h("span.skeleton-line.short")));
    document.body.appendChild(menu);
    const place = () => {
        const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, hgt = menu.offsetHeight, m = 8;
        menu.style.left = `${Math.max(m, Math.min(innerWidth - w - m, r.left))}px`;
        menu.style.top = `${r.bottom + m + hgt < innerHeight ? r.bottom + m : Math.max(m, r.top - m - hgt)}px`;
    };
    place();
    const onDown = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMenu(); anchor.focus(); } };
    setTimeout(() => document.addEventListener("pointerdown", onDown, true));
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", closeMenu, { once: true });
    openMenu = { anchor, close: () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); menu.remove(); } };

    const r = await guidesOf(item);
    if (!menu.isConnected) return;
    menu.querySelector(".guides-loading").remove();
    for (const g of r.groups) {
        menu.appendChild(h("p.guides-group", null, g.label));
        for (const l of g.links) {
            menu.appendChild(h("button.guides-link", { type: "button", role: "menuitem", title: l.url,
                onclick: () => { openExternal(l.url); closeMenu(); } },
                h("span.guides-fav", null, icon(GROUP_ICON[g.id] || "external")),
                h("span.guides-text", null, h("b", null, l.label), h("small", null, l.note || hostOf(l.url))),
                r.best && l.url === r.best.url ? h("span.guides-best", null, "Best") : null));
        }
    }
    place();
    menu.querySelector(".guides-link")?.focus();
}

// ---- In a game's details: "Guides" (the best site), and the arrow for all of them --------------
export function guidesButton(item) {
    const main = h("button.btn.lg.guides-main", { type: "button", title: "Open the best guide site for this game" }, icon("compass"), "Guides");
    const more = h("button.btn.lg.guides-more", { type: "button", "aria-label": "All guides and mods", title: "All guides, wikis and mods", "aria-haspopup": "menu" }, icon("arrow"));
    main.onclick = async () => {
        const r = await guidesOf(item);
        if (r.best) openExternal(r.best.url); else showGuides(more, item);
    };
    more.onclick = () => showGuides(more, item);
    // say which site it is once known
    guidesOf(item).then((r) => { if (r.best) main.title = `${r.best.label}: ${r.best.note || hostOf(r.best.url)}`; });
    return h("div.guides-split", null, main, more);
}

// ---- On a Library card: a small compass that opens the list -------------------------------------
export function guidesChip(item) {
    const chip = h("span.guides-chip", { role: "button", tabindex: "0", title: "Guides & mods", "aria-label": `Guides and mods for ${item.title}`, "aria-haspopup": "menu" }, icon("compass"));
    const go = (e) => { e.preventDefault(); e.stopPropagation(); showGuides(chip, item); };
    chip.addEventListener("click", go);
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    return chip;
}
