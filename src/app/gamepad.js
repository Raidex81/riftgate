// Riftgate — controller, TV remote and TV mode (from Riftgate 1.x's
// gamepad-nav.js, rebuilt for this interface).
//
// With an Xbox / PlayStation / Nintendo controller (the browser Gamepad API)
// or a TV remote's arrow keys, a highlight moves between everything you can
// use, picking the nearest item in the direction pressed:
//
//   D-pad / left stick / arrows   move (up/down go row by row)
//   A / OK / Enter                select (a card opens its details, starting
//                                 on its big button: Play, Get it free…)
//   B / Back / Esc                back: close a window, or go to the menu
//   Y / I                         a card's details straight away
//   X / P                         a card's main button straight away
//   LB / RB, CH− / CH+, [ ]       previous / next section
//   LT / RT, Page Up / Down       scroll a screen
//   Right stick                   scroll freely
//   Menu / M                      jump between the menu and the page
//   View / Share / − / Info / F1  the controls screen
//
// TV mode zooms the whole interface (engine "set-tv-mode") so it reads from
// the couch. "With a controller" (default) turns it on while one is
// connected, and back off when it's unplugged.

import { h, icon, clear } from "./dom.js";
import { call, settings, saveSettings } from "./api.js";

const STICK_DEADZONE = .5, FIRST_REPEAT_MS = 380, REPEAT_MS = 115, RIGHT_STICK_SCROLL = 22;
const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const CARD = ".card:not(.skeleton)";
const CANDIDATES = ["button", "a[href]", "select", "input:not([type=hidden]):not([type=radio])", "textarea", "[tabindex]:not([tabindex='-1'])", ".gp-scroll", CARD].join(",");
const SKIP = ".row-arrow, .win-controls *, .row-grip, .gp-hints *, [aria-hidden='true'] *";
// Windows over the page, most important first when several are open
const OVERLAYS = ".gp-controls, .trailer-stage, .account-portal, .interests-portal, .wn-modal, .rift-roll, .today, .palette, .browser, .detail, .account-menu";

export const SCHEMES = {
    xbox: { name: "Xbox", keys: { MOVE: "D-pad / left stick", A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT", RS: "Right stick", MENU: "Menu ☰", VIEW: "View ⧉" } },
    playstation: { name: "PlayStation", keys: { MOVE: "D-pad / left stick", A: "✕", B: "○", X: "□", Y: "△", LB: "L1", RB: "R1", LT: "L2", RT: "R2", RS: "Right stick", MENU: "Options", VIEW: "Create / Share" } },
    nintendo: { name: "Nintendo / other", keys: { MOVE: "D-pad / left stick", A: "B", B: "A", X: "Y", Y: "X", LB: "L", RB: "R", LT: "ZL", RT: "ZR", RS: "Right stick", MENU: "+", VIEW: "−" } },
    remote: { name: "TV remote", keys: { MOVE: "Arrow buttons", A: "OK", B: "Back", X: null, Y: null, LB: "CH −", RB: "CH +", LT: null, RT: null, RS: null, MENU: "Menu", VIEW: "Info" } },
    keyboard: { name: "Keyboard", keys: { MOVE: "Arrow keys", A: "Enter", B: "Esc / Backspace", X: "P", Y: "I", LB: "[", RB: "]", LT: "Page Up", RT: "Page Down", RS: null, MENU: "M", VIEW: "F1 or ?" } }
};
export const CONTROLS = [
    ["MOVE", null, "Move the highlight. Up and down go row by row: to the item right under, or the first item of a shorter row."],
    ["A", null, "Select. On a card: open it, starting on its big button (Play, Get it free, Find tickets…). On a list (country, sort): change it with up/down, select again to confirm."],
    ["B", null, "Back: close a window or the See all list; on the page, go to the menu."],
    ["Y", null, "On a card: its details straight away."],
    ["X", null, "On a card: its main button straight away (Play, Get it free, Find tickets…)."],
    ["LB", "RB", "Previous / next section (Nexus, Free games, Deals…)."],
    ["LT", "RT", "Scroll a whole screen up / down."],
    ["RS", null, "Scroll freely."],
    ["MENU", null, "Jump between the menu and the page."],
    ["VIEW", null, "This controls screen."]
];

let scheme = "xbox", current = null, padConnected = false, tvOn = null, desktopUntilNextPad = false;
let pollHandle = null, heldDirection = null, heldSince = 0, lastRepeat = 0, tvSetting = "auto";
const previousButtons = new Map();
const stage = () => document.getElementById("stage");
const rail = () => document.getElementById("rail");

function schemeForPad(pad) {
    const id = String((pad && pad.id) || "").toLowerCase();
    if (/xbox|045e|xinput/.test(id)) return "xbox"; // "Xbox Wireless Controller" also contains PlayStation's "wireless controller"
    if (/054c|playstation|dualsense|dualshock|wireless controller/.test(id)) return "playstation";
    if (/057e|nintendo|pro controller|joy-con|switch/.test(id)) return "nintendo";
    return "xbox";
}
const keyLabel = (which, other, keys) => { const a = keys[which]; if (!a) return null; return other && keys[other] ? `${a} / ${keys[other]}` : a; };

// ---- Hints bar -----------------------------------------------------------------------
const hints = h("div.gp-hints", { "aria-hidden": "true" });
function renderHints() {
    const keys = SCHEMES[scheme].keys;
    clear(hints);
    [["A", null, "Select"], ["B", null, "Back"], ["Y", null, "Details"], ["X", null, "Play / Get"], ["LB", "RB", "Sections"], ["MENU", null, "Menu"], ["VIEW", null, "Controls"]].forEach(([w, o, label]) => {
        const k = keyLabel(w, o, keys);
        if (k) hints.appendChild(h("span", null, h("b", null, k), label));
    });
}
function setScheme(next) { if (SCHEMES[next] && next !== scheme) { scheme = next; renderHints(); } }

// ---- What can be highlighted -----------------------------------------------------------
function isShown(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.pointerEvents !== "none" && !el.disabled;
}
function activeLayer() {
    const open = [...document.querySelectorAll(OVERLAYS)].filter((o) => isShown(o));
    if (open.length) {
        open.sort((a, b) => (parseInt(getComputedStyle(a).zIndex, 10) || 0) - (parseInt(getComputedStyle(b).zIndex, 10) || 0));
        return open[open.length - 1];
    }
    return document.body;
}
// On the page: the menu and title bar are the "chrome", the stage is content
const isChrome = (el) => !stage().contains(el);

function candidates() {
    const layer = activeLayer();
    const list = [];
    layer.querySelectorAll(CANDIDATES).forEach((el) => {
        if (el.matches(SKIP)) return;
        if (layer === document.body && el.closest(OVERLAYS)) return;
        if (!el.matches(CARD) && el.closest(CARD)) return; // a card is one stop
        if (!isShown(el)) return;
        const r = el.getBoundingClientRect();
        // sideways: on screen, or inside a row that is on screen
        if (!(r.right > 0 && r.left < innerWidth)) {
            const row = el.closest(".row-track");
            if (!row) return;
            const rr = row.getBoundingClientRect();
            if (!(rr.right > 0 && rr.left < innerWidth)) return;
        }
        list.push(el);
    });
    return list;
}

// ---- Moving the highlight ----------------------------------------------------------------
function setCurrent(el, { scroll = true } = {}) {
    if (editingSelect && editingSelect !== el) finishSelectEdit(true);
    if (current && current !== el) current.classList.remove("gp-focus");
    current = el;
    if (!el) return;
    el.classList.add("gp-focus");
    document.body.classList.add("gp-nav");
    if (el.matches("button, a[href], select, input, textarea, [tabindex]")) { try { el.focus({ preventScroll: true }); } catch { /* */ } }
    if (scroll) bringIntoView(el);
}

function bringIntoView(el) {
    const track = el.closest(".row-track");
    if (track && track !== el) {
        const r = el.getBoundingClientRect(), t = track.getBoundingClientRect(), pad = 28;
        if (r.left < t.left + pad) track.scrollBy({ left: r.left - t.left - pad, behavior: "smooth" });
        else if (r.right > t.right - pad) track.scrollBy({ left: r.right - t.right + pad, behavior: "smooth" });
    }
    const layer = activeLayer();
    if (layer !== document.body) { el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); return; }
    if (isChrome(el)) return;
    const s = stage(), sr = s.getBoundingClientRect(), r = el.getBoundingClientRect();
    const topSafe = sr.top + 24, bottomSafe = sr.bottom - (document.body.classList.contains("gp-pad") ? 70 : 24);
    let delta = 0;
    if (r.top < topSafe) delta = r.top - topSafe;
    else if (r.bottom > bottomSafe) delta = r.height > bottomSafe - topSafe ? r.top - topSafe : r.bottom - bottomSafe;
    if (delta) s.scrollBy({ top: delta, behavior: "smooth" });
}

const currentIsValid = () => !!current && isShown(current) && activeLayer().contains(current);

function nearestToViewTop(list) {
    const top = activeLayer() === document.body ? stage().getBoundingClientRect().top : 0;
    let best = null, bestScore = Infinity;
    list.forEach((el) => {
        if (activeLayer() === document.body && isChrome(el)) return;
        const r = el.getBoundingClientRect();
        if (r.bottom < top || r.top > innerHeight) return;
        const score = Math.max(0, r.top - top) * 2 + Math.max(0, r.left);
        if (score < bestScore) { bestScore = score; best = el; }
    });
    return best || list.find((el) => !isChrome(el)) || list[0] || null;
}

// Lists (country, sort…) change on purpose: A opens for changing, arrows pick,
// A confirms, B cancels.
let editingSelect = null, editingOriginal = -1;
function startSelectEdit(sel) { editingSelect = sel; editingOriginal = sel.selectedIndex; sel.classList.add("gp-editing"); }
function finishSelectEdit(confirm) {
    const sel = editingSelect; if (!sel) return;
    editingSelect = null; sel.classList.remove("gp-editing");
    if (!confirm) sel.selectedIndex = editingOriginal;
    else if (sel.selectedIndex !== editingOriginal) sel.dispatchEvent(new Event("change", { bubbles: true }));
}
function stepSelect(sel, d) {
    let i = sel.selectedIndex;
    for (let k = 0; k < sel.options.length; k++) { i += d; if (i < 0 || i >= sel.options.length) return; if (!sel.options[i].disabled) break; }
    if (i >= 0 && i < sel.options.length) sel.selectedIndex = i;
}

function move(direction) {
    if (editingSelect) {
        if (editingSelect.isConnected) { stepSelect(editingSelect, direction === "down" || direction === "right" ? 1 : -1); return; }
        editingSelect = null;
    }
    if (currentIsValid() && current.matches("input[type=range]") && (direction === "left" || direction === "right")) {
        const step = parseFloat(current.step) || 1;
        current.value = String(parseFloat(current.value) + (direction === "right" ? step : -step));
        current.dispatchEvent(new Event("input", { bubbles: true }));
        current.dispatchEvent(new Event("change", { bubbles: true }));
        return;
    }
    const list = candidates();
    if (!currentIsValid()) { setCurrent(nearestToViewTop(list)); return; }

    // a long text scrolls with up/down before the highlight moves on
    if ((direction === "up" || direction === "down") && current.matches(".gp-scroll")) {
        const room = direction === "down" ? current.scrollHeight - current.clientHeight - current.scrollTop : current.scrollTop;
        if (room > 4) { current.scrollBy({ top: (direction === "down" ? 1 : -1) * Math.max(60, current.clientHeight * .7), behavior: "smooth" }); return; }
    }

    const inPage = activeLayer() === document.body;
    const fromChrome = inPage && isChrome(current);
    const from = current.getBoundingClientRect();

    // From the menu, right goes into the page (to what's at the top of the view)
    if (fromChrome && direction === "right" && rail().contains(current)) {
        const target = nearestToViewTop(list.filter((el) => !isChrome(el)));
        if (target) setCurrent(target);
        return;
    }
    if (direction === "up" || direction === "down") {
        const target = verticalTarget(list, direction, from, inPage, fromChrome);
        if (target) setCurrent(target);
        else if (inPage) stage().scrollBy({ top: direction === "down" ? 240 : -240, behavior: "smooth" });
        return;
    }
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best = null, bestScore = Infinity, bestChrome = null, bestChromeScore = Infinity;
    list.forEach((el) => {
        if (el === current || el.contains(current) || current.contains(el)) return;
        const chrome = inPage && isChrome(el);
        if (fromChrome && !chrome) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const primary = direction === "right" ? cx - fx : fx - cx;
        if (direction === "right" ? r.left < from.left + 2 : r.right > from.right - 2) return;
        const secondary = Math.abs(cy - fy);
        const overlap = r.top < from.bottom && r.bottom > from.top;
        if (!chrome && !overlap && secondary > Math.max(from.height, r.height) * .75) return;
        if (primary <= 0) return;
        const score = primary + secondary * (overlap ? .3 : 2.5);
        if (chrome && !fromChrome) { if (direction === "left" && rail().contains(el) && score < bestChromeScore) { bestChromeScore = score; bestChrome = el; } return; }
        if (score < bestScore) { bestScore = score; best = el; }
    });
    // Left from the page's left edge reaches the menu (its current section)
    if (!best && bestChrome) best = rail().querySelector(".nav-item[aria-current='page']") || bestChrome;
    if (best) setCurrent(best);
}

function verticalTarget(list, direction, from, inPage, fromChrome) {
    const down = direction === "down";
    const fromCard = current.matches(CARD);
    const items = [], chromeItems = [];
    list.forEach((el) => {
        if (el === current || el.contains(current) || current.contains(el)) return;
        const chrome = inPage && isChrome(el);
        // inside the menu, up/down stay in the menu; from the page, only up reaches the title bar
        if (fromChrome && rail().contains(current) && !rail().contains(el)) return;
        if (!fromChrome && chrome && (down || rail().contains(el))) return;
        const r = el.getBoundingClientRect();
        if (down ? r.top < from.top + from.height * .5 : r.bottom > from.bottom - from.height * .5) return;
        (chrome && !fromChrome ? chromeItems : items).push({ el, r });
    });
    const pick = (group) => {
        if (!group.length) return null;
        const edge = (i) => (down ? i.r.top : i.r.bottom);
        let ref = group[0];
        group.forEach((i) => { if (down ? edge(i) < edge(ref) : edge(i) > edge(ref)) ref = i; });
        const tol = Math.max(24, ref.r.height * .5);
        const line = group.filter((i) => (down ? edge(i) <= edge(ref) + tol : edge(i) >= edge(ref) - tol));
        let best = null, bestOverlap = 0;
        line.forEach((i) => { const o = Math.min(i.r.right, from.right) - Math.max(i.r.left, from.left); if (o > bestOverlap) { bestOverlap = o; best = i; } });
        if (!best) best = line.reduce((a, b) => (b.r.left < a.r.left ? b : a));
        return best.el;
    };
    // down from a card goes straight to the next row's cards (skipping its heading buttons)
    if (down && fromCard) { const next = pick(items.filter((i) => i.el.matches(CARD))); if (next) return next; }
    return pick(items) || pick(chromeItems);
}

// ---- Actions -----------------------------------------------------------------------------
function activate() {
    if (editingSelect && editingSelect !== current) finishSelectEdit(true);
    if (!currentIsValid()) { move("down"); return; }
    const el = current;
    if (el.tagName === "SELECT") { if (editingSelect === el) finishSelectEdit(true); else startSelectEdit(el); return; }
    if (el.matches("input:not([type=checkbox]), textarea")) { el.focus(); if (el.select) el.select(); return; }
    el.click();
}

// When something opens a window, the highlight starts inside it (a long
// text, else its big button, else its first item); closing it returns.
const returnStack = [];
function focusNewLayerSoon(previous) {
    const from = current;
    setTimeout(() => {
        const layer = activeLayer();
        if (layer === previous || layer === document.body || (current && layer.contains(current) && isShown(current))) return;
        if (from) { returnStack.push({ layer, el: from }); if (returnStack.length > 20) returnStack.shift(); }
        const list = candidates();
        const text = list.find((el) => el.matches(".gp-scroll") && el.scrollHeight > el.clientHeight + 4);
        const main = list.find((el) => el.matches(".btn.primary"));
        setCurrent(text || main || list.find((el) => !el.matches("[aria-label='Close']")) || list[0] || null);
    }, 380);
}
function openDetails() {
    const card = currentIsValid() && current.matches(CARD) ? current : null;
    if (card) card.click(); else activate();
}
function primaryAction() {
    if (!currentIsValid()) { activate(); return; }
    if (current.matches(CARD)) {
        current.click();
        // the detail panel builds its buttons as it opens
        setTimeout(() => { const b = document.querySelector(".detail .detail-actions .btn.primary"); if (b) b.click(); }, 260);
        return;
    }
    const layer = activeLayer();
    const main = layer !== document.body ? [...layer.querySelectorAll(".btn.primary")].find(isShown) : null;
    (main || current).click();
}
function back() {
    if (editingSelect) { finishSelectEdit(false); return; }
    const layer = activeLayer();
    if (layer !== document.body) {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        setTimeout(() => {
            if (activeLayer() === layer && layer.isConnected && isShown(layer)) {
                const closer = [...layer.querySelectorAll("[aria-label='Close'], [aria-label='Close trailer'], .today-close")].find(isShown);
                if (closer) closer.click();
            }
            setTimeout(() => {
                while (returnStack.length) {
                    const b = returnStack.pop();
                    if (b.el.isConnected && isShown(b.el) && activeLayer().contains(b.el)) { setCurrent(b.el, { scroll: false }); return; }
                }
            }, 120);
        }, 60);
        return;
    }
    if (current && rail().contains(current)) { const t = nearestToViewTop(candidates().filter((el) => !isChrome(el))); if (t) setCurrent(t); return; }
    const nav = rail().querySelector(".nav-item[aria-current='page']");
    if (nav) setCurrent(nav);
}
function switchSectionBy(d) {
    const tabs = [...rail().querySelectorAll(".nav .nav-item")].filter(isShown);
    if (!tabs.length) return;
    const i = tabs.findIndex((t) => t.getAttribute("aria-current") === "page");
    const next = tabs[(i + d + tabs.length) % tabs.length];
    next.click();
    setCurrent(next, { scroll: false });
    // land on the new page's first item once it has drawn
    setTimeout(() => { const t = nearestToViewTop(candidates().filter((el) => !isChrome(el))); if (t && activeLayer() === document.body) setCurrent(t); }, 700);
}
function scrollScreen(dir) {
    const layer = activeLayer();
    const box = layer === document.body ? stage() : (layer.querySelector(".browser-body") || layer);
    box.scrollBy({ top: dir * box.clientHeight * .8, behavior: "smooth" });
    setTimeout(() => {
        const list = candidates().filter((el) => layer !== document.body || !isChrome(el));
        let best = null, bestD = Infinity;
        list.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.bottom < 80 || r.top > innerHeight) return;
            const d = Math.abs(r.top + r.height / 2 - innerHeight / 2) + Math.max(0, r.left) * .2;
            if (d < bestD) { bestD = d; best = el; }
        });
        if (best) setCurrent(best, { scroll: false });
    }, 420);
}
function toggleMenu() {
    if (current && rail().contains(current)) back();
    else { const nav = rail().querySelector(".nav-item[aria-current='page']") || rail().querySelector(".nav-item"); if (nav) setCurrent(nav); }
}

// ---- TV mode -------------------------------------------------------------------------------
export function tvMode() { return tvSetting; }
export async function setTvMode(v) {
    tvSetting = v === "on" || v === "off" ? v : "auto";
    await saveSettings({ tvMode: tvSetting });
    applyTvMode();
}
function applyTvMode() {
    const wanted = !desktopUntilNextPad && (tvSetting === "on" || (tvSetting === "auto" && padConnected));
    if (wanted === tvOn) return;
    tvOn = wanted;
    document.body.classList.toggle("tv-mode", wanted);
    call("set-tv-mode", wanted);
}

// ---- Controller polling ------------------------------------------------------------------------
const pads = () => [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
function directionFrom(pad) {
    const p = (i) => pad.buttons[i] && pad.buttons[i].pressed;
    if (p(BUTTON.UP)) return "up"; if (p(BUTTON.DOWN)) return "down"; if (p(BUTTON.LEFT)) return "left"; if (p(BUTTON.RIGHT)) return "right";
    const x = pad.axes[0] || 0, y = pad.axes[1] || 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEADZONE) return null;
    return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
}
function onButton(i) {
    document.body.classList.add("gp-nav");
    const before = activeLayer();
    switch (i) {
        case BUTTON.A: activate(); focusNewLayerSoon(before); break;
        case BUTTON.B: back(); break;
        case BUTTON.X: primaryAction(); focusNewLayerSoon(before); break;
        case BUTTON.Y: openDetails(); focusNewLayerSoon(before); break;
        case BUTTON.LB: switchSectionBy(-1); break;
        case BUTTON.RB: switchSectionBy(1); break;
        case BUTTON.LT: scrollScreen(-1); break;
        case BUTTON.RT: scrollScreen(1); break;
        case BUTTON.MENU: toggleMenu(); break;
        case BUTTON.VIEW: toggleControls(); break;
        default: break;
    }
}
function poll(now) {
    const list = pads();
    if (!list.length) { pollHandle = null; return; }
    let direction = null;
    list.forEach((pad) => {
        const before = previousButtons.get(pad.index) || [];
        const pressed = pad.buttons.map((b) => b.pressed);
        pressed.forEach((down, i) => { if (down && !before[i] && i !== BUTTON.UP && i !== BUTTON.DOWN && i !== BUTTON.LEFT && i !== BUTTON.RIGHT) onButton(i); });
        previousButtons.set(pad.index, pressed);
        direction = direction || directionFrom(pad);
        const ry = pad.axes[3] || 0;
        if (Math.abs(ry) > .3) { const layer = activeLayer(); (layer === document.body ? stage() : (layer.querySelector(".browser-body") || layer)).scrollBy(0, ry * RIGHT_STICK_SCROLL); }
    });
    if (direction) {
        if (direction !== heldDirection) { heldDirection = direction; heldSince = now; lastRepeat = now; move(direction); }
        else if (now - heldSince > FIRST_REPEAT_MS && now - lastRepeat > REPEAT_MS) { lastRepeat = now; move(direction); }
    } else heldDirection = null;
    pollHandle = requestAnimationFrame(poll);
}
const startPolling = () => { if (!pollHandle) pollHandle = requestAnimationFrame(poll); };

function clearHighlight() {
    document.body.classList.remove("gp-nav");
    if (current) current.classList.remove("gp-focus");
    current = null;
}

// ---- Controls screen -----------------------------------------------------------------------------
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, text) { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (text != null) e.textContent = text; return e; }
// A plain, generic outline (not any brand's shape) with each button's name
// for the chosen controller in its place.
function diagram(kind) {
    const k = SCHEMES[kind].keys;
    if (kind === "keyboard") return null;
    const T = (x, y, t, cls) => svg("text", { x, y, class: cls, "text-anchor": "middle" }, t);
    if (kind === "remote") {
        const s = svg("svg", { viewBox: "0 0 200 250", class: "cd-svg", "aria-hidden": "true" });
        s.append(svg("rect", { x: 55, y: 8, width: 90, height: 234, rx: 40, class: "cd-body" }), svg("circle", { cx: 100, cy: 92, r: 36, class: "cd-part" }),
            svg("circle", { cx: 100, cy: 92, r: 15, class: "cd-key cd-main" }), T(100, 97, k.A, "cd-key-label"),
            T(100, 68, "▲", "cd-arrow"), T(100, 124, "▼", "cd-arrow"), T(75, 97, "◀", "cd-arrow"), T(125, 97, "▶", "cd-arrow"),
            svg("rect", { x: 66, y: 142, width: 30, height: 18, rx: 8, class: "cd-key" }), T(81, 155, k.B, "cd-small"),
            svg("rect", { x: 104, y: 142, width: 30, height: 18, rx: 8, class: "cd-key" }), T(119, 155, k.MENU, "cd-small"),
            svg("rect", { x: 66, y: 170, width: 30, height: 18, rx: 8, class: "cd-key" }), T(81, 183, k.RB, "cd-small"),
            svg("rect", { x: 66, y: 194, width: 30, height: 18, rx: 8, class: "cd-key" }), T(81, 207, k.LB, "cd-small"),
            svg("rect", { x: 104, y: 170, width: 30, height: 18, rx: 8, class: "cd-key" }), T(119, 183, k.VIEW, "cd-small"), T(100, 36, "TV remote", "cd-title"));
        return s;
    }
    const s = svg("svg", { viewBox: "0 0 440 250", class: "cd-svg", "aria-hidden": "true" });
    s.append(
        svg("path", { d: "M120 58 H320 C372 58 402 92 414 148 C426 204 404 236 374 236 C350 236 336 218 322 198 L300 170 H140 L118 198 C104 218 90 236 66 236 C36 236 14 204 26 148 C38 92 68 58 120 58 Z", class: "cd-body" }),
        svg("rect", { x: 74, y: 30, width: 86, height: 20, rx: 9, class: "cd-key" }), T(117, 44, k.LB, "cd-small"),
        svg("rect", { x: 80, y: 6, width: 74, height: 20, rx: 9, class: "cd-part" }), T(117, 20, k.LT, "cd-small"),
        svg("rect", { x: 280, y: 30, width: 86, height: 20, rx: 9, class: "cd-key" }), T(323, 44, k.RB, "cd-small"),
        svg("rect", { x: 286, y: 6, width: 74, height: 20, rx: 9, class: "cd-part" }), T(323, 20, k.RT, "cd-small"),
        svg("path", { d: "M96 98 h18 v-18 h18 v18 h18 v18 h-18 v18 h-18 v-18 h-18 z", class: "cd-key" }), T(123, 150, "D-pad", "cd-small"),
        svg("circle", { cx: 170, cy: 152, r: 22, class: "cd-part" }), T(170, 156, "L stick", "cd-small"),
        svg("circle", { cx: 270, cy: 152, r: 22, class: "cd-part" }), T(270, 156, "R stick", "cd-small"),
        svg("rect", { x: 178, y: 92, width: 34, height: 18, rx: 9, class: "cd-key" }), T(195, 105, k.VIEW.split(" ")[0], "cd-tiny"),
        svg("rect", { x: 228, y: 92, width: 34, height: 18, rx: 9, class: "cd-key" }), T(245, 105, k.MENU.split(" ")[0], "cd-tiny"),
        svg("circle", { cx: 330, cy: 80, r: 15, class: "cd-key" }), T(330, 85, k.Y, "cd-key-label"),
        svg("circle", { cx: 302, cy: 108, r: 15, class: "cd-key" }), T(302, 113, k.X, "cd-key-label"),
        svg("circle", { cx: 358, cy: 108, r: 15, class: "cd-key" }), T(358, 113, k.B, "cd-key-label"),
        svg("circle", { cx: 330, cy: 136, r: 15, class: "cd-key cd-main" }), T(330, 141, k.A, "cd-key-label"));
    return s;
}


// ---- The controller layout: the real controller, every button labelled ---------------------
// Positions are pixels on the photo (assets/controllers/*.png). Each label
// sits in a column beside the controller, joined to its button by a line.
const PHOTOS = {
    xbox: { src: "assets/controllers/xbox.png", w: 428, h: 385,
        at: { LT: [118, 30], LB: [92, 50], VIEW: [183, 107], LS: [105, 105], DPAD: [160, 175], RT: [312, 30], RB: [338, 50], MENU: [245, 107], Y: [325, 78], X: [293, 107], B: [350, 107], A: [322, 134], RS: [270, 170] } },
    playstation: { src: "assets/controllers/playstation.png", w: 495, h: 493,
        at: { LT: [95, 92], LB: [100, 110], VIEW: [132, 126], LS: [170, 247], DPAD: [95, 182], RT: [398, 92], RB: [395, 110], MENU: [361, 126], Y: [398, 146], X: [370, 182], B: [433, 182], A: [398, 216], RS: [325, 247] } }
};
const LAYOUT = {
    left: [["LT", "Scroll a screen up"], ["LB", "Previous section"], ["VIEW", "Controls (this screen)"], ["LS", "Move the highlight"], ["DPAD", "Move, row by row"]],
    right: [["RT", "Scroll a screen down"], ["RB", "Next section"], ["MENU", "Menu ↔ page"], ["Y", "Details"], ["X", "Play / Get it free"], ["B", "Back / close"], ["A", "Select / open"], ["RS", "Scroll freely"]]
};
// Face-button colours, as printed on the controllers
const FACE = { xbox: { A: "#3ab14a", B: "#e3342f", X: "#2f78d6", Y: "#f2b705" }, playstation: { A: "#7b9cf2", B: "#ef6b75", X: "#e58bd8", Y: "#3fc9a8" } };
const GLYPH = { LS: "L stick", RS: "R stick", DPAD: "D-pad" };

const SHORT = { playstation: { VIEW: "Create", MENU: "Options" }, xbox: { VIEW: "View ⧉", MENU: "Menu ☰" } };

function photoLayout(kind) {
    const ph = PHOTOS[kind];
    if (!ph) return null;
    const keys = SCHEMES[kind].keys;
    const W = 1300, H = 700, boxW = 330, boxH = 40, top = 104, bottom = 30;
    const scale = Math.min(540 / ph.w, 500 / ph.h);
    const iw = ph.w * scale, ih = ph.h * scale, ix = (W - iw) / 2, iy = top + (H - top - bottom - ih) / 2;
    const toSvg = ([x, y]) => [ix + x * scale, iy + y * scale];
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "cl-svg", role: "img", "aria-label": `${SCHEMES[kind].name} controller: what each button does in Riftgate` });
    root.append(svg("rect", { x: 0, y: 0, width: W, height: H, rx: 18, class: "cl-panel" }),
        svg("text", { x: W / 2, y: 48, class: "cl-title", "text-anchor": "middle" }, `${SCHEMES[kind].name.toUpperCase()} CONTROLLER`),
        svg("text", { x: W / 2, y: 74, class: "cl-sub", "text-anchor": "middle" }, "What each button does in Riftgate"));
    const img = svg("image", { x: ix, y: iy, width: iw, height: ih, preserveAspectRatio: "xMidYMid meet" });
    img.setAttribute("href", ph.src);
    root.appendChild(img);
    const lines = svg("g", { class: "cl-lines" });
    const labels = svg("g");
    const column = (side, list) => {
        // top to bottom in the order of the buttons' height (then outward first), so no lines cross
        const items = list.map(([k, what]) => ({ k, what, a: toSvg(ph.at[k]) }))
            .sort((p, q) => p.a[1] - q.a[1] || (side === "left" ? p.a[0] - q.a[0] : q.a[0] - p.a[0]));
        const step = (H - top - bottom - boxH) / Math.max(1, items.length - 1);
        items.forEach((it, i) => {
            const by = items.length === 1 ? (H - boxH) / 2 : top + i * Math.min(step, boxH + 26) + Math.max(0, (H - top - bottom - boxH - (items.length - 1) * Math.min(step, boxH + 26)) / 2);
            const cy = by + boxH / 2;
            const bx = side === "left" ? 28 : W - 28 - boxW;
            const [ax, ay] = it.a;
            const edge = side === "left" ? bx + boxW : bx;
            const stub = side === "left" ? edge + 26 : edge - 26;
            lines.append(svg("polyline", { points: `${edge},${cy} ${stub},${cy} ${ax},${ay}`, class: "cl-line" }),
                svg("circle", { cx: ax, cy: ay, r: 5.5, class: "cl-dot" }), svg("circle", { cx: ax, cy: ay, r: 12, class: "cl-ring" }));
            const g = svg("g", { class: "cl-label" });
            g.append(svg("rect", { x: bx, y: by, width: boxW, height: boxH, rx: 8, class: "cl-box" }));
            const name = GLYPH[it.k] || (SHORT[kind] && SHORT[kind][it.k]) || keys[it.k] || it.k;
            const face = FACE[kind] && FACE[kind][it.k];
            const round = name.length <= 2;
            const badgeW = round ? 30 : Math.max(44, name.length * 8.4 + 16);
            const bxBadge = side === "left" ? bx + boxW - badgeW - 6 : bx + 6;
            g.append(svg("rect", { x: bxBadge, y: by + 5, width: badgeW, height: boxH - 10, rx: round ? 15 : 7, class: "cl-badge", style: face ? `fill:${face}` : "" }),
                svg("text", { x: bxBadge + badgeW / 2, y: by + boxH / 2 + 5, class: "cl-badge-text", "text-anchor": "middle" }, name));
            const tx = side === "left" ? bxBadge - 12 : bxBadge + badgeW + 12;
            g.append(svg("text", { x: tx, y: by + boxH / 2 + 5.5, class: "cl-text", "text-anchor": side === "left" ? "end" : "start" }, it.what.toUpperCase()));
            labels.appendChild(g);
        });
    };
    column("left", LAYOUT.left);
    column("right", LAYOUT.right);
    root.append(lines, labels);
    return root;
}

let controlsEl = null;
export function toggleControls(open) {
    const willOpen = typeof open === "boolean" ? open : !controlsEl;
    if (!willOpen) { if (controlsEl) { controlsEl.remove(); controlsEl = null; } return; }
    if (controlsEl) return;
    let helpScheme = scheme;
    const tabs = h("div.controls-tabs", { role: "tablist" });
    const dia = h("div.controls-diagram");
    const table = h("table.controls-table");
    const paint = () => {
        clear(tabs);
        Object.entries(SCHEMES).forEach(([kind, info]) => tabs.appendChild(h("button.chip", { type: "button", role: "tab", "aria-pressed": String(kind === helpScheme), "aria-selected": String(kind === helpScheme),
            onclick: () => { helpScheme = kind; paint(); const t = tabs.querySelector("[aria-pressed='true']"); if (document.body.classList.contains("gp-nav") && t) setCurrent(t, { scroll: false }); } }, info.name)));
        clear(dia); const d = photoLayout(helpScheme) || diagram(helpScheme); if (d) dia.appendChild(d);
        controlsEl && controlsEl.classList.toggle("has-photo", !!PHOTOS[helpScheme]);
        clear(table);
        const keys = SCHEMES[helpScheme].keys;
        const body = h("tbody");
        CONTROLS.forEach(([w, o, what]) => { const k = keyLabel(w, o, keys); if (k) body.appendChild(h("tr", null, h("td", null, h("b", null, k)), h("td", null, what))); });
        if (helpScheme === "remote") body.appendChild(h("tr", null, h("td.controls-row-note", { colspan: "2" }, "No Y / X on a remote: select a card (OK) and pick Play, Trailer or anything else inside it.")));
        table.appendChild(body);
    };
    paint();
    controlsEl = h("div.gp-controls", { role: "dialog", "aria-modal": "true", "aria-label": "Controller and remote controls", onclick: (e) => { if (e.target === controlsEl) toggleControls(false); } },
        h("div.wn-box.controls-box", null,
            h("div.wn-head", null, h("h2", null, "Controller & remote controls"), h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => toggleControls(false) }, icon("x"))),
            h("p.muted", null, "Riftgate recognises your controller by itself. Pick a type to see its buttons."),
            tabs, dia, table,
            h("p.muted.controls-note", null, "TV mode (everything bigger) turns on while a controller is connected and off when it's unplugged. Change it in Settings → TV mode.")));
    controlsEl.classList.toggle("has-photo", !!PHOTOS[helpScheme]);
    document.body.appendChild(controlsEl);
    const t = tabs.querySelector("[aria-pressed='true']");
    if (document.body.classList.contains("gp-nav") && t) setCurrent(t, { scroll: false });
}

// ---- Start ----------------------------------------------------------------------------------------
export async function start() {
    document.body.appendChild(hints);
    renderHints();
    const s = await settings();
    tvSetting = s.tvMode === "on" || s.tvMode === "off" ? s.tvMode : "auto";

    window.addEventListener("gamepadconnected", (e) => {
        padConnected = true; desktopUntilNextPad = false;
        setScheme(schemeForPad(e.gamepad));
        document.body.classList.add("gp-pad");
        applyTvMode(); startPolling();
    });
    // unplugged: back to desktop (normal size, no highlight, the mouse in charge)
    window.addEventListener("gamepaddisconnected", () => {
        padConnected = pads().length > 0;
        if (padConnected) return;
        desktopUntilNextPad = true;
        document.body.classList.remove("gp-pad");
        if (editingSelect) finishSelectEdit(false);
        clearHighlight();
        applyTvMode();
    });

    const KEY_DIR = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const navOn = () => tvOn || padConnected || document.body.classList.contains("gp-nav");
    document.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const typing = e.target && e.target.matches && e.target.matches("input:not([type=range]):not([type=checkbox]), textarea, [contenteditable]");
        // F1 / ? / Info open the controls screen any time
        if (!typing && (e.key === "F1" || e.key === "?" || e.key === "Info")) { e.preventDefault(); toggleControls(); return; }
        if (!navOn()) return;
        const dir = KEY_DIR[e.key];
        if (dir) {
            if (typing && (dir === "left" || dir === "right")) return;
            e.preventDefault(); e.stopImmediatePropagation();
            if (!padConnected) setScheme(tvOn ? "remote" : "keyboard");
            move(dir); return;
        }
        if (e.key === "Enter" && !typing && currentIsValid()) { e.preventDefault(); e.stopImmediatePropagation(); const before = activeLayer(); activate(); focusNewLayerSoon(before); return; }
        if (!typing) {
            const k = e.key; let handled = true;
            const before = activeLayer();
            if (k === "ChannelUp" || k === "]") switchSectionBy(1);
            else if (k === "ChannelDown" || k === "[") switchSectionBy(-1);
            else if (k === "PageDown") scrollScreen(1);
            else if (k === "PageUp") scrollScreen(-1);
            else if (k === "ContextMenu" || k === "m" || k === "M") toggleMenu();
            else if (k === "p" || k === "P") { primaryAction(); focusNewLayerSoon(before); }
            else if (k === "i" || k === "I") { openDetails(); focusNewLayerSoon(before); }
            else handled = false;
            if (handled) { e.preventDefault(); e.stopImmediatePropagation(); document.body.classList.add("gp-nav"); if (!padConnected) setScheme(tvOn ? "remote" : "keyboard"); return; }
        }
        if ((e.key === "Backspace" || e.key === "BrowserBack" || e.key === "GoBack") && !typing) { e.preventDefault(); back(); return; }
        if (e.key === "Escape" && editingSelect) { e.preventDefault(); e.stopImmediatePropagation(); finishSelectEdit(false); return; }
        if (e.key === "Escape" && controlsEl) { e.preventDefault(); e.stopImmediatePropagation(); toggleControls(false); }
    }, true);

    // The mouse takes over again as soon as it moves
    let lastMouse = null;
    document.addEventListener("mousemove", (e) => {
        const pos = `${e.screenX},${e.screenY}`;
        if (lastMouse !== null && lastMouse !== pos && current) clearHighlight();
        lastMouse = pos;
    }, { passive: true });

    if (pads().length) { padConnected = true; document.body.classList.add("gp-pad"); startPolling(); }
    applyTvMode();
}

// For tests and the Settings page
export const pad = { move, activate, back, primaryAction, openDetails, switchSectionBy, toggleMenu, onButton, setScheme, get current() { return current; }, activeLayer, candidates };
