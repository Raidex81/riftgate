// Riftgate — seasonal events. Each one has dates, and Riftgate puts it on and
// takes it off by itself: nothing to install, nothing to undo. Settings →
// Seasonal events turns them off.
//
// The Hallowed Rift (22 October to 3 November): pumpkin and witch violet
// over your theme's colours, ghost-green lightning, will-o'-wisps around the
// Nexus rift and bats crossing now and then, a haunted wind under the
// opening, scary picks, a Trick or treat mood and Halloween facts. On
// 4 November Riftgate is itself again.
//
// The Christmas Rift (11 November to 6 January): pine green, berry red and
// gold over your theme's colours, snow falling over everything, a garland of
// lights along the top, holly in the corners, a Santa hat on the gem, a tree,
// presents, a fireplace with stockings and an elf by the Nexus rift, Santa's
// sleigh crossing the opening in front of the gem (and the app now and then),
// sleigh bells, an advent calendar, presents hidden around Riftgate to find,
// Christmas picks, a Ho ho ho mood and Christmas facts.
//
// A theme can carry a season too (the Hallowed Rift and Christmas Rift themes
// in Themes): with one of them on, its decorations stay all year, whatever
// the date, and its own colours are used as they are.

import { h } from "./dom.js";
import { tokens } from "./theme.js";
import * as journal from "./store.js";

export const SEASONS = [
    {
        id: "halloween", name: "The Hallowed Rift", from: [10, 22], to: [11, 3],
        // a full theme, of which only the colours go over yours (backgrounds only on dark themes)
        theme: { tone: "dark", colors: { bg: "#0b0609", panel: "#150a12", card: "#1c0e18", hover: "#28121f", line: "#3d1b2e", accent: "#ff7a1a", accent2: "#9b4dff", text: "#fff1e4", muted: "#b49b90" } },
        extra: { "--bolt-core": "#aaff8f" },
        hello: "The Hallowed Rift is open until 3 November. Something is stirring in it."
    },
    {
        id: "christmas", name: "The Christmas Rift", from: [11, 11], to: [1, 6],
        theme: { tone: "dark", colors: { bg: "#050d0a", panel: "#0a1812", card: "#0f2119", hover: "#152d22", line: "#1f3f2f", accent: "#e3263b", accent2: "#f4c04e", text: "#f3fbf4", muted: "#9cb8a6" } },
        extra: { "--bolt-core": "#fff3c4" },
        hello: "The Christmas Rift is open until 6 January. Snow is falling, and there are presents hidden all over Riftgate."
    }
];
export const SEASON_IDS = SEASONS.map((s) => s.id);

// The year a season belongs to (the Christmas Rift of 2026 runs into January 2027)
export function seasonYear(date = new Date()) { return date.getMonth() + 1 <= 1 ? date.getFullYear() - 1 : date.getFullYear(); }
const inRange = (d, [fm, fd], [tm, td]) => {
    const v = (d.getMonth() + 1) * 100 + d.getDate();
    const a = fm * 100 + fd, b = tm * 100 + td;
    return a <= b ? v >= a && v <= b : v >= a || v <= b; // ranges may cross New Year
};
// The season on a given day (null outside every event)
export function seasonOn(date = new Date()) { return SEASONS.find((s) => inRange(date, s.from, s.to)) || null; }

let active = null, enabled = true, key = "";
const listeners = new Set();
export const current = () => active;
export const is = (id) => !!active && active.id === id;
// on the season's own dates (not only through a theme that carries it): the events that belong to the dates
export const onDates = (id) => is(id) && !active.fromTheme;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const styleEl = () => document.getElementById("r2-season") || document.head.appendChild(h("style", { id: "r2-season" }));
// a theme that carries a season (theme.js sets data-theme-season when it's applied)
const themeSeason = () => SEASONS.find((x) => x.id === document.documentElement.dataset.themeSeason) || null;
function paint() {
    const root = document.documentElement;
    const dated = enabled ? seasonOn() : null;
    // the theme's season, unless it's the very season the dates have on anyway
    const forced = dated && themeSeason() && dated.id === themeSeason().id ? null : themeSeason();
    const s = forced || dated;
    const k = s ? `${s.id}:${forced ? "theme" : "date"}:${root.dataset.tone}` : "";
    if (k === key) return;
    key = k;
    const was = active && active.id;
    active = s ? { ...s, fromTheme: !!forced } : null;
    if (!s) { delete root.dataset.season; styleEl().textContent = ""; }
    else if (forced) { // the theme's own colours, only the season's extras on top
        styleEl().textContent = `:root[data-season="${s.id}"]{${Object.entries(s.extra || {}).map(([k, v]) => `${k}:${v};`).join("")}}`;
        root.dataset.season = s.id;
    } else {
        const tk = tokens(s.theme);
        const light = root.dataset.tone === "light";
        const keep = light ? ["--amethyst", "--amethyst-soft", "--rift-pink", "--logo-filter"]
            : ["--void", "--nebula", "--nebula-2", "--nebula-3", "--line", "--line-strong", "--amethyst", "--amethyst-soft", "--rift-pink", "--starlight", "--starlight-2", "--dust", "--dust-2", "--logo-filter"];
        const vars = { ...Object.fromEntries(keep.map((k) => [k, tk[k]])), ...s.extra };
        styleEl().textContent = `:root[data-season="${s.id}"]{${Object.entries(vars).map(([k, v]) => `${k}:${v};`).join("")}}`;
        root.dataset.season = s.id;
    }
    if ((active && active.id) === was) return;
    listeners.forEach((fn) => { try { fn(active); } catch (e) { console.error(e); } });
}

// At start (before the opening, so it plays in the season's colours), then hourly
export function start({ on = true } = {}) {
    enabled = on;
    paint();
    setInterval(paint, 3600e3);
    window.addEventListener("r2-theme-applied", paint);
    return active;
}
export function setEnabled(on) { enabled = !!on; paint(); }

// Once per season, a line to say it has begun
export function greeted() {
    if (!active || active.fromTheme) return true;
    const k = `season:${active.id}:${seasonYear()}`;
    if (journal.pref(k, false)) return true;
    journal.setPref(k, true);
    return false;
}
