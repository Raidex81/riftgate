// Riftgate — the Library's everyday tools, from Riftgate 1.x:
//   • drop a game, app or shortcut anywhere on the window to add it
//     (an EPUB or PDF goes to your eBooks);
//   • new installs found on this PC are offered (add, or "not interested");
//   • games that moved or were uninstalled are found (locate, or remove);
//   • per item: notes, category, cover, show in folder, find mods,
//     uninstall, remove from Riftgate.

import { h, icon, clear } from "./dom.js";
import { call, forget, on, openExternal } from "./api.js";
import * as D from "./data.js";
import { toast } from "../components/toast.js";
import { openAddDialog } from "../components/add-dialog.js";
import { plural } from "./format.js";

const changed = () => { forget("load-games"); D.library({ fresh: true }); window.dispatchEvent(new CustomEvent("r2-library-changed")); };
const nameFromPath = (p) => String(p).split(/[\\/]/).pop().replace(/\.(exe|lnk|url|app)$/i, "");

// Add one game or app from a file path (a shortcut is followed to its target)
export async function addFromPath(filePath, category = "game") {
    const resolved = (await call("resolve-shortcut", filePath)) || filePath;
    const games = (await call("load-games")) || [];
    if (games.some((g) => String(g.path).toLowerCase() === String(resolved).toLowerCase())) {
        toast(`${nameFromPath(resolved)} is already in your library`);
        return false;
    }
    let name = nameFromPath(resolved);
    if (/\.exe$/i.test(resolved)) {
        const described = await call("get-exe-description", resolved);
        if (typeof described === "string" && described.trim().length > 1 && described.trim().toLowerCase() !== name.toLowerCase()) name = described.trim();
    }
    const override = await call("get-override", name);
    let cover = override && override.image ? override.image : null;
    if (!cover) {
        cover = await call("find-cover", name);
        if (!cover || cover === "covers/default.jpg") cover = await call("fetch-online-cover", name);
    }
    const game = { name, path: resolved, image: cover || "covers/default.jpg", category };
    if (override && override.trailerId) game.trailerId = override.trailerId;
    await call("save-game", game);
    toast(`Added ${name} to your library`);
    changed();
    return true;
}

// ---- Drop files anywhere on the window ------------------------------------------------
export function enableDrop(onEbook) {
    const veil = h("div.drop-veil", { hidden: true }, h("div", null, icon("plus"), h("b", null, "Drop to add to Riftgate"), h("span", null, "Games, apps and shortcuts go to your Library (you'll pick the category); EPUB and PDF to your eBooks")));
    document.body.appendChild(veil);
    let depth = 0;
    // Only files dragged in from outside Riftgate count. Dragging something
    // inside the window (a card, a cover picture, a row) never shows "Drop to
    // add": Chromium labels a dragged picture as a file too, which is why a
    // Continue your journey card used to offer to add itself.
    let inside = false;
    document.addEventListener("dragstart", () => { inside = true; }, true);
    document.addEventListener("dragend", () => { inside = false; depth = 0; veil.hidden = true; }, true);
    const hasFiles = (e) => !inside && e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; depth++; veil.hidden = false; });
    window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
    window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
    window.addEventListener("drop", async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0; veil.hidden = true;
        const files = [...e.dataTransfer.files];
        const programs = [];
        for (const f of files) {
            const p = window.riftgate && window.riftgate.pathForFile ? window.riftgate.pathForFile(f) : null;
            if (!p) continue;
            if (/\.(epub|pdf)$/i.test(p)) { if (onEbook) await onEbook(p); continue; }
            if (/\.(exe|lnk|url|app)$/i.test(p)) { programs.push(p); continue; }
            toast(`${f.name} isn't a game, app, shortcut or eBook`, "err");
        }
        // Wherever you drop them, they go to your Library, after you confirm each category
        if (programs.length) openAddDialog(programs);
    });
}

// ---- New installs on this PC --------------------------------------------------------------
export function watchNewInstalls() {
    on("new-install-detected", (candidates) => {
        if (!Array.isArray(candidates) || !candidates.length) return;
        document.querySelector(".new-installs")?.remove();
        const list = h("div.ni-list");
        const panel = h("aside.new-installs", { role: "dialog", "aria-label": "New on this PC" },
            h("div.ni-head", null, icon("sparkles"), h("b", null, candidates.length === 1 ? "Just installed" : `${candidates.length} new on this PC`),
                h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => panel.remove() }, icon("x"))),
            h("p.muted", null, "Add them to your library?"), list);
        candidates.forEach((c) => {
            const add = h("button.btn.primary", { type: "button" }, icon("plus"), "Add");
            const no = h("button.btn.ghost", { type: "button", title: "Don't ask again for this one" }, "Not interested");
            const row = h("div.ni-row", null, h("span", null, c.name || nameFromPath(c.path)), add, no);
            add.onclick = async () => { add.disabled = no.disabled = true; await addFromPath(c.path, c.category || "game"); row.classList.add("done"); };
            no.onclick = async () => { await call("dismiss-import", c.path); row.remove(); if (!list.children.length) panel.remove(); };
            list.appendChild(row);
        });
        document.body.appendChild(panel);
    });
}

// ---- Missing games -------------------------------------------------------------------------
export async function missingNotice(onChange) {
    const missing = (await call("check-missing-games")) || [];
    if (!missing.length) return null;
    const box = h("div.notice.missing", null, icon("info"),
        h("div.grow", null, h("strong", null, missing.length === 1 ? `${missing[0].name} can't be found` : `${plural(missing.length, "item")} can't be found`),
            h("p", null, "Moved, or uninstalled? Point Riftgate to where it is now, or remove it."),
            h("div.missing-list", null, missing.map((m) => {
                const row = h("div.ni-row", null, h("span", null, m.name),
                    h("button.btn", { type: "button", onclick: async () => {
                        const exe = await call("select-exe");
                        if (!exe) return;
                        const games = (await call("load-games")) || [];
                        const old = games.find((g) => g.path === m.path);
                        if (!old) return;
                        await call("save-game", { ...old, path: exe });
                        await call("remove-game", m.path);
                        toast(`${m.name} found`); changed(); row.remove(); onChange && onChange();
                    } }, icon("folder"), "Locate"),
                    h("button.btn.ghost", { type: "button", onclick: async () => { await call("remove-game", m.path); toast(`Removed ${m.name}`); changed(); row.remove(); onChange && onChange(); } }, icon("trash"), "Remove"));
                return row;
            }))));
    return box;
}

// ---- Manage one item (inside its details) ----------------------------------------------------
const CATEGORIES = [["game", "Game"], ["vr", "VR"], ["app", "App"], ["other", "Other"]];
export function manageBox(item, close) {
    const g = item.raw || {};
    const notes = h("textarea.input.note-input", { rows: 3, maxlength: 4000, placeholder: "Notes: keys, mods, where you left off…" });
    notes.value = g.notes || "";
    let t = null;
    notes.addEventListener("input", () => { clearTimeout(t); t = setTimeout(async () => { await call("update-game", { path: g.path, notes: notes.value.trim() || null }); g.notes = notes.value; }, 600); });
    const cat = h("select.input", { "aria-label": "Category" }, CATEGORIES.map(([v, l]) => h("option", { value: v }, l)));
    cat.value = CATEGORIES.some(([v]) => v === g.category) ? g.category : "game";
    cat.addEventListener("change", async () => { await call("update-game", { path: g.path, category: cat.value }); g.category = cat.value; toast(`${item.title} is now in ${cat.options[cat.selectedIndex].text}`); changed(); });
    const btn = (label, ico, fn, cls = "") => h(`button.btn${cls}`, { type: "button", onclick: fn }, icon(ico), label);
    return h("section.detail-section.manage", null,
        h("h3", null, "Manage"),
        h("label.field", null, h("span", null, "Notes"), notes),
        h("div.manage-row", null,
            h("label.field", null, h("span", null, "Category"), cat),
            h("div.manage-actions", null,
                btn("Change cover", "grid", async () => {
                    const img = await call("select-cover-image", item.title);
                    if (!img) return;
                    await call("update-game", { path: g.path, image: img });
                    toast("Cover changed"); changed(); close && close();
                }),
                btn("Show in folder", "folder", async () => { if (!(await call("r2-show-in-folder", g.path))) toast("This one doesn't live in a folder Riftgate can open (a store launcher link, or it moved).", "err"); }),
                btn("Find mods", "search", () => openExternal(`https://www.google.com/search?q=${encodeURIComponent(item.title + " mods")}`)),
                btn("Uninstall", "trash", async () => {
                    const r = await call("uninstall-game", { path: g.path, name: item.title });
                    if (!r || !r.success) { toast((r && r.error) || "Couldn't find an uninstaller for this.", "err"); return; }
                    toast(`Opened the uninstaller for ${r.displayName || item.title}. When it's done, remove it here too.`);
                }),
                btn("Remove from Riftgate", "x", async () => { await call("remove-game", g.path); toast(`Removed ${item.title} (it stays installed)`); changed(); close && close(); }, ".ghost"))));
}
