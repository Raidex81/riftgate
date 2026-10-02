// Riftgate 2 — tiny DOM toolkit.
// h() builds elements; any string child becomes a text node, so text from
// games, films, books or the web can never be read as HTML. The only markup
// ever parsed is the app's own icon SVG (icons.js), which is a constant.

import { ICONS } from "./icons.js";

export function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === "class") el.className += (el.className ? " " : "") + v;
            else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
            else if (k === "dataset") Object.assign(el.dataset, v);
            else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v === true) el.setAttribute(k, "");
            else el.setAttribute(k, String(v));
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else if (c instanceof Node) el.appendChild(c);
        else el.appendChild(document.createTextNode(String(c)));
    }
}

// An app icon as an inline SVG element (stroke uses currentColor).
const parser = new DOMParser();
const iconCache = new Map();
export function icon(name, cls) {
    let tpl = iconCache.get(name);
    if (!tpl) {
        const body = ICONS[name] || ICONS.gem;
        const doc = parser.parseFromString(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
            "image/svg+xml");
        tpl = doc.documentElement;
        iconCache.set(name, tpl);
    }
    const el = document.importNode(tpl, true);
    if (cls) el.setAttribute("class", cls);
    return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

// Debounce for search boxes.
export function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Remote images go through Riftgate's local cover cache (covercache://), the
// same path the engine uses for every cover: faster on the second view, and
// it works with image hosts that refuse direct loads.
export function coverSrc(url) {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return `covercache://cover?u=${encodeURIComponent(url)}`;
    return url;
}

// Image that degrades to a typographic gem placeholder instead of a broken icon.
export function art(url, title, fallbackUrl) {
    const wrap = h("div.card-art");
    let img = null;
    const fb = () => {
        if (img) img.remove();
        wrap.prepend(h("div.art-fallback", null, title || ""));
    };
    if (!url) { fb(); return wrap; }
    let triedFallback = false;
    img = h("img", { src: coverSrc(url), alt: "", loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => {
        if (!triedFallback && fallbackUrl) { triedFallback = true; img.src = coverSrc(fallbackUrl); return; }
        fb();
    });
    wrap.appendChild(img);
    return wrap;
}
