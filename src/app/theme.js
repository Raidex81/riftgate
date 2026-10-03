// Riftgate 2 — the theme engine. A theme is plain data (colours, surface,
// pattern, font, glow, an optional picture); apply() turns it into design
// tokens on <html>, so every view follows instantly. Built-in themes come
// from themes-builtin.js; yours live in r2-themes.json (with pictures).

import { h, coverSrc } from "./dom.js";
import { call } from "./api.js";
import * as journal from "./store.js";
import { BUILTIN_THEMES, FONTS, SURFACES, PATTERNS } from "./themes-builtin.js";
export { BUILTIN_THEMES, FONTS, SURFACES, PATTERNS };

let mine = [];
let loadedMine = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export function loadMine() {
    if (!loadedMine) loadedMine = call("r2-themes-local-get").then((l) => { mine = Array.isArray(l) ? l : []; return mine; });
    return loadedMine;
}
export function myThemes() { return mine.slice(); }
export function allThemes() { return [...mine, ...BUILTIN_THEMES]; }
export function find(id) { return allThemes().find((t) => t.id === id) || null; }
export function activeId() { return journal.pref("theme", null) || legacyAccent() || "builtin:rift"; }
export function active() { return find(activeId()) || BUILTIN_THEMES[0]; }

// Riftgate 2 alpha had accent swatches: map them to the closest theme once
function legacyAccent() {
    const a = journal.pref("accent", null);
    return { ember: "builtin:ember", cyan: "builtin:deep-ocean", venom: "builtin:forest-night", crimson: "builtin:crimson-night" }[a] || null;
}

async function saveMine() {
    const r = await call("r2-themes-local-set", mine);
    if (!r || !r.ok) throw new Error((r && r.error) || "Your themes couldn't be saved.");
    emit();
}
export async function saveTheme(t) {
    await loadMine();
    const copy = { ...t, builtin: false, updatedAt: Date.now() };
    if (!copy.id || copy.id.startsWith("builtin:")) copy.id = `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const i = mine.findIndex((x) => x.id === copy.id);
    if (i >= 0) mine[i] = copy; else mine.unshift(copy);
    await saveMine();
    return copy;
}
export async function deleteTheme(id) {
    await loadMine();
    mine = mine.filter((t) => t.id !== id);
    await saveMine();
    if (activeId() === id) await use("builtin:rift");
}
export async function use(id) {
    const t = find(id);
    if (!t) return;
    apply(t);
    await journal.setPref("theme", id);
    emit();
}

// ---- Apply ------------------------------------------------------------------------
const styleEl = () => document.getElementById("r2-theme") || document.head.appendChild(h("style", { id: "r2-theme" }));
const mix = (a, b, pct) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
const safeColor = (c, fb) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fb);
const D = BUILTIN_THEMES[0].colors;

export function tokens(t) {
    const c = Object.fromEntries(Object.keys(D).map((k) => [k, safeColor(t.colors && t.colors[k], D[k])]));
    const light = t.tone === "light";
    const font = FONTS[t.font] || FONTS.rift;
    return {
        "--void": c.bg, "--nebula": c.panel, "--nebula-2": c.card, "--nebula-3": c.hover,
        "--line": c.line, "--line-strong": mix(c.line, c.text, 62),
        "--amethyst": c.accent, "--amethyst-soft": mix(c.accent, light ? c.text : "#ffffff", light ? 72 : 60),
        "--rift-pink": c.accent2,
        "--starlight": c.text, "--starlight-2": mix(c.text, c.bg, 80),
        "--dust": c.muted, "--dust-2": mix(c.muted, c.bg, 62),
        "--hi": light ? c.text : "#ffffff",
        "--on-accent": safeColor(t.onAccent, "#ffffff"),
        "--font": font.body, "--font-display": font.display
    };
}

export function apply(t) {
    const root = document.documentElement;
    const tk = tokens(t);
    const wp = t.wallpaper && t.wallpaper.src ? t.wallpaper : null;
    let css = ":root{" + Object.entries(tk).map(([k, v]) => `${k}:${v};`).join("");
    if (wp) {
        const src = /^https?:/i.test(wp.src) ? coverSrc(wp.src) : wp.src;
        css += `--wallpaper:url("${String(src).replace(/["\\\n]/g, "")}");--wp-dim:${clamp(wp.dim, 0, 95, 55)}%;--wp-blur:${clamp(wp.blur, 0, 40, 0)}px;`;
    }
    css += "}";
    styleEl().textContent = css;
    root.dataset.surface = SURFACES.some((s) => s.id === t.surface) ? t.surface : "gem";
    root.dataset.pattern = PATTERNS.includes(t.pattern) ? t.pattern : "none";
    root.dataset.tone = t.tone === "light" ? "light" : "dark";
    root.dataset.glow = String(clamp(t.glow, 0, 2, 1));
    if (wp) { root.dataset.wallpaper = ""; root.dataset.wpMode = wp.mode === "tile" ? "tile" : "cover"; }
    else { delete root.dataset.wallpaper; delete root.dataset.wpMode; }
    delete root.dataset.accent;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", t.tone === "light" ? "light" : "dark");
}
function clamp(v, lo, hi, fb) { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; }

export async function start() {
    await Promise.all([journal.load(), loadMine()]);
    apply(active());
}

// ---- Pictures ----------------------------------------------------------------------
function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That picture couldn't be opened.")); i.src = src; });
}
// Shrinks a picture to fit `max` pixels on its long side, as JPEG, and keeps
// lowering quality until it fits `maxChars` (a data URL's length).
export async function shrink(src, max = 2560, maxChars = 4e6, quality = .88) {
    const img = await loadImage(src);
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    let q = quality, out = cv.toDataURL("image/jpeg", q);
    while (out.length > maxChars && q > .35) { q -= .08; out = cv.toDataURL("image/jpeg", q); }
    return out.length > maxChars ? shrink(out, Math.round(max * .75), maxChars, .8) : out;
}

// ---- A small live preview of any theme (tiles in the gallery) ------------------
export function tile(t, { thumb } = {}) {
    const vars = tokens(t);
    const wp = thumb || (t.wallpaper && t.wallpaper.src) || null;
    const el = h("div.theme-tile", { dataset: { surface: t.surface || "gem", pattern: t.pattern || "none", tone: t.tone || "dark" }, "aria-hidden": "true" },
        h("div.tt-bg", { style: wp ? { backgroundImage: `url("${/^https?:/i.test(wp) ? coverSrc(wp) : wp}")` } : null }),
        h("div.tt-pat"),
        h("div.tt-rail", null, h("i"), h("i"), h("i")),
        h("div.tt-main", null,
            h("div.tt-title"),
            h("div.tt-row", null, h("div.tt-card"), h("div.tt-card"), h("div.tt-card")),
            h("div.tt-btn")));
    Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
    if (t.wallpaper && t.wallpaper.src) el.style.setProperty("--tt-dim", `${clamp(t.wallpaper.dim, 0, 95, 55)}%`);
    return el;
}

// A fresh, editable copy of any theme
export function draft(from) {
    const base = from || active();
    return JSON.parse(JSON.stringify({
        id: null, name: from ? `${base.name} (mine)` : "My theme", tone: base.tone || "dark", surface: base.surface || "gem",
        pattern: base.pattern || "none", font: base.font || "rift", glow: base.glow ?? 1, onAccent: base.onAccent || "#ffffff",
        colors: { ...D, ...(base.colors || {}) }, wallpaper: base.wallpaper ? { ...base.wallpaper } : null, basedOn: base.id || null
    }));
}

// Generate a harmonious palette from one colour (the "magic" button)
export function paletteFrom(accent, tone = "dark") {
    const hex = safeColor(accent, "#8b3dff");
    const [h0, s0] = hsl(hex);
    const H = (l, s = Math.min(s0, 45), hue = h0) => hslHex(hue, s, l);
    const second = hslHex((h0 + 40) % 360, Math.max(60, s0), 60);
    return tone === "light"
        ? { bg: H(95, 30), panel: H(97, 30), card: "#ffffff", hover: H(91, 35), line: H(84, 30), accent: hex, accent2: second, text: H(14, 30), muted: H(42, 15) }
        : { bg: H(4, 40), panel: H(8, 42), card: H(11, 40), hover: H(15, 40), line: H(21, 38), accent: hex, accent2: second, text: H(94, 60), muted: H(65, 18) };
}
function hsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
        hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; }
    return [Math.round(hh), Math.round(s * 100), Math.round(l * 100)];
}
function hslHex(hh, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, "0");
    return `#${f(0)}${f(8)}${f(4)}`;
}
