// Riftgate — "Add a show to My shows": search any series or anime (TVMaze
// knows tens of thousands, far more than Riftgate's rows show) and follow it.
// Its new episodes then land in Nexus and the Theatre, with a countdown to
// the next one. A show you already follow can be removed from here too.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { call, cached } from "../app/api.js";
import * as D from "../app/data.js";
import * as gate from "../app/mature.js";
import { toast } from "./toast.js";

let openNow = null;

export function openAddShow(startQuery = "") {
    if (openNow) { openNow.input.focus(); return; }
    let mine = new Map(); // tvmaze id -> name
    let changed = false, seq = 0, timer = null;
    const input = h("input.input.addshow-input", { type: "search", placeholder: "Search any series or anime", "aria-label": "Search for a series", autocomplete: "off", value: startQuery, maxlength: 120 });
    const status = h("p.muted.addshow-status", { role: "status" });
    const list = h("div.addshow-list", { role: "list" });
    const box = h("div.wn-box.addshow-box", null,
        h("div.wn-head", null, h("h2", null, "Add a show to My shows"),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
        h("p.muted", null, "Can't find a series in Riftgate? Search for it here and follow it: its new episodes show up in Nexus and the Theatre, with a countdown to the next one."),
        h("label.addshow-search", null, icon("search"), input),
        status, list);
    const wrap = h("div.wn-modal", { role: "dialog", "aria-modal": "true", "aria-label": "Add a show to My shows", onclick: (e) => { if (e.target === wrap) close(); } }, box);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    openNow = { input };
    input.focus();

    cached("get-watchlist", [], { fresh: true }).then((l) => { mine = new Map((l || []).map((s) => [s.id, s.name])); paint(last); });

    let last = [];
    const year = (d) => (d ? String(d).slice(0, 4) : "");
    function paint(results) {
        last = results;
        clear(list);
        results.forEach((s) => {
            const following = mine.has(s.id);
            const btn = h("button.btn" + (following ? "" : ".primary"), { type: "button" });
            const paintBtn = () => { const f = mine.has(s.id); btn.className = "btn" + (f ? " following" : " primary"); clear(btn).append(icon(f ? "check" : "plus"), f ? "In My shows" : "Add"); btn.title = f ? "Click to remove it from My shows" : ""; };
            paintBtn();
            btn.onclick = async () => {
                btn.disabled = true;
                if (mine.has(s.id)) {
                    await call("remove-from-watchlist", s.id);
                    mine.delete(s.id); toast(`${s.name} is no longer in My shows`);
                } else {
                    const r = await call("add-to-watchlist", { id: s.id, name: s.name, image: s.image, premiered: s.premiered });
                    if (r === null) { btn.disabled = false; toast("It couldn't be added. Try again.", "err"); return; }
                    mine.set(s.id, s.name); toast(`${s.name} is in My shows: new episodes will show up in Nexus`);
                }
                changed = true; btn.disabled = false; paintBtn();
            };
            const meta = [year(s.premiered), s.network, s.status === "Ended" ? "Ended" : s.status === "Running" ? "Still running" : s.status, (s.genres || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ");
            list.appendChild(h("div.addshow-row", { role: "listitem" },
                h("div.addshow-art", null, s.image ? h("img", { src: coverSrc(s.image), alt: "", loading: "lazy" }) : icon("tv")),
                h("div.grow", null, h("b", null, s.name), meta ? h("small", null, meta) : null),
                btn));
        });
    }

    async function search() {
        const q = input.value.trim();
        const my = ++seq;
        if (q.length < 2) { status.textContent = q ? "Keep typing…" : ""; paint([]); return; }
        status.textContent = "Searching…";
        const r = await call("search-tv-shows", q);
        if (my !== seq) return; // a newer search is on its way
        const results = (r || []).filter((s) => s && s.name && (!s.isMature || gate.canSeeMature()));
        status.textContent = r === null ? "The search couldn't reach TVMaze. Check your connection." : results.length ? "" : `No series called “${q}”. Try another spelling, or its original title.`;
        paint(results);
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 320); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer); search(); } });
    if (startQuery) search();

    function close() {
        clearTimeout(timer);
        wrap.remove(); document.removeEventListener("keydown", onKey, true);
        openNow = null;
        if (changed) D.watchlistChanged();
    }
}

// "Manage My shows": every show you follow, each with Remove (and Undo,
// until the window closes), so a series you stopped watching is one click away
export function openManageShows() {
    if (openNow) return;
    let changed = false;
    const list = h("div.addshow-list", { role: "list" });
    const status = h("p.muted.addshow-status", { role: "status" }, "Loading your shows…");
    const box = h("div.wn-box.addshow-box", null,
        h("div.wn-head", null, h("h2", null, "My shows"),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
        h("p.muted", null, "The series and anime you follow. Remove one you've stopped watching: its episodes leave Nexus and the Theatre."),
        status, list);
    const wrap = h("div.wn-modal", { role: "dialog", "aria-modal": "true", "aria-label": "Manage My shows", onclick: (e) => { if (e.target === wrap) close(); } }, box);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    openNow = { input: box };

    cached("get-watchlist", [], { fresh: true }).then((shows) => {
        shows = (shows || []).filter((s) => s && s.name).sort((a, b) => a.name.localeCompare(b.name));
        status.textContent = shows.length ? `${shows.length} ${shows.length === 1 ? "show" : "shows"}` : "You don't follow any shows yet. Add a show finds any series or anime.";
        for (const s of shows) {
            let removed = false;
            const btn = h("button.btn", { type: "button" });
            const row = h("div.addshow-row", { role: "listitem" },
                h("div.addshow-art", null, s.image ? h("img", { src: coverSrc(s.image), alt: "", loading: "lazy" }) : icon("tv")),
                h("div.grow", null, h("b", null, s.name), s.premiered ? h("small", null, `Since ${String(s.premiered).slice(0, 4)}`) : null),
                btn);
            const paint = () => { row.classList.toggle("is-removed", removed); clear(btn).append(icon(removed ? "refresh" : "trash"), removed ? "Undo" : "Remove"); btn.title = removed ? `Follow ${s.name} again` : `Stop following ${s.name}`; };
            btn.onclick = async () => {
                btn.disabled = true;
                if (!removed) { await call("remove-from-watchlist", s.id); toast(`${s.name} is no longer in My shows`); }
                else {
                    const r = await call("add-to-watchlist", { id: s.id, name: s.name, image: s.image, premiered: s.premiered });
                    if (r === null) { btn.disabled = false; toast("It couldn't be added back. Try again.", "err"); return; }
                    toast(`${s.name} is back in My shows`);
                }
                removed = !removed; changed = true; btn.disabled = false; paint();
            };
            paint();
            list.appendChild(row);
        }
    }).catch(() => { status.textContent = "Your shows couldn't be loaded. Try again."; });

    function close() {
        wrap.remove(); document.removeEventListener("keydown", onKey, true);
        openNow = null;
        if (changed) D.watchlistChanged();
    }
}
