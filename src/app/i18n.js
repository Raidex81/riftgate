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
const SKIP = new Set(["SCRIPT", "STYLE", "style", "TEXTAREA", "INPUT", "CODE", "PRE", "CANVAS", "SVG", "svg"]);

let words = null;           // Map: English -> translation
let patterns = [];          // [{ re, to, anchor }]
let active = "en";

export const language = () => active;
// for dates: the language's own way of writing them (undefined = Windows' way)
const LOCALES = { pt: "pt-PT" };
export const locale = () => LOCALES[active];

// what "Same as Windows" means: the system's language when Riftgate has it
export function resolve(choice) {
    const sys = String((globalThis.navigator && navigator.language) || "en").slice(0, 2).toLowerCase();
    const id = !choice || choice === "auto" ? sys : choice;
    return FILES[id] ? id : "en";
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

function compile(table) {
    const words = new Map(), patterns = [];
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
    return { words, patterns };
}
function load(table) { ({ words, patterns } = compile(table)); }

// use a language table directly (tests, tools)
export function use(table, id = "xx") { load(table); active = id; }

// one sentence, or null when there's nothing for it (T: another language's table, for localize)
export function translate(text, deep = true, T = null) {
    const { words: W, patterns: P } = T || { words, patterns };
    if (!W) return null;
    const key = clean(text);
    if (!key || key.length > 600) return null;
    const hit = W.get(key);
    if (hit) return hit;
    for (const p of P) {
        if (p.anchor && !key.includes(p.anchor)) continue;
        const m = p.re.exec(key);
        if (!m || (p.numeric && !/^[\d.,\s%+−-]{1,12}$/.test(m[1]))) continue;
        const vals = {};
        // what's filled in may be a sentence of its own ("Move Popular on Netflix")
        p.order.forEach((n, i) => { const v = m[i + 1]; vals[n] = W.get(v) || (deep && translate(v, false, T)) || v; });
        return p.to.replace(/\{(\d)\}/g, (_, n) => vals[n] ?? "");
    }
    return null;
}
// for code that builds a sentence itself (canvas, notifications)
export const t = (text) => translate(text) || text;

const kept = (el) => el && el.closest && el.closest("[translate='no'], .notranslate");

function textNode(n, T) {
    const v = n.data;
    if (!v || !/[A-Za-z]/.test(v)) return;
    const p = n.parentNode;
    if (!p || SKIP.has(p.nodeName)) return;
    const to = translate(v, true, T);
    if (!to || to === clean(v) || kept(p)) return;
    const lead = /^\s*/.exec(v)[0], tail = /\s*$/.exec(v)[0];
    n.data = lead + to + tail;
}
function attrs(el, T) {
    for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !/[A-Za-z]/.test(v)) continue;
        const to = translate(v, true, T);
        if (to && to !== v && !kept(el)) el.setAttribute(a, to);
    }
}
function tree(root, T) {
    if (root.nodeType === 3) return textNode(root, T);
    if (root.nodeType !== 1 || root.getAttribute("translate") === "no") return;
    attrs(root, T);
    if (SKIP.has(root.nodeName)) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
            if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
            if (n.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
            if (SKIP.has(n.nodeName)) { attrs(n, T); return NodeFilter.FILTER_REJECT; } // a field's placeholder, not what's typed in it
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (n.nodeType === 3) textNode(n, T); else attrs(n, T); }
}
function watch(root, T) {
    const mo = new MutationObserver((list) => {
        for (const m of list) {
            if (m.type === "childList") m.addedNodes.forEach((n) => tree(n, T));
            else if (m.type === "characterData") textNode(m.target, T);
            else if (m.type === "attributes") { const v = m.target.getAttribute(m.attributeName); const to = v && translate(v, true, T); if (to && to !== v && !kept(m.target)) m.target.setAttribute(m.attributeName, to); }
        }
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    return mo;
}

// One part of the window in a language of its own (the Dune: Awakening companion has its own choice):
// in the window's language it's left to the rest; in English inside a translated window it's kept as
// it is; in another language it's translated with that language's file, and kept translated as it
// changes. Returns a function that stops it.
const others = {};
export async function localize(el, id) {
    if (!el) return () => {};
    const done = () => { if (el.dataset.localized === "en") el.removeAttribute("translate"); delete el.dataset.localized; };
    if (id === active) { done(); return () => {}; }
    if (id === "en" || !FILES[id]) { el.setAttribute("translate", "no"); el.dataset.localized = "en"; return done; }
    const T = others[id] || (others[id] = compile((await FILES[id]()).default));
    el.dataset.localized = id;
    tree(el, T);
    const mo = watch(el, T);
    return () => { mo.disconnect(); done(); };
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
    watch(document.body);
    return active;
}
