// Riftgate — Rift Rewind: your year in the rift, one big moment at a time.
// What you finished (by kind), your favourites, your most-played game, the
// free games you claimed, the Seals you earned, and at the end your rift
// itself, with all its relics, on a card you can save and share.
// Ready every year from 1 December to 15 January; "your year so far" from
// the Journal any time.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import * as journal from "../app/store.js";
import * as D from "../app/data.js";
import * as S from "../app/seals.js";
import { call } from "../app/api.js";
import { hours } from "../app/format.js";
import { Rift } from "./rift.js";
import { toast } from "./toast.js";

const KINDS = [["game", "games", "--type-game"], ["film", "films", "--type-film"], ["series", "series", "--type-series"], ["anime", "anime", "--type-anime"], ["book", "books", "--type-book"]];

// The Rewind's year: December and the first half of January look back on that year
export function rewindYear(d = new Date()) { return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); }
export function rewindSeason(d = new Date()) { return (d.getMonth() === 11) || (d.getMonth() === 0 && d.getDate() <= 15); }

export async function yearIn(year) {
    await journal.load();
    const inYear = (t) => t && new Date(t).getFullYear() === year;
    const es = journal.entries().filter((e) => e.item);
    const done = es.filter((e) => e.status === "completed" && inYear(e.completedAt || e.updatedAt));
    const byKind = Object.fromEntries(KINDS.map(([k]) => [k, done.filter((e) => e.item.type === k).length]));
    const loved = es.filter((e) => (e.rating >= 4 || e.favourite) && inYear(e.updatedAt)).sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0)).slice(0, 5);
    const lib = await D.library().catch(() => []);
    const games = lib.filter((g) => g.type === "game" && g.playtime);
    const top = games.slice().sort((a, b) => b.playtime - a.playtime)[0] || null;
    const seals = Object.entries(S.earned()).filter(([, t]) => inYear(t)).map(([id]) => S.SEALS.find((x) => x.id === id)).filter(Boolean);
    const relics = es.filter((e) => e.status === "completed").sort((a, b) => (a.completedAt || a.updatedAt || 0) - (b.completedAt || b.updatedAt || 0)).map((e) => ({ type: e.item.type || "game", at: e.completedAt || e.updatedAt || 0 }));
    return { year, done, byKind, loved, top, played: games.reduce((s, g) => s + g.playtime, 0), claims: S.count(`claims-${year}`), seals, relics, tracked: es.filter((e) => inYear(e.updatedAt)).length };
}

export async function openRewind(year = rewindYear()) {
    const y = await yearIn(year);
    const soFar = year === new Date().getFullYear() && new Date().getMonth() < 11;
    const canvas = h("canvas", { "aria-hidden": "true" });
    const stage = h("div.rw-stage");
    const dots = h("div.rw-dots");
    const wrap = h("div.rw", { role: "dialog", "aria-modal": "true", "aria-label": `Rift Rewind ${year}` },
        canvas, dots, stage,
        h("button.icon-btn.rw-close", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x")),
        h("button.rw-prev", { type: "button", "aria-label": "Back", onclick: () => go(i - 1) }, icon("left")),
        h("button.rw-next", { type: "button", "aria-label": "Next", onclick: () => go(i + 1) }, icon("right")));
    const rift = new Rift(canvas, { cx: .5, cy: .5, scale: 1.25, intensity: .8 });
    rift.setRelics(y.relics);

    const big = (n, label) => h("div.rw-big", null, h("b", null, n), h("span", null, label));
    const total = y.done.length;
    const slides = [
        () => [h("p.rw-kicker", null, icon("rift"), soFar ? "Your year so far" : "Rift Rewind"), h("h1.rw-title", null, String(year)), h("p.rw-sub", null, soFar ? "Everything you've played, watched and read this year, until today." : "Your year in the rift: everything you played, watched and read.")],
        () => total ? [h("p.rw-kicker", null, "You finished"), big(total.toLocaleString(), total === 1 ? "thing" : "things"),
            h("div.rw-kinds", null, KINDS.filter(([k]) => y.byKind[k]).map(([k, label, c]) => h("div.rw-kind", { style: { "--c": `var(${c})` } },
                h("b", null, String(y.byKind[k])), h("span", null, y.byKind[k] === 1 ? label.replace(/s$/, "") : label),
                h("i", { style: { width: `${Math.max(6, y.byKind[k] / Math.max(...Object.values(y.byKind)) * 100)}%` } }))))]
            : [h("p.rw-kicker", null, "This year"), big(String(y.tracked), y.tracked === 1 ? "thing in your Journal" : "things in your Journal"), h("p.rw-sub", null, "Mark what you finish as Completed and next year's Rewind will tell its story.")],
        () => y.loved.length ? [h("p.rw-kicker", null, "What you loved"), h("div.rw-loved", null, y.loved.map((e, k) => h("div.rw-love", { style: { "--i": String(k) } },
            e.item.image ? h("img", { src: coverSrc(e.item.image), alt: "", onerror: (ev) => ev.target.remove() }) : h("span.rw-noart", null, icon("gem")),
            h("b", null, e.item.title), h("span", null, e.rating ? "★".repeat(e.rating) : "Favourite"))))] : null,
        () => y.top ? [h("p.rw-kicker", null, "Your most-played game"), h("h2.rw-name", null, y.top.title), big(hours(y.top.playtime) || "", "played"),
            h("p.rw-sub", null, `${hours(y.played)} across every game on your shelf.`)] : null,
        () => y.claims ? [h("p.rw-kicker", null, "Free, and yours"), big(String(y.claims), y.claims === 1 ? "free game claimed" : "free games claimed"), h("p.rw-sub", null, "Riftgate told you; you were quick.")] : null,
        () => y.seals.length ? [h("p.rw-kicker", null, "Seals earned"), big(String(y.seals.length), y.seals.length === 1 ? "seal" : "seals"),
            h("div.rw-seals", null, y.seals.slice(0, 8).map((x) => h("span.rw-seal", null, icon(x.icon), x.name)))] : null,
        () => [h("p.rw-kicker", null, "Your rift"), h("p.rw-sub", null, y.relics.length ? `${y.relics.length.toLocaleString()} relics orbit it now, one for everything you've ever finished.` : "It's waiting for its first relic."),
            h("div.rw-actions", null,
                h("button.btn.primary.lg", { type: "button", onclick: saveCard }, icon("download"), "Save my card"),
                h("button.btn.lg", { type: "button", onclick: () => close() }, "Close"))]
    ].filter((f) => f() !== null);

    let i = 0;
    function go(n) {
        if (n < 0) return;
        if (n >= slides.length) { close(); return; }
        i = n;
        clear(stage).append(h("div.rw-slide", null, slides[i]()));
        clear(dots).append(...slides.map((_, k) => h(k <= i ? "i.on" : "i")));
        wrap.querySelector(".rw-prev").hidden = i === 0;
        wrap.classList.toggle("last", i === slides.length - 1);
        if (i === slides.length - 1) rift.strikeNow({ golden: true });
    }
    const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { if (e.target.closest && e.target.closest("button") && e.key !== "ArrowRight") return; e.preventDefault(); go(i + 1); }
        else if (e.key === "ArrowLeft") go(i - 1);
    };
    stage.addEventListener("click", (e) => { if (!e.target.closest("button")) go(i + 1); });
    document.addEventListener("keydown", onKey, true);
    function close() { rift.destroy(); wrap.remove(); document.removeEventListener("keydown", onKey, true); }
    document.body.appendChild(wrap);
    go(0);

    // The card: 1200 × 630, your rift with its relics, the year and its numbers
    async function saveCard() {
        const W = 1200, H = 630, c = document.createElement("canvas"); c.width = W; c.height = H;
        const x = c.getContext("2d");
        const css = (v, fb) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb;
        const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, css("--void", "#07050d")); g.addColorStop(1, css("--nebula", "#120b22"));
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        // the rift, drawn once at card size
        const rc = document.createElement("canvas"); rc.style.cssText = `position:fixed;left:-9999px;width:${H}px;height:${H}px`; document.body.appendChild(rc);
        const r = new Rift(rc, { cx: .5, cy: .5, scale: 1, intensity: 1 }); r.stop(); r.setRelics(y.relics); r.draw(0);
        await new Promise((res) => setTimeout(res, 300)); r.draw(0);
        x.drawImage(rc, W - H - 20, 0, H, H);
        r.destroy(); rc.remove();
        x.fillStyle = css("--amethyst-soft", "#b98cff"); x.font = `600 22px ${css("--font", "sans-serif")}`; x.fillText(soFar ? "MY YEAR SO FAR IN THE RIFT" : "MY YEAR IN THE RIFT", 64, 110);
        x.fillStyle = "#ffffff"; x.font = `700 120px ${css("--font-display", "sans-serif")}`; x.fillText(String(year), 58, 230);
        x.font = `500 30px ${css("--font", "sans-serif")}`;
        const lines = [total ? `${total} finished: ${KINDS.filter(([k]) => y.byKind[k]).map(([k, l]) => `${y.byKind[k]} ${y.byKind[k] === 1 ? l.replace(/s$/, "") : l}`).join(", ")}` : null,
            y.top ? `Most played: ${y.top.title}` : null, y.claims ? `${y.claims} free games claimed` : null, y.seals.length ? `${y.seals.length} seals earned` : null,
            `${y.relics.length} relics in my rift`].filter(Boolean).slice(0, 4);
        x.fillStyle = css("--starlight", "#ede6ff");
        lines.forEach((l, k) => { let t = l; while (x.measureText(t).width > 560 && t.length > 4) t = t.slice(0, -2); if (t !== l) t += "…"; x.fillText(t, 64, 310 + k * 52); });
        x.fillStyle = css("--dust", "#9a8fb8"); x.font = `600 20px ${css("--font", "sans-serif")}`; x.fillText("RIFTGATE · ALL YOUR WORLDS. ONE GATEWAY.", 64, H - 50);
        const res = await call("r2-save-image", { name: `Riftgate Rewind ${year}`, dataUrl: c.toDataURL("image/png") });
        if (res && res.ok) toast("Your card is saved, ready to share.");
        else if (!(res && res.canceled)) toast("The card couldn't be saved.", "err");
    }
}
