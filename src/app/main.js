// Riftgate 2 — entry point: builds the frame (title bar, rail), routes
// between views, wires keyboard shortcuts and the engine's events.

import { h, icon, clear } from "./dom.js";
import { call, on, send } from "./api.js";
import * as journal from "./store.js";
import { setDetailOpener } from "../components/card.js";
import { openDetail, closeDetail } from "../components/detail.js";
import { openPalette, setCommands } from "../components/palette.js";
import { openRoll } from "../components/roll.js";
import { toast } from "../components/toast.js";

import nexus from "../views/nexus.js";
import library from "../views/library.js";
import free from "../views/free.js";
import deals from "../views/deals.js";
import theatre from "../views/theatre.js";
import reading from "../views/reading.js";
import journalView from "../views/journal.js";
import settings from "../views/settings.js";

setDetailOpener(openDetail);

// Sections, in rail order. `roll` returns the list Surprise Me picks from.
const VIEWS = [
    { id: "nexus", label: "Nexus", icon: "nexus", view: nexus, group: "Discover" },
    { id: "free", label: "Free games", icon: "gift", view: free, group: "Discover" },
    { id: "deals", label: "Deals", icon: "tag", view: deals, group: "Discover" },
    { id: "theatre", label: "Theatre", icon: "film", view: theatre, group: "Discover" },
    { id: "reading", label: "Reading room", icon: "book", view: reading, group: "Discover" },
    { id: "library", label: "Library", icon: "library", view: library, group: "Yours" },
    { id: "journal", label: "Journal", icon: "journal", view: journalView, group: "Yours" }
];
const SETTINGS = { id: "settings", label: "Settings", icon: "settings", view: settings };
const ALL = [...VIEWS, SETTINGS];

const stage = document.getElementById("stage");
const rail = document.getElementById("rail");
const titlebar = document.getElementById("titlebar");
let current = null;
let cleanup = null;

// ---- Title bar -----------------------------------------------------------------
function buildTitlebar() {
    const maxBtn = h("button.win-btn", { type: "button", "aria-label": "Maximise", onclick: () => call("window-maximize-toggle") }, icon("max"));
    titlebar.append(
        h("button.search-trigger", { type: "button", onclick: () => openPalette() },
            icon("search"), h("span.grow", null, "Search your universe"), h("kbd", null, "Ctrl K")),
        h("div.titlebar-spacer"),
        h("div.win-controls", null,
            h("button.win-btn", { type: "button", "aria-label": "Minimise", onclick: () => call("window-minimize") }, icon("min")),
            maxBtn,
            h("button.win-btn.close", { type: "button", "aria-label": "Close", onclick: () => call("window-close") }, icon("x"))));
    on("maximize-changed", (isMax) => { clear(maxBtn).appendChild(icon(isMax ? "restore" : "max")); });
}

// ---- Rail -----------------------------------------------------------------------
const navButtons = new Map();
const node = h("div.rift-node");
function buildRail() {
    const nav = h("div.nav");
    let group = null;
    VIEWS.forEach((v) => {
        if (v.group !== group) { group = v.group; nav.appendChild(h("div.nav-group-label", null, group)); }
        const b = h("a.nav-item", { href: `#${v.id}`, title: v.label }, icon(v.icon), h("span", null, v.label));
        navButtons.set(v.id, b);
        nav.appendChild(b);
    });
    const settingsBtn = h("a.nav-item", { href: "#settings", title: "Settings" }, icon("settings"), h("span", null, "Settings"));
    navButtons.set("settings", settingsBtn);
    const version = h("div.rail-version");
    call("get-app-version").then((v) => { if (v) version.textContent = `Riftgate 2 · ${typeof v === "string" ? v : v.version || ""}`; });

    rail.append(
        h("div.rift-line", null, node),
        h("div.brand", null, brandGem(), h("span.brand-word", null, "RIFTGATE"), h("span.brand-two", null, "2")),
        nav,
        h("div.rail-foot", null,
            h("button.btn.primary", { type: "button", onclick: rollHere, title: "Open a random rift (R)" }, icon("dice"), h("span", null, "Surprise me")),
            settingsBtn, version));
}

function brandGem() {
    const g = icon("gem", "brand-gem");
    g.setAttribute("stroke", "url(#energyGrad)");
    return g;
}

function moveNode(id) {
    const b = navButtons.get(id);
    if (!b) return;
    const top = b.getBoundingClientRect().top - rail.getBoundingClientRect().top;
    node.style.transform = `translateY(${top}px)`;
}

// ---- Router -----------------------------------------------------------------------
async function route() {
    const id = (location.hash || "#nexus").slice(1).split("/")[0];
    const v = ALL.find((x) => x.id === id) || VIEWS[0];
    if (current === v.id) return;
    current = v.id;
    closeDetail();
    navButtons.forEach((b) => b.removeAttribute("aria-current"));
    navButtons.get(v.id)?.setAttribute("aria-current", "page");
    moveNode(v.id);
    if (cleanup) { try { cleanup(); } catch (e) { /* */ } cleanup = null; }
    clear(stage);
    stage.scrollTop = 0;
    const root = h("div.view", { dataset: { view: v.id } });
    stage.appendChild(root);
    try {
        cleanup = (await v.view.render(root)) || null;
    } catch (err) {
        console.error(err);
        root.appendChild(h("div.empty", null, icon("info"), h("h3", null, "This section couldn't open"), h("p", null, String(err.message || err))));
    }
    send("renderer-ready-for-updates");
}

function rollHere() {
    const v = ALL.find((x) => x.id === current);
    const list = v && v.view.rollPool ? v.view.rollPool() : null;
    Promise.resolve(list).then((items) => {
        if (!openRoll(items, v && v.view.rollTitle ? v.view.rollTitle : "Open a random rift")) {
            toast("Nothing to pick from here yet. Try Free games or your Library.", "err");
        }
    });
}

// ---- Shortcuts ---------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); openPalette(); }
    else if (e.key.toLowerCase() === "r" && !document.querySelector(".rift-roll, .detail, .palette, .browser")) rollHere();
    else if (/^[1-7]$/.test(e.key) && !document.querySelector(".detail, .palette, .browser")) location.hash = VIEWS[Number(e.key) - 1].id;
});

setCommands([
    ...ALL.map((v) => ({ title: `Go to ${v.label}`, icon: v.icon, run: () => { location.hash = v.id; } })),
    { title: "Open a random rift (Surprise me)", icon: "dice", run: rollHere }
]);

// ---- Engine events ---------------------------------------------------------------------
on("update-available", (info) => toast(`Riftgate ${info && info.version ? info.version : "update"} is available`));
on("app-exited", (d) => { if (d && d.playtimeSeconds) toast("Playtime saved to your Library"); });

// ---- Start ---------------------------------------------------------------------------
(async function start() {
    buildTitlebar();
    buildRail();
    await journal.load();
    const accent = journal.pref("accent", "rift");
    if (accent && accent !== "rift") document.documentElement.dataset.accent = accent;
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", () => moveNode(current));
    route();
})();
