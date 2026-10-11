// Riftgate — Nexus: everything that matters right now, across every world.

import * as gate from "../app/mature.js";
import { h, icon } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import { openTickets } from "../app/regions.js";
import * as D from "../app/data.js";
import { firstWithLandscape } from "../app/landscape.js";
import * as foryou from "../app/foryou.js";
import * as seen from "../app/seen.js";
import * as journal from "../app/store.js";
import { hero } from "../components/hero.js";
import { row } from "../components/row.js";
import { shelf } from "../components/shelf.js";
import { todayBand, scaryPicks } from "../components/today.js";
import * as season from "../app/season.js";
import { openRewind, rewindSeason, rewindYear } from "../components/rewind.js";
import * as interests from "../app/interests.js";
import { toast } from "../components/toast.js";
import { hours, until, plural } from "../app/format.js";

const WEEK = 7 * 86400000;

// Continue your journey: what you're in the middle of, then what you played
// lately; "See all" lists everything you added (games, apps, VR, others).
async function journey() {
    const [lib] = await Promise.all([D.library(), journal.load()]);
    const byKey = new Map(lib.map((g) => [g.key, g]));
    const out = new Map();
    // What you marked as in progress, most recently touched first
    journal.entries()
        .filter((e) => e.status === "progress" && e.item)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .forEach((e) => out.set(e.key, byKey.get(e.key) || { ...e.item, key: e.key, kind: e.item.kind || "journal" }));
    // Then what you actually played lately
    lib.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)
        .forEach((g) => { if (!out.has(g.key)) out.set(g.key, g); });
    const recent = [...out.values()];
    // Everything else you added, newest first
    const rest = lib.filter((g) => !out.has(g.key)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0) || a.title.localeCompare(b.title));
    return { recent, all: [...recent, ...rest] };
}
async function continueJourney() {
    const { recent, all } = await journey();
    // never empty while you have anything in your library
    return recent.length >= 8 ? recent : all.slice(0, Math.max(recent.length, 12));
}

async function slides() {
    const pick = (p, fn) => p.then(fn).catch(() => null);
    const W = interests.wants;
    const none = Promise.resolve(null);
    const list = await Promise.all([
        // only wide pictures in the banner: a poster there is cropped beyond recognition
        !W("free") ? none : pick(D.freeGames(), async (l) => {
            const recent = D.newFreeGames(l).sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0));
            const pool = [...recent, ...l.filter((g) => !g.alwaysFree && !recent.includes(g)).sort((a, b) => b.popularity - a.popularity)];
            const fresh = await firstWithLandscape(pool, 6);
            return fresh && { item: fresh, kicker: `Free right now on ${fresh.source}`, kickerIcon: "gift", action: { label: "Get it free", icon: "gift", run: () => openExternal(fresh.url) } };
        }),
        !W("screen") ? none : pick(D.inCinemas(), async (l) => {
            const f = await firstWithLandscape(l.filter((m) => m.backdrop && !gate.hidden(m)), 4);
            return f && { item: f, kicker: "In cinemas near you", kickerIcon: "film", action: { label: "Find tickets", icon: "ticket", run: () => openTickets(f.title) } };
        }),
        !W("screen") ? none : pick(D.newSeries(), async (l) => {
            const s = await firstWithLandscape(l.filter((x) => x.backdrop && !gate.hidden(x)), 4);
            return s && { item: s, kicker: "New series", kickerIcon: "tv" };
        }),
        !W("deals") ? none : pick(D.deals(), async (l) => {
            const d = await firstWithLandscape(l.filter((x) => (x.price.discount || 0) >= 50).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)), 6);
            return d && { item: { ...d, desc: `${d.price.discount}% off on ${d.source}.` }, kicker: "Deal worth it", kickerIcon: "tag", action: { label: "View deal", icon: "tag", run: () => openExternal(d.url) } };
        }),
        !W("games") ? none : pick(D.upcomingGames(), async (l) => {
            const u = await firstWithLandscape(l.filter((x) => x.image), 5);
            return u && { item: { ...u, desc: `${until(u.date)}${u.platforms.length ? " · " + u.platforms.slice(0, 3).join(", ") : ""}` }, kicker: "Coming soon", kickerIcon: "calendar" };
        })
    ]);
    // Slides for what you love come first
    const KIND = { gift: "free", film: "screen", tv: "screen", tag: "deals", calendar: "games" };
    return interests.byInterest(list.filter(Boolean), (sl) => [KIND[sl.kickerIcon] || "games"]);
}

function pulse() {
    const strip = h("div.pulse");
    const item = (ico, n, label, hash) => {
        const el = h("button.pulse-item", { type: "button", onclick: () => { location.hash = hash; } }, icon(ico), h("b", null, n), h("span", null, label));
        strip.appendChild(el);
    };
    Promise.all([D.freeGames(), D.deals(), D.latestEpisodes(), D.library(), seen.load()]).then(([f, d, eps, lib]) => {
        const fresh = D.newFreeGames(f).length;
        if (interests.wants("free")) item("gift", f.length.toLocaleString(), fresh ? `free games, ${fresh} new this week` : "free games right now", "free");
        const big = d.filter((x) => (x.price.discount || 0) >= 75).length;
        if (d.length && interests.wants("deals")) item("tag", big.toLocaleString(), "deals at 75% off or more", "deals");
        const newEps = eps.filter((e) => e.date && Date.now() - Date.parse(e.date) < WEEK && !seen.isSeen(e)).length;
        if (eps.length && interests.wants("screen")) item("tv", String(newEps), newEps === 1 ? "episode to watch this week" : "episodes to watch this week", "theatre");
        // your rift's relics: everything you've completed
        const relics = journal.entries().filter((e) => e.status === "completed" && e.item).length;
        if (relics) item("gem", relics.toLocaleString(), `${relics === 1 ? "relic" : "relics"} orbiting your rift`, "journal");
        if (lib.length) {
            const total = lib.reduce((s, g) => s + (g.playtime || 0), 0);
            const n = lib.filter((g) => g.type === "game").length;
            item("library", n.toLocaleString(), `${n === 1 ? "game" : "games"} in your library${total ? `, ${hours(total)} played` : ""}`, "library");
        }
    });
    return strip;
}

// After a few days with Riftgate, one polite question: may this PC be counted
// (anonymously, once a week)? Asked once; Settings changes the answer.
async function askToCount(root) {
    const { settings: appSettings, saveSettings, call: engine } = await import("../app/api.js");
    const first = journal.pref("firstUseAt", null);
    if (!first) { journal.setPref("firstUseAt", Date.now()); return; }
    if (Date.now() - first < 3 * 86400e3) return;
    const s = await appSettings({ fresh: true });
    if (s.usageStats === true || s.usageStats === false) return;
    const answer = async (yes) => { await saveSettings({ usageStats: yes }); n.remove(); if (yes) { engine("r2-usage-ping-now"); toast("Thank you! This PC is counted once a week, anonymously."); } };
    const n = h("div.notice", null, icon("heart"),
        h("div.grow", null, h("strong", null, "Help Riftgate grow?"),
            h("p", null, "May Riftgate count this PC once a week as one that uses it? Only a random number, the version and Windows or Mac: never your name, account or anything you do. You can change it in Settings.")),
        h("button.btn.primary", { type: "button", onclick: () => answer(true) }, icon("check"), "Yes, count it"),
        h("button.btn", { type: "button", onclick: () => answer(false) }, "No thanks"));
    root.prepend(n);
}

async function importNotice(root) {
    const info = await call("r2-riftgate-available");
    if (!info || !info.available || info.alreadyImported) return;
    const btn = h("button.btn.primary", { type: "button" }, icon("import"), "Bring it over");
    const n = h("div.notice", null, icon("import"),
        h("div.grow", null,
            h("strong", null, "Bring your library with you"),
            h("p", null, `Your earlier version of Riftgate has ${plural(info.games, "item")} in its library, ${plural(info.shows, "tracked show")} and ${plural(info.books, "book")}. Bring them here: they're copied, so it keeps working untouched.`)),
        btn,
        h("button.icon-btn", { type: "button", "aria-label": "Not now", onclick: () => { n.remove(); journal.setPref("import-dismissed", true); } }, icon("x")));
    if (journal.pref("import-dismissed", false)) return;
    btn.onclick = async () => {
        btn.disabled = true; btn.lastChild.textContent = "Importing…";
        const r = await call("r2-import-riftgate");
        if (r && r.ok) { toast("Your library is here"); D.refreshAll(); location.reload(); }
        else { toast(`Import didn't finish: ${(r && r.error) || "unknown error"}`, "err"); btn.disabled = false; btn.lastChild.textContent = "Try again"; }
    };
    root.prepend(n);
}

export default {
    async render(root) {
        const hr = hero(slides());
        const body = h("div");
        root.append(hr, pulse(), todayBand(), body);
        importNotice(body);
        askToCount(body);
        // Rift Rewind's season (1 December to 15 January): the year, ready to look back on
        if (rewindSeason() && !journal.pref(`rewind:seen:${rewindYear()}`, false)) {
            const n = h("div.notice.rw-notice", null, icon("rift"),
                h("div.grow", null, h("strong", null, `Your ${rewindYear()} Rift Rewind is ready`), h("p", null, "Everything you played, watched and read this year, your favourites, your seals, and your rift on a card to share.")),
                h("button.btn.primary", { type: "button", onclick: () => { journal.setPref(`rewind:seen:${rewindYear()}`, true); n.remove(); openRewind(rewindYear()); } }, icon("play"), "Watch it"),
                h("button.icon-btn", { type: "button", "aria-label": "Not now", onclick: () => { journal.setPref(`rewind:seen:${rewindYear()}`, true); n.remove(); } }, icon("x")));
            body.prepend(n);
        }

        const noMature = (l) => gate.visible(l);
        const rows = [
            row({ title: "Continue your journey", icon: "rift", items: continueJourney(), hideEmpty: true, cardOpts: { showType: true }, seeAllTitle: "Your journey: everything you added", seeAll: () => journey().then((j) => j.all) }),
            row({ title: "Picked for you", icon: "sparkles", items: () => foryou.picks({ limit: 60 }), hideEmpty: true, cardOpts: { showType: true, reasons: true },
                note: "From what you play, watch, read and open", seeAllTitle: "Picked for you" }),
            row({ title: "Free right now", icon: "gift", seeAllTitle: "All free games",
                items: () => D.freeGames().then((l) => l.filter((g) => !g.alwaysFree).sort((a, b) => (b.firstSeenAt || 0) - (a.firstSeenAt || 0))) }),
            row({ title: "New episodes", icon: "tv", items: () => Promise.all([D.latestEpisodes(), seen.load()]).then(([l]) => seen.unwatchedFirst(l)), hideEmpty: true }),
            row({ title: "In cinemas", icon: "film", items: D.inCinemas().then(noMature), full: { kind: "now-playing" } }),
            row({ title: "Deals worth it", icon: "tag", items: () => D.deals().then((l) => l.filter((d) => (d.price.discount || 0) >= 50).sort((a, b) => (b.popularity || 0) - (a.popularity || 0))) }),
            row({ title: "Coming soon", icon: "calendar", wide: true, items: D.upcomingGames(), cardOpts: { wide: true }, full: { kind: "upcoming-games" }, seeAllTitle: "Upcoming games" }),
            row({ title: "New series", icon: "tv", items: D.newSeries().then(noMature), full: { kind: "new-series" }, enhance: D.withProviders }),
            row({ title: "New anime", icon: "sparkles", items: D.newAnime().then(noMature), full: { kind: "new-anime" }, enhance: D.withProviders }),
            row({ title: "Books everyone's reading", icon: "book", items: () => D.booksPopular(), full: { kind: "buy-books-popular" }, seeAllTitle: "Most popular books" })
        ];
        // Only what you're into, what you love first (a manual order still wins)
        const IN = { "free-right-now": ["free"], "new-episodes": ["screen"], "in-cinemas": ["screen"], "deals-worth-it": ["deals"],
            "coming-soon": ["games"], "new-series": ["screen"], "new-anime": ["anime"], "books-everyone-s-reading": ["books"] };
        const ids = (r) => IN[r.dataset.rowId] || [];
        // The Hallowed Rift: the scariest of everything, first
        if (season.is("halloween")) body.append(row({ title: "Scary picks for Halloween", icon: "flame", id: "season-scary", items: () => scaryPicks({ limit: 30 }), hideEmpty: true,
            cardOpts: { showType: true }, note: "Games, films, series and books to play, watch and read with the lights off" }));
        body.append(shelf("nexus", interests.byInterest(rows.filter((r) => interests.wants(...ids(r))), ids)));
        return () => hr.destroy();
    },
    rollTitle: "Open a random rift",
    async rollPool() {
        const [f, lib, c] = await Promise.all([D.freeGames(), D.library(), D.inCinemas()]);
        return [...lib.filter((g) => g.type === "game"), ...f.slice(0, 200), ...c];
    }
};
