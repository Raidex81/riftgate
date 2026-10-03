// Riftgate 2 — Library: your games, apps and VR, ready to launch.

import { h, icon, clear, art, debounce } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as D from "../app/data.js";
import { card } from "../components/card.js";
import { toast } from "../components/toast.js";
import { hours, ago, plural } from "../app/format.js";
import { missingNotice } from "../app/library-tools.js";
import { openAddDialog } from "../components/add-dialog.js";
import * as journal from "../app/store.js";

const FILTERS = [
    { id: "all", label: "Everything", test: () => true },
    { id: "game", label: "Games", test: (g) => g.type === "game" && !g.vr },
    { id: "vr", label: "VR", test: (g) => g.vr },
    { id: "app", label: "Apps", test: (g) => g.type === "app" }
];
const SORTS = {
    mine: { label: "My order", fn: null },
    recent: { label: "Recently played", fn: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || (b.addedAt || 0) - (a.addedAt || 0) },
    most: { label: "Most played", fn: (a, b) => (b.playtime || 0) - (a.playtime || 0) },
    added: { label: "Recently added", fn: (a, b) => (b.addedAt || 0) - (a.addedAt || 0) },
    az: { label: "Name A–Z", fn: (a, b) => a.title.localeCompare(b.title) }
};

export default {
    async render(root) {
        await journal.load();
        // Your own order (drag cards to set it), kept by Journal key
        let order = journal.pref("library:order", null) || [];
        let filter = "all", sort = order.length ? "mine" : "recent", query = "";
        const grid = h("div.grid");
        const chips = h("div.chips", { role: "group", "aria-label": "Show" });
        const sortSel = h("select.input", { "aria-label": "Sort" }, Object.entries(SORTS).map(([k, s]) => h("option", { value: k }, s.label)));
        sortSel.value = sort;
        const search = h("input.input", { type: "search", placeholder: "Filter your library", "aria-label": "Filter your library", style: { width: "220px" } });
        const summary = h("p");
        const notices = h("div");
        missingNotice(() => reload(true)).then((n) => { if (n && root.isConnected) notices.appendChild(n); });
        const onChanged = () => { if (!root.isConnected) return window.removeEventListener("r2-library-changed", onChanged); reload(true); };
        window.addEventListener("r2-library-changed", onChanged);

        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Library"), summary),
                h("div.actions", null,
                    h("button.btn", { type: "button", onclick: () => scanPc(reload) }, icon("search"), "Scan this PC"),
                    h("button.btn.primary", { type: "button", onclick: () => addOne(reload) }, icon("plus"), "Add a game or app"))),
            notices,
            h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "28px" } }, chips, h("div", { style: { flex: 1 } }), search, sortSel),
            grid,
            h("p.muted.drop-hint", null, icon("plus"), "Tip: drag cards to put them in your own order (or Ctrl + arrows). Drop a game, app or shortcut anywhere on the window to add it."));

        let all = [];
        async function reload(fresh) {
            if (fresh) forget("load-games");
            all = await D.library({ fresh });
            const total = all.reduce((s, g) => s + (g.playtime || 0), 0);
            summary.textContent = all.length
                ? `${plural(all.filter((g) => g.type === "game").length, "game")}, ${plural(all.filter((g) => g.type === "app").length, "app")}${total ? ` · ${hours(total)} played in total` : ""}`
                : "";
            paint();
        }

        function paint() {
            clear(chips);
            FILTERS.forEach((f) => {
                const n = all.filter(f.test).length;
                if (f.id !== "all" && !n) return;
                chips.appendChild(h("button.chip", { type: "button", "aria-pressed": String(filter === f.id), onclick: () => { filter = f.id; paint(); } }, f.label, h("span.n", null, String(n))));
            });
            const q = query.trim().toLowerCase();
            const list = all.filter(FILTERS.find((f) => f.id === filter).test)
                .filter((g) => !q || g.title.toLowerCase().includes(q))
                .sort(sort === "mine" ? byMine : SORTS[sort].fn);
            clear(grid);
            if (!all.length) {
                grid.replaceWith(emptyState(reload));
                return;
            }
            const frag = document.createDocumentFragment();
            list.forEach((g) => { const c = card(g, { foot: footFor(g) }); makeDraggable(c, g); frag.appendChild(c); });
            grid.appendChild(frag);
            if (!list.length) grid.appendChild(h("p.row-empty", null, `Nothing in your library matches “${query}”.`));
        }

        // ---- Drag and drop to reorder ------------------------------------------------
        // The card you drag travels through the grid as you move (the others
        // glide aside); letting go saves the order and switches to "My order".
        // Keyboard / controller: Ctrl + ← → (or ↑ ↓) moves the focused card.
        const rank = () => new Map(order.map((k, i) => [k, i]));
        let ranks = rank();
        function byMine(a, b) {
            const ra = ranks.has(a.key) ? ranks.get(a.key) : Infinity, rb = ranks.has(b.key) ? ranks.get(b.key) : Infinity;
            return ra - rb || SORTS.recent.fn(a, b);
        }
        // the full order, as currently shown when "My order" isn't on yet
        const fullOrder = () => all.slice().sort(sort === "mine" ? byMine : SORTS[sort].fn).map((g) => g.key);
        async function saveOrder(keys) {
            order = keys; ranks = rank();
            if (sort !== "mine") { sort = "mine"; sortSel.value = "mine"; }
            await journal.setPref("library:order", keys);
        }
        // place `key` just before `beforeKey` (or at the end) in the full order
        function moveKey(key, beforeKey) {
            const keys = fullOrder().filter((k) => k !== key);
            const i = beforeKey ? keys.indexOf(beforeKey) : -1;
            keys.splice(i < 0 ? keys.length : i, 0, key);
            return keys;
        }
        // smooth slide of the cards that moved (FLIP)
        function glide(mutate) {
            const cards = [...grid.children].filter((c) => c.classList.contains("card"));
            const before = new Map(cards.map((c) => [c, c.getBoundingClientRect()]));
            mutate();
            cards.forEach((c) => {
                const a = before.get(c), b = c.getBoundingClientRect();
                const dx = a.left - b.left, dy = a.top - b.top;
                if (!dx && !dy) return;
                c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" });
            });
        }
        let dragged = null;
        function makeDraggable(c, g) {
            c.draggable = true;
            c.addEventListener("dragstart", (e) => {
                dragged = c;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-riftgate-card", g.key);
                requestAnimationFrame(() => { c.classList.add("lib-dragging"); grid.classList.add("lib-sorting"); });
            });
            c.addEventListener("dragend", () => {
                c.classList.remove("lib-dragging"); grid.classList.remove("lib-sorting");
                if (!dragged) return;
                dragged = null;
                const shown = [...grid.children].filter((x) => x._item).map((x) => x._item.key);
                const i = shown.indexOf(g.key);
                const next = shown[i + 1] || null;
                // keep it right after the one before it if it went last among what's shown
                saveOrder(next ? moveKey(g.key, next) : moveAfter(g.key, shown[i - 1]));
            });
            c.addEventListener("dragover", (e) => {
                if (!dragged || dragged === c) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = c.getBoundingClientRect();
                const after = (e.clientX - r.left) > r.width / 2;
                const ref = after ? c.nextSibling : c;
                if (ref === dragged || dragged.nextSibling === ref) return;
                glide(() => grid.insertBefore(dragged, ref));
            });
            c.addEventListener("drop", (e) => e.preventDefault());
            c.addEventListener("keydown", (e) => {
                if (!e.ctrlKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                e.preventDefault(); e.stopPropagation();
                const shown = [...grid.children].filter((x) => x._item);
                const i = shown.indexOf(c);
                const cols = Math.max(1, Math.round(grid.clientWidth / (c.offsetWidth || 1)));
                const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -cols : cols;
                const j = Math.max(0, Math.min(shown.length - 1, i + step));
                if (j === i) return;
                glide(() => grid.insertBefore(c, j > i ? shown[j].nextSibling : shown[j]));
                c.focus();
                const keys = [...grid.children].filter((x) => x._item).map((x) => x._item.key);
                const k = keys.indexOf(g.key);
                saveOrder(keys[k + 1] ? moveKey(g.key, keys[k + 1]) : moveAfter(g.key, keys[k - 1]));
            });
        }
        function moveAfter(key, afterKey) {
            const keys = fullOrder().filter((k) => k !== key);
            const i = afterKey ? keys.indexOf(afterKey) : -1;
            keys.splice(i + 1, 0, key);
            return keys;
        }
        grid.addEventListener("dragover", (e) => { if (dragged) e.preventDefault(); });

        sortSel.addEventListener("change", () => { sort = sortSel.value; paint(); });
        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 100));
        await reload(false);
    },
    rollTitle: "What to play tonight",
    async rollPool() { return (await D.library()).filter((g) => g.type === "game"); }
};

function footFor(g) {
    const bits = [];
    if (g.playtime) bits.push(h("span", { style: { display: "inline-flex", gap: "4px", alignItems: "center" } }, icon("clock"), hours(g.playtime)));
    bits.push(h("span.muted", null, g.lastPlayed ? ago(g.lastPlayed) : "Not played yet"));
    return bits;
}

function emptyState(reload) {
    return h("div.empty", null, icon("library"),
        h("h3", null, "Your library is empty"),
        h("p", null, "Scan this PC to find installed games and apps, or add one by hand. Already use Riftgate? Import it from Nexus."),
        h("div", { style: { display: "flex", gap: "8px" } },
            h("button.btn.primary", { type: "button", onclick: () => scanPc(reload) }, icon("search"), "Scan this PC"),
            h("button.btn", { type: "button", onclick: () => addOne(reload) }, icon("plus"), "Add a game or app")));
}

async function addOne(reload) {
    const exe = await call("select-exe");
    if (!exe) return;
    if (await openAddDialog([exe])) reload(true);
}

// Scan: list what's installed and not in the library yet; pick and add.
async function scanPc(reload) {
    const list = h("div.grid", { style: { "--card-w": "150px" } });
    const status = h("span.muted", null, "Looking through Steam, Epic, GOG, Xbox and installed programs…");
    const addBtn = h("button.btn.primary", { type: "button", disabled: true }, icon("plus"), "Add selected");
    const scrim = h("div.scrim", { onclick: close });
    const panel = h("div.browser", { role: "dialog", "aria-modal": "true", "aria-label": "Scan this PC" },
        h("div.browser-head", null, h("div", null, h("h2", null, "Scan this PC"), status),
            h("div.tools", null, addBtn, h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: close }, icon("x")))),
        h("div.browser-body", null, list));
    document.body.append(scrim, panel);
    function close() { scrim.remove(); panel.remove(); }

    const found = (await call("scan-all-installed")) || [];
    if (!panel.isConnected) return;
    if (!found.length) { status.textContent = "Everything installed is already in your library."; return; }
    status.textContent = `${plural(found.length, "item")} found. Games are selected; pick anything else you want.`;
    const picked = new Set(found.filter((f) => f.category === "game"));
    const sync = () => { addBtn.disabled = !picked.size; addBtn.lastChild.textContent = picked.size ? `Add ${picked.size} selected` : "Add selected"; };
    found.forEach((f) => {
        const c = h("button.card", { type: "button", "aria-pressed": String(picked.has(f)), title: f.path },
            h("div.card-frame", null, h("div.card-body", null, art(null, f.name), h("div.card-info", null,
                h("div.card-title", null, f.name), h("div.card-sub", null, f.category === "game" ? "Game" : "App")))));
        const paintSel = () => { c.classList.toggle("is-featured", picked.has(f)); c.setAttribute("aria-pressed", String(picked.has(f))); };
        c.onclick = () => { picked.has(f) ? picked.delete(f) : picked.add(f); paintSel(); sync(); };
        paintSel();
        list.appendChild(c);
        call("find-game-cover", f.name).then((url) => { if (url && c.isConnected) c.querySelector(".card-art").replaceWith(art(url, f.name)); f.image = url; });
    });
    sync();
    addBtn.onclick = async () => {
        addBtn.disabled = true;
        for (const f of picked) {
            await call("save-game", { name: f.name, path: f.path, category: f.category || "game", image: f.image || "covers/default.jpg" });
        }
        toast(`Added ${plural(picked.size, "item")} to your library`);
        close();
        reload(true);
    };
}
