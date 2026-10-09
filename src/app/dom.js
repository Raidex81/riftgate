// Riftgate — tiny DOM toolkit.
// h() builds elements; any string child becomes a text node, so text from
// games, films, books or the web can never be read as HTML. The only markup
// ever parsed is the app's own icon SVG (icons.js), which is a constant.

import { ICONS } from "./icons.js";
import { findCover, whenSeen } from "./covers.js";

export function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name || "div");
    if (classes.length) el.className = classes.join(" ");
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === "class") el.className += (el.className ? " " : "") + v;
            else if (k === "style" && typeof v === "object") { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
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

// append()/prepend() skip null, undefined and false, like h() does, so
// "cond ? node : null" never shows up as the text "null" on screen.
for (const P of [Element.prototype, DocumentFragment.prototype]) {
    for (const k of ["append", "prepend"]) {
        const orig = P[k];
        if (orig.__r2) continue;
        const wrapped = function (...nodes) { return orig.apply(this, nodes.filter((n) => n != null && n !== false)); };
        wrapped.__r2 = true;
        P[k] = wrapped;
    }
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
// With a `find` ({ kind, year }), a missing or broken picture is looked up by
// title (once, when the card comes on screen) before giving up.
export function art(url, title, fallbackUrl, find) {
    const wrap = h("div.card-art");
    let img = null, looked = false, triedFallback = false;
    const placeholder = () => { if (!wrap.querySelector(".art-fallback")) wrap.prepend(h("div.art-fallback", null, title || "")); };
    const show = (src) => {
        if (img) img.remove();
        img = h("img", { src: coverSrc(src), alt: "", loading: "lazy", decoding: "async", draggable: "false" });
        img.addEventListener("load", () => { wrap.querySelector(".art-fallback")?.remove(); wrap.classList.remove("finding"); });
        img.addEventListener("error", onError);
        wrap.appendChild(img);
    };
    const lookUp = () => {
        if (looked || !find || !title) return false;
        looked = true;
        wrap.classList.add("finding");
        whenSeen(wrap, () => findCover(title, find.kind, find.year).then((u) => {
            wrap.classList.remove("finding");
            if (u && u !== url && u !== fallbackUrl) show(u);
        }));
        return true;
    };
    function onError() {
        if (!triedFallback && fallbackUrl) { triedFallback = true; img.src = coverSrc(fallbackUrl); return; }
        if (img) { img.remove(); img = null; }
        placeholder();
        lookUp();
    }
    if (!url && !fallbackUrl) { placeholder(); lookUp(); return wrap; }
    if (!url) { triedFallback = true; show(fallbackUrl); return wrap; }
    show(url);
    return wrap;
}
