// Riftgate 2 — Nexus: everything that matters right now, across every world.

import { h, icon } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as D from "../app/data.js";
import * as journal from "../app/store.js";
import { hero } from "../components/hero.js";
import { row } from "../components/row.js";
import { toast } from "../components/toast.js";
import { hours, until, plural } from "../app/format.js";

const WEEK = 7 * 86400000;

async function continueJourney() {
    const [lib] = await Promise.all([D.library(), journal.load()]);
    const byKey = new Map(lib.map((g) => [g.key, g]));
    const out = new Map();
    // What you marked as in progress, most recently touched first
    journal.entries()
        .filter((e) => e.status === "progress" && e.item)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .forEach((e) => out.set(e.key, byKey.get(e.key) || { ...e.item, key: e.key, kind: e.item.kind || "journal" }));
    // Then what you actually played lately
    lib.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 12)
        .forEach((g) => { if (!out.has(g.key)) out.set(g.key, g); });
    return [...out.values()];
}

async function slides() {
    const pick = (p, fn) => p.then(fn).catch(() => null);
    const list = await Promise.all([
        pick(D.freeGames(), (l) => {
            const fresh = l.filter((g) => !g.alwaysFree && g.image).sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0))[0];
            return fresh && { item: fresh, kicker: `Free right now on ${fresh.source}`, kickerIcon: "gift", action: { label: "Get it free", icon: "gift", run: () => openExternal(fresh.url) } };
        }),
        pick(D.inCinemas(), (l) => {
            const f = l.find((m) => m.backdrop && !m.mature);
            return f && { item: f, kicker: "In cinemas near you", kickerIcon: "film", action: { label: "Find tickets", icon: "ticket", run: () => openExternal(`https://www.google.com/search?q=${encodeURIComponent(f.title + " showtimes")}`) } };
        }),
        pick(D.newSeries(), (l) => {
            const s = l.find((x) => x.backdrop && !x.mature);
            return s && { item: s, kicker: "New series", kickerIcon: "tv" };
        }),
        pick(D.deals(), (l) => {
            const d = l.filter((x) => (x.price.discount || 0) >= 50).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
            return d && { item: { ...d, desc: `${d.price.discount}% off on ${d.source}.` }, kicker: "Deal worth it", kickerIcon: "tag", action: { label: "View deal", icon: "tag", run: () => openExternal(d.url) } };
        }),
        pick(D.upcomingGames(), (l) => {
            const u = l.find((x) => x.image);
            return u && { item: { ...u, desc: `${until(u.date)}${u.platforms.length ? " · " + u.platforms.slice(0, 3).join(", ") : ""}` }, kicker: "Coming soon", kickerIcon: "calendar" };
        })
    ]);
    return list.filter(Boolean);
}

function pulse() {
    const strip = h("div.pulse");
    const item = (ico, n, label, hash) => {
        const el = h("button.pulse-item", { type: "button", onclick: () => { location.hash = hash; } }, icon(ico), h("b", null, n), h("span", null, label));
        strip.appendChild(el);
    };
    Promise.all([D.freeGames(), D.deals(), D.latestEpisodes(), D.library()]).then(([f, d, eps, lib]) => {
        const fresh = f.filter((g) => !g.alwaysFree && g.firstSeenAt && Date.now() - g.firstSeenAt < WEEK).length;
        item("gift", f.length.toLocaleString(), fresh ? `free games, ${fresh} new this week` : "free games right now", "free");
        const big = d.filter((x) => (x.price.discount || 0) >= 75).length;
        if (d.length) item("tag", big.toLocaleString(), "deals at 75% off or more", "deals");
        const newEps = eps.filter((e) => e.date && Date.now() - Date.parse(e.date) < WEEK).length;
        if (eps.length) item("tv", String(newEps), newEps === 1 ? "new episode this week" : "new episodes this week", "theatre");
        if (lib.length) {
            const total = lib.reduce((s, g) => s + (g.playtime || 0), 0);
            const n = lib.filter((g) => g.type === "game").length;
            item("library", n.toLocaleString(), `${n === 1 ? "game" : "games"} in your library${total ? `, ${hours(total)} played` : ""}`, "library");
        }
    });
    return strip;
}

async function importNotice(root) {
    const info = await call("r2-riftgate-available");
    if (!info || !info.available || info.alreadyImported) return;
    const btn = h("button.btn.primary", { type: "button" }, icon("import"), "Import from Riftgate");
    const n = h("div.notice", null, icon("import"),
        h("div.grow", null,
            h("strong", null, "Bring your Riftgate with you"),
            h("p", null, `Found ${plural(info.games, "item")} in your library, ${plural(info.shows, "tracked show")} and ${plural(info.books, "book")}. Riftgate 2 copies them; the original app keeps working untouched.`)),
        btn,
        h("button.icon-btn", { type: "button", "aria-label": "Not now", onclick: () => { n.remove(); journal.setPref("import-dismissed", true); } }, icon("x")));
    if (journal.pref("import-dismissed", false)) return;
    btn.onclick = async () => {
        btn.disabled = true; btn.lastChild.textContent = "Importing…";
        const r = await call("r2-import-riftgate");
        if (r && r.ok) { toast("Imported from Riftgate"); D.refreshAll(); location.reload(); }
        else { toast(`Import didn't finish: ${(r && r.error) || "unknown error"}`, "err"); btn.disabled = false; btn.lastChild.textContent = "Try again"; }
    };
    root.prepend(n);
}

export default {
    async render(root) {
        const hr = hero(slides());
        const body = h("div");
        root.append(hr, pulse(), body);
        importNotice(body);

        body.append(
            row({ title: "Continue your journey", icon: "rift", items: continueJourney(), hideEmpty: true, cardOpts: { showType: true } }),
            row({ title: "Free right now", icon: "gift", seeAllTitle: "All free games",
                items: D.freeGames().then((l) => l.filter((g) => !g.alwaysFree).sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0))) }),
            row({ title: "New episodes", icon: "tv", items: D.latestEpisodes(), hideEmpty: true }),
            row({ title: "In cinemas", icon: "film", items: D.inCinemas().then((l) => l.filter((m) => !m.mature)) }),
            row({ title: "Deals worth it", icon: "tag", items: D.deals().then((l) => l.filter((d) => (d.price.discount || 0) >= 50).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) }),
            row({ title: "Coming soon", icon: "calendar", wide: true, items: D.upcomingGames(), cardOpts: { wide: true } }),
            row({ title: "New series", icon: "tv", items: D.newSeries().then((l) => l.filter((s) => !s.mature)) }),
            row({ title: "New anime", icon: "sparkles", items: D.newAnime().then((l) => l.filter((s) => !s.mature)) })
        );
        return () => hr.destroy();
    },
    rollTitle: "Open a random rift",
    async rollPool() {
        const [f, lib, c] = await Promise.all([D.freeGames(), D.library(), D.inCinemas()]);
        return [...lib.filter((g) => g.type === "game"), ...f.slice(0, 200), ...c];
    }
};
