// Riftgate — entry point: builds the frame (title bar, rail), routes
// between views, wires keyboard shortcuts and the engine's events.

import { h, icon, clear } from "./dom.js";
import { call, on, send, settings as appSettings, forget, openExternal, onAnswerMeta } from "./api.js";
import { playIntro, done as introDone, quiet as introQuiet } from "../components/intro.js";
import { markVisits, maybeWelcome } from "../components/welcome.js";
import * as season from "./season.js";
import { mountBats } from "../components/bats.js";
import { mountHallowed } from "../components/hallowed.js";
import * as seals from "./seals.js";
import { announce } from "../components/seals.js";
import { watchSecrets } from "./secrets.js";
import * as journal from "./store.js";
import { setDetailOpener } from "../components/card.js";
import { openDetail, closeDetail } from "../components/detail.js";
import { openPalette, setCommands } from "../components/palette.js";
import { openRoll } from "../components/roll.js";
import { openToday, openAsk, MOODS } from "../components/today.js";
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
import suggestionsView from "../views/suggestions.js";
import { bellButton, openWhatsNew, checkForUpdates } from "../components/whatsnew.js";
import * as gamepad from "./gamepad.js";
import { enableDrop, watchNewInstalls, watchUninstalls } from "./library-tools.js";
import settings from "../views/settings.js";
import vaultView from "../views/vault.js";
import adminView from "../views/admin.js";
import * as gate from "./mature.js";
import { applyLook } from "./look.js";
import { mountFacts, follow as factsFollow } from "../components/facts.js";
import { maybeTour, startTour } from "../components/tour.js";
import { noteAnswer } from "./sources.js";
import { mountSourcesBanner } from "../components/sources-banner.js";
import { openAddShow } from "../components/add-show.js";
import { listenForFarewell } from "../components/farewell.js";

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
    { id: "themes", label: "Themes", icon: "sparkles", view: themesView, group: "Yours" },
    { id: "suggestions", label: "Suggestions", icon: "chat", view: suggestionsView, group: "Yours" },
    // only for admins (the rail shows them once your account is known to be one)
    { id: "vault", admin: true, label: "The Vault", icon: "vault", view: vaultView, group: "Admin" },
    { id: "admin", admin: true, label: "Admin", icon: "shield", view: adminView, group: "Admin" }
];
const SETTINGS = { id: "settings", label: "Settings", icon: "settings", view: settings };
const ALL = [...VIEWS, SETTINGS];

const stage = document.getElementById("stage");
// Wide and ultrawide screens: the page keeps a comfortable width (--view-max,
// layout.css), centred; --bleed is how far the stage reaches past it each side.
{
    const app = document.getElementById("app");
    let last = -1;
    const fitWide = () => {
        const max = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--view-max")) || 1880;
        const b = Math.max(0, Math.floor((stage.clientWidth - max) / 2));
        if (b === last) return;
        last = b;
        app.style.setProperty("--bleed", b + "px");
        app.classList.toggle("is-wide", b > 0);
    };
    new ResizeObserver(fitWide).observe(stage);
    fitWide();
}
const rail = document.getElementById("rail");
const titlebar = document.getElementById("titlebar");
let current = null;
let cleanup = null;

// ---- Title bar -----------------------------------------------------------------
// "Star on GitHub", back from Riftgate 1.x: the project's real star count (the
// engine asks GitHub at most every 10 minutes and remembers the last count),
// a click opens the repository to star it, and coming back to the window
// refreshes the count so your new star shows up.
function githubStar() {
    let url = "https://github.com/Raidex81/Riftgate";
    const count = h("b.gh-count", null, "–");
    const btn = h("button.gh-star", { type: "button", title: "Riftgate on GitHub: give it a star", "aria-label": "Star Riftgate on GitHub",
        onclick: () => { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); openExternal(url); } },
        h("span.gh-mark", { "aria-hidden": "true" }), h("span.gh-label", null, "Star"), icon("star"), count);
    const fmt = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
    const refresh = async (fresh) => {
        const r = await call("get-github-stars", { fresh });
        if (r && r.url) url = r.url;
        if (r && Number.isFinite(r.stars)) { count.textContent = fmt(r.stars); btn.title = `Riftgate on GitHub: ${r.stars.toLocaleString()} star${r.stars === 1 ? "" : "s"}. Click to give it one`; }
    };
    refresh(false);
    window.addEventListener("focus", () => refresh(true));
    return btn;
}

function buildTitlebar() {
    const maxBtn = h("button.win-btn", { type: "button", "aria-label": "Maximise", onclick: () => call("window-maximize-toggle") }, icon("max"));
    titlebar.append(
        h("button.search-trigger", { type: "button", onclick: () => openPalette() },
            icon("search"), h("span.grow", null, "Search your universe"), h("kbd", null, "Ctrl K")),
        h("div.titlebar-spacer"),
        githubStar(),
        bellButton(),
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
// Your own order of the sections (drag them in the rail, or Ctrl + ↑ ↓), kept per group
const railOrder = () => journal.pref("order:rail", []) || [];
const shownViews = () => {
    const order = railOrder();
    const rank = (v) => { const i = order.indexOf(v.id); return i < 0 ? 1000 + VIEWS.indexOf(v) : i; };
    const groups = [...new Set(VIEWS.map((v) => v.group))];
    return VIEWS.filter((v) => (!v.admin || gate.isAdmin()) && (!v.interests || interests.wants(...v.interests) || v.id === current))
        .sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || rank(a) - rank(b));
};
async function saveRailOrder(ids) {
    // keep the hidden ones where they were
    const rest = railOrder().filter((id) => !ids.includes(id));
    await journal.setPref("order:rail", [...ids, ...rest]);
}
function buildRail() {
    clear(rail);
    navButtons.clear();
    const nav = h("div.nav");
    let group = null;
    shownViews().forEach((v) => {
        if (v.group !== group) { group = v.group; nav.appendChild(h("div.nav-group-label", null, group)); }
        // Clicking the section you're in opens it fresh (e.g. back to its first tab)
        const b = h("a.nav-item", { href: `#${v.id}`, title: `${v.label} (drag to reorder)`, draggable: "true", dataset: { view: v.id, group: v.group },
            onclick: (e) => { if (current === v.id) { e.preventDefault(); current = null; route(); } } }, icon(v.icon), h("span", null, v.label));
        navButtons.set(v.id, b);
        nav.appendChild(b);
        railDrag(b, nav);
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

// Drag a section up or down within its group; the others slide aside
let railDragging = null;
function railDrag(b, nav) {
    const ids = () => [...nav.querySelectorAll(".nav-item[data-view]")].map((x) => x.dataset.view);
    const commit = () => { saveRailOrder(ids()); requestAnimationFrame(() => moveNode(current)); };
    b.addEventListener("dragstart", (e) => { railDragging = b; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-riftgate-section", b.dataset.view); requestAnimationFrame(() => b.classList.add("rail-dragging")); });
    b.addEventListener("dragend", () => { b.classList.remove("rail-dragging"); if (railDragging) { railDragging = null; commit(); } });
    b.addEventListener("dragover", (e) => {
        if (!railDragging || railDragging === b || railDragging.dataset.group !== b.dataset.group) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        const r = b.getBoundingClientRect();
        const ref = e.clientY > r.top + r.height / 2 ? b.nextSibling : b;
        if (ref === railDragging || railDragging.nextSibling === ref) return;
        const items = [...nav.querySelectorAll(".nav-item[data-view]")];
        const before = new Map(items.map((x) => [x, x.getBoundingClientRect().top]));
        nav.insertBefore(railDragging, ref);
        items.forEach((x) => { const dy = before.get(x) - x.getBoundingClientRect().top; if (dy) x.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 160, easing: "ease-out" }); });
        moveNode(current);
    });
    b.addEventListener("drop", (e) => e.preventDefault());
    b.addEventListener("keydown", (e) => {
        if (!e.ctrlKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault(); e.stopPropagation();
        const sib = e.key === "ArrowUp" ? b.previousElementSibling : b.nextElementSibling;
        if (!sib || !sib.dataset || sib.dataset.group !== b.dataset.group) return;
        nav.insertBefore(b, e.key === "ArrowUp" ? sib : sib.nextSibling);
        b.focus(); commit();
    });
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
    factsFollow(v.id);
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

// A picture of the window, saved in Pictures\Riftgate (after the palette or
// any toast has gone, so they aren't in it)
async function saveScreenshot() {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    await new Promise((r) => setTimeout(r, 450));
    const r = await call("r2-capture-window");
    if (r && r.ok) { toast(`Saved in Pictures › Riftgate: ${r.name}`); }
    else toast("The screenshot couldn't be saved", "err");
}

// Every section, one picture each, in the order the README and website use
// (Pictures\Riftgate): Nexus, Surprise me, Library, Free games, Deals,
// Theatre, Reading room, Journal, Themes. Any key or click stops it.
async function screenshotTour() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let stopped = false;
    const stop = () => { stopped = true; };
    setTimeout(() => { document.addEventListener("keydown", stop, { once: true }); document.addEventListener("pointerdown", stop, { once: true }); }, 600);
    const shots = [["nexus", 9000], ["today", 4000], ["library", 6000], ["free", 9000], ["deals", 8000], ["theatre", 8000], ["reading", 8000], ["journal", 5000], ["themes", 5000]];
    let n = 0;
    toast("Taking a picture of every section. Leave it be for about a minute and a half.", "ok", 4000);
    await wait(4200);
    for (const [where, ms] of shots) {
        if (stopped) break;
        closeDetail();
        if (where === "today") { location.hash = "nexus"; await wait(1500); openToday(); }
        else { location.hash = where; stage.scrollTop = 0; }
        await wait(ms);
        if (stopped) break;
        await saveScreenshot();
        n++;
        if (where === "today") document.querySelector(".today-close")?.click();
    }
    document.removeEventListener("keydown", stop); document.removeEventListener("pointerdown", stop);
    toast(stopped ? `Stopped after ${n} pictures` : `Saved ${n} pictures in Pictures › Riftgate`);
}

// ---- Shortcuts ---------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); saveScreenshot(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); openPalette(); }
    else if (e.key.toLowerCase() === "r" && !document.querySelector(".today, .rift-roll, .detail, .palette, .browser, .gp-controls")) openToday();
    else if (/^[1-9]$/.test(e.key) && !document.querySelector(".detail, .palette, .browser, .today, .interests-portal")) { const v = shownViews()[Number(e.key) - 1]; if (v) location.hash = v.id; }
});

setCommands([
    ...ALL.filter((v) => !v.admin).map((v) => ({ title: `Go to ${v.label}`, icon: v.icon, run: () => { location.hash = v.id; } })),
    { title: "What do you want to do today? (Surprise me)", icon: "dice", run: () => openToday() },
    ...MOODS.filter((m) => m.id !== "any").map((m) => ({ title: `Surprise me: ${m.label.toLowerCase()} (${m.hint.toLowerCase()})`, icon: m.icon, run: () => openToday(m.id) })),
    { title: "Ask the Rift: tell it what you feel like", icon: "sparkles", run: () => openAsk({ free: "free", theatre: "watch", reading: "read", library: "play" }[location.hash.slice(1)] || null) },
    { title: "Random pick from this section", icon: "rift", run: rollHere },
    { title: "Make Riftgate yours (your interests)", icon: "heart", run: () => interests.openInterests() },
    { title: "What's new in Riftgate", icon: "bell", run: () => openWhatsNew() },
    { title: "Controller & remote controls", icon: "app", run: () => gamepad.toggleControls(true) },
    { title: "Check for updates", icon: "refresh", run: () => checkForUpdates() },
    { title: "Send a suggestion or report a bug", icon: "chat", run: () => { location.hash = "suggestions"; } },
    { title: "Change the theme", icon: "sparkles", run: () => { location.hash = "themes"; } },
    { title: "Create a theme", icon: "plus", run: () => { location.hash = "themes/studio"; } },
    { title: "Community themes", icon: "globe", run: () => { location.hash = "themes/community"; } },
    { title: "Sign in or create a Riftgate account", icon: "gem", run: () => openAccount("in") },
    { title: "Add a show to My shows (search any series)", icon: "tv", run: () => openAddShow() },
    { title: "Take the tour of Riftgate", icon: "compass", run: () => startTour() },
    { title: "Save a screenshot of Riftgate (Ctrl Shift S)", icon: "download", run: () => saveScreenshot() },
    { title: "Save screenshots of every section (for the README and website)", icon: "grid", run: () => screenshotTour() },
    { title: "Did you know? (turn the facts on or off)", icon: "bulb", run: () => { location.hash = "settings"; } },
    { title: "Change the card size", icon: "resize", run: () => { location.hash = "settings"; } },
    { title: "Open the Vault (admins)", icon: "vault", run: () => { location.hash = "vault"; } },
    { title: "Admin tools (admins)", icon: "shield", run: () => { location.hash = "admin"; } }
]);

window.addEventListener("r2-engine-outdated", () => toast("Riftgate was updated. Quit it from the system tray (right-click its icon, Quit) and open it again to finish.", "err", 15000));

// ---- Engine events ---------------------------------------------------------------------
on("app-exited", (d) => { if (d && d.playtimeSeconds) toast("Playtime saved to your Library"); });
// a notification clicked (several new free games at once): straight to that section
on("r2-alert-open", (d) => { if (d && typeof d.view === "string" && /^[a-z]+$/.test(d.view)) location.hash = d.view; });

// ---- Start ---------------------------------------------------------------------------
(async function start() {
    buildTitlebar();
    listenForFarewell(); // the closing sound when Riftgate quits for good
    await theme.start(); // journal + your themes, applied before anything paints
    applyLook(); // card size and type colours
    const firstStart = !interests.chosen();
    const lastVisit = markVisits(); // for "While you were away"
    // the opening plays in the theme's colours while everything loads underneath
    // a seasonal event (season.js) goes on first, so the opening plays in its colours
    appSettings().then((s) => { season.start({ on: s.seasonalEvents !== false }); playIntro({ enabled: s.startupAnimation !== false, sound: s.startupSound !== false }); });
    account.restore();
    // the age gate and admin status; admins get their sections in the rail
    let wasAdmin = false, sawMature = false;
    gate.onChange(() => {
        if (gate.isAdmin() !== wasAdmin) {
            wasAdmin = gate.isAdmin(); buildRail(); moveNode(current);
            if (["vault", "admin"].includes(current)) { if (wasAdmin) { current = null; route(); } else location.hash = "nexus"; return; }
        }
        // what may show changed: lists filtered before are filtered again
        if (gate.canSeeMature() !== sawMature) { sawMature = gate.canSeeMature(); if (current && current !== "settings" && current !== "admin") { const c = current; current = null; location.hash = c; route(); } }
    });
    // wait (briefly) for it, so the first lists are already right
    await Promise.race([gate.start(), new Promise((r) => setTimeout(r, 2500))]);
    wasAdmin = gate.isAdmin(); sawMature = gate.canSeeMature();
    gamepad.start();
    enableDrop((p) => reading.addEbook(p).then((ok) => { if (ok) { location.hash = "reading"; } return ok; }));
    watchNewInstalls();
    watchUninstalls();
    // Steam hours stay current by themselves: once a day at most, a little after start
    setTimeout(async () => {
        const s = await appSettings();
        if (!s.steamId64 || Date.now() - (s.steamPlaytimesUpdatedAt || 0) < 24 * 3600e3) return;
        const r = await call("refresh-steam-playtime", s.steamId64);
        if (r && r.success) { await appSettings({ fresh: true }); forget("load-games"); window.dispatchEvent(new CustomEvent("r2-library-changed")); }
    }, 40 * 1000);
    buildRail();
    mountFacts(document.getElementById("app"));
    // when an outside source fails: the notice under the title bar, and Try
    // again drawing the section again from scratch (sources.js)
    onAnswerMeta(noteAnswer);
    mountSourcesBanner(document.getElementById("app"));
    window.addEventListener("r2-retry", () => { const c = current; current = null; if (c) route(); });
    // Interests change the rail and what Nexus leads with
    interests.onChange(() => {
        buildRail(); moveNode(current);
        if (current === "nexus") { const c = current; current = null; location.hash = c; route(); }
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("resize", () => moveNode(current));
    // the first page is built once the opening has calmed down (or at once without it)
    await Promise.race([introQuiet, new Promise((r) => setTimeout(r, 9000))]);
    await route();
    if (!interests.chosen()) introDone.then(() => setTimeout(() => interests.openInterests({ first: true }), 500));
    introDone.then(() => { mountBats(); mountHallowed(); if (season.current() && !season.greeted()) setTimeout(() => toast(season.current().hello, "ok", 9000), 2500); });
    // Seals: what earns them, then a look now and whenever something changes
    watchSecrets({ toast });
    { const hr = new Date().getHours(); if (hr >= 2 && hr < 5) seals.flag("night-owl"); }
    if (season.is("halloween")) seals.flag("hallowed");
    seals.onEarned(announce);
    let sealTimer = null;
    const lookAgain = () => { clearTimeout(sealTimer); sealTimer = setTimeout(() => seals.check(), 1500); };
    introDone.then(() => setTimeout(() => { seals.check(); journal.subscribe(lookAgain); }, 4000));
    // then the tour: all of it the first time, afterwards only what's new to you
    introDone.then(() => new Promise((r) => setTimeout(r, firstStart ? 900 : 1500))).then(async () => {
        if (!firstStart) await maybeWelcome(lastVisit).catch(() => false);
        while (document.querySelector(".interests-portal, .wn-modal, .detail, .update-modal")) await new Promise((r) => setTimeout(r, 600));
        maybeTour({ firstStart });
    });
})();
