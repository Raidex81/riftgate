// Riftgate — the Christmas Rift's advent calendar (season.js). Twenty-four
// wrapped doors, one a day from 1 to 24 December. Behind each one: something
// Christmassy from your worlds (a game, a film, a series or a book, by what
// reviewers and players think of it) or a Christmas fact; behind the 24th,
// Christmas itself. A door missed is still there the next day, until
// 6 January. Open all 24 for the Twenty-four doors seal. What's behind each
// door is kept, so it's the same every time you look.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import * as season from "../app/season.js";
import * as journal from "../app/store.js";
import { flag } from "../app/seals.js";
import { christmasFacts } from "../app/facts.js";
import { christmasPicks } from "./today.js";
import { openDetail } from "./detail.js";
import { presentSVG, WRAPS } from "./yule-art.js";
import { burst, huntLine } from "./present-hunt.js";

// the doors, in a real calendar's jumble
const ORDER = [7, 15, 2, 22, 11, 18, 4, 20, 13, 1, 24, 9, 16, 5, 12, 21, 3, 19, 8, 14, 23, 6, 17, 10];
const key = () => `advent:${season.seasonYear()}`;
const opened = () => journal.pref(key(), {}) || {};
// the last door you may open today: none in November, today's in December, all of them in January
function lastDoor(d = new Date()) {
    const m = d.getMonth() + 1;
    return m === 12 ? Math.min(24, d.getDate()) : m === 1 ? 24 : 0;
}
const daysTo = (d = new Date()) => Math.ceil((new Date(d.getFullYear(), 11, 1) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400e3);

// ---- The band in Nexus ------------------------------------------------------------------
export function adventBand() {
    if (!season.onDates("christmas")) return null;
    const last = lastDoor(), have = opened();
    const waiting = Array.from({ length: last }, (_, i) => i + 1).filter((d) => !have[d]);
    const line = last === 0
        ? `It opens on 1 December${daysTo() > 1 ? `, in ${daysTo()} days` : ", tomorrow"}. Until then, look for the presents hidden around Riftgate.`
        : waiting.length === 0
            ? (last < 24 ? `Every door so far is open. Door ${last + 1} opens tomorrow.` : "Every door is open. Merry Christmas!")
            : waiting.length === 1 ? `Door ${waiting[0]} is waiting for you.` : `${waiting.length} doors are waiting for you, door ${waiting[waiting.length - 1]} the newest.`;
    const gift = h("div");
    gift.innerHTML = presentSVG(0);
    return h("section.advent-band", { "aria-label": "Advent calendar" },
        gift.firstElementChild,
        h("div.grow", null, h("h3", null, "Advent calendar"), h("p", null, line), h("span.hunt-count", null, icon("gift"), " ", huntLine())),
        h("button.btn.primary", { type: "button", onclick: () => openAdvent() }, icon("calendar"), last ? "Open the calendar" : "Take a look"));
}

// ---- What's behind a door ----------------------------------------------------------------------
const keep = (i) => ({ key: i.key, title: i.title, type: i.type, kind: i.kind, image: i.image || null, backdrop: i.backdrop || null, sub: i.sub || "", url: i.url || null, tmdbId: i.tmdbId || null, desc: String(i.desc || "").slice(0, 400) });
let picks = null;
async function surprise(day, have) {
    if (day === 24) return { kind: "christmas" };
    const facts = christmasFacts();
    if (day % 2) {
        if (!picks) picks = christmasPicks({ limit: 40 }).catch(() => []);
        const list = (await picks) || [];
        const used = new Set(Object.values(have).map((c) => c && c.item && c.item.key));
        const fresh = list.filter((i) => i && i.key && !used.has(i.key));
        if (fresh.length) return { kind: "pick", item: keep(fresh[(day * 7) % Math.min(fresh.length, 12)]) };
    }
    return { kind: "fact", text: facts[(day * 3) % facts.length] };
}

// ---- The calendar --------------------------------------------------------------------------
let openNow = null;
export function openAdvent() {
    if (openNow) return;
    const grid = h("div.advent-grid");
    const note = h("p.advent-note");
    const box = h("div.advent-box", null,
        h("div.advent-head", null,
            h("div.grow", null, h("h2", null, "Advent calendar"),
                h("p", null, "One door a day, from 1 to 24 December. Behind each: something for Christmas from your worlds, or a Christmas fact. Missed one? It waits for you until 6 January.")),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
        grid, note);
    const wrap = h("div.advent", { role: "dialog", "aria-modal": "true", "aria-label": "Advent calendar", onclick: (e) => { if (e.target === wrap) close(); } }, box);
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    function close() { document.removeEventListener("keydown", onKey, true); wrap.remove(); openNow = null; }
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    openNow = wrap;

    const inside = (c) => {
        const el = h("div.advent-inside");
        if (!c) return el;
        if (c.kind === "christmas") el.append(h("div", null, h("span.icon-wrap", null, icon("gift")), h("b", { style: { display: "block", fontSize: "15px", marginTop: "4px" } }, "Merry Christmas!"), h("span", null, "from Riftgate")));
        else if (c.kind === "fact") el.append(h("span.advent-fact", null, c.text));
        else if (c.kind === "pick") {
            const it = c.item;
            if (it.image) el.append(h("img", { src: coverSrc(it.image), alt: "", loading: "lazy", onerror: (e) => e.target.remove() }));
            el.append(h("span.advent-tag", { translate: "no" }, it.title),
                h("button.advent-open-item", { type: "button", "aria-label": `Open ${it.title}`, onclick: () => { close(); openDetail(it); } }));
        }
        return el;
    };

    const paint = () => {
        const have = opened(), last = lastDoor(), today = new Date().getMonth() === 11 ? new Date().getDate() : 0;
        clear(grid);
        ORDER.forEach((day, i) => {
            const w = WRAPS[i % WRAPS.length];
            const c = have[day];
            const can = day <= last;
            const door = h(`div.advent-door${c ? ".open" : ""}${!c && day === today ? ".today" : ""}`, { dataset: { day: String(day) } }, inside(c));
            const leaf = h("button.advent-leaf", { type: "button", disabled: !can || !!c || null, style: { "--wrap": w.box, "--rib": w.ribbon },
                "aria-label": can ? `Open door ${day}` : `Door ${day} opens on ${day} December`,
                title: can ? "" : `Opens on ${day} December` },
                h("b", null, String(day)), !can ? h("small", null, `${day} Dec`) : null);
            leaf.addEventListener("click", async () => {
                if (leaf.disabled) return;
                leaf.disabled = true;
                const now = opened();
                const what = now[day] || await surprise(day, now);
                const next = { ...opened(), [day]: what };
                await journal.setPref(key(), next);
                door.replaceChild(inside(what), door.firstChild);
                door.classList.add("open", "just");
                door.classList.remove("today");
                requestAnimationFrame(() => door.classList.remove("just"));
                const r = door.getBoundingClientRect();
                burst(r.left + r.width / 2, r.top + r.height / 2, day === 24 ? 60 : 22);
                if (Object.keys(next).length >= 24) flag("advent");
                paintNote();
            });
            door.appendChild(leaf);
            grid.appendChild(door);
        });
        paintNote();
    };
    const paintNote = () => {
        const n = Object.keys(opened()).length, last = lastDoor();
        note.textContent = last === 0
            ? `The first door opens on 1 December${daysTo() > 1 ? `, in ${daysTo()} days` : ", tomorrow"}. ${huntLine()}.`
            : `${n} of 24 doors open. ${huntLine()}.`;
    };
    paint();
    box.querySelector(".advent-door.today .advent-leaf, .advent-leaf:not(:disabled)")?.focus();
}
