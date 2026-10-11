// Riftgate — "While you were away": when you come back after a while, the
// rift shows what changed since your last visit. New free games, the ones
// about to end that you haven't claimed, new episodes of your shows, and
// price drops on your wishlist. Only what's there, only when there's
// something, and gone with one click.

import { h, icon, clear, coverSrc } from "../app/dom.js";
import * as journal from "../app/store.js";
import * as D from "../app/data.js";
import * as A from "../app/alerts.js";
import { openExternal } from "../app/api.js";

const AWAY = 4 * 3600e3; // shorter than this isn't "away"
const settled = (p) => p.catch(() => []);

// Remember when you were last here: at start, then every few minutes while Riftgate is open
export function markVisits() {
    const last = journal.pref("lastSeenAt", null);
    const touch = () => journal.setPref("lastSeenAt", Date.now());
    touch();
    setInterval(touch, 5 * 60e3);
    return typeof last === "number" ? last : null;
}

function since(ms) {
    const h = ms / 3600e3;
    if (h < 24) return `${Math.round(h)} hours`;
    const d = Math.round(h / 24);
    return d === 1 ? "a day" : d < 14 ? `${d} days` : d < 60 ? `${Math.round(d / 7)} weeks` : "a long while";
}

// Gathers what's new since `last`; null when nothing is
export async function changesSince(last, now = Date.now()) {
    const [gw, free, episodes, wish] = await Promise.all([A.giveaways({ fresh: true }), settled(D.freeGames()), settled(D.latestEpisodes()), A.wishlist({ fresh: true })]);
    const newFree = (free || []).filter((g) => g.firstSeenAt && g.firstSeenAt > last && !g.alwaysFree);
    const ending = (gw.live || []).filter((g) => !g.claimed && g.endsAt && g.endsAt > now && g.endsAt - now < 48 * 3600e3);
    const eps = (episodes || []).filter((e) => { const t = e.date ? Date.parse(e.date) : NaN; return isFinite(t) && t > last - 12 * 3600e3 && t <= now; });
    const drops = (wish.items || []).filter((it) => it.droppedAt && it.droppedAt > last);
    if (!newFree.length && !ending.length && !eps.length && !drops.length) return null;
    return { newFree, ending, eps, drops, money: wish.money, away: now - last };
}

export function openWelcome(c) {
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
    const go = (hash) => { close(); location.hash = hash; };
    const tile = (ico, title, note, thumbs, onclick) => h("button.wb-tile", { type: "button", onclick },
        h("span.wb-ico", null, icon(ico)),
        h("span.wb-text", null, h("b", null, title), note ? h("small", null, note) : null),
        thumbs.length ? h("span.wb-thumbs", null, thumbs.slice(0, 4).map((src) => h("img", { src: coverSrc(src), alt: "", loading: "lazy", onerror: (e) => e.target.remove() }))) : null,
        icon("right"));
    const tiles = [];
    if (c.ending.length) tiles.push(tile("clock", c.ending.length === 1 ? `${c.ending[0].name} is free for ${A.timeLeft(c.ending[0].endsAt).replace(/ left$/, "")} more` : `${c.ending.length} free games end soon`,
        c.ending.length === 1 ? `On ${c.ending[0].store}. You haven't claimed it yet.` : c.ending.map((g) => g.name).slice(0, 3).join(", "), c.ending.map((g) => g.image).filter(Boolean),
        () => (c.ending.length === 1 && c.ending[0].url ? (openExternal(c.ending[0].url), A.claim(c.ending[0].key), close()) : go("free"))));
    if (c.newFree.length) tiles.push(tile("gift", `${c.newFree.length} new free game${c.newFree.length === 1 ? "" : "s"}`, c.newFree.slice(0, 3).map((g) => g.title).join(", "), c.newFree.map((g) => g.image).filter(Boolean), () => go("free")));
    if (c.eps.length) {
        const shows = [...new Set(c.eps.map((e) => e.title))];
        tiles.push(tile("tv", `${c.eps.length} new episode${c.eps.length === 1 ? "" : "s"} of your shows`, shows.slice(0, 3).join(", "), c.eps.map((e) => e.image).filter(Boolean), () => go("theatre")));
    }
    if (c.drops.length) tiles.push(tile("tag", c.drops.length === 1 ? `${c.drops[0].title} got cheaper` : `${c.drops.length} games on your wishlist got cheaper`,
        c.drops.length === 1 ? `Now ${A.money(c.drops[0].price, c.money)}${c.drops[0].droppedFrom ? `, was ${A.money(c.drops[0].droppedFrom, c.money)}` : ""}. On your wishlist.` : c.drops.slice(0, 2).map((it) => `${it.title}: ${A.money(it.price, c.money)}`).join(" · "), c.drops.map((it) => it.image).filter(Boolean), () => go("deals")));

    const wrap = h("div.wn-modal.wb-modal", { role: "dialog", "aria-modal": "true", "aria-label": "While you were away", onclick: (e) => { if (e.target === wrap) close(); } },
        h("div.wn-box.wb-box", null,
            h("p.wb-kicker", null, icon("rift"), `Away for ${since(c.away)}`),
            h("h2.wb-title", null, "While you were away"),
            h("div.wb-tiles", null, tiles),
            h("div.wb-foot", null, h("button.btn.primary", { type: "button", onclick: close }, icon("check"), "Got it"))));
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector(".wb-tile")?.focus();
}

// At start, after the opening: shown only after a real absence and when something changed
export async function maybeWelcome(last) {
    if (!last || Date.now() - last < AWAY) return false;
    const c = await changesSince(last);
    if (!c) return false;
    while (document.querySelector(".interests-portal, .wn-modal, .detail, .update-modal, .today")) await new Promise((r) => setTimeout(r, 600));
    openWelcome(c);
    return true;
}
