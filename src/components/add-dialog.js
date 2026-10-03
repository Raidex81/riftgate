// Riftgate — "Add to your library": what opens when you drop shortcuts or
// programs on the window (on any page), or pick one with "Add a game or app".
// Each one gets its cover, its name (editable) and a category. Riftgate works
// the category out by itself when it can (where it's installed, its store,
// Steam's VR flag, a game database) and marks it "Detected"; you can always
// pick another before adding. Already in your library? It says so and skips it.

import { h, icon, clear, art } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as D from "../app/data.js";
import { toast } from "./toast.js";

export const CATEGORIES = [
    { id: "game", label: "Game", icon: "library", hint: "Played on screen" },
    { id: "vr", label: "VR", icon: "vr", hint: "Needs a headset" },
    { id: "app", label: "App", icon: "app", hint: "Software, tools" },
    { id: "other", label: "Other", icon: "list", hint: "Anything else" }
];
const nameFromPath = (p) => String(p).split(/[\\/]/).pop().replace(/\.(exe|lnk|url|app|bat|cmd)$/i, "");
const changed = () => { forget("load-games"); D.library({ fresh: true }); window.dispatchEvent(new CustomEvent("r2-library-changed")); };

let open = null;

// paths: files dropped or picked. Resolves to how many were added.
export function openAddDialog(paths) {
    paths = [...new Set((paths || []).filter(Boolean))];
    if (!paths.length) return Promise.resolve(0);
    // dropped again while open: add them to the same list
    if (open) { paths.forEach((p) => open.add(p)); return open.done; }

    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const entries = [];
    const list = h("div.addlib-list");
    const count = h("span.addlib-count");
    const addBtn = h("button.btn.primary.lg", { type: "button" }, icon("plus"), h("span", null, "Add to library"));
    const cancel = h("button.btn.ghost.lg", { type: "button", onclick: () => close(0) }, "Cancel");
    const note = h("p.addlib-note");
    const box = h("div.addlib-box", { role: "dialog", "aria-modal": "true", "aria-labelledby": "addlib-title" },
        h("div.addlib-head", null,
            h("div.addlib-mark", null, icon("rift")),
            h("div", null, h("h2", { id: "addlib-title" }, "Add to your library"),
                h("p.muted", null, "Riftgate guessed what each one is. Change it if it got it wrong.")),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close(0) }, icon("x"))),
        list,
        h("div.addlib-foot", null, note, h("div.grow"), cancel, addBtn));
    const wrap = h("div.addlib", { onclick: (e) => { if (e.target === wrap) close(0); } }, box);
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(0); } };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);

    function close(n) {
        document.removeEventListener("keydown", onKey, true);
        wrap.classList.add("closing");
        setTimeout(() => wrap.remove(), 180);
        open = null;
        resolveDone(n);
    }

    function refresh() {
        const ready = entries.filter((e) => !e.removed && !e.dupe && !e.failed);
        const missing = ready.filter((e) => !e.category);
        const busy = ready.some((e) => e.loading);
        addBtn.disabled = !ready.length || !!missing.length || busy;
        addBtn.querySelector("span").textContent = ready.length > 1 ? `Add ${ready.length} to library` : "Add to library";
        note.textContent = busy ? "Looking them up…" : missing.length ? `Pick a category for ${missing[0].name || "it"}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""}.` : "";
        count.textContent = String(ready.length);
        if (!entries.some((e) => !e.removed)) close(0);
    }

    function add(p) {
        const e = { path: p, resolved: p, name: nameFromPath(p), category: null, detected: null, reason: null, image: null, loading: true };
        entries.push(e);
        const cover = h("div.addlib-cover");
        const nameIn = h("input.input.addlib-name", { type: "text", value: e.name, maxlength: 120, "aria-label": "Name", oninput: () => { e.name = nameIn.value.trim(); refresh(); } });
        const where = h("p.addlib-where", { title: p }, p);
        const why = h("p.addlib-why");
        const cats = h("div.addlib-cats", { role: "radiogroup", "aria-label": "Category" });
        const paintCats = () => {
            clear(cats);
            CATEGORIES.forEach((c) => cats.appendChild(h("button.addlib-cat", { type: "button", role: "radio", "aria-checked": String(e.category === c.id), "aria-pressed": String(e.category === c.id),
                disabled: e.dupe || e.failed, dataset: { detected: String(e.detected === c.id) },
                onclick: () => { e.category = c.id; paintCats(); paintWhy(); refresh(); } },
                icon(c.icon), h("b", null, c.label), h("small", null, e.detected === c.id ? "Detected" : c.hint))));
        };
        const paintWhy = () => {
            clear(why);
            if (e.dupe) why.append(icon("check"), "Already in your library, so it's skipped.");
            else if (e.failed) why.append(icon("info"), e.failed);
            else if (e.loading) why.append(h("span.addlib-spin"), "Working out what it is…");
            else if (e.detected && e.category === e.detected) why.append(icon("sparkles"), `Detected as ${CATEGORIES.find((c) => c.id === e.detected).label}: ${e.reason || "from where it's installed"}.`);
            else if (e.detected) why.append(icon("info"), `You picked ${CATEGORIES.find((c) => c.id === e.category).label}. Riftgate thought ${CATEGORIES.find((c) => c.id === e.detected).label}.`);
            else if (e.category) why.append(icon("check"), "Your choice.");
            else why.append(icon("info"), "Riftgate couldn't tell what this is. Pick one.");
        };
        const remove = h("button.icon-btn.addlib-remove", { type: "button", "aria-label": "Don't add this one", title: "Don't add this one", onclick: () => { e.removed = true; row.remove(); refresh(); } }, icon("x"));
        const row = h("article.addlib-item", { dataset: { state: "loading" } },
            cover, h("div.addlib-info", null, nameIn, where, cats, why), remove);
        list.appendChild(row);
        const paintCover = () => { clear(cover).appendChild(art(e.image, e.name)); };
        paintCover(); paintCats(); paintWhy(); refresh();

        (async () => {
            try {
                e.resolved = (await call("resolve-shortcut", p)) || p;
                where.textContent = e.resolved; where.title = e.resolved;
                const games = (await call("load-games")) || [];
                if (games.some((g) => String(g.path).toLowerCase() === String(e.resolved).toLowerCase())) {
                    e.dupe = true; e.loading = false; row.dataset.state = "dupe";
                    const g = games.find((x) => String(x.path).toLowerCase() === String(e.resolved).toLowerCase());
                    if (g) { e.name = g.name; nameIn.value = g.name; nameIn.disabled = true; e.image = g.image !== "covers/default.jpg" ? g.image : null; paintCover(); }
                    paintCats(); paintWhy(); refresh();
                    return;
                }
                if (/\.exe$/i.test(e.resolved)) {
                    const described = await call("get-exe-description", e.resolved);
                    if (typeof described === "string" && described.trim().length > 1 && nameIn.value === nameFromPath(p)) { e.name = described.trim(); nameIn.value = e.name; }
                }
                const [det, override] = await Promise.all([call("r2-detect-category", { path: e.resolved, name: e.name }), call("get-override", e.name)]);
                if (det && det.category) {
                    e.detected = det.category; e.reason = det.reason;
                    if (!e.category) e.category = det.category;
                }
                e.trailerId = override && override.trailerId;
                e.loading = false; row.dataset.state = "ready";
                paintCats(); paintWhy(); refresh();
                // the cover can arrive last
                let image = override && override.image ? override.image : null;
                if (!image) {
                    image = await call("find-cover", e.name);
                    if (!image || image === "covers/default.jpg") image = await call("fetch-online-cover", e.name);
                }
                if (image && image !== "covers/default.jpg") { e.image = image; paintCover(); }
            } catch (err) {
                e.loading = false; e.failed = "This one couldn't be read."; row.dataset.state = "failed";
                paintCats(); paintWhy(); refresh();
            }
        })();
    }

    addBtn.onclick = async () => {
        const ready = entries.filter((e) => !e.removed && !e.dupe && !e.failed && e.category);
        if (!ready.length) return;
        addBtn.disabled = true; cancel.disabled = true;
        let n = 0;
        for (const e of ready) {
            const game = { name: e.name || nameFromPath(e.resolved), path: e.resolved, image: e.image || "covers/default.jpg", category: e.category };
            if (e.trailerId) game.trailerId = e.trailerId;
            try { await call("save-game", game); n++; } catch (err) { /* keep going */ }
        }
        changed();
        toast(n === 1 ? `Added ${ready[0].name} to your library` : `Added ${n} to your library`);
        close(n);
    };

    open = { add, done };
    paths.forEach(add);
    return done;
}
