// Riftgate 2 — entry point: builds the frame (title bar, rail), routes
// between views, wires keyboard shortcuts and the engine's events.

import { h, icon, clear } from "./dom.js";
import { call, on, send } from "./api.js";
import * as journal from "./store.js";
import { setDetailOpener } from "../components/card.js";
import { openDetail, closeDetail } from "../components/detail.js";
import { openPalette, setCommands } from "../components/palette.js";
import { openRoll } from "../components/roll.js";
import { openToday, MOODS } from "../components/today.js";
import { toast } from "../components/toast.js";
import * as interests from "./interests.js";
import * as theme from "./theme.js";
import * as account from "./account.js";
import { accountChip, openAccount } from "../components/account.js";

import nexus from "../views/nexus.js";
import library from "../views/library.js";
import free from "../views/free.js";
import deals from "../views/deals.js";
import theatre from "../views/theatre.js";
import reading from "../views/reading.js";
import apps from "../views/apps.js";
import journalView from "../views/journal.js";
import themesView from "../views/themes.js";
import settings from "../views/settings.js";

setDetailOpener(openDetail);

// Sections, in rail order. `roll` returns the list Surprise Me picks from.
const VIEWS = [
    { id: "nexus", label: "Nexus", icon: "nexus", view: nexus, group: "Discover" },
    { id: "free", interests: ["free"], label: "Free games", icon: "gift", view: free, group: "Discover" },
    { id: "deals", interests: ["deals"], label: "Deals", icon: "tag", view: deals, group: "Discover" },
    { id: "theatre", interests: ["screen", "anime"], label: "Theatre", icon: "film", view: theatre, group: "Discover" },
    { id: "reading", interests: ["books"], label: "Reading room", icon: "book", view: reading, group: "Discover" },
    { id: "apps", label: "Applications", icon: "app", view: apps, group: "Discover" },
    { id: "library", label: "Library", icon: "library", view: library, group: "Yours" },
    { id: "journal", label: "Journal", icon: "journal", view: journalView, group: "Yours" },
    { id: "themes", label: "Themes", icon: "sparkles", view: themesView, group: "Yours" }
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
// Sections you said aren't for you leave the rail (still one Ctrl K away).
const shownViews = () => VIEWS.filter((v) => !v.interests || interests.wants(...v.interests) || v.id === current);
function buildRail() {
    clear(rail);
    navButtons.clear();
    const nav = h("div.nav");
    let group = null;
    shownViews().forEach((v) => {
        if (v.group !== group) { group = v.group; nav.appendChild(h("div.nav-group-label", null, group)); }
        // Clicking the section you're in opens it fresh (e.g. back to its first tab)
        const b = h("a.nav-item", { href: `#${v.id}`, title: v.label, onclick: (e) => { if (current === v.id) { e.preventDefault(); current = null; route(); } } }, icon(v.icon), h("span", null, v.label));
        navButtons.set(v.id, b);
        nav.appendChild(b);
    });
    const settingsBtn = h("a.nav-item", { href: "#settings", title: "Settings" }, icon("settings"), h("span", null, "Settings"));
    navButtons.set("settings", settingsBtn);
    const version = h("div.rail-version");
    call("get-app-version").then((v) => { if (v) version.textContent = `Riftgate ${typeof v === "string" ? v : v.version || ""}`; });

    rail.append(
        h("div.rift-line", null, node),
        h("a.brand", { href: "#nexus", title: "Riftgate" }, brandGem(),
            h("span.brand-text", null,
                h("span.brand-word", null, "RIFTGATE"),
                h("span.brand-tagline", null, "All your worlds. One gateway."))),
        nav,
        h("div.rail-foot", null,
            h("button.btn.primary.today-btn", { type: "button", onclick: () => openToday(), title: "What do you want to do today? (R)" }, icon("dice"), h("span", null, "Surprise me")),
            settingsBtn, accountChip(), version));
    navButtons.get(current)?.setAttribute("aria-current", "page");
}

// Riftgate's own gem, the same mark as the original app, tinted by the theme
function brandGem() {
    return h("img.brand-gem", { src: "assets/riftgate-gem-mark.png", alt: "", draggable: "false" });
}

function moveNode(id) {
    const b = navButtons.get(id);
    if (!b) return;
    const top = b.getBoundingClientRect().top - rail.getBoundingClientRect().top;
    node.style.transform = `translateY(${top}px)`;
}

// ---- Router -----------------------------------------------------------------------
async function route() {
    const [id, sub] = (location.hash || "#nexus").slice(1).split("/");
    const v = ALL.find((x) => x.id === id) || VIEWS[0];
    if (current === v.id && !sub) return;
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
        cleanup = (await v.view.render(root, { sub })) || null;
        if (sub) history.replaceState(null, "", `#${v.id}`);
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
    else if (e.key.toLowerCase() === "r" && !document.querySelector(".today, .rift-roll, .detail, .palette, .browser")) openToday();
    else if (/^[1-9]$/.test(e.key) && !document.querySelector(".detail, .palette, .browser, .today, .interests-portal")) { const v = shownViews()[Number(e.key) - 1]; if (v) location.hash = v.id; }
});

setCommands([
    ...ALL.map((v) => ({ title: `Go to ${v.label}`, icon: v.icon, run: () => { location.hash = v.id; } })),
    { title: "What do you want to do today? (Surprise me)", icon: "dice", run: () => openToday() },
    ...MOODS.filter((m) => m.id !== "any").map((m) => ({ title: `Surprise me: ${m.label.toLowerCase()} (${m.hint.toLowerCase()})`, icon: m.icon, run: () => openToday(m.id) })),
    { title: "Random pick from this section", icon: "rift", run: rollHere },
    { title: "Make Riftgate yours (your interests)", icon: "heart", run: () => interests.openInterests() },
    { title: "Change the theme", icon: "sparkles", run: () => { location.hash = "themes"; } },
    { title: "Create a theme", icon: "plus", run: () => { location.hash = "themes/studio"; } },
    { title: "Community themes", icon: "globe", run: () => { location.hash = "themes/community"; } },
    { title: "Sign in or create a Riftgate account", icon: "gem", run: () => openAccount("in") }
]);

window.addEventListener("r2-engine-outdated", () => toast("Riftgate was updated. Quit it from the system tray (right-click its icon, Quit) and open it again to finish.", "err", 15000));

// ---- Engine events ---------------------------------------------------------------------
on("update-available", (info) => toast(`Riftgate ${info && info.version ? info.version : "update"} is available`));
on("app-exited", (d) => { if (d && d.playtimeSeconds) toast("Playtime saved to your Library"); });

// ---- Start ---------------------------------------------------------------------------
(async function start() {
    buildTitlebar();
    await theme.start(); // journal + your themes, applied before anything paints
    account.restore();
    buildRail();
    // Interests change the rail and what Nexus leads with
    interests.onChange(() => {
        buildRail(); moveNode(current);
        if (current === "nexus") { const c = current; current = null; location.hash = c; route(); }
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", () => moveNode(current));
    await route();
    if (!interests.chosen()) setTimeout(() => interests.openInterests({ first: true }), 900);
})();
