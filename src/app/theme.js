// Riftgate — the theme engine. A theme is plain data (colours, surface,
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

// Riftgate alpha had accent swatches: map them to the closest theme once
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
        "--font": font.body, "--font-display": font.display,
        "--logo-filter": logoFilterFor(c.accent)
    };
}

// How a picture sits behind the app:
//   smart  (default) fills the window when the shapes are close (crops at most
//          about a fifth); otherwise shows the whole picture, with a soft
//          blurred copy of it filling the sides (ultrawide screens, tall photos)
//   fill   always fills the window (cropping what doesn't fit)
//   whole  always the whole picture, blurred copy around it
//   tile   repeats a small picture
export const WP_MODES = [
    { id: "smart", label: "Smart", hint: "Fill or fit, whatever looks best on this screen" },
    { id: "fill", label: "Fill", hint: "Always fill the window (crops the edges)" },
    { id: "whole", label: "Whole", hint: "Always the whole picture" },
    { id: "tile", label: "Tile", hint: "Repeat a small picture" }
];
export const WP_POSITIONS = [{ id: "top", label: "Top" }, { id: "center", label: "Middle" }, { id: "bottom", label: "Bottom" }];
export function wpMode(m) { return m === "tile" || m === "fill" || m === "whole" ? m : "smart"; } // older themes said "cover": that's smart now
const ratios = new Map();
let current = null;
function ensureWall() {
    const app = document.querySelector(".app");
    if (!app) { requestAnimationFrame(ensureWall); return; }
    if (!app.querySelector(":scope > .app-wall")) { const w = document.createElement("div"); w.className = "app-wall"; w.setAttribute("aria-hidden", "true"); app.prepend(w); }
}
function fit() {
    const root = document.documentElement;
    const wp = current;
    if (!wp) return;
    const mode = wpMode(wp.mode);
    if (mode !== "smart") { root.dataset.wpFit = mode === "whole" ? "whole" : mode === "tile" ? "tile" : "fill"; return; }
    const r = ratios.get(wp.src);
    if (!r) {
        root.dataset.wpFit = "fill";
        const img = new Image();
        img.onload = () => { ratios.set(wp.src, img.naturalWidth / Math.max(1, img.naturalHeight)); if (current === wp) fit(); };
        img.src = /^https?:/i.test(wp.src) ? coverSrc(wp.src) : wp.src;
        return;
    }
    const win = window.innerWidth / Math.max(1, window.innerHeight);
    root.dataset.wpFit = Math.abs(Math.log(r / win)) <= Math.log(1.25) ? "fill" : "whole";
}
let resizeHooked = false;

export function apply(t) {
    const root = document.documentElement;
    const tk = tokens(t);
    const wp = t.wallpaper && t.wallpaper.src ? t.wallpaper : null;
    let css = ":root{" + Object.entries(tk).map(([k, v]) => `${k}:${v};`).join("");
    if (wp) {
        const src = /^https?:/i.test(wp.src) ? coverSrc(wp.src) : wp.src;
        const pos = WP_POSITIONS.some((p) => p.id === wp.pos) ? wp.pos : "center";
        css += `--wallpaper:url("${String(src).replace(/["\\\n]/g, "")}");--wp-dim:${clamp(wp.dim, 0, 95, 55)}%;--wp-blur:${clamp(wp.blur, 0, 40, 0)}px;--wp-pos:center ${pos};`;
    }
    css += "}";
    styleEl().textContent = css;
    root.dataset.surface = SURFACES.some((s) => s.id === t.surface) ? t.surface : "gem";
    root.dataset.pattern = PATTERNS.includes(t.pattern) ? t.pattern : "none";
    root.dataset.tone = t.tone === "light" ? "light" : "dark";
    root.dataset.glow = String(clamp(t.glow, 0, 2, 1));
    current = wp;
    if (wp) {
        root.dataset.wallpaper = ""; root.dataset.wpMode = wpMode(wp.mode);
        ensureWall(); fit();
        if (!resizeHooked) { resizeHooked = true; let tm = null; window.addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(fit, 150); }); }
    } else { delete root.dataset.wallpaper; delete root.dataset.wpMode; delete root.dataset.wpFit; }
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
// The logo is violet (hue 266): turn it to the theme's accent hue, and
// drain it for grey accents (Mono Noir)
function logoFilterFor(accent) {
    if (!/^#[0-9a-f]{6}$/i.test(accent)) return "none";
    const [hh, ss] = hsl(accent);
    const turn = ((hh - 266) % 360 + 360) % 360;
    return `hue-rotate(${turn}deg) saturate(${Math.max(0, Math.min(1.3, ss / 85)).toFixed(2)})`;
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

// ---- A theme that matches a picture ---------------------------------------------------------
// Reads the picture's colours (k-means on a small copy), how light it is, how
// colourful and how busy, and returns the settings that sit best on it:
// accent and second accent taken from the picture's most vivid colours,
// light or dark, a background tinted like the picture, how much to blend and
// blur it so text stays readable, and a surface and glow that suit it.
export async function matchPicture(src) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image(); i.crossOrigin = "anonymous";
        i.onload = () => resolve(i); i.onerror = () => reject(new Error("The picture couldn't be read."));
        i.src = /^https?:/i.test(src) ? coverSrc(src) : src;
    });
    const W = 96, H = Math.max(24, Math.round(96 * img.naturalHeight / Math.max(1, img.naturalWidth)));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, W, H);
    let data;
    try { data = x.getImageData(0, 0, W, H).data; } catch (e) { throw new Error("This picture can't be analysed (the site doesn't allow it). Save it and choose it from your PC."); }
    const px = [], lum = new Float32Array(W * H);
    let rg = 0, yb = 0, rg2 = 0, yb2 = 0, n = 0, lsum = 0;
    for (let i = 0, k = 0; i < data.length; i += 4, k++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (data[i + 3] < 128) continue;
        px.push([r, g, b]);
        const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; lum[k] = L; lsum += L;
        const a1 = r - g, a2 = (r + g) / 2 - b; rg += a1; yb += a2; rg2 += a1 * a1; yb2 += a2 * a2; n++;
    }
    if (!n) throw new Error("This picture is empty.");
    const light = lsum / n;
    const sd = Math.sqrt(Math.max(0, rg2 / n - (rg / n) ** 2) + Math.max(0, yb2 / n - (yb / n) ** 2));
    const colorful = (sd + 0.3 * Math.hypot(rg / n, yb / n)) / 100; // ~0 grey … >0.6 very colourful
    let edges = 0;
    for (let yy = 0; yy < H - 1; yy++) for (let xx = 0; xx < W - 1; xx++) { const k = yy * W + xx; edges += Math.abs(lum[k] - lum[k + 1]) + Math.abs(lum[k] - lum[k + W]); }
    const busy = edges / ((W - 1) * (H - 1)); // ~0.02 calm … >0.12 busy
    // k-means, 6 colours
    const K = 6; let cent = [];
    for (let i = 0; i < K; i++) cent.push(px[Math.floor((i + .5) * px.length / K)].slice());
    let assign = new Int32Array(px.length);
    for (let it = 0; it < 10; it++) {
        const sum = cent.map(() => [0, 0, 0, 0]);
        px.forEach((p, i) => {
            let best = 0, bd = Infinity;
            cent.forEach((q, j) => { const d = (p[0] - q[0]) ** 2 * 2 + (p[1] - q[1]) ** 2 * 4 + (p[2] - q[2]) ** 2 * 3; if (d < bd) { bd = d; best = j; } });
            assign[i] = best; const s = sum[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
        });
        cent = sum.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : cent[j]));
    }
    const weight = new Array(K).fill(0); assign.forEach((a) => weight[a]++);
    const toHex = (p) => "#" + p.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
    const clusters = cent.map((p, j) => { const hex = toHex(p); const [hh, ss, ll] = hsl(hex); return { hex, h: hh, s: ss, l: ll, w: weight[j] / px.length }; }).filter((q) => q.w > 0.01);
    const vivid = clusters.map((q) => ({ ...q, score: Math.sqrt(q.w) * Math.pow(q.s / 100, 1.3) * (q.l > 18 && q.l < 85 ? 1 : .35) })).sort((a, b) => b.score - a.score);
    const tone = light > 0.6 ? "light" : "dark";
    let a1 = vivid[0] && vivid[0].s >= 18 ? vivid[0] : null;
    // make the accent readable on the background it will sit on
    const tune = (q) => { const l = tone === "dark" ? Math.max(55, Math.min(72, q.l)) : Math.max(36, Math.min(50, q.l)); return hslHex(q.h, Math.max(55, q.s), l); };
    const accent = a1 ? tune(a1) : (tone === "dark" ? "#d6d6de" : "#3a3a44");
    const colors = paletteFrom(accent, tone);
    const a2 = a1 && vivid.slice(1).find((q) => q.s >= 22 && Math.min(Math.abs(q.h - a1.h), 360 - Math.abs(q.h - a1.h)) >= 25);
    if (a2) colors.accent2 = tune(a2);
    // background and panels tinted like the picture's biggest colour
    const base = clusters.slice().sort((a, b) => b.w - a.w)[0];
    if (base) {
        const s = Math.min(base.s, 38);
        if (tone === "dark") Object.assign(colors, { bg: hslHex(base.h, s, 5), panel: hslHex(base.h, s, 9), card: hslHex(base.h, s, 12), hover: hslHex(base.h, s, 16), line: hslHex(base.h, Math.min(s, 30), 22) });
        else Object.assign(colors, { bg: hslHex(base.h, s, 95), panel: hslHex(base.h, s, 97), hover: hslHex(base.h, s, 91), line: hslHex(base.h, Math.min(s, 30), 84) });
    }
    const [, , al] = hsl(accent);
    const onAccent = al > 62 ? "#14101c" : "#ffffff";
    const surface = tone === "light" ? "glass" : (colorful > 0.45 || busy > 0.09 ? "glass" : (a1 && a1.s > 75 && busy < 0.06 ? "neon" : "gem"));
    const glow = !a1 ? 0 : (tone === "dark" && a1.s > 70 && colorful > 0.35 ? 2 : 1);
    const dim = Math.round(tone === "light" ? Math.min(60, 30 + busy * 250) : Math.min(78, 42 + busy * 260 + (light > 0.45 ? 12 : 0)));
    const blur = busy > 0.13 ? 6 : busy > 0.09 ? 3 : 0;
    const name = (q) => { if (!q || q.s < 18) return "grey"; const hh = q.h; return hh < 15 || hh >= 345 ? "red" : hh < 40 ? "orange" : hh < 65 ? "gold" : hh < 160 ? "green" : hh < 195 ? "teal" : hh < 250 ? "blue" : hh < 290 ? "violet" : "pink"; };
    return {
        tone, colors, onAccent, surface, glow, pattern: "none", dim, blur,
        summary: `${name(a1)} accent${a2 ? ` with ${name(a2)}` : ""}, ${tone}, ${surface} surface${glow === 2 ? ", intense glow" : glow === 0 ? ", no glow" : ""}`
    };
}
