// Riftgate — seasonal events. Each one has dates, and Riftgate puts it on and
// takes it off by itself: nothing to install, nothing to undo. Settings →
// Seasonal events turns them off.
//
// The Hallowed Rift (22 October to 3 November): pumpkin and witch violet
// over your theme's colours, ghost-green lightning, will-o'-wisps around the
// Nexus rift and bats crossing now and then, a haunted wind under the
// opening, scary picks, a Trick or treat mood and Halloween facts. On
// 4 November Riftgate is itself again.

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
    }
];

const inRange = (d, [fm, fd], [tm, td]) => {
    const v = (d.getMonth() + 1) * 100 + d.getDate();
    const a = fm * 100 + fd, b = tm * 100 + td;
    return a <= b ? v >= a && v <= b : v >= a || v <= b; // ranges may cross New Year
};
// The season on a given day (null outside every event)
export function seasonOn(date = new Date()) { return SEASONS.find((s) => inRange(date, s.from, s.to)) || null; }

let active = null, enabled = true;
const listeners = new Set();
export const current = () => active;
export const is = (id) => !!active && active.id === id;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const styleEl = () => document.getElementById("r2-season") || document.head.appendChild(h("style", { id: "r2-season" }));
function paint() {
    const root = document.documentElement;
    const s = enabled ? seasonOn() : null;
    if ((s && s.id) === (active && active.id)) return;
    active = s;
    if (!s) { delete root.dataset.season; styleEl().textContent = ""; }
    else {
        const tk = tokens(s.theme);
        const light = root.dataset.tone === "light";
        const keep = light ? ["--amethyst", "--amethyst-soft", "--rift-pink", "--logo-filter"]
            : ["--void", "--nebula", "--nebula-2", "--nebula-3", "--line", "--line-strong", "--amethyst", "--amethyst-soft", "--rift-pink", "--starlight", "--starlight-2", "--dust", "--dust-2", "--logo-filter"];
        const vars = { ...Object.fromEntries(keep.map((k) => [k, tk[k]])), ...s.extra };
        styleEl().textContent = `:root[data-season="${s.id}"]{${Object.entries(vars).map(([k, v]) => `${k}:${v};`).join("")}}`;
        root.dataset.season = s.id;
    }
    listeners.forEach((fn) => { try { fn(active); } catch (e) { console.error(e); } });
}

// At start (before the opening, so it plays in the season's colours), then hourly
export function start({ on = true } = {}) {
    enabled = on;
    paint();
    setInterval(paint, 3600e3);
    return active;
}
export function setEnabled(on) { enabled = !!on; paint(); }

// Once per season, a line to say it has begun
export function greeted() {
    if (!active) return true;
    const key = `season:${active.id}:${new Date().getFullYear()}`;
    if (journal.pref(key, false)) return true;
    journal.setPref(key, true);
    return false;
}
