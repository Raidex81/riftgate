// Controller and TV-remote navigation for Riftgate, plus TV mode.
//
// With an Xbox / PlayStation / generic controller (the browser Gamepad API)
// or a TV remote's arrow keys, a highlight moves between everything that can
// be used on screen — section tabs, buttons, lists, cards — picking the
// nearest item in the direction pressed:
//
//   D-pad / left stick / arrow keys   move the highlight (up/down row by row)
//   A / OK / Enter                     select; on a card, open its options
//                                      (Details, Trailer, Sound, Play/Get…)
//   B / Back / Esc                     back: leave a card, close a window/panel
//   Y                                  a card's details straight away
//   X                                  a card's main button (Play, Get, Tickets…)
//   LB / RB                            previous / next section
//   LT / RT                            scroll a screen up / down (right stick scrolls too)
//   ☰ Menu (Start)                     open / close the side panel (settings)
//   ⧉ View (Back)                      the controls screen (per controller type)
//
// The full table for each kind of controller (Xbox, PlayStation, Nintendo,
// TV remote, keyboard) is in CONTROLS below; the controls screen and the
// hints bar are built from it.
//
// TV mode zooms the whole interface (main.js "set-tv-mode") so it reads from
// the couch. "With a controller" (the default) turns it on while a
// controller is connected.
//
// Loaded after renderer.js and uses its globals (settings, saveSetting,
// switchSection, closeSeeAll, endTour, tourActive).
(function () {
    "use strict";

    const STICK_DEADZONE = 0.5;
    const FIRST_REPEAT_MS = 380;
    const REPEAT_MS = 115;
    const RIGHT_STICK_SCROLL = 22; // px per frame at full tilt

    const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

    // One stop per card: the parts inside a card are reached with A / X.
    const CARD_SELECTOR = ".game-card, .recent-episode-card, .community-app-card";
    const CANDIDATE_SELECTOR = [
        "button", "a[href]", "select", "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
        "textarea", "label.sidebar-toggle", "[tabindex]:not([tabindex='-1'])", CARD_SELECTOR
    ].join(",");
    // Arrows beside a sideways row are skipped: moving past the last visible
    // card scrolls the row by itself.
    const SKIP_SELECTOR = ".carousel-arrow, .startup-overlay *, .custom-titlebar *, .titlebar-hover-zone";

    let current = null;
    let padConnected = false;
    let tvOn = null; // unknown until the first applyTvMode, which always sets the zoom
    // Unplugging the controller goes back to desktop mode, even with TV mode
    // set to "Always on", until a controller is used again.
    let desktopUntilNextPad = false;
    let pollHandle = null;
    const previousButtons = new Map(); // gamepad index -> pressed[]
    let heldDirection = null;
    let heldSince = 0;
    let lastRepeat = 0;

    const sideBar = document.getElementById("sideBar");
    const tvModeSelect = document.getElementById("tvModeSelect");

    // --- Controller types and what each button does ---------------------------------
    // Buttons are named by position (the browser's standard mapping), so the
    // labels differ per brand: the bottom face button is A on Xbox, ✕ on
    // PlayStation and B on Nintendo.
    const SCHEMES = {
        xbox: { name: "Xbox", keys: { MOVE: "D-pad / left stick", A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT", RS: "Right stick", MENU: "Menu ☰", VIEW: "View ⧉" } },
        playstation: { name: "PlayStation", keys: { MOVE: "D-pad / left stick", A: "✕", B: "○", X: "□", Y: "△", LB: "L1", RB: "R1", LT: "L2", RT: "R2", RS: "Right stick", MENU: "Options", VIEW: "Create / Share" } },
        nintendo: { name: "Nintendo / other", keys: { MOVE: "D-pad / left stick", A: "B", B: "A", X: "Y", Y: "X", LB: "L", RB: "R", LT: "ZL", RT: "ZR", RS: "Right stick", MENU: "+", VIEW: "−" } },
        remote: { name: "TV remote", keys: { MOVE: "Arrow buttons", A: "OK", B: "Back", X: null, Y: null, LB: "CH −", RB: "CH +", LT: null, RT: null, RS: null, MENU: "Menu", VIEW: "Info" } },
        keyboard: { name: "Keyboard", keys: { MOVE: "Arrow keys", A: "Enter", B: "Esc / Backspace", X: "P", Y: "I", LB: "[", RB: "]", LT: "Page Up", RT: "Page Down", RS: null, MENU: "M", VIEW: "F1 or ?" } }
    };
    const CONTROLS = [
        ["MOVE", null, "Move the highlight. Up and down go row by row: to the item right under, or the first item of a shorter row."],
        ["A", null, "Select. On a card: open its options — Details, ▶ Trailer, 🔊 Sound on/off, Play / Get / Tickets and the rest. On a list (country, city, sort): change it with up/down, select again to confirm."],
        ["B", null, "Back: leave a card's options, close a window, the side panel or the See all list."],
        ["Y", null, "On a card: its details straight away."],
        ["X", null, "On a card: its main button straight away (Play, Get it free, Find tickets…)."],
        ["LB", "RB", "Previous / next section (New, Installed, Free Games…)."],
        ["LT", "RT", "Scroll a whole screen up / down."],
        ["RS", null, "Scroll freely."],
        ["MENU", null, "Open / close the side panel (settings, region, TV mode)."],
        ["VIEW", null, "This controls screen."]
    ];
    let scheme = "xbox";

    function schemeForPad(pad) {
        const id = String((pad && pad.id) || "").toLowerCase();
        if (/054c|playstation|dualsense|dualshock|wireless controller/.test(id)) return "playstation";
        if (/057e|nintendo|pro controller|joy-con|switch/.test(id)) return "nintendo";
        return "xbox";
    }

    function keyLabel(which, other, keys) {
        const a = keys[which];
        if (!a) return null;
        return other && keys[other] ? `${a} / ${keys[other]}` : a;
    }

    // --- Hints bar ----------------------------------------------------------
    const hints = document.createElement("div");
    hints.className = "gp-hints";
    hints.setAttribute("aria-hidden", "true");
    document.body.appendChild(hints);

    function renderHints() {
        const keys = SCHEMES[scheme].keys;
        hints.textContent = "";
        [["A", null, "Select"], ["B", null, "Back"], ["Y", null, "Details"], ["X", null, "Play / Get"], ["LB", "RB", "Sections"], ["MENU", null, "Menu"], ["VIEW", null, "Controls"]].forEach(([which, other, label]) => {
            const key = keyLabel(which, other, keys);
            if (!key) return;
            const item = document.createElement("span");
            const badge = document.createElement("b");
            badge.textContent = key;
            item.appendChild(badge);
            item.appendChild(document.createTextNode(label));
            hints.appendChild(item);
        });
    }

    function setScheme(next) {
        if (!SCHEMES[next] || next === scheme) return;
        scheme = next;
        renderHints();
    }
    renderHints();

    // --- What can be highlighted right now -------------------------------------
    function isShown(el) {
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.pointerEvents === "none") return false;
        if (el.disabled) return false;
        return true;
    }

    // The part of the screen that currently takes input: the tour, an open
    // window, the "See all" panel, the side panel, or else the page itself.
    function activeLayer() {
        const tourGroup = document.getElementById("tourOverlayGroup");
        if (typeof tourActive !== "undefined" && tourActive && tourGroup) {
            const tooltip = document.getElementById("tourTooltip");
            if (tooltip && isShown(tooltip)) return tooltip;
        }
        const modals = Array.from(document.querySelectorAll(".modal-overlay.active")).filter((m) => getComputedStyle(m).display !== "none");
        if (modals.length) {
            modals.sort((a, b) => (parseInt(getComputedStyle(a).zIndex, 10) || 0) - (parseInt(getComputedStyle(b).zIndex, 10) || 0));
            return modals[modals.length - 1];
        }
        if (insideCard) {
            if (insideCard.isConnected && isShown(insideCard)) return insideCard;
            leaveCard(false);
        }
        const seeAll = document.getElementById("seeAllOverlay");
        if (seeAll && !seeAll.hidden) return seeAll;
        if (sideBar && sideBar.classList.contains("gp-open")) return sideBar;
        return document.body;
    }

    // --- Inside a card: its own options ---------------------------------------------
    // A (OK) on a card moves the highlight into it: the cover (= Details),
    // ▶ trailer, 🔊 sound, ★ favourite and every button on the card. B leaves.
    let insideCard = null;

    function enterCard(card) {
        insideCard = card;
        card.classList.add("gp-inside", "gp-show");
        const first = card.querySelector(".cover-img");
        const list = candidates();
        setCurrent(first && list.includes(first) ? first : list[0] || card);
    }

    function leaveCard(focusCard = true) {
        const card = insideCard;
        insideCard = null;
        if (!card) return;
        card.classList.remove("gp-inside");
        if (focusCard && card.isConnected) setCurrent(card);
        else card.classList.remove("gp-show");
    }

    function horizontallyReachable(el, rect) {
        if (rect.right > 0 && rect.left < window.innerWidth) return true;
        // Off to the side inside a sideways row that is itself on screen.
        const row = el.closest(".carousel-track, .hscroll-row");
        if (!row) return false;
        const rowRect = row.getBoundingClientRect();
        return rowRect.right > 0 && rowRect.left < window.innerWidth;
    }

    // Cards past the fold of a folded grid ("▾ See more") are out of sight.
    function hiddenByFold(el, rect) {
        const fold = el.closest(".grid-collapsed");
        if (!fold) return false;
        const box = fold.getBoundingClientRect();
        return rect.top >= box.bottom - 2 || rect.bottom <= box.top + 2;
    }

    function candidates() {
        const layer = activeLayer();
        const list = [];
        const insideThisCard = layer === insideCard;
        layer.querySelectorAll(insideThisCard ? `${CANDIDATE_SELECTOR}, .cover-img` : CANDIDATE_SELECTOR).forEach((el) => {
            if (el.matches(SKIP_SELECTOR)) return;
            if (layer === document.body) {
                if (sideBar && sideBar.contains(el)) return;
                if (el.closest(".modal-overlay, #seeAllOverlay, #tourOverlayGroup")) return;
            }
            // Parts of a card are reached through the card itself.
            const card = el.matches(CARD_SELECTOR) ? null : el.closest(CARD_SELECTOR);
            if (card && card !== layer) return;
            if (el.matches("label.sidebar-toggle") === false && el.closest("label.sidebar-toggle")) return;
            if (!isShown(el)) return;
            const rect = el.getBoundingClientRect();
            if (!horizontallyReachable(el, rect)) return;
            if (hiddenByFold(el, rect)) return;
            list.push(el);
        });
        return list;
    }

    // --- Moving the highlight --------------------------------------------------
    function setCurrent(el, { scroll = true } = {}) {
        if (editingSelect && editingSelect !== el) finishSelectEdit(true);
        if (current && current !== el) current.classList.remove("gp-focus");
        const oldCard = current ? current.closest(CARD_SELECTOR) : null;
        const newCard = el ? el.closest(CARD_SELECTOR) : null;
        if (oldCard && oldCard !== newCard) oldCard.classList.remove("gp-show", "gp-inside");
        current = el;
        if (!el) return;
        el.classList.add("gp-focus");
        // A highlighted card looks hovered: its trailer, sound and other
        // buttons show, and the background follows it like with the mouse.
        if (newCard && newCard !== oldCard) {
            newCard.classList.add("gp-show");
            newCard.dispatchEvent(new MouseEvent("mouseenter"));
        }
        document.body.classList.add("gp-nav");
        if (el.matches("button, a[href], select, input, textarea, [tabindex]")) {
            try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
        } else if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        if (scroll) bringIntoView(el);
    }

    // Pinned = inside something that stays put while the page scrolls (the
    // section tabs, the Login button and the icons beside it, the ticker).
    // Content scrolls underneath them, so a card can sit behind them on
    // screen; they must never be mistaken for the card's neighbours.
    const pinnedCache = new WeakMap();
    function isPinned(el) {
        if (pinnedCache.has(el)) return pinnedCache.get(el);
        let pinned = false;
        for (let node = el; node && node !== document.body; node = node.parentElement) {
            const position = getComputedStyle(node).position;
            if (position === "sticky" || position === "fixed") { pinned = true; break; }
        }
        pinnedCache.set(el, pinned);
        return pinned;
    }

    // Bottom edge of the pinned bars at the top of the page right now.
    function pinnedTopEdge() {
        let bottom = 0;
        document.querySelectorAll("#sectionPill, .login-status-btn, .header-actions, .fact-ticker").forEach((bar) => {
            const r = bar.getBoundingClientRect();
            if (r.height > 0 && r.top < window.innerHeight / 3 && getComputedStyle(bar).position === "sticky") bottom = Math.max(bottom, r.bottom);
        });
        return bottom;
    }

    function bringIntoView(el) {
        // Sideways inside a row: scroll the row itself.
        const track = el.closest(".carousel-track, .hscroll-row");
        if (track && track !== el) {
            const r = el.getBoundingClientRect();
            const t = track.getBoundingClientRect();
            if (r.left < t.left) track.scrollBy({ left: r.left - t.left - 8, behavior: "smooth" });
            else if (r.right > t.right) track.scrollBy({ left: r.right - t.right + 8, behavior: "smooth" });
        }
        const box = el.parentElement && el.parentElement.closest(".games-grid");
        if (box && box.scrollHeight > box.clientHeight + 2 && getComputedStyle(box).overflowY === "auto") {
            const r = el.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            if (r.top < b.top) box.scrollBy({ top: r.top - b.top - 8, behavior: "smooth" });
            else if (r.bottom > b.bottom) box.scrollBy({ top: r.bottom - b.bottom + 8, behavior: "smooth" });
        }
        if (activeLayer() !== document.body || isPinned(el)) {
            if (activeLayer() !== document.body) el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
            return;
        }
        // Up and down: keep the whole item below the pinned bars and above
        // the hints bar (a tall card is lined up with its top).
        const rect = el.getBoundingClientRect();
        const topSafe = pinnedTopEdge() + 16;
        const bottomSafe = window.innerHeight - 70;
        let delta = 0;
        if (rect.top < topSafe) delta = rect.top - topSafe;
        else if (rect.bottom > bottomSafe) delta = rect.height > bottomSafe - topSafe ? rect.top - topSafe : rect.bottom - bottomSafe;
        if (delta) window.scrollBy({ top: delta, behavior: "smooth" });
    }

    function currentIsValid() {
        if (!current || !isShown(current)) return false;
        const layer = activeLayer();
        return layer.contains(current);
    }

    function nearestToViewportTop(list) {
        let best = null;
        let bestScore = Infinity;
        list.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight) return;
            const score = Math.max(0, r.top) * 2 + Math.max(0, r.left);
            if (score < bestScore) { bestScore = score; best = el; }
        });
        return best || list[0] || null;
    }

    // A list (country, city, sort…) is changed on purpose, not by passing
    // over it: A opens it for changing (arrows pick, A confirms, B cancels).
    let editingSelect = null;
    let editingOriginalIndex = -1;

    function startSelectEdit(select) {
        editingSelect = select;
        editingOriginalIndex = select.selectedIndex;
        select.classList.add("gp-editing");
    }

    function finishSelectEdit(confirm) {
        const select = editingSelect;
        if (!select) return;
        editingSelect = null;
        select.classList.remove("gp-editing");
        if (!confirm) {
            select.selectedIndex = editingOriginalIndex;
        } else if (select.selectedIndex !== editingOriginalIndex) {
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    function move(direction) {
        if (editingSelect) {
            if (!editingSelect.isConnected) { editingSelect = null; }
            else {
                stepSelect(editingSelect, direction === "down" || direction === "right" ? 1 : -1);
                return;
            }
        }
        if (currentIsValid() && current.matches("input[type=range]") && (direction === "left" || direction === "right")) {
            const step = parseFloat(current.step) || 1;
            current.value = String(parseFloat(current.value) + (direction === "right" ? step : -step));
            current.dispatchEvent(new Event("input", { bubbles: true }));
            current.dispatchEvent(new Event("change", { bubbles: true }));
            return;
        }

        const list = candidates();
        if (!currentIsValid()) {
            setCurrent(nearestToViewportTop(list));
            return;
        }

        // Inside a card its options are one short list, in the card's own
        // order (Details, sound, trailer, then its buttons): right/down go
        // to the next one, left/up to the previous.
        if (insideCard && activeLayer() === insideCard) {
            const index = list.indexOf(current);
            const step = direction === "right" || direction === "down" ? 1 : -1;
            const next = list[index + step];
            if (next) setCurrent(next);
            return;
        }

        const from = current.getBoundingClientRect();
        const fx = from.left + from.width / 2;
        const fy = from.top + from.height / 2;
        const inPage = activeLayer() === document.body;
        const fromPinned = inPage && isPinned(current);
        let best = null;
        let bestScore = Infinity;
        let bestPinned = null;
        let bestPinnedScore = Infinity;

        if (direction === "up" || direction === "down") {
            const target = verticalTarget(list, direction, from, inPage, fromPinned);
            if (target) setCurrent(target);
            else window.scrollBy({ top: direction === "down" ? 240 : -240, behavior: "smooth" });
            return;
        }

        list.forEach((el) => {
            if (el === current || el.contains(current) || current.contains(el)) return;
            const pinned = inPage && isPinned(el);
            // From the pinned bars, sideways stays in the bars; from the page,
            // only "up" can reach them, and only past the top of the content.
            if (fromPinned && !pinned && (direction === "left" || direction === "right")) return;
            if (!fromPinned && pinned && direction !== "up") return;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            let primary;
            let secondary;
            let overlap;
            if (direction === "right" || direction === "left") {
                primary = direction === "right" ? cx - fx : fx - cx;
                if (direction === "right" ? r.left < from.left + 2 : r.right > from.right - 2) return;
                secondary = Math.abs(cy - fy);
                overlap = r.top < from.bottom && r.bottom > from.top;
                // Sideways means along the same line: nothing far above or
                // below (the end of a row stays put instead of jumping away).
                if (!overlap && secondary > Math.max(from.height, r.height) * 0.75) return;
            } else {
                primary = direction === "down" ? cy - fy : fy - cy;
                if (direction === "down" ? r.top < from.top + 2 : r.bottom > from.bottom - 2) return;
                secondary = Math.abs(cx - fx);
                overlap = r.left < from.right && r.right > from.left;
            }
            if (primary <= 0) return;
            // Items in line with the current one win over diagonal ones.
            const score = primary + secondary * (overlap ? 0.3 : 2.5);
            if (pinned && !fromPinned) {
                if (score < bestPinnedScore) { bestPinnedScore = score; bestPinned = el; }
                return;
            }
            if (score < bestScore) { bestScore = score; best = el; }
        });

        // Going up from the page reaches the pinned bars only when nothing
        // in the content itself is above.
        if (!best && bestPinned) best = bestPinned;
        if (best) setCurrent(best);
        else if (direction === "up" || direction === "down") window.scrollBy({ top: direction === "down" ? 240 : -240, behavior: "smooth" });
    }

    // Up / down go row by row, like other TV apps: to the item right under
    // (or over) the current one in the next row, or, when nothing is right
    // under it (a shorter row, a new shelf), to the first item of that row.
    // Down from a card skips the next row's heading buttons and goes
    // straight to its cards (up from a card still reaches those buttons),
    // and down in a folded grid unfolds it ("▾ See more") to keep going.
    function verticalTarget(list, direction, from, inPage, fromPinned) {
        const down = direction === "down";
        const fromCard = current.matches(CARD_SELECTOR);

        if (down && fromCard) {
            const fold = current.closest(".grid-collapsed");
            const seeMore = fold && fold.nextElementSibling && fold.nextElementSibling.classList.contains("see-more-btn") ? fold.nextElementSibling : null;
            const hasMoreBelow = fold && Array.from(fold.children).some((card) => {
                const r = card.getBoundingClientRect();
                return r.top >= from.bottom - 2 && hiddenByFold(card, r);
            });
            if (seeMore && hasMoreBelow) {
                seeMore.click();
                list = candidates();
            }
        }

        const items = [];
        const pinnedItems = [];
        list.forEach((el) => {
            if (el === current || el.contains(current) || current.contains(el)) return;
            const pinned = inPage && isPinned(el);
            if (!fromPinned && pinned && !down) {
                // Collected apart: only used when nothing in the page is above.
            } else if (!fromPinned && pinned) {
                return;
            }
            const r = el.getBoundingClientRect();
            // Must start past the middle of the current item in that direction.
            if (down ? r.top < from.top + from.height * 0.5 : r.bottom > from.bottom - from.height * 0.5) return;
            (pinned && !fromPinned ? pinnedItems : items).push({ el, r });
        });

        const pickFromNearestLine = (group) => {
            if (!group.length) return null;
            const edgeOf = (i) => (down ? i.r.top : i.r.bottom);
            let ref = group[0];
            group.forEach((i) => { if (down ? edgeOf(i) < edgeOf(ref) : edgeOf(i) > edgeOf(ref)) ref = i; });
            const tolerance = Math.max(24, ref.r.height * 0.5);
            const line = group.filter((i) => (down ? edgeOf(i) <= edgeOf(ref) + tolerance : edgeOf(i) >= edgeOf(ref) - tolerance));
            let best = null;
            let bestOverlap = 0;
            line.forEach((i) => {
                const overlap = Math.min(i.r.right, from.right) - Math.max(i.r.left, from.left);
                if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
            });
            if (!best) best = line.reduce((a, b) => (b.r.left < a.r.left ? b : a));
            return best.el;
        };

        if (down && fromCard) {
            const next = pickFromNearestLine(items.filter((i) => i.el.matches(CARD_SELECTOR)));
            if (next) return next;
        }
        return pickFromNearestLine(items) || pickFromNearestLine(pinnedItems);
    }

    function stepSelect(select, delta) {
        let index = select.selectedIndex;
        for (let i = 0; i < select.options.length; i++) {
            index += delta;
            if (index < 0 || index >= select.options.length) return;
            if (!select.options[index].disabled) break;
        }
        if (index === select.selectedIndex || index < 0 || index >= select.options.length) return;
        select.selectedIndex = index;
    }

    // --- Actions ---------------------------------------------------------------
    function activate() {
        if (editingSelect && editingSelect !== current) finishSelectEdit(true);
        if (!currentIsValid()) {
            move("down");
            return;
        }
        const el = current;
        if (el.matches(CARD_SELECTOR)) {
            enterCard(el);
            return;
        }
        if (el.tagName === "SELECT") {
            if (editingSelect === el) finishSelectEdit(true);
            else startSelectEdit(el);
            return;
        }
        if (el.matches("input, textarea")) {
            el.focus();
            if (el.select) el.select();
            return;
        }
        el.click();
    }

    function openDetails() {
        const card = currentIsValid() ? current.closest(CARD_SELECTOR) : null;
        if (!card) {
            activate();
            return;
        }
        const opener = card.querySelector(".cover-img, .game-desc, h3") || card.querySelector("button");
        if (opener) opener.click();
    }

    function primaryAction() {
        if (currentIsValid() && !current.matches(CARD_SELECTOR) && current.closest(CARD_SELECTOR)) {
            const cardEl = current.closest(CARD_SELECTOR);
            const main = Array.from(cardEl.querySelectorAll(".launchBtn, .ticketsBtn")).find((b) => isShown(b));
            if (main) main.click();
            return;
        }
        if (!currentIsValid() || !current.matches(CARD_SELECTOR)) {
            activate();
            return;
        }
        const button = Array.from(current.querySelectorAll(".launchBtn, .ticketsBtn, button")).find((b) => isShown(b));
        if (button) button.click();
    }

    function visibleButtonIn(root, selector) {
        return Array.from(root.querySelectorAll(selector)).find((b) => isShown(b)) || null;
    }

    function back() {
        if (editingSelect) {
            finishSelectEdit(false);
            return;
        }
        if (sideBar && sideBar.classList.contains("gp-open")) {
            toggleSidePanel(false);
            return;
        }
        if (typeof tourActive !== "undefined" && tourActive && typeof endTour === "function") {
            endTour();
            return;
        }
        const layer = activeLayer();
        if (layer.classList && layer.classList.contains("modal-overlay")) {
            // The window's own Close / Cancel / Later button, if it has one
            // (a window that must be answered has none, on purpose).
            const closer = visibleButtonIn(layer, "[id$='CloseBtn'], [id$='CancelBtn'], [id$='LaterBtn'], .modal-close, .close-btn, button[aria-label='Close']");
            if (closer) closer.click();
            else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            return;
        }
        if (insideCard) {
            leaveCard(true);
            return;
        }
        const seeAll = document.getElementById("seeAllOverlay");
        if (seeAll && !seeAll.hidden && typeof closeSeeAll === "function") {
            closeSeeAll();
            return;
        }
        // On the page itself: back up to the section tabs.
        const activeTab = document.querySelector("#sectionPill .sectionOption.active");
        if (activeTab) setCurrent(activeTab);
    }

    function switchSectionBy(delta) {
        const tabs = Array.from(document.querySelectorAll("#sectionPill .sectionOption")).filter((t) => isShown(t));
        if (!tabs.length) return;
        const index = tabs.findIndex((t) => t.classList.contains("active"));
        const next = tabs[(index + delta + tabs.length) % tabs.length];
        next.click();
        window.scrollTo({ top: 0, behavior: "smooth" });
        setCurrent(next, { scroll: false });
    }

    function scrollScreen(direction) {
        window.scrollBy({ top: direction * window.innerHeight * 0.8, behavior: "smooth" });
        setTimeout(() => {
            if (activeLayer() !== document.body) return;
            const list = candidates();
            let best = null;
            let bestDistance = Infinity;
            list.forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.bottom < 120 || r.top > window.innerHeight) return;
                const distance = Math.abs(r.top + r.height / 2 - window.innerHeight / 2) + Math.max(0, r.left) * 0.2;
                if (distance < bestDistance) { bestDistance = distance; best = el; }
            });
            if (best) setCurrent(best, { scroll: false });
        }, 420);
    }

    function toggleSidePanel(open) {
        if (!sideBar) return;
        const willOpen = typeof open === "boolean" ? open : !sideBar.classList.contains("gp-open");
        sideBar.classList.toggle("gp-open", willOpen);
        if (willOpen) {
            const first = candidates()[0];
            if (first) setCurrent(first);
        } else {
            const activeTab = document.querySelector("#sectionPill .sectionOption.active");
            setCurrent(activeTab && isShown(activeTab) ? activeTab : null);
        }
    }

    // --- TV mode ---------------------------------------------------------------
    function tvModeSetting() {
        const value = typeof settings !== "undefined" && settings ? settings.tvMode : null;
        return value === "on" || value === "off" ? value : "auto";
    }

    function applyTvMode() {
        if (tvModeSelect) tvModeSelect.value = tvModeSetting();
        const mode = tvModeSetting();
        const wanted = !desktopUntilNextPad && (mode === "on" || (mode === "auto" && padConnected));
        if (wanted === tvOn) return;
        tvOn = wanted;
        document.body.classList.toggle("tv-mode", wanted);
        window.riftgate.invoke("set-tv-mode", wanted);
    }

    if (tvModeSelect) {
        tvModeSelect.addEventListener("change", () => {
            if (typeof saveSetting === "function") saveSetting("tvMode", tvModeSelect.value);
            applyTvMode();
        });
    }


    // --- Controller polling ------------------------------------------------------
    function connectedPads() {
        return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
    }

    function directionFrom(pad) {
        const pressed = (i) => pad.buttons[i] && pad.buttons[i].pressed;
        if (pressed(BUTTON.UP)) return "up";
        if (pressed(BUTTON.DOWN)) return "down";
        if (pressed(BUTTON.LEFT)) return "left";
        if (pressed(BUTTON.RIGHT)) return "right";
        const x = pad.axes[0] || 0;
        const y = pad.axes[1] || 0;
        if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEADZONE) return null;
        return Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up");
    }

    function onButton(index) {
        document.body.classList.add("gp-nav");
        switch (index) {
            case BUTTON.A: activate(); break;
            case BUTTON.B: back(); break;
            case BUTTON.X: primaryAction(); break;
            case BUTTON.Y: openDetails(); break;
            case BUTTON.LB: switchSectionBy(-1); break;
            case BUTTON.RB: switchSectionBy(1); break;
            case BUTTON.LT: scrollScreen(-1); break;
            case BUTTON.RT: scrollScreen(1); break;
            case BUTTON.MENU: toggleSidePanel(); break;
            case BUTTON.VIEW: toggleControlsHelp(); break;
            default: break;
        }
    }

    function poll(now) {
        const pads = connectedPads();
        if (!pads.length) {
            pollHandle = null;
            return;
        }
        let direction = null;
        pads.forEach((pad) => {
            const before = previousButtons.get(pad.index) || [];
            const nowPressed = pad.buttons.map((b) => b.pressed);
            nowPressed.forEach((isDown, i) => {
                if (isDown && !before[i] && i !== BUTTON.UP && i !== BUTTON.DOWN && i !== BUTTON.LEFT && i !== BUTTON.RIGHT) onButton(i);
            });
            previousButtons.set(pad.index, nowPressed);
            direction = direction || directionFrom(pad);
            const rightY = pad.axes[3] || 0;
            if (Math.abs(rightY) > 0.3) window.scrollBy(0, rightY * RIGHT_STICK_SCROLL);
        });

        if (direction) {
            if (direction !== heldDirection) {
                heldDirection = direction;
                heldSince = now;
                lastRepeat = now;
                move(direction);
            } else if (now - heldSince > FIRST_REPEAT_MS && now - lastRepeat > REPEAT_MS) {
                lastRepeat = now;
                move(direction);
            }
        } else {
            heldDirection = null;
        }
        pollHandle = requestAnimationFrame(poll);
    }

    function startPolling() {
        if (!pollHandle) pollHandle = requestAnimationFrame(poll);
    }

    window.addEventListener("gamepadconnected", (event) => {
        padConnected = true;
        desktopUntilNextPad = false;
        setScheme(schemeForPad(event.gamepad));
        document.body.classList.add("gp-pad");
        applyTvMode();
        startPolling();
    });

    // Back to desktop mode: normal size, no highlight, no hints, the mouse
    // in charge.
    window.addEventListener("gamepaddisconnected", () => {
        padConnected = connectedPads().length > 0;
        if (padConnected) return;
        desktopUntilNextPad = true;
        document.body.classList.remove("gp-pad", "gp-nav");
        if (editingSelect) finishSelectEdit(false);
        leaveCard(false);
        if (current) {
            current.classList.remove("gp-focus");
            const card = current.closest(CARD_SELECTOR);
            if (card) card.classList.remove("gp-show");
        }
        current = null;
        if (sideBar) sideBar.classList.remove("gp-open");
        applyTvMode();
    });

    // --- TV remote / keyboard ------------------------------------------------------
    const KEY_DIRECTIONS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

    function keyboardNavigationOn() {
        return tvOn || padConnected || document.body.classList.contains("gp-nav");
    }

    document.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (!keyboardNavigationOn()) return;
        const target = event.target;
        const typing = target && target.matches && target.matches("input:not([type=range]):not([type=checkbox]), textarea, [contenteditable]");
        const direction = KEY_DIRECTIONS[event.key];

        if (direction) {
            // In a text box, left/right move the cursor; up/down leave it.
            if (typing && (direction === "left" || direction === "right")) return;
            event.preventDefault();
            if (!padConnected) setScheme(tvOn ? "remote" : "keyboard");
            move(direction);
            return;
        }
        if (event.key === "Enter" && !typing && currentIsValid()) {
            event.preventDefault();
            activate();
            return;
        }
        if (!typing) {
            const key = event.key;
            let handled = true;
            if (key === "ChannelUp" || key === "]") switchSectionBy(1);
            else if (key === "ChannelDown" || key === "[") switchSectionBy(-1);
            else if (key === "PageDown") scrollScreen(1);
            else if (key === "PageUp") scrollScreen(-1);
            else if (key === "F1" || key === "?" || key === "Info") toggleControlsHelp();
            else if (key === "ContextMenu" || key === "m" || key === "M") toggleSidePanel();
            else if (key === "p" || key === "P") primaryAction();
            else if (key === "i" || key === "I") openDetails();
            else handled = false;
            if (handled) {
                event.preventDefault();
                document.body.classList.add("gp-nav");
                if (!padConnected) setScheme(tvOn ? "remote" : "keyboard");
                return;
            }
        }
        if ((event.key === "Backspace" || event.key === "BrowserBack" || event.key === "GoBack") && !typing) {
            event.preventDefault();
            back();
            return;
        }
        if (event.key === "Escape" && editingSelect) {
            event.preventDefault();
            finishSelectEdit(false);
            return;
        }
        if (event.key === "Escape" && sideBar && sideBar.classList.contains("gp-open")) {
            toggleSidePanel(false);
        }
    }, true);

    // The mouse takes over again as soon as it moves.
    let lastMouse = null;
    document.addEventListener("mousemove", (event) => {
        const position = `${event.screenX},${event.screenY}`;
        if (lastMouse !== null && lastMouse !== position) {
            document.body.classList.remove("gp-nav");
            leaveCard(false);
            if (current) {
                current.classList.remove("gp-focus");
                const card = current.closest(CARD_SELECTOR);
                if (card) card.classList.remove("gp-show");
            }
            current = null;
            if (sideBar) sideBar.classList.remove("gp-open");
        }
        lastMouse = position;
    }, { passive: true });

    // Controllers already connected before this page loaded show up on the
    // first poll (browsers only announce them after a button press).
    if (connectedPads().length) {
        padConnected = true;
        document.body.classList.add("gp-pad");
        startPolling();
    }

    // --- Controls screen: what every button does, per kind of controller -------------
    const helpModal = document.createElement("div");
    helpModal.className = "modal-overlay";
    helpModal.id = "controlsModal";
    helpModal.innerHTML = `
        <div class="modal-box controls-box" role="dialog" aria-labelledby="controlsTitle">
            <h3 id="controlsTitle">🎮 Controller &amp; remote controls</h3>
            <p class="controls-intro">Riftgate recognises your controller by itself. Pick a type to see its buttons.</p>
            <div class="controls-tabs" role="tablist"></div>
            <div class="controls-diagram"></div>
            <table class="controls-table"><tbody></tbody></table>
            <p class="controls-note">TV mode (everything bigger) turns on while a controller is connected and off when it's unplugged — change it in the side panel under Display.</p>
            <div class="modal-actions"><button type="button" id="controlsCloseBtn">Close</button></div>
        </div>`;
    document.body.appendChild(helpModal);
    let helpScheme = scheme;

    function svgText(x, y, text, cls) {
        return `<text x="${x}" y="${y}" class="${cls || "cd-label"}" text-anchor="middle">${String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
    }

    // A plain, generic outline (not any brand's shape) with each button's
    // name for the chosen controller type in its place.
    function diagramFor(kind) {
        const k = SCHEMES[kind].keys;
        if (kind === "keyboard") return "";
        if (kind === "remote") {
            return `<svg viewBox="0 0 200 250" class="cd-svg" aria-hidden="true">
                <rect x="55" y="8" width="90" height="234" rx="40" class="cd-body"/>
                <circle cx="100" cy="92" r="36" class="cd-part"/>
                <circle cx="100" cy="92" r="15" class="cd-key"/>${svgText(100, 97, k.A, "cd-key-label")}
                ${svgText(100, 68, "▲", "cd-arrow")}${svgText(100, 124, "▼", "cd-arrow")}${svgText(75, 97, "◀", "cd-arrow")}${svgText(125, 97, "▶", "cd-arrow")}
                <rect x="66" y="142" width="30" height="18" rx="8" class="cd-key"/>${svgText(81, 155, k.B, "cd-small")}
                <rect x="104" y="142" width="30" height="18" rx="8" class="cd-key"/>${svgText(119, 155, k.MENU, "cd-small")}
                <rect x="66" y="170" width="30" height="18" rx="8" class="cd-key"/>${svgText(81, 183, k.RB, "cd-small")}
                <rect x="66" y="194" width="30" height="18" rx="8" class="cd-key"/>${svgText(81, 207, k.LB, "cd-small")}
                <rect x="104" y="170" width="30" height="18" rx="8" class="cd-key"/>${svgText(119, 183, k.VIEW, "cd-small")}
                ${svgText(100, 36, "TV remote", "cd-title")}
            </svg>`;
        }
        return `<svg viewBox="0 0 440 250" class="cd-svg" aria-hidden="true">
            <path d="M120 58 H320 C372 58 402 92 414 148 C426 204 404 236 374 236 C350 236 336 218 322 198 L300 170 H140 L118 198 C104 218 90 236 66 236 C36 236 14 204 26 148 C38 92 68 58 120 58 Z" class="cd-body"/>
            <rect x="74" y="30" width="86" height="20" rx="9" class="cd-key"/>${svgText(117, 44, k.LB, "cd-small")}
            <rect x="80" y="6" width="74" height="20" rx="9" class="cd-part"/>${svgText(117, 20, k.LT, "cd-small")}
            <rect x="280" y="30" width="86" height="20" rx="9" class="cd-key"/>${svgText(323, 44, k.RB, "cd-small")}
            <rect x="286" y="6" width="74" height="20" rx="9" class="cd-part"/>${svgText(323, 20, k.RT, "cd-small")}
            <path d="M96 98 h18 v-18 h18 v18 h18 v18 h-18 v18 h-18 v-18 h-18 z" class="cd-key"/>${svgText(123, 150, "D-pad", "cd-small")}
            <circle cx="170" cy="152" r="22" class="cd-part"/>${svgText(170, 156, "L stick", "cd-small")}
            <circle cx="270" cy="152" r="22" class="cd-part"/>${svgText(270, 156, "R stick", "cd-small")}
            <rect x="178" y="92" width="34" height="18" rx="9" class="cd-key"/>${svgText(195, 105, k.VIEW.split(" ")[0], "cd-tiny")}
            <rect x="228" y="92" width="34" height="18" rx="9" class="cd-key"/>${svgText(245, 105, k.MENU.split(" ")[0], "cd-tiny")}
            <circle cx="330" cy="80" r="15" class="cd-key"/>${svgText(330, 85, k.Y, "cd-key-label")}
            <circle cx="302" cy="108" r="15" class="cd-key"/>${svgText(302, 113, k.X, "cd-key-label")}
            <circle cx="358" cy="108" r="15" class="cd-key"/>${svgText(358, 113, k.B, "cd-key-label")}
            <circle cx="330" cy="136" r="15" class="cd-key cd-main"/>${svgText(330, 141, k.A, "cd-key-label")}
        </svg>`;
    }

    function renderHelp() {
        const tabs = helpModal.querySelector(".controls-tabs");
        tabs.textContent = "";
        Object.entries(SCHEMES).forEach(([kind, info]) => {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = `controls-tab${kind === helpScheme ? " active" : ""}`;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", kind === helpScheme ? "true" : "false");
            tab.textContent = info.name;
            tab.addEventListener("click", () => {
                helpScheme = kind;
                renderHelp();
                const again = helpModal.querySelector(".controls-tab.active");
                if (again && document.body.classList.contains("gp-nav")) setCurrent(again, { scroll: false });
            });
            tabs.appendChild(tab);
        });
        helpModal.querySelector(".controls-diagram").innerHTML = diagramFor(helpScheme);
        const body = helpModal.querySelector(".controls-table tbody");
        body.textContent = "";
        const keys = SCHEMES[helpScheme].keys;
        CONTROLS.forEach(([which, other, what]) => {
            const key = keyLabel(which, other, keys);
            if (!key) return;
            const row = document.createElement("tr");
            const keyCell = document.createElement("td");
            const badge = document.createElement("b");
            badge.textContent = key;
            keyCell.appendChild(badge);
            const whatCell = document.createElement("td");
            whatCell.textContent = what;
            row.appendChild(keyCell);
            row.appendChild(whatCell);
            body.appendChild(row);
        });
        if (helpScheme === "remote") {
            const row = document.createElement("tr");
            const note = document.createElement("td");
            note.colSpan = 2;
            note.className = "controls-row-note";
            note.textContent = "No Y / X on a remote: select a card (OK) and pick Details, Trailer, Sound or Play inside it.";
            row.appendChild(note);
            body.appendChild(row);
        }
    }

    function toggleControlsHelp(open) {
        const willOpen = typeof open === "boolean" ? open : !helpModal.classList.contains("active");
        if (willOpen) {
            helpScheme = scheme;
            renderHelp();
            helpModal.classList.add("active");
            if (document.body.classList.contains("gp-nav")) {
                const tab = helpModal.querySelector(".controls-tab.active");
                if (tab) setCurrent(tab, { scroll: false });
            }
        } else {
            helpModal.classList.remove("active");
        }
    }
    helpModal.querySelector("#controlsCloseBtn").addEventListener("click", () => toggleControlsHelp(false));
    helpModal.addEventListener("click", (event) => { if (event.target === helpModal) toggleControlsHelp(false); });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && helpModal.classList.contains("active")) toggleControlsHelp(false);
    });
    const helpButton = document.getElementById("controlsHelpBtn");
    if (helpButton) helpButton.addEventListener("click", () => toggleControlsHelp(true));

    // renderer.js may have applied the saved settings before this file
    // loaded (it only waits for load-settings), so apply TV mode now too.
    applyTvMode();

    window.riftgatePad = { applyTvMode, move, activate, back, candidates, focus: setCurrent, openDetails, primaryAction, toggleControlsHelp, setScheme, SCHEMES, CONTROLS, get current() { return current; } };
})();
