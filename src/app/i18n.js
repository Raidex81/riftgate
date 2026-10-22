// Riftgate — in your language. The interface is written in English; a
// language file (lang/<id>.js) maps each English sentence to its
// translation, and this translates the window as it's drawn: text,
// placeholders, tooltips and screen-reader labels, in every section and
// dialog, without the rest of the code knowing. Sentences with something
// filled in ("{0} days left") match as patterns. Anything a language file
// doesn't have stays in English, and nothing inside translate="no" (titles,
// descriptions, what you typed) is ever touched.
// Settings → Language: Same as Windows (the default), English, Português.

import { settings } from "./api.js";

export const LANGUAGES = [
    { id: "auto", label: "Same as Windows" },
    { id: "en", label: "English" },
    { id: "pt", label: "Português" }
];
const FILES = { pt: () => import("./lang/pt.js") };
const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "CANVAS", "SVG", "svg"]);

let words = null;           // Map: English -> translation
let patterns = [];          // [{ re, to, anchor }]
let active = "en";

export const language = () => active;
// for dates: the language's own way of writing them (undefined = Windows' way)
const LOCALES = { pt: "pt-PT" };
export const locale = () => LOCALES[active];

// what "Same as Windows" means: the system's language when Riftgate has it
export function resolve(choice) {
    const sys = String(navigator.language || "en").slice(0, 2).toLowerCase();
    const id = !choice || choice === "auto" ? sys : choice;
    return FILES[id] ? id : "en";
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

function load(table) {
    words = new Map();
    patterns = [];
    for (const [en, to] of Object.entries(table)) {
        if (!to || to === en) continue;
        if (/\{\d\}/.test(en)) {
            const parts = en.split(/\{(\d)\}/);
            let src = "^", anchor = "";
            for (let i = 0; i < parts.length; i++) {
                if (i % 2) src += "(.+?)";
                else { src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); if (parts[i].trim().length > anchor.length) anchor = parts[i].trim(); }
            }
            const literal = parts.filter((_, i) => !(i % 2)).join("").trim();
            const open = parts[0] === "", close = parts[parts.length - 1] === "";
            // "{0} and {1}" would match any sentence with "and" in it: too loose to use
            if (anchor.length < 2 || (open && close && literal.length < 12)) continue;
            const order = parts.filter((_, i) => i % 2).map(Number);
            // "{0} days": only when what's filled in is a number, not "In 6 days" inside a title
            const numeric = open && literal.length < 10;
            patterns.push({ re: new RegExp(src + "$", "s"), to, order, anchor, numeric });
        } else words.set(clean(en), to);
    }
    // the longest patterns first: "{0} new entries in your Journal." before "{0} new entries"
    patterns.sort((a, b) => b.anchor.length - a.anchor.length);
}

// use a language table directly (tests, tools)
export function use(table, id = "xx") { load(table); active = id; }

// one sentence, or null when there's nothing for it
export function translate(text, deep = true) {
    if (!words) return null;
    const key = clean(text);
    if (!key || key.length > 600) return null;
    const hit = words.get(key);
    if (hit) return hit;
    for (const p of patterns) {
        if (p.anchor && !key.includes(p.anchor)) continue;
        const m = p.re.exec(key);
        if (!m || (p.numeric && !/^[\d.,\s%+−-]{1,12}$/.test(m[1]))) continue;
        const vals = {};
        // what's filled in may be a sentence of its own ("Move Popular on Netflix")
        p.order.forEach((n, i) => { const v = m[i + 1]; vals[n] = words.get(v) || (deep && translate(v, false)) || v; });
        return p.to.replace(/\{(\d)\}/g, (_, n) => vals[n] ?? "");
    }
    return null;
}
// for code that builds a sentence itself (canvas, notifications)
export const t = (text) => translate(text) || text;

const kept = (el) => el && el.closest && el.closest("[translate='no'], .notranslate");

function textNode(n) {
    const v = n.data;
    if (!v || !/[A-Za-z]/.test(v)) return;
    const p = n.parentNode;
    if (!p || SKIP.has(p.nodeName)) return;
    const to = translate(v);
    if (!to || to === clean(v) || kept(p)) return;
    const lead = /^\s*/.exec(v)[0], tail = /\s*$/.exec(v)[0];
    n.data = lead + to + tail;
}
function attrs(el) {
    for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !/[A-Za-z]/.test(v)) continue;
        const to = translate(v);
        if (to && to !== v && !kept(el)) el.setAttribute(a, to);
    }
}
function tree(root) {
    if (root.nodeType === 3) return textNode(root);
    if (root.nodeType !== 1 || root.getAttribute("translate") === "no") return;
    attrs(root);
    if (SKIP.has(root.nodeName)) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
            if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
            if (n.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
            if (SKIP.has(n.nodeName)) { attrs(n); return NodeFilter.FILTER_REJECT; } // a field's placeholder, not what's typed in it
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (n.nodeType === 3) textNode(n); else attrs(n); }
}

// Starts translating (before the first section is drawn). Resolves to the
// language in use.
export async function start() {
    const s = await settings().catch(() => ({}));
    const id = resolve(s.language);
    if (id === "en") return (active = "en");
    try { load((await FILES[id]()).default); } catch (err) { console.error("[i18n] language file missing:", err); return (active = "en"); }
    active = id;
    document.documentElement.lang = id;
    tree(document.body);
    new MutationObserver((list) => {
        for (const m of list) {
            if (m.type === "childList") m.addedNodes.forEach(tree);
            else if (m.type === "characterData") textNode(m.target);
            else if (m.type === "attributes") { const v = m.target.getAttribute(m.attributeName); const to = v && translate(v); if (to && to !== v && !kept(m.target)) m.target.setAttribute(m.attributeName, to); }
        }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return active;
}
