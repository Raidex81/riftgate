// Controller and TV-remote navigation for Riftgate, plus TV mode.
//
// With an Xbox / PlayStation / generic controller (the browser Gamepad API)
// or a TV remote's arrow keys, a highlight moves between everything that can
// be used on screen — section tabs, buttons, lists, cards — picking the
// nearest item in the direction pressed:
//
//   D-pad / left stick / arrow keys   move the highlight
//   A / Enter                          open or press the highlighted item
//   B / Backspace                      back: close a window, panel or menu
//   X                                  a card's main button (Play, Get, Tickets…)
//   LB / RB                            previous / next section
//   LT / RT                            scroll a screen up / down (right stick scrolls too)
//   ☰ Menu (Start)                     open / close the side panel (settings)
//   ⧉ View (Back)                      TV mode on / off
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
    let pollHandle = null;
    const previousButtons = new Map(); // gamepad index -> pressed[]
    let heldDirection = null;
    let heldSince = 0;
    let lastRepeat = 0;

    const sideBar = document.getElementById("sideBar");
    const tvModeSelect = document.getElementById("tvModeSelect");

    // --- Hints bar ----------------------------------------------------------
    const hints = document.createElement("div");
    hints.className = "gp-hints";
    hints.setAttribute("aria-hidden", "true");
    [["A", "Open"], ["B", "Back"], ["X", "Play / Get"], ["LB RB", "Sections"], ["☰", "Menu"]].forEach(([key, label]) => {
        const item = document.createElement("span");
        const badge = document.createElement("b");
        badge.textContent = key;
        item.appendChild(badge);
        item.appendChild(document.createTextNode(label));
        hints.appendChild(item);
    });
    document.body.appendChild(hints);

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
        const seeAll = document.getElementById("seeAllOverlay");
        if (seeAll && !seeAll.hidden) return seeAll;
        if (sideBar && sideBar.classList.contains("gp-open")) return sideBar;
        return document.body;
    }

    function horizontallyReachable(el, rect) {
        if (rect.right > 0 && rect.left < window.innerWidth) return true;
        // Off to the side inside a sideways row that is itself on screen.
        const row = el.closest(".carousel-track, .hscroll-row");
        if (!row) return false;
        const rowRect = row.getBoundingClientRect();
        return rowRect.right > 0 && rowRect.left < window.innerWidth;
    }

    function candidates() {
        const layer = activeLayer();
        const list = [];
        layer.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
            if (el.matches(SKIP_SELECTOR)) return;
            if (layer === document.body) {
                if (sideBar && sideBar.contains(el)) return;
                if (el.closest(".modal-overlay, #seeAllOverlay, #tourOverlayGroup")) return;
            }
            // Parts of a card are reached through the card itself.
            const card = el.matches(CARD_SELECTOR) ? null : el.closest(CARD_SELECTOR);
            if (card) return;
            if (el.matches("label.sidebar-toggle") === false && el.closest("label.sidebar-toggle")) return;
            if (!isShown(el)) return;
            const rect = el.getBoundingClientRect();
            if (!horizontallyReachable(el, rect)) return;
            list.push(el);
        });
        return list;
    }

    // --- Moving the highlight --------------------------------------------------
    function setCurrent(el, { scroll = true } = {}) {
        if (current && current !== el) current.classList.remove("gp-focus");
        current = el;
        if (!el) return;
        el.classList.add("gp-focus");
        document.body.classList.add("gp-nav");
        if (el.matches("button, a[href], select, input, textarea, [tabindex]")) {
            try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
        } else if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        if (scroll) bringIntoView(el);
    }

    function bringIntoView(el) {
        const rect = el.getBoundingClientRect();
        // Keep clear of the sticky section tabs at the top and the hints bar.
        const topSafe = 150;
        const bottomSafe = window.innerHeight - 70;
        const block = rect.top < topSafe || rect.bottom > bottomSafe ? "center" : "nearest";
        el.scrollIntoView({ block, inline: "nearest", behavior: "smooth" });
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

    function move(direction) {
        // A select's choices change with left/right; up/down leave it.
        if (currentIsValid() && current.tagName === "SELECT" && (direction === "left" || direction === "right")) {
            stepSelect(current, direction === "right" ? 1 : -1);
            return;
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

        const from = current.getBoundingClientRect();
        const fx = from.left + from.width / 2;
        const fy = from.top + from.height / 2;
        let best = null;
        let bestScore = Infinity;

        list.forEach((el) => {
            if (el === current || el.contains(current) || current.contains(el)) return;
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
            if (score < bestScore) { bestScore = score; best = el; }
        });

        if (best) setCurrent(best);
        else if (direction === "up" || direction === "down") window.scrollBy({ top: direction === "down" ? 240 : -240, behavior: "smooth" });
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
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // --- Actions ---------------------------------------------------------------
    function activate() {
        if (!currentIsValid()) {
            move("down");
            return;
        }
        const el = current;
        if (el.matches(CARD_SELECTOR)) {
            // Open the card's details, like clicking its cover.
            const opener = el.querySelector(".cover-img, .game-desc, h3") || el.querySelector("button");
            if (opener) opener.click();
            else el.click();
            return;
        }
        if (el.tagName === "SELECT") {
            stepSelect(el, 1);
            return;
        }
        if (el.matches("input, textarea")) {
            el.focus();
            if (el.select) el.select();
            return;
        }
        el.click();
    }

    function primaryAction() {
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
        const wanted = mode === "on" || (mode === "auto" && padConnected);
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

    function toggleTvModeQuick() {
        const next = tvOn ? "off" : "on";
        if (typeof saveSetting === "function") saveSetting("tvMode", next);
        else if (typeof settings !== "undefined") settings.tvMode = next;
        applyTvMode();
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
            case BUTTON.LB: switchSectionBy(-1); break;
            case BUTTON.RB: switchSectionBy(1); break;
            case BUTTON.LT: scrollScreen(-1); break;
            case BUTTON.RT: scrollScreen(1); break;
            case BUTTON.MENU: toggleSidePanel(); break;
            case BUTTON.VIEW: toggleTvModeQuick(); break;
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

    window.addEventListener("gamepadconnected", () => {
        padConnected = true;
        document.body.classList.add("gp-pad");
        applyTvMode();
        startPolling();
    });

    window.addEventListener("gamepaddisconnected", () => {
        padConnected = connectedPads().length > 0;
        if (!padConnected) {
            document.body.classList.remove("gp-pad");
            applyTvMode();
        }
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
            move(direction);
            return;
        }
        if (event.key === "Enter" && !typing && currentIsValid()) {
            event.preventDefault();
            activate();
            return;
        }
        if ((event.key === "Backspace" || event.key === "BrowserBack" || event.key === "GoBack") && !typing) {
            event.preventDefault();
            back();
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
            if (current) current.classList.remove("gp-focus");
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

    window.riftgatePad = { applyTvMode, move, activate, back, candidates, get current() { return current; } };
})();
