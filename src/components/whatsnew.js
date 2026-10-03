// Riftgate — version information: What's new (every release, newest first),
// Check for updates, and the update window (see what's in it, download
// with progress, restart to install). Never downloads on its own.

import { h, icon, clear } from "../app/dom.js";
import { call, on } from "../app/api.js";
import * as journal from "../app/store.js";
import { CHANGELOG } from "../app/changelog.js";
import { toast } from "./toast.js";

let version = null;
export async function appVersion() {
    if (!version) { const v = await call("get-app-version"); version = typeof v === "string" ? v : (v && v.version) || ""; }
    return version;
}
export const isPreview = (v) => /-/.test(v || "");

// The 🔔 dot: lit until you've opened What's new for this version
const bells = new Set();
export async function unseen() { return journal.pref("seen:version", null) !== await appVersion(); }
async function paintBells() { const u = await unseen(); bells.forEach((b) => b.classList.toggle("has-news", u)); }
export function bellButton() {
    const b = h("button.win-btn.bell", { type: "button", title: "What's new", "aria-label": "What's new", onclick: () => openWhatsNew() }, icon("bell"));
    bells.add(b); paintBells();
    return b;
}

function modal(title, ...body) {
    document.querySelector(".wn-modal")?.remove();
    const box = h("div.wn-box", null, h("div.wn-head", null, h("h2", null, title),
        h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))), ...body);
    const wrap = h("div.wn-modal", { role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e) => { if (e.target === wrap) close(); } }, box);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey);
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey); }
    document.body.appendChild(wrap);
    return { box, close };
}

const notes = (items) => h("ul.wn-list", null, items.map((t) => {
    const m = /^(New|Changed|Fixed|Improved|Removed)(\s(?:in|for)\s[^:]+)?:\s*/.exec(t);
    return h("li", null, m ? h("span.wn-tag", { dataset: { k: m[1].toLowerCase() } }, m[1]) : null, m ? t.slice(m[0].length) : t);
}));

export async function openWhatsNew() {
    const v = await appVersion();
    const versions = Object.keys(CHANGELOG);
    const list = h("div.wn-versions");
    let shown = 0;
    const more = h("button.btn", { type: "button" }, "Show older versions");
    const add = (n) => {
        versions.slice(shown, shown + n).forEach((ver) => list.appendChild(h("section.wn-version", null,
            h("h3", null, `Version ${ver}`, ver === v ? h("span.badge", null, "You have this") : null), notes(CHANGELOG[ver]))));
        shown += n;
        more.hidden = shown >= versions.length;
    };
    more.onclick = () => add(8);
    add(3);
    modal("What's new", h("p.muted", null, `You're on Riftgate ${v}.`), list, more);
    journal.setPref("seen:version", v).then(paintBells);
}

// ---- Updates ------------------------------------------------------------------------
let manual = false;
export async function checkForUpdates() {
    const v = await appVersion();
    if (isPreview(v)) { toast(`This is a test version (${v}): it doesn't take updates. Install the released Riftgate to get them.`); return; }
    manual = true;
    toast("Checking for updates…");
    await call("check-for-updates");
}
on("update-not-available", () => { if (manual) toast("You're on the latest version of Riftgate."); manual = false; });
on("update-error", (msg) => { if (manual) toast(`Couldn't check for updates: ${msg || "unknown error"}`, "err"); manual = false; });
on("update-available", (info) => {
    manual = false;
    const ver = info && info.version ? String(info.version) : "";
    const items = CHANGELOG[ver] || [];
    const bar = h("div.wn-progress", { hidden: true }, h("i"));
    const label = h("p.muted", { hidden: true }, "Downloading…");
    const now = h("button.btn.primary.lg", { type: "button" }, icon("download"), "Update now");
    const later = h("button.btn.lg", { type: "button" }, "Keep using this version");
    const m = modal("An update is ready",
        h("p", null, `Riftgate ${ver} is available. Here's what's new:`),
        items.length ? notes(items) : h("p.muted", null, "New features and fixes. Open What's new after updating for the details."),
        bar, label, h("div.wn-actions", null, now, later));
    later.onclick = () => m.close();
    now.onclick = () => { now.hidden = later.hidden = true; bar.hidden = label.hidden = false; call("start-update-download"); };
});
on("update-download-progress", (pct) => {
    const i = document.querySelector(".wn-progress i");
    if (i) i.style.width = `${Math.max(0, Math.min(100, Number(pct) || 0))}%`;
    const l = document.querySelector(".wn-modal p.muted:not([hidden])");
    if (l && /Download/.test(l.textContent)) l.textContent = `Downloading the update… ${Math.round(pct)}%`;
});
on("update-downloaded", () => {
    toast("Update downloaded. Riftgate restarts to install it…");
    setTimeout(() => call("quit-and-install-update"), 1200);
});
