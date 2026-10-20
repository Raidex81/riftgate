// Riftgate — a reorderable stack of rows. Drag a row by its grip (⋮⋮)
// to move it, or focus the grip and press ↑/↓. The order is remembered per
// section; rows added later (a new store, a streaming service) slot into
// their saved place, and brand-new ones go to the end.
//
// Any row can be hidden (the × in its header): it stops loading, and a
// "Hidden rows" line under the shelf brings it back. Remembered per section.

import { h, icon, clear } from "../app/dom.js";
import * as journal from "../app/store.js";
import { toast } from "./toast.js";

export function shelf(viewId, rows = []) {
    const key = `order:${viewId}`;
    const el = h("div.shelf");
    const saved = () => journal.pref(key, null) || [];
    const id = (r) => r.dataset.rowId;

    function place(r) {
        const ord = saved();
        const idx = ord.indexOf(id(r));
        if (idx < 0) { el.appendChild(r); return; }
        const before = [...el.children].find((c) => { const j = ord.indexOf(id(c)); return j < 0 || j > idx; });
        el.insertBefore(r, before || null);
    }
    function save() {
        const ord = [...el.children].map(id);
        // keep the saved place of rows not on screen right now (e.g. a platform with no games today)
        const old = saved().filter((x) => !ord.includes(x));
        journal.setPref(key, [...ord, ...old]);
    }

    // ---- Hidden rows -------------------------------------------------------------
    const hiddenKey = `hidden:${viewId}`;
    const hiddenIds = () => new Set(journal.pref(hiddenKey, null) || []);
    const bar = h("div.shelf-hidden", { hidden: true });
    function setUserHidden(r, on) {
        r.dataset.userHidden = on ? "1" : "";
        r.hidden = on || !!r._autoHidden;
        if (!on && r.wake) r.wake();
    }
    function paintBar() {
        const hid = hiddenIds();
        const rows = [...el.children].filter((r) => hid.has(id(r)));
        clear(bar);
        bar.hidden = !rows.length;
        if (rows.length) {
            bar.append(h("span.muted", null, icon("eye"), rows.length === 1 ? "1 hidden row:" : `${rows.length} hidden rows:`),
                ...rows.map((r) => h("button.chip", { type: "button", title: "Show this row again", onclick: () => unhide(r) }, r.getAttribute("aria-label"))));
        }
        if (!bar.isConnected && el.parentNode) el.after(bar);
    }
    function hide(r) {
        const hid = hiddenIds(); hid.add(id(r));
        journal.setPref(hiddenKey, [...hid]);
        setUserHidden(r, true); paintBar();
        toast(`${r.getAttribute("aria-label")} is hidden. It's listed at the bottom of the page to bring back.`);
    }
    function unhide(r) {
        const hid = hiddenIds(); hid.delete(id(r));
        journal.setPref(hiddenKey, hid.size ? [...hid] : null);
        setUserHidden(r, false); paintBar();
        r.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    el.addEventListener("row-hide", (e) => { const r = e.target.closest(".row"); if (r && r.parentNode === el) hide(r); });
    const applyHidden = () => { const hid = hiddenIds(); [...el.children].forEach((r) => { const on = hid.has(id(r)); if (on !== (r.dataset.userHidden === "1")) setUserHidden(r, on); }); paintBar(); };

    el.add = (...rs) => { rs.flat().filter(Boolean).forEach((r) => { wire(r); place(r); if (hiddenIds().has(id(r))) setUserHidden(r, true); }); if (el.parentNode) paintBar(); return el; };
    el.reset = () => { journal.setPref(key, null); };

    // ---- Drag to reorder -------------------------------------------------------
    let dragging = null;
    function wire(r) {
        const grip = r.querySelector(".row-grip");
        if (!grip) return;
        grip.draggable = true;
        grip.addEventListener("dragstart", (e) => {
            dragging = r;
            r.classList.add("dragging");
            el.classList.add("is-sorting");
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", id(r)); e.dataTransfer.setDragImage(r.querySelector(".row-head"), 24, 20); } catch {}
        });
        grip.addEventListener("dragend", () => {
            r.classList.remove("dragging");
            el.classList.remove("is-sorting");
            if (dragging) { dragging = null; save(); }
        });
        grip.addEventListener("keydown", (e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const sib = visibleSibling(r, e.key === "ArrowUp" ? -1 : 1);
            if (!sib) return;
            if (e.key === "ArrowUp") el.insertBefore(r, sib); else el.insertBefore(r, sib.nextSibling);
            grip.focus();
            r.scrollIntoView({ block: "nearest", behavior: "smooth" });
            save();
            toast(`Moved ${r.getAttribute("aria-label")} ${e.key === "ArrowUp" ? "up" : "down"}`);
        });
    }
    function visibleSibling(r, dir) {
        let n = dir < 0 ? r.previousElementSibling : r.nextElementSibling;
        while (n && n.hidden) n = dir < 0 ? n.previousElementSibling : n.nextElementSibling;
        return n;
    }
    el.addEventListener("dragover", (e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const over = [...el.children].find((c) => {
            if (c === dragging || c.hidden) return false;
            const b = c.getBoundingClientRect();
            return e.clientY < b.top + b.height / 2;
        });
        if (over !== dragging.nextElementSibling) el.insertBefore(dragging, over || null);
        // Auto-scroll the stage near its edges
        const stage = el.closest(".stage");
        if (stage) {
            const sb = stage.getBoundingClientRect();
            if (e.clientY < sb.top + 70) stage.scrollBy(0, -18);
            else if (e.clientY > sb.bottom - 70) stage.scrollBy(0, 18);
        }
    });
    el.addEventListener("drop", (e) => { if (dragging) e.preventDefault(); });

    el.add(rows);
    // Saved order (and hidden rows) may arrive after the first paint
    journal.load().then(() => { [...el.children].forEach(place); applyHidden(); });
    requestAnimationFrame(() => requestAnimationFrame(paintBar)); // once the shelf is on the page
    return el;
}
