// Riftgate — the Dune: Awakening companion. Your loadout laid out like the
// game's equipment screen (gear on the body, weapons below), saved as builds;
// hover an item for its stats, hover its hammer for what it takes to craft;
// and for the whole build, what to farm and where. Weapons ranked best to
// weakest, armour by protection, and each dungeon with its hazard, the gear
// that suits it, its boss's strategy and a video of the fight.
// All of it from the Dune: Awakening Community Wiki (engine/dune.js), which
// it follows as the wiki is updated.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as journal from "../app/store.js";
import { toast } from "../components/toast.js";
import { shortAgo } from "../app/sources.js";

// Like the game's own screen: the character's gear on the right (two columns),
// the quick-swap loadout wheel of eight on the left
const SLOTS = [
    { id: "Head", kind: "garment", label: "Head", icon: "eye" },
    { id: "Torso", kind: "garment", label: "Chest", icon: "shield" },
    { id: "Legs", kind: "garment", label: "Legs", icon: "list" },
    { id: "Hands", kind: "garment", label: "Hands", icon: "grip" },
    { id: "Feet", kind: "garment", label: "Feet", icon: "arrow" },
    { id: "Suit", kind: "garment", label: "Utility suit", icon: "flame" },
    { id: "Belt", kind: "gadget", label: "Suspensor belt", icon: "rift" },
    { id: "Shield", kind: "gadget", label: "Shield", icon: "shield" },
    { id: "Power", kind: "gadget", label: "Power pack", icon: "bulb" },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `L${n}`, kind: "weapon", label: `Loadout ${n}`, icon: "plus", n }))
];
// builds saved before the wheel: their three weapon slots go into the wheel
const migrate = (slots) => { const s = { ...(slots || {}) }; [["Ranged1", "L1"], ["Ranged2", "L2"], ["Melee", "L3"]].forEach(([a, b2]) => { if (s[a] && !s[b2]) s[b2] = s[a]; delete s[a]; }); return s; };
const MIT_LABEL = { light_dart: "Light dart", heavy_dart: "Heavy dart", blade: "Blade", concussive: "Concussive", energy: "Energy", fire: "Fire", radiation: "Radiation", poison: "Poison" };
const fmt = (v, d = 0) => (v == null ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const tierClass = (it) => (it.unique ? "unique" : `mk${it.tier ?? 0}`);
const mk = (it) => (it.unique ? "Unique" : it.tier ? `Mk${it.tier}` : "");
const img = (url, alt = "") => (url ? h("img", { src: coverSrc(url), alt, loading: "lazy", draggable: "false", onerror: (e) => e.target.replaceWith(h("span.dn-noimg", null, icon("gem"))) }) : h("span.dn-noimg", null, icon("gem")));
const mins = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

// ---- Builds (saved in your Journal's settings) --------------------------------------------------------
const builds = () => { const b = journal.pref("dune:builds", null); return Array.isArray(b) && b.length ? b : [{ id: "b1", name: "My build", slots: {} }]; };
const saveBuilds = (list) => journal.setPref("dune:builds", list);
const currentId = () => journal.pref("dune:build", null);

// ---- Where to get a piece -------------------------------------------------------------------------------
// A Unique's schematic drops in the world (the wiki says where, and how often) or is traded on the Exchange;
// the rest are researched with Intel, in a tier, and then crafted.
const SRC = { research: {}, where: {}, dungeons: new Set(), goDungeon: null, augments: [], weapons: [], garments: [], equip: null };
function howToGet(it) {
    const w = SRC.where[it.name];
    if (w && (w.places.length || w.exchange || w.text)) return { kind: "drop", ...w };
    const r = SRC.research[it.name];
    if (r) return { kind: "research", ...r };
    return it.unique ? { kind: "drop", places: [], exchange: false, text: null } : null;
}
function placeChip(p) {
    const inDungeons = SRC.dungeons.has(p.name);
    return h(`button.dn-place${inDungeons ? ".dungeon" : ""}`, { type: "button", title: inDungeons ? "See this dungeon: its hazard, boss and what to bring" : "Open this place on the wiki",
        onclick: (e) => { e.stopPropagation(); closeTip(); if (inDungeons && SRC.goDungeon) { closeItem(); SRC.goDungeon(p.name); } else openExternal(`https://awakening.wiki/${encodeURIComponent(p.name.replace(/ /g, "_"))}`); } },
    icon(inDungeons ? "flame" : "compass"), h("span", { translate: "no" }, p.label), p.chance != null ? h("small", null, `${fmt(p.chance, 1)}%`) : null);
}
function whereEls(it) {
    const g = howToGet(it);
    if (!g) return [h("p.dn-where-none", null, "The wiki doesn't say yet where it comes from.")];
    if (g.kind === "research") return [
        h("p", null, icon("bulb"), h("span", null, g.tier && g.cost ? `Research its schematic in the ${g.tier} tier for ${fmt(g.cost)} Intel, then craft it.` : g.tier ? `Research its schematic in the ${g.tier} tier, then craft it.` : "Research its schematic, then craft it.")),
        g.prereq ? h("p.dn-where-note", null, `Unlocked after: ${g.prereq}`) : null].filter(Boolean);
    const out = [];
    if (g.places.length) out.push(h("p", null, icon("search"), h("span", null, "Its schematic drops in:")), h("div.dn-places", null, ...g.places.map(placeChip)));
    else if (g.text) out.push(h("p", { translate: "no" }, icon("search"), h("span", null, g.text)));
    else out.push(h("p.dn-where-none", null, icon("search"), h("span", null, "A Unique: its schematic drops somewhere in the world. The wiki doesn't say where yet.")));
    if (g.exchange) out.push(h("p", null, icon("tag"), h("span", null, "Or buy the schematic from other players on the Exchange.")));
    out.push(h("p.dn-where-note", null, "A schematic lets you craft it once."));
    return out;
}

// ---- An item opened: every stat at every level, where to get it, its recipe and its augments -------------------
const TIER_WORDS = /^(Standard|Artisan|House|Adept|Regis)\s+/;
const familyKey = (it) => (it.group ? `w|${it.group}|${it.family}` : `g|${it.slot}|${String(it.name).replace(TIER_WORDS, "").replace(/\s+Mk\s?\d$/i, "").trim()}`);
function variantsOf(it) {
    const pool = it.group ? SRC.weapons : SRC.garments;
    const key = familyKey(it);
    return pool.filter((x) => familyKey(x) === key).sort((a, b) => (a.unique - b.unique) || (a.tier || 0) - (b.tier || 0) || a.name.localeCompare(b.name));
}
// the rows of the levels table: [label, value, digits, unit, lower is better]
function statLines(it, all) {
    if (it.group) return [["Sustained damage / s", (x) => x.score, 1], ["Burst damage / s", (x) => x.dps, 1],
        [it.group === "melee" ? "Damage per hit" : "Damage per shot", (x) => x.damage, 1], [it.group === "melee" ? "Attacks / min" : "Rounds / min", (x) => x.rate, 0],
        ["Magazine", (x) => x.clip, 0], ["Reload", (x) => x.reload, 2, " s", true], ["Effective range", (x) => x.range, 0, " m"],
        ["Accuracy", (x) => x.accuracy, 2], ["Stability", (x) => x.stability, 2, "", null]].filter(([, f]) => all.some((x) => f(x) != null));
    const mits = [...new Set(all.flatMap((x) => Object.keys(x.mit || {})))];
    return [["Armour", (x) => x.armor, 0], ...mits.map((k) => [`${MIT_LABEL[k] || k} mitigation`, (x) => (x.mit || {})[k], 1, "%"]),
        ["Heat protection", (x) => x.heat, 1], ["Dash stamina", (x) => x.stamina, 1, "", true]].filter(([, f]) => all.some((x) => f(x) != null));
}
// an augment as the game draws it: its icon in a frame; hover it for a large view with what its best grade does
function augIcon(a, { big = false } = {}) {
    const el = h(`span.dn-augicon${big ? ".big" : ""}`, { tabindex: "0", "aria-label": a.name }, img(a.image, a.name));
    const top = (a.grades || []).slice().sort((x, y) => y.grade - x.grade)[0];
    return hover(el, () => [h("div.dn-augbig", null, img(a.image, a.name)), h("div.dn-tip-head.craft", null, icon("sparkles"), h("div", null, h("b", { translate: "no" }, a.name),
        top ? h("small", null, `Grade ${top.grade}`) : a.grade ? h("small", null, `Grade ${a.grade}`) : null)),
        top ? h("p.dn-tip-meta", null, top.effects.map((e) => e.text).join(" · ")) : null].filter(Boolean));
}
let drawerEl = null, drawerBack = null, drawerFrom = null;
function closeItem() {
    if (!drawerEl) return;
    drawerEl.remove(); drawerBack.remove(); drawerEl = drawerBack = null;
    document.removeEventListener("keydown", drawerKeys, true);
    if (drawerFrom && drawerFrom.isConnected) drawerFrom.focus();
}
function drawerKeys(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeItem(); } }
function openItem(it, from) {
    closeTip();
    if (!drawerEl) {
        drawerFrom = from || document.activeElement;
        drawerBack = h("div.dn-drawer-back", { onclick: closeItem });
        drawerEl = h("aside.dn-drawer", { role: "dialog", "aria-modal": "true", "aria-label": it.name, tabindex: "-1" });
        document.body.append(drawerBack, drawerEl);
        document.addEventListener("keydown", drawerKeys, true);
    }
    drawerEl.setAttribute("aria-label", it.name);
    const vars = variantsOf(it);
    const lines = statLines(it, vars.length ? vars : [it]);
    // every level of the same item side by side, the one you opened outlined; click a level to open it
    const levels = vars.length > 1 ? h("div.dn-levels", null, h("table", null,
        h("thead", null, h("tr", null, h("th", null, "Level"), ...vars.map((v) => h(`th${v.id === it.id ? ".on" : ""}`, null,
            h("button", { type: "button", "aria-pressed": String(v.id === it.id), title: v.name, onclick: () => openItem(v) }, mk(v) || "–"))))),
        h("tbody", null, ...lines.map(([label, f, dg, unit = "", lower]) => {
            const vals = vars.map(f).filter((v) => v != null);
            const best = lower === null || new Set(vals).size < 2 ? null : lower ? Math.min(...vals) : Math.max(...vals);
            return h("tr", null, h("th", null, label), ...vars.map((v) => { const val = f(v); return h(`td${v.id === it.id ? ".on" : ""}${val != null && val === best && vals.length > 1 ? ".best" : ""}`, null, val == null ? "–" : `${fmt(val, dg)}${unit}`); }));
        })))) : null;

    const kinds = (it.augs || []).map((i) => SRC.augments[i]).filter(Boolean);
    const mk6 = vars.find((v) => (v.tier || 0) >= 6 && !v.unique);
    const can = (it.tier || 0) >= 6;
    const augSection = (it.group || it.mit) ? h("section.dn-dsec", null, h("h3", null, icon("sparkles"), "Augmentations"),
        h("p.dn-where-note", null, "Augments go on Plastanium (Mk6) items. They're crafted from schematics found in the overland dungeons, with Regis Components from Landsraad missions, and fitted at an Augmentation Station: once fitted they can't come off, and they take 2% of the item's maximum durability."),
        !can ? h("p.dn-augwarn", null, icon("info"), h("span", null, `This one is ${mk(it) || "below Mk6"}: it can't take augments.`), mk6 ? h("button.linkish", { type: "button", onclick: () => openItem(mk6) }, `See ${mk6.name}`) : null) : null,
        it.bestAug ? h("div.dn-augpick", null, augIcon(it.bestAug, { big: true }), h("div", null, h("small", null, icon("star"), "Suggested"), h("b", { translate: "no" }, `${it.bestAug.name} · Grade ${it.bestAug.grade}`),
            h("p", null, "The biggest overall boost of the augments listed for it, on the wiki's numbers (damage and armour weigh the most, then fire rate, magazine and reload).")))
            : can ? h("div.dn-augpick.none", null, icon("info"), h("div", null, h("b", null, "No suggestion yet"),
                h("p", null, "The wiki doesn't list the numbers of the augments for this item yet; Riftgate suggests one as soon as it does."),
                it.group ? h("button.linkish", { type: "button", onclick: () => openExternal("https://www.method.gg/dune-awakening/database/augmentations") }, icon("external"), "Players' augment lists on Method.gg") : null)) : null,
        ...kinds.map((k) => h("div.dn-augkind", null,
            h("h4", null, k.applies === "all" ? "For any item" : k.applies === "garment" ? "For armour" : k.applies === "melee" ? "For melee weapons" : k.applies === "ranged" ? "For any gun" : `For the ${k.title}`),
            k.places.length ? h("div.dn-where", null, h("p", null, icon("search"), h("span", null, "Their schematics drop in:")), h("div.dn-places", null, ...k.places.map(placeChip)))
                : k.found ? h("p.dn-where-note", { translate: "no" }, k.found) : null,
            k.augments.length ? h("div.dn-auglist", null, ...k.augments.map((a) => h(`div.dn-aug${it.bestAug && it.bestAug.name === a.name ? ".best" : ""}`, null,
                h("div.dn-aughead", null, augIcon(a), h("b", { translate: "no" }, a.name), it.bestAug && it.bestAug.name === a.name ? h("span.dn-augbadge", null, "Best pick") : null),
                h("table.dn-grades", null, h("tbody", null, ...a.grades.map((g) => h("tr", null, h("th", null, `Grade ${g.grade}`), h("td", null, g.effects.map((e) => e.text).join(" · ")))))))))
                : h("p.dn-where-none", null, "The wiki hasn't listed these augments yet."))),
        !kinds.length ? h("p.dn-where-none", null, "The wiki lists no augments for this kind of item yet.") : null) : null;

    const craft = h("div.dn-dcraft", null, h("p.muted", null, "Reading the recipe on the wiki…"));
    craftTip(it).then((nodes) => { if (craft.isConnected) clear(craft).append(...[].concat(nodes).slice(1)); }).catch(() => {});

    clear(drawerEl).append(
        h("div.dn-dhead2", null, h(`div.dn-dimg.${tierClass(it)}`, null, img(it.image, it.name)),
            h("div", null, h("h2", { translate: "no" }, it.name),
                h("p", null, [mk(it), it.group ? it.cls : it.kind ? null : `${it.type} · ${it.slot}`, it.dart].filter(Boolean).join(" · ")),
                it.rank ? h("p.dn-rank", null, `#${it.rank} of the ${it.group === "melee" ? "melee weapons" : "guns"}`) : null),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: closeItem }, icon("x"))),
        h("div.dn-dscroll", null,
            it.desc ? h("p.dn-tip-desc", { translate: "no" }, it.desc) : null,
            h("section.dn-dsec", null, h("h3", null, icon("list"), vars.length > 1 ? "Stats at every level" : "Stats"),
                levels || h("div.dn-stats", null, ...statRows(it)),
                vars.length > 1 ? h("p.dn-where-note", null, "The same item at each level; the best value of each row is marked. Click a level to open it.") : null),
            augSection,
            h("section.dn-dsec", null, h("h3", null, icon("compass"), "Where to get it"), h("div.dn-where", null, ...whereEls(it))),
            h("section.dn-dsec", null, h("h3", null, icon("settings"), "Crafting"), craft)),
        h("div.dn-dfoot", null,
            SRC.equip ? h("button.btn", { type: "button", onclick: () => { SRC.equip(it); } }, icon("plus"), "Equip") : null,
            h("button.btn.ghost", { type: "button", onclick: () => openExternal(it.url || `https://awakening.wiki/${encodeURIComponent(it.name.replace(/ /g, "_"))}`) }, icon("external"), "On the wiki")));
    drawerEl.querySelector(".dn-dscroll").scrollTop = 0;
    drawerEl.focus();
}

// ---- Tooltips: the item's stats, like in the game; and, over its hammer, the recipe ---------------------------
let tip = null, tipTimer = null;
const closeTip = () => { clearTimeout(tipTimer); if (tip) { tip.remove(); tip = null; } };
function placeTip(anchor) {
    const r = anchor.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight, m = 10;
    let x = r.right + m; if (x + w > innerWidth - m) x = r.left - m - w; if (x < m) x = Math.max(m, Math.min(innerWidth - w - m, r.left));
    const y = Math.max(m, Math.min(innerHeight - hh - m, r.top));
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
function hover(el, make) {
    const show = () => { clearTimeout(tipTimer); tipTimer = setTimeout(async () => { closeTip(); tip = h("div.dn-tip", { role: "tooltip" }); document.body.appendChild(tip); const c = make(); tip.append(...[].concat(c instanceof Promise ? [h("div.dn-tip-wait", null, "Reading the wiki…")] : c)); placeTip(el); if (c instanceof Promise) { const mine = tip; const got = await c; if (tip !== mine) return; clear(tip).append(...[].concat(got)); placeTip(el); } }, 140); };
    el.addEventListener("mouseenter", show); el.addEventListener("focus", show);
    el.addEventListener("mouseleave", closeTip); el.addEventListener("blur", closeTip);
    return el;
}
function statRows(it) {
    const row = (k, v, cls) => h(`div.dn-stat${cls ? "." + cls : ""}`, null, h("span", null, k), h("b", null, v));
    if (it.kind) return Object.entries(it.stats || {}).map(([k, v], i) => row(k, typeof v === "number" ? fmt(v, 1) : v, i ? "" : "key"));
    if (it.group) return [
        row("Sustained damage / s", fmt(it.score, 1), "key"), row("Burst damage / s", fmt(it.dps, 1)),
        row(it.group === "melee" ? "Damage per hit" : "Damage per shot", fmt(it.damage, 1)),
        row(it.group === "melee" ? "Attacks / min" : "Rounds / min", fmt(it.rate)),
        it.clip ? row("Magazine", fmt(it.clip)) : null, it.reload != null ? row("Reload", `${fmt(it.reload, 2)} s`) : null,
        it.range != null ? row("Effective range", `${fmt(it.range)} m`) : null, it.accuracy != null ? row("Accuracy", fmt(it.accuracy, 2)) : null,
        it.stability != null ? row("Stability", fmt(it.stability, 2)) : null, it.damageType ? row("Damage type", it.damageType) : null, it.fireMode ? row("Fire mode", it.fireMode) : null
    ].filter(Boolean);
    return [row("Armour", fmt(it.armor), "key"),
        ...Object.entries(it.mit).map(([k, v]) => row(`${MIT_LABEL[k] || k} mitigation`, `${v > 0 ? "+" : ""}${fmt(v, 1)}%`, v < 0 ? "neg" : "pos")),
        it.heat != null ? row("Heat protection", fmt(it.heat, 1)) : null, it.stamina != null ? row("Dash stamina", fmt(it.stamina, 1)) : null];
}
function statsTip(it) {
    return [h(`div.dn-tip-head.${tierClass(it)}`, null, h("div.dn-tip-img", null, img(it.image)), h("div", null, h("b", { translate: "no" }, it.name),
        h("small", null, [mk(it), it.group ? it.cls : it.kind ? ({ Belt: "Suspensor belt", Shield: "Holtzman shield", Power: "Power pack" })[it.kind] : `${it.type} · ${it.slot}`].filter(Boolean).join(" · ")),
        it.rank ? h("small.dn-rank", null, `#${it.rank} of the ${it.group === "melee" ? "melee weapons" : "guns"}`) : null)),
    h("div.dn-stats", null, ...statRows(it)),
    it.desc ? h("p.dn-tip-desc", { translate: "no" }, it.desc) : null,
    h("div.dn-where.in-tip", null, h("small.dn-where-h", null, "Where to get it"), ...whereEls(it)),
    h("p.dn-tip-hint", null, icon("info"), "Hover the hammer for what it takes to craft")].filter(Boolean);
}
const crafted = new Map();
function recipeOf(name) {
    if (!crafted.has(name)) crafted.set(name, call("r2-dune-craft", [{ name, qty: 1 }]).then((r) => r || {}).catch(() => { crafted.delete(name); return {}; }));
    return crafted.get(name);
}
async function craftTip(it) {
    const r = await recipeOf(it.name);
    const p = r.pages && r.pages[it.name];
    const rec = p && p.recipes && (p.recipes.find((x) => x.makes.some((m) => m.name === it.name)) || p.recipes[0]);
    const head = h("div.dn-tip-head.craft", null, icon("settings"), h("div", null, h("b", { translate: "no" }, it.name), h("small", null, rec ? `Made in: ${rec.stations.join(", ")}` : "Not crafted")));
    if (r.error) return [head, h("p.dn-tip-desc", null, r.error)];
    if (!rec) return [head, h("p.dn-tip-desc", null, p && p.where ? p.where : "The wiki has no recipe for it: it's found, not made.")];
    const raw = r.farm && r.farm.raw;
    return [head,
        h("div.dn-mats", null, ...rec.ingredients.map((i) => h("div.dn-mat", null, img(i.image), h("span", { translate: "no" }, i.name), h("b", null, `× ${fmt(i.qty)}`)))),
        h("p.dn-tip-meta", null, rec.water ? `${fmt(rec.water)} mL water · ` : "", rec.time ? `${fmt(rec.time, 1)} s` : ""),
        raw && raw.length ? h("div.dn-raw", null, h("small", null, "Gathered, all the way down:"), h("p", { translate: "no" }, raw.map((m) => `${m.name} × ${fmt(m.qty)}`).join(", "))) : null].filter(Boolean);
}

// an item as the game shows it: picture in a frame of its tier, Mk in the corner, a hammer for its recipe
function tile(it, { onclick, size = "", label } = {}) {
    const hammer = hover(h("span.dn-hammer", { tabindex: "0", "aria-label": `What it takes to craft ${it.name}` }, icon("settings")), () => craftTip(it));
    hammer.addEventListener("click", (e) => e.stopPropagation());
    const el = h(`button.dn-tile.${tierClass(it)}${size ? "." + size : ""}`, { type: "button", "aria-label": label || it.name, onclick },
        img(it.image, it.name), mk(it) ? h("span.dn-mk", null, mk(it)) : null, hammer);
    return hover(el, () => statsTip(it));
}

export default {
    async render(root) {
        root.classList.add("dn");
        const head = h("div.view-head", null, h("div", null, h("h1", null, "Dune: Awakening"), h("p.muted", null, "Your loadout, the strongest weapons and armour, what to farm and every dungeon's boss, from the Dune: Awakening Community Wiki.")));
        const tabsEl = h("div.chips.dn-tabs", { role: "tablist" });
        const body = h("div.dn-body", null, h("div.dn-loading", null, h("span.skeleton-line"), h("span.skeleton-line.short")));
        const foot = h("p.dn-credit.muted");
        root.append(head, tabsEl, body, foot);
        const stopTip = () => closeTip();
        window.addEventListener("scroll", stopTip, true);

        let d = await call("r2-dune-data", {});
        if (!d || d.error || !d.weapons) {
            clear(body).append(h("div.empty", null, icon("wifi-off"), h("h3", null, "The Dune: Awakening wiki didn't answer"), h("p", null, (d && d.error) || "Check your connection and try again."),
                h("button.btn", { type: "button", onclick: () => location.reload() }, icon("refresh"), "Try again")));
            return () => window.removeEventListener("scroll", stopTip, true);
        }
        const credit = () => {
            clear(foot).append("Data from the ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); openExternal("https://awakening.wiki/"); } }, "Dune: Awakening Community Wiki"),
                " (CC BY-NC-SA 4.0), taken from the game's files and kept by its players. Dune: Awakening © Funcom. Updated ", shortAgo(d.at), ". ",
                h("button.linkish", { type: "button", onclick: async () => { foot.lastChild.textContent = "Checking…"; const n = await call("r2-dune-data", { fresh: true }); if (n && !n.error) { d = n; index(); toast("Up to date with the wiki"); paint(); } credit(); } }, "Check the wiki now"));
        };
        let W, G, GD, byName;
        const index = () => {
            W = d.weapons; G = d.garments; GD = d.gadgets || []; byName = new Map([...W, ...G, ...GD].map((x) => [x.id, x]));
            Object.assign(SRC, { research: d.research || {}, where: d.where || {}, dungeons: new Set((d.dungeons || []).map((x) => x.title)), augments: d.augments || [], weapons: W, garments: G });
        };
        index(); credit();

        let tab = journal.pref("dune:tab", "loadout"), focusDungeon = null;
        SRC.goDungeon = (title) => { focusDungeon = title; tab = "dungeons"; journal.setPref("dune:tab", tab); paint(); };
        const TABS = [["loadout", "Loadout", "library"], ["weapons", "Weapons", "rift"], ["armour", "Armour", "shield"], ["dungeons", "Dungeons", "flame"], ["skills", "Skills", "sparkles"]];
        const paintTabs = () => { clear(tabsEl); TABS.forEach(([id, label, ic]) => tabsEl.append(h("button.chip", { type: "button", role: "tab", "aria-selected": String(tab === id), "aria-pressed": String(tab === id), onclick: () => { tab = id; journal.setPref("dune:tab", id); paint(); } }, icon(ic), label))); };
        const paint = () => { closeTip(); paintTabs(); clear(body); ({ loadout, weapons, armour, dungeons, skills })[tab](); };

        // ---- Loadout -------------------------------------------------------------------------------------
        let picking = null;
        function loadout() {
            const all = builds();
            let b = all.find((x) => x.id === currentId()) || all[0];
            b = { ...b, slots: migrate(b.slots) };
            const save = (patch) => { const list = builds().map((x) => (x.id === b.id ? { ...x, ...patch, updatedAt: Date.now() } : x)); if (!list.some((x) => x.id === b.id)) list.push({ ...b, ...patch }); b = { ...b, ...patch }; saveBuilds(list); };
            const itemIn = (slot) => byName.get(b.slots[slot]);

            // builds: pick, new, rename, copy, delete
            const sel = h("select.input", { "aria-label": "Build", onchange: () => { journal.setPref("dune:build", sel.value); paint(); } }, all.map((x) => h("option", { value: x.id, selected: x.id === b.id || null }, x.name)));
            const bar = h("div.dn-buildbar", null, icon("library"), sel,
                h("button.btn.sm", { type: "button", onclick: () => { const nb = { id: `b${Date.now().toString(36)}`, name: `Build ${all.length + 1}`, slots: {} }; saveBuilds([...builds(), nb]); journal.setPref("dune:build", nb.id); paint(); } }, icon("plus"), "New"),
                h("button.btn.sm", { type: "button", onclick: () => { const nb = { ...b, id: `b${Date.now().toString(36)}`, name: `${b.name} (copy)`, slots: { ...b.slots } }; saveBuilds([...builds(), nb]); journal.setPref("dune:build", nb.id); paint(); } }, "Copy"),
                h("button.btn.sm", { type: "button", onclick: () => {
                    // (renamed in place: Riftgate's window has no pop-up prompts)
                    const inp = h("input.input.dn-rename", { type: "text", value: b.name, maxlength: 40, "aria-label": "Build name" });
                    const done = () => { const n = inp.value.trim(); if (n) save({ name: n.slice(0, 40) }); paint(); };
                    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); if (e.key === "Escape") paint(); });
                    inp.addEventListener("blur", done);
                    sel.replaceWith(inp); inp.focus(); inp.select();
                } }, "Rename"),
                all.length > 1 ? h("button.btn.sm.ghost", { type: "button", onclick: () => { saveBuilds(builds().filter((x) => x.id !== b.id)); journal.setPref("dune:build", null); paint(); } }, icon("trash"), "Delete") : null);

            // the equipment screen
            const slotEl = (s) => {
                const it = itemIn(s.id);
                const box = h(`div.dn-slot.s-${s.id}${picking === s.id ? ".picking" : ""}`, null,
                    it ? tile(it, { onclick: () => { picking = s.id; paint(); }, label: `${s.label}: ${it.name}` })
                        : h("button.dn-tile.empty", { type: "button", "aria-label": `${s.label}: empty`, onclick: () => { picking = s.id; paint(); } }, icon(s.icon)),
                    h("small", null, s.label),
                    it ? h("button.dn-unequip", { type: "button", "aria-label": `Take off ${it.name}`, title: "Take it off", onclick: () => { const slots = { ...b.slots }; delete slots[s.id]; save({ slots }); paint(); } }, icon("x")) : null);
                return box;
            };
            const figure = h("div.dn-figure", { "aria-hidden": "true" });
            figure.innerHTML = `<svg viewBox="0 0 120 260"><defs><linearGradient id="dnfig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity=".08"/></linearGradient></defs><path fill="url(#dnfig)" d="M60 8c11 0 19 9 19 21s-8 22-19 22-19-10-19-22S49 8 60 8zM38 60h44c9 0 15 6 17 15l8 55c1 6-3 10-8 10-4 0-7-3-8-7l-6-38-2 60 4 92c0 7-5 11-11 11s-10-4-10-10l-6-80-6 80c0 6-5 10-10 10-6 0-11-4-11-11l4-92-2-60-6 38c-1 4-4 7-8 7-5 0-9-4-8-10l8-55c2-9 8-15 17-15z"/></svg>`;
            // what you're wearing, on you: each piece's picture where it goes, glowing in its tier's colour; your first two weapons in hand and on your back
            [["Head", "head"], ["Torso", "chest"], ["Hands", "hand-l"], ["Hands", "hand-r"], ["Legs", "legs"], ["Feet", "foot-l"], ["Feet", "foot-r"], ["Suit", "suit"], ["Belt", "belt"], ["Shield", "shield"], ["Power", "power"], ["L1", "weapon"], ["L2", "back"]].forEach(([slot, where]) => {
                const it = itemIn(slot);
                if (it && it.image) figure.appendChild(h(`span.dn-wear.p-${where}.${tierClass(it)}`, null, h("img", { src: coverSrc(it.image), alt: "", onerror: (e) => e.target.parentElement.remove() })));
            });
            figure.classList.toggle("suited", !!itemIn("Suit"));
            // left: the loadout wheel (1 at the top, clockwise, like the game); middle: you; right: your gear
            const wheelAt = { 1: "t", 2: "tr", 3: "r", 4: "br", 5: "b", 6: "bl", 7: "l", 8: "tl" };
            const wheel = h("div.dn-wheel", null, ...SLOTS.filter((x) => x.n).map((x) => { const el = slotEl(x); el.classList.add(`w-${wheelAt[x.n]}`); return el; }),
                h("div.dn-hub", { "aria-hidden": "true" }, ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => h(`span.h-${wheelAt[n]}`, null, String(n)))));
            const gear = h("div.dn-equip", null,
                h("div.dn-side", null, h("p.dn-plate", null, "Loadout"), wheel),
                figure,
                h("div.dn-side", null, h("p.dn-plate", null, "Character"),
                    h("div.dn-chargrid", null,
                        h("div.dn-col", null, ...["Head", "Torso", "Legs", "Hands", "Feet"].map((id) => slotEl(SLOTS.find((x) => x.id === id)))),
                        h("div.dn-col", null, ...["Suit", "Belt", "Shield", "Power"].map((id) => slotEl(SLOTS.find((x) => x.id === id)))))));

            // what the build adds up to
            const worn = SLOTS.filter((s) => s.kind === "garment").map((s) => itemIn(s.id)).filter(Boolean);
            const guns = SLOTS.filter((s) => s.kind === "weapon").map((s) => itemIn(s.id)).filter(Boolean);
            const kit = SLOTS.filter((s) => s.kind === "gadget").map((s) => itemIn(s.id)).filter(Boolean);
            const mit = {};
            worn.forEach((g) => Object.entries(g.mit).forEach(([k, v]) => { mit[k] = (mit[k] || 0) + v; }));
            const sum = h("div.dn-sum", null,
                h("div.dn-sumhead", null, h("b", null, fmt(worn.reduce((n, g) => n + g.armor, 0))), h("span", null, "armour")),
                h("div.dn-stats", null, ...Object.entries(mit).filter(([, v]) => v).map(([k, v]) => h(`div.dn-stat.${v < 0 ? "neg" : "pos"}`, null, h("span", null, MIT_LABEL[k] || k), h("b", null, `${v > 0 ? "+" : ""}${fmt(v, 1)}%`))),
                    ...guns.map((w) => h("div.dn-stat.key", null, h("span", { translate: "no" }, w.name), h("b", null, `${fmt(w.score, 1)} dmg/s`)))));

            // the item list for the slot you clicked, best first
            let picker = null;
            if (picking) {
                const s = SLOTS.find((x) => x.id === picking);
                const q = h("input.input", { type: "search", placeholder: `Find ${s.kind === "weapon" ? "a weapon" : "a piece"}…`, "aria-label": "Find" });
                const grid = h("div.dn-grid");
                const pool = s.kind === "weapon" ? W : s.kind === "gadget" ? GD.filter((x) => x.slot === s.id)
                    : G.filter((g) => (s.id === "Suit" ? g.slot === "Suit" : g.slot === s.id || (s.id === "Torso" && g.slot === "Top and Legs"))).sort((a, b2) => b2.armor - a.armor || (b2.tier || 0) - (a.tier || 0));
                const fill = () => {
                    const t = q.value.trim().toLowerCase();
                    clear(grid).append(...pool.filter((x) => !t || x.name.toLowerCase().includes(t) || (x.cls || x.type || "").toLowerCase().includes(t)).slice(0, 120).map((x) =>
                        h("div.dn-pick", null, tile(x, { onclick: () => { save({ slots: { ...b.slots, [s.id]: x.id } }); picking = null; paint(); } }),
                            h("small", { translate: "no" }, x.name), h("span.dn-pickstat", null, s.kind === "weapon" ? `${fmt(x.score, 0)} dmg/s` : s.kind === "gadget" ? mk(x) : `${fmt(x.armor)} armour`))));
                };
                q.addEventListener("input", fill);
                picker = h("section.dn-picker", null, h("div.dn-pickhead", null, h("h3", null, `${s.label}: best first`), q, h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => { picking = null; paint(); } }, icon("x"))), grid);
                fill();
                setTimeout(() => q.focus());
            }

            // what to farm, and where
            const farm = h("section.dn-farm", null, h("h3", null, icon("search"), "What to farm"));
            const wants = [...worn, ...guns, ...kit].map((x) => ({ name: x.name, qty: 1 }));
            if (!wants.length) farm.append(h("p.muted", null, "Put gear and weapons on, and Riftgate adds up every material they take to craft, down to what you gather, with where to find it."));
            else {
                farm.append(h("p.muted.dn-wait", null, "Reading the recipes on the wiki…"));
                call("r2-dune-craft", wants).then((r) => {
                    if (!farm.isConnected) return;
                    farm.querySelector(".dn-wait")?.remove();
                    if (!r || r.error || !r.farm) { farm.append(h("p.muted", null, (r && r.error) || "The recipes couldn't be read.")); return; }
                    const f = r.farm;
                    const matRow = (m, extra) => h("div.dn-farmrow", null, img(m.image), h("div", null, h("b", { translate: "no" }, m.name), extra ? h("small", { translate: "no" }, extra) : null), h("span.dn-qty", null, `× ${fmt(m.qty)}`),
                        h("button.icon-btn", { type: "button", title: "Open it on the wiki", "aria-label": `${m.name} on the wiki`, onclick: () => openExternal(m.url || `https://awakening.wiki/${encodeURIComponent(m.name.replace(/ /g, "_"))}`) }, icon("external")));
                    farm.append(h("p.dn-farmtot", null, `${f.raw.length} materials to gather`, f.water ? ` · ${fmt(f.water / 1000, 1)} L of water` : "", f.time ? ` · ${mins(f.time)} of crafting` : ""),
                        ...f.raw.map((m) => matRow(m, m.where)));
                    if (f.uncraftable.length) farm.append(h("h4", null, "Found, not crafted"), ...f.uncraftable.map((m) => { const g = howToGet({ name: m.name }), at = g && g.places && g.places.length ? `Its schematic drops in ${g.places.map((p) => p.label).join(", ")}` : null;
                        return matRow({ ...m, qty: 1, image: (byNameText(m.name) || {}).image }, at || m.where || "Its schematic drops somewhere in the world: see the wiki"); }));
                    if (f.made.length) farm.append(h("details.dn-made", null, h("summary", null, `Made along the way (${f.made.length})`), ...f.made.map((m) => matRow(m, m.station ? `In a ${m.station}` : null))));
                });
            }
            // where each piece comes from: a dungeon or wreck its schematic drops in, or the Intel to research it
            const worn2 = SLOTS.map((s) => ({ s, it: itemIn(s.id) })).filter((x) => x.it).filter((x, i, a) => a.findIndex((y) => y.it.id === x.it.id) === i);
            const where = h("section.dn-wherelist", null, h("h3", null, icon("compass"), "Where to get each piece"),
                worn2.length ? h("div", null, ...worn2.map(({ s, it }) => h("div.dn-whererow", null, tile(it, { size: "sm" }),
                    h("div", null, h("b", { translate: "no" }, it.name), h("small.muted", null, [s.label, mk(it)].filter(Boolean).join(" · ")), h("div.dn-where", null, ...whereEls(it))))))
                    : h("p.muted", null, "Put gear and weapons on, and Riftgate shows where each one drops or how to unlock it."));
            body.append(bar, h("div.dn-loadout", null, h("div.dn-left", null, gear, sum, where), picker || farm));
            if (picker) body.append(farm);
        }
        const byNameText = (name) => [...W, ...G, ...GD].find((x) => x.name === name);

        // ---- Find an item: names that contain the text, or the exact name; the list jumps to it ----------------
        // items(): every item it can find; jump(item): shows it in the list (filters set to include it) and returns its row
        function finder({ items, jump, what }) {
            let exact = journal.pref("dune:find-exact", false), timer = null, hits = [], at = -1;
            const q = h("input.input.dn-findq", { type: "search", placeholder: `Find ${what}…`, "aria-label": `Find ${what}`, autocomplete: "off", spellcheck: "false" });
            const menu = h("div.dn-findmenu", { role: "listbox", hidden: true });
            const count = h("small.dn-findcount", { "aria-live": "polite" });
            const modes = h("div.dn-findmode", { role: "group", "aria-label": "How to match" });
            const paintModes = () => clear(modes).append(...[[false, "Contains"], [true, "Exact name"]].map(([v, l]) =>
                h("button.chip", { type: "button", "aria-pressed": String(exact === v), onclick: () => { exact = v; journal.setPref("dune:find-exact", v); paintModes(); search(true); } }, l)));
            const norm = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();
            const go = (it, quiet) => {
                if (!it) return;
                const row = jump(it);
                if (!row) return;
                list().querySelectorAll(".dn-rankrow.here").forEach((r) => r.classList.remove("here"));
                row.classList.add("here");
                row.scrollIntoView({ behavior: "smooth", block: "center" });
                if (!quiet) { menu.hidden = true; q.setAttribute("aria-expanded", "false"); }
            };
            const list = () => body.querySelector(".dn-rank") || body;
            const mark = () => { const t = norm(q.value); list().querySelectorAll(".dn-rankrow").forEach((r) => r.classList.toggle("hit", !!t && hits.some((x) => x.id === r.dataset.id))); };
            const paintMenu = () => {
                clear(menu);
                menu.hidden = !hits.length || !q.value.trim();
                q.setAttribute("aria-expanded", String(!menu.hidden));
                hits.slice(0, 8).forEach((it, i) => menu.append(h(`button.dn-findopt${i === at ? ".on" : ""}`, { type: "button", role: "option", "aria-selected": String(i === at), onmousedown: (e) => e.preventDefault(), onclick: () => { at = i; paintMenu(); go(it); } },
                    img(it.image), h("span", null, h("b", { translate: "no" }, it.name), h("small", null, [mk(it), it.cls || it.type, it.group ? `#${it.rank} of the ${it.group === "melee" ? "melee weapons" : "guns"}` : null].filter(Boolean).join(" · "))))));
            };
            function search(now) {
                const t = norm(q.value);
                hits = !t ? [] : items().filter((it) => (exact ? norm(it.name) === t : norm(it.name).includes(t)))
                    .sort((a, b) => (norm(b.name) === t) - (norm(a.name) === t) || norm(b.name).startsWith(t) - norm(a.name).startsWith(t) || (a.rank || 0) - (b.rank || 0) || a.name.localeCompare(b.name));
                at = hits.length ? 0 : -1;
                count.textContent = !t ? "" : hits.length ? (exact ? `${hits.length} with exactly that name` : `${hits.length} containing “${q.value.trim()}”`) : (exact ? "No item has exactly that name" : "Nothing contains that");
                paintMenu();
                clearTimeout(timer);
                // it goes to the best match by itself as you type
                if (hits.length) timer = setTimeout(() => { go(hits[0], true); mark(); }, now ? 0 : 450); else mark();
            }
            q.addEventListener("input", () => search(false));
            q.addEventListener("focus", () => { if (hits.length && q.value.trim()) paintMenu(); });
            q.addEventListener("blur", () => setTimeout(() => { menu.hidden = true; q.setAttribute("aria-expanded", "false"); }, 120));
            q.addEventListener("keydown", (e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!hits.length) return; at = (at + (e.key === "ArrowDown" ? 1 : -1) + Math.min(8, hits.length)) % Math.min(8, hits.length); paintMenu(); go(hits[at], true); mark(); }
                else if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); go(hits[Math.max(0, at)]); mark(); }
                else if (e.key === "Escape") { if (q.value) { q.value = ""; search(true); } menu.hidden = true; }
            });
            q.setAttribute("aria-haspopup", "listbox");
            paintModes();
            return { el: h("div.dn-find", null, h("div.dn-findbox", null, icon("search"), q, menu), modes, count), mark };
        }

        // ---- Weapons, best to weakest ----------------------------------------------------------------------
        function weapons() {
            let group = "ranged", cls = "all", tier = "all";
            const list = h("div.dn-rank");
            const filters = h("div.dn-filters");
            let find = null;
            const draw = () => {
                const pool = W.filter((w) => w.group === group);
                const classes = [...new Set(pool.map((w) => w.cls))].sort();
                clear(filters).append(
                    ...[["ranged", "Guns"], ["melee", "Melee"]].map(([id, l]) => h("button.chip", { type: "button", "aria-pressed": String(group === id), onclick: () => { group = id; cls = "all"; draw(); } }, l)),
                    h("select.input", { "aria-label": "Kind", onchange: (e) => { cls = e.target.value; draw(); } }, h("option", { value: "all" }, "Every kind"), classes.map((c) => h("option", { value: c, selected: cls === c || null }, c))),
                    h("select.input", { "aria-label": "Tier", onchange: (e) => { tier = e.target.value; draw(); } }, h("option", { value: "all" }, "Every tier"), h("option", { value: "unique", selected: tier === "unique" || null }, "Uniques"), [6, 5, 4, 3, 2, 1].map((t) => h("option", { value: String(t), selected: tier === String(t) || null }, `Mk${t}`))));
                const shown = pool.filter((w) => (cls === "all" || w.cls === cls) && (tier === "all" || (tier === "unique" ? w.unique : String(w.tier) === tier)));
                clear(list).append(...shown.map((w) => h("div.dn-rankrow", { dataset: { id: w.id }, ...opens(w) },
                    h("span.dn-pos", null, `#${w.rank}`), tile(w, { size: "sm" }),
                    h("div.dn-rankname", null, h("b", { translate: "no" }, w.name), h("small", null, [mk(w), w.cls, w.dart].filter(Boolean).join(" · "))),
                    h("div.dn-bar", { title: `${Math.round(w.of * 100)}% of the strongest` }, h("i", { style: { width: `${Math.max(3, w.of * 100)}%` } })),
                    h("span.dn-num", null, h("b", null, fmt(w.score, 1)), h("small", null, "dmg/s")),
                    h("button.btn.sm", { type: "button", onclick: () => equip(w) }, "Equip"))));
                if (!shown.length) list.append(h("p.row-empty", null, "No weapon matches."));
                if (find) find.mark();
            };
            // found: guns or melee as it is, and a kind or tier that would hide it let go
            find = finder({ what: "a weapon", items: () => W, jump: (w) => {
                const hidden = w.group !== group || (cls !== "all" && w.cls !== cls) || (tier !== "all" && (tier === "unique" ? !w.unique : String(w.tier) !== tier));
                if (hidden) { group = w.group; if (cls !== "all" && w.cls !== cls) cls = "all"; if (tier !== "all" && (tier === "unique" ? !w.unique : String(w.tier) !== tier)) tier = "all"; draw(); }
                return [...list.children].find((r) => r.dataset.id === w.id);
            } });
            draw();
            body.append(h("p.muted.dn-note", null, icon("info"), "Ranked by sustained damage: what a weapon deals per second over a whole magazine and its reload (for melee, damage per hit times swings per second). Hover any weapon for its full stats."), find.el, filters, list);
        }
        SRC.equip = (it) => {
            if (it.group) return equip(it);
            const list2 = builds(); const b = list2.find((x) => x.id === currentId()) || list2[0];
            const slot = it.slot === "Top and Legs" ? "Torso" : it.slot;
            saveBuilds(list2.map((x) => (x.id === b.id ? { ...x, slots: { ...migrate(x.slots), [slot]: it.id } } : x)).concat(list2.some((x) => x.id === b.id) ? [] : [{ ...b, slots: { ...migrate(b.slots), [slot]: it.id } }]));
            toast(`${it.name} is in ${b.name}`);
        };
        // a row opens the item, unless you clicked its Equip button or its hammer
        const opens = (it) => ({ tabindex: "0", role: "button", "aria-label": `${it.name}: open`, title: "Open: every stat, levels, augments",
            onclick: (e) => { if (!e.target.closest(".btn, .dn-hammer")) openItem(it, e.currentTarget); },
            onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); openItem(it, e.currentTarget); } } });
        function equip(w) {
            const list = builds();
            const b = list.find((x) => x.id === currentId()) || list[0];
            const slots = migrate(b.slots);
            const id = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `L${n}`).find((k) => !slots[k]) || "L1";
            slots[id] = w.id;
            saveBuilds(list.map((x) => (x.id === b.id ? { ...x, slots } : x)).concat(list.some((x) => x.id === b.id) ? [] : [{ ...b, slots }]));
            toast(`${w.name} is in ${b.name}`);
        }

        // ---- Armour ------------------------------------------------------------------------------------------
        function armour() {
            let slot = "Torso", by = "armor", upTo = 80, find = null;
            const filters = h("div.dn-filters"), list = h("div.dn-rank");
            const slotOf = (g) => (g.slot === "Top and Legs" ? "Torso" : g.slot);
            const val = (g) => (by === "armor" ? g.armor : g.mit[by] || 0);
            const draw = () => {
                clear(filters).append(...["Head", "Torso", "Hands", "Legs", "Feet", "Suit"].map((s) => h("button.chip", { type: "button", "aria-pressed": String(slot === s), onclick: () => { slot = s; upTo = 80; draw(); } }, s === "Suit" ? "Utility suits" : s)),
                    h("select.input", { "aria-label": "Best for", onchange: (e) => { by = e.target.value; draw(); } }, h("option", { value: "armor" }, "Most armour"), Object.entries(MIT_LABEL).map(([k, l]) => h("option", { value: k, selected: by === k || null }, `Best against ${l.toLowerCase()}`))));
                const pool = G.filter((g) => g.slot === slot || (slot === "Torso" && g.slot === "Top and Legs")).sort((a, b) => val(b) - val(a) || b.armor - a.armor);
                const top = pool.length ? Math.max(1, val(pool[0])) : 1;
                clear(list).append(...pool.slice(0, upTo).map((g, i) => h("div.dn-rankrow", { dataset: { id: g.id }, ...opens(g) },
                    h("span.dn-pos", null, `#${i + 1}`), tile(g, { size: "sm" }),
                    h("div.dn-rankname", null, h("b", { translate: "no" }, g.name), h("small", null, [mk(g), g.type].filter(Boolean).join(" · "))),
                    h("div.dn-bar", null, h("i", { style: { width: `${Math.max(3, (val(g) / top) * 100)}%` } })),
                    h("span.dn-num", null, h("b", null, by === "armor" ? fmt(g.armor) : `${fmt(val(g), 1)}%`), h("small", null, by === "armor" ? "armour" : MIT_LABEL[by].toLowerCase())),
                    h("button.btn.sm", { type: "button", onclick: () => { const list2 = builds(); const b = list2.find((x) => x.id === currentId()) || list2[0]; saveBuilds(list2.map((x) => (x.id === b.id ? { ...x, slots: { ...migrate(x.slots), [slotOf(g)]: g.id } } : x))); toast(`${g.name} is in ${b.name}`); } }, "Equip"))));
                if (find) find.mark();
            };
            // found: its slot shown, and the list long enough to reach it
            find = finder({ what: "a piece of armour", items: () => G, jump: (g) => {
                if (!["Head", "Torso", "Hands", "Legs", "Feet", "Suit"].includes(slotOf(g))) return null;
                const pool = G.filter((x) => slotOf(x) === slotOf(g)).sort((a, b) => val(b) - val(a) || b.armor - a.armor);
                const need = Math.max(80, pool.findIndex((x) => x.id === g.id) + 1);
                if (slot !== slotOf(g) || need > upTo) { slot = slotOf(g); upTo = need; draw(); }
                return [...list.children].find((r) => r.dataset.id === g.id);
            } });
            draw();
            body.append(find.el, filters, list);
        }

        // ---- Skills: the best ones for what you want to do, the specialization for it, and every skill tree ---------
        function skills() {
            const arch = d.archetypes || [], specs = d.specializations || [], picks = d.skillPicks || {};
            if (!arch.length) { body.append(h("div.empty", null, icon("sparkles"), h("h3", null, "No skill trees yet"), h("p", null, "The wiki's skill trees couldn't be read. Check the wiki now, below."))); return; }
            const GOALS = [["guns", "Fighting with guns", "rift"], ["melee", "Fighting up close", "shield"], ["farm", "Farming & gathering", "gem"], ["explore", "Exploring & surviving", "compass"], ["craft", "Crafting & repairs", "settings"]];
            let goal = journal.pref("dune:goal", "guns"), who = journal.pref("dune:arch", arch[0].name);
            const typeTag = (t) => h(`span.dn-sktype.t-${String(t).toLowerCase()}`, null, t);
            const costText = (sk) => (sk.cost.length > 1 ? `${sk.cost.join(" / ")} points (${sk.points})` : `${sk.points || "–"} points`);
            const skillTip = (sk, a, t) => [h("div.dn-tip-head.craft", null, icon("sparkles"), h("div", null, h("b", { translate: "no" }, sk.name), h("small", null, [sk.type, a && a.name, t && t.name].filter(Boolean).join(" · ")))),
                h("p.dn-tip-desc", { translate: "no" }, sk.desc), sk.notes ? h("p.dn-tip-meta", { translate: "no" }, sk.notes) : null,
                h("div.dn-stats", null, h("div.dn-stat.key", null, h("span", null, "Cost"), h("b", null, costText(sk))),
                    sk.cooldown ? h("div.dn-stat", null, h("span", null, "Cooldown"), h("b", null, `${sk.cooldown} s`)) : null,
                    sk.duration ? h("div.dn-stat", null, h("span", null, "Duration"), h("b", null, `${sk.duration} s`)) : null,
                    sk.stamina ? h("div.dn-stat", null, h("span", null, "Stamina"), h("b", null, String(sk.stamina))) : null)].filter(Boolean);
            const goalBar = h("div.dn-filters.dn-goals", { role: "group", "aria-label": "What for" });
            const best = h("section.dn-skbest");
            const spec = h("section.dn-skspec");
            const trees = h("section.dn-sktrees");
            const drawGoal = () => {
                clear(goalBar).append(...GOALS.map(([id, l, ic]) => h("button.chip", { type: "button", "aria-pressed": String(goal === id), onclick: () => { goal = id; journal.setPref("dune:goal", id); drawGoal(); } }, icon(ic), l)));
                const list = picks[goal] || [];
                const label = (GOALS.find((x) => x[0] === goal) || [])[1] || "";
                clear(best).append(h("h3", null, icon("star"), `Best skills for ${label.toLowerCase()}`),
                    h("p.dn-where-note", null, "Picked from what each skill does, by the wiki's descriptions and effects; the first ones do the most for it."),
                    list.length ? h("div.dn-skgrid", null, ...list.map((sk, i) => h("article.dn-skcard", null,
                        h("div.dn-skhead", null, h("span.dn-pos", null, `#${i + 1}`), h("div", null, h("b", { translate: "no" }, sk.name), h("small", { translate: "no" }, `${sk.archetype} · ${sk.tree}`)), typeTag(sk.type)),
                        h("p", { translate: "no" }, sk.desc),
                        sk.notes ? h("p.dn-skfx", { translate: "no" }, sk.notes) : null,
                        h("p.dn-skcost", null, costText(sk), sk.cooldown ? ` · ${sk.cooldown} s cooldown` : "")))) : h("p.muted", null, "No skill matches this yet."));
                const sp = specs.find((x) => x.name === (d.goalSpec || {})[goal]);
                clear(spec);
                if (sp) spec.append(h("h3", null, icon("trophy"), `From the Landsraad: the ${sp.name} specialization`),
                    sp.desc ? h("p.dn-where-note", null, sp.desc) : null,
                    h("p.dn-where-note", null, "Earn its XP with the Landsraad missions of that kind; its main bonuses are bought with spice melange."),
                    h("div.dn-sptable", null, h("table", null, h("thead", null, h("tr", null, h("th", null, "Level"), h("th", null, "Bonus"), h("th", null, "Effect"), h("th", null, "Spice"))),
                        h("tbody", null, ...sp.primary.map((b) => h("tr", { title: b.desc || "" }, h("td", null, String(b.level ?? "")), h("td", { translate: "no" }, h("b", null, b.name), b.desc ? h("small", null, b.desc) : null), h("td", { translate: "no" }, b.effect || ""), h("td", null, b.spice ? String(b.spice) : "–")))))),
                    ...sp.secondary.map((x) => h("p.dn-skfx", { translate: "no" }, `${x.stat}: ${x.each || ""} per level, ${x.total || ""} in all (${x.levels} levels)`)));
            };
            const drawTrees = () => {
                const a = arch.find((x) => x.name === who) || arch[0];
                clear(trees).append(h("h3", null, icon("list"), "Every skill tree"),
                    h("div.dn-filters", null, ...arch.map((x) => h("button.chip", { type: "button", "aria-pressed": String(x.name === a.name), onclick: () => { who = x.name; journal.setPref("dune:arch", who); drawTrees(); } }, x.name))),
                    h("div.dn-archhead", null, a.image ? h("img.dn-archimg", { src: coverSrc(a.image), alt: "", loading: "lazy", onerror: (e) => e.target.remove() }) : null,
                        h("div", null, h("h4", { translate: "no" }, a.name), a.focus ? h("p", null, a.focus) : null,
                            h("p.dn-where-note", null, `${a.points} skill points to learn it all.`),
                            a.basic ? h("p.dn-where-note", { translate: "no" }, `Basic trainer: ${a.basic.name}${a.basic.where ? `, ${a.basic.where}` : ""}`) : null,
                            a.advanced ? h("p.dn-where-note", { translate: "no" }, `Advanced trainer: ${a.advanced.name}${a.advanced.where ? `, ${a.advanced.where}` : ""}`) : null,
                            h("button.linkish", { type: "button", onclick: () => openExternal(a.url) }, icon("external"), "On the wiki"))),
                    h("div.dn-treecols", null, ...a.trees.map((t) => h("div.dn-tree", null, h("h4", { translate: "no" }, t.name), t.desc ? h("p.dn-where-note", null, t.desc) : null,
                        ...t.skills.map((sk) => hover(h("div.dn-skrow", { tabindex: "0" }, typeTag(sk.type), h("span", { translate: "no" }, sk.name), h("small", null, sk.points ? `${sk.points} pt` : "")), () => skillTip(sk, a, t)))))));
            };
            drawGoal(); drawTrees();
            body.append(goalBar, h("div.dn-skwrap", null, best, spec), trees,
                h("p.dn-where-note.dn-skbuilder", null, "To plan a whole build point by point, the wiki recommends ",
                    h("button.linkish", { type: "button", onclick: () => openExternal("https://dune.gaming.tools/skill-builder") }, "gaming.tools' Skill Builder"), "."));
        }

        // ---- Dungeons ------------------------------------------------------------------------------------------
        function dungeons() {
            const ranged = W.filter((w) => w.group === "ranged");
            body.append(h("p.muted.dn-note", null, icon("info"), "Each dungeon is built around one hazard. The gear below is the strongest against it on the wiki's numbers, with the weapons its boss notes recommend; strategies are the wiki's, the videos are from YouTube."));
            const dropsIn = (title) => [...W, ...G, ...GD].filter((x) => { const w = SRC.where[x.name]; return w && w.places.some((p) => p.name === title); });
            for (const dg of d.dungeons) {
                const drops = dropsIn(dg.title);
                const gearRec = gear(dg);
                const wpn = weaponsFor(dg, ranged);
                const strat = dg.boss ? h("div.dn-strat", null, ...dg.boss.intro.map((l) => h(l.level ? "li" : "p", null, l.text)),
                    ...dg.boss.parts.map((p) => h("details", null, h("summary", null, p.title), ...p.lines.map((l) => h(l.level ? "li" : "p", { class: l.level > 1 ? "sub" : undefined }, l.text))))) : null;
                const video = h("div.dn-video");
                const card = h("article.dn-dungeon", { dataset: { title: dg.title } },
                    h("div.dn-dhead", { style: dg.image ? { "--bg": `url("${coverSrc(dg.image)}")` } : null },
                        h("div", null, h("h2", { translate: "no" }, dg.title), dg.tagline ? h("p", null, dg.tagline) : null,
                            dg.hazardInfo ? h("span.dn-hazard", { dataset: { hz: dg.hazard } }, icon(dg.hazard === "Darkness" ? "eye" : "flame"), dg.hazardInfo.label) : null)),
                    h("div.dn-dbody", null,
                        h("section", null, h("h3", null, "What to bring"),
                            dg.hazardInfo ? h("p.muted", null, dg.hazardInfo.tip) : null,
                            h("div.dn-bring", null, ...gearRec.pieces.map((g) => h("div.dn-pick", null, tile(g), h("small", { translate: "no" }, g.name))), gearRec.suit ? h("div.dn-pick", null, tile(gearRec.suit), h("small", { translate: "no" }, gearRec.suit.name)) : null),
                            h("div.dn-bring", null, ...wpn.map((p) => h("div.dn-pick", null, tile(p.w), h("small", { translate: "no" }, p.w.name), h("span.dn-pickstat", null, p.why)))),
                            h("button.btn.sm", { type: "button", onclick: () => {
                                const slots = {};
                                gearRec.pieces.forEach((g) => { slots[g.slot] = g.id; });
                                if (gearRec.suit) slots.Suit = gearRec.suit.id;
                                wpn.slice(0, 4).forEach((p, i) => { slots[`L${i + 1}`] = p.w.id; });
                                const nb = { id: `b${Date.now().toString(36)}`, name: dg.title.slice(0, 40), slots };
                                saveBuilds([...builds(), nb]); journal.setPref("dune:build", nb.id); tab = "loadout"; journal.setPref("dune:tab", tab); paint();
                            } }, icon("plus"), "Make it a build")),
                        dg.boss ? h("section", null, h("h3", null, "Boss: ", h("span", { translate: "no" }, dg.boss.name || "unknown")), dg.boss.image ? h("img.dn-portrait", { src: coverSrc(dg.boss.image), alt: dg.boss.name || "", loading: "lazy", onerror: (e) => e.target.remove() }) : null, video, strat) : null,
                        drops.length ? h("section", null, h("h3", null, "Unique schematics that drop here"),
                            h("div.dn-bring", null, ...drops.map((x) => { const pl = SRC.where[x.name].places.find((p) => p.name === dg.title); return h("div.dn-pick", null, tile(x), h("small", { translate: "no" }, x.name), pl && pl.chance != null ? h("span.dn-pickstat", null, `${fmt(pl.chance, 1)}% chance`) : null); }))) : null,
                        dg.rewards.length ? h("section", null, h("h3", null, "Rewards"), h("p", { translate: "no" }, dg.rewards.join(" · "))) : null,
                        h("button.linkish", { type: "button", onclick: () => openExternal(dg.url) }, icon("external"), "Everything about it on the wiki")));
                body.appendChild(card);
                if (dg.boss && dg.boss.name) loadVideo(video, dg);
            }
            if (focusDungeon) {
                const el = [...body.querySelectorAll(".dn-dungeon")].find((x) => x.dataset.title === focusDungeon);
                focusDungeon = null;
                if (el) { el.classList.add("focus"); setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
                else toast("That place isn't one of the wiki's dungeons");
            }
        }
        function gear(dg) {
            const stat = dg.hazardInfo && dg.hazardInfo.stat;
            const val = (g) => (stat ? g.mit[stat] || 0 : 0);
            const better = (a, b) => val(b) - val(a) || b.armor - a.armor;
            const combat = G.filter((g) => g.type === "Heavy Armor" || g.type === "Light Armor");
            return { pieces: ["Head", "Torso", "Hands", "Legs", "Feet"].map((s) => combat.filter((g) => g.slot === s).sort(better)[0]).filter(Boolean),
                suit: stat ? G.filter((g) => g.slot === "Suit" && val(g) > 0).sort(better)[0] || null : null };
        }
        function weaponsFor(dg, ranged) {
            const text = dg.boss ? [...dg.boss.intro, ...dg.boss.parts.flatMap((p) => p.lines)].map((l) => l.text).join(" ") : "";
            const lower = text.toLowerCase();
            const named = W.filter((w) => w.name.length > 4 && lower.includes(w.name.toLowerCase()));
            const kinds = [[/shotgun|scattergun|drillshot/i, /shotgun/i], [/sniper|spitdart|long range/i, /spit/i], [/\bsmg\b/i, /smg/i], [/pistol/i, /pistol/i]].filter(([re]) => re.test(text)).map(([, k]) => k);
            const kindPool = kinds.length ? ranged.filter((w) => kinds.some((k) => k.test(w.cls))) : [];
            const out = [], seen = new Set();
            named.forEach((w) => { if (!seen.has(w.id)) { seen.add(w.id); out.push({ w, why: "Named in the boss notes" }); } });
            (kindPool.length ? kindPool : ranged).slice(0, 4).forEach((w) => { if (!seen.has(w.id)) { seen.add(w.id); out.push({ w, why: kindPool.length ? `Strongest ${w.cls.toLowerCase()}` : "Among the strongest" }); } });
            return out.slice(0, 5);
        }
        async function loadVideo(box, dg) {
            clear(box).append(h("p.muted", null, "Looking for a guide to the fight…"));
            const v = await call("r2-dune-video", { boss: dg.boss.name, place: dg.title });
            if (!box.isConnected) return;
            clear(box);
            if (!v || !v.id) { box.append(h("p.muted", null, "No guide to this fight on YouTube yet.")); return; }
            box.append(h("div.dn-frame", null, h("iframe", { src: `https://www.youtube.com/embed/${v.id}?rel=0&modestbranding=1`, title: v.title || `${dg.boss.name} boss fight`, loading: "lazy", allow: "encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true })),
                h("div.dn-vidbar", null, h("small.muted", { translate: "no" }, [v.title, v.channel].filter(Boolean).join(" · ")),
                    h("button.linkish", { type: "button", onclick: () => openExternal(`https://www.youtube.com/watch?v=${v.id}`) }, icon("external"), "YouTube"),
                    h("button.linkish", { type: "button", title: "Not the fight, or not a guide: Riftgate looks for another", onclick: async () => { await call("r2-dune-video-wrong", { boss: dg.boss.name, place: dg.title, id: v.id }); loadVideo(box, dg); } }, icon("x"), "Not this fight")));
        }

        paint();
        return () => { window.removeEventListener("scroll", stopTip, true); closeTip(); closeItem(); SRC.equip = null; SRC.goDungeon = null; };
    }
};
