// Riftgate — a reorderable stack of rows. Drag a row by its grip (⋮⋮)
// to move it, or focus the grip and press ↑/↓. The order is remembered per
// section; rows added later (a new store, a streaming service) slot into
// their saved place, and brand-new ones go to the end.

import { h } from "../app/dom.js";
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

    el.add = (...rs) => { rs.flat().filter(Boolean).forEach((r) => { wire(r); place(r); }); return el; };
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
    // Saved order may arrive after the first paint
    journal.load().then(() => [...el.children].forEach(place));
    return el;
}
