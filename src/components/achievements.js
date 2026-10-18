// Riftgate — Steam achievements in a game's details (the logic is in
// app/achievements.js; the Journal's Trophy room is trophy-room.js).

import { h, icon, clear, coverSrc } from "../app/dom.js";
import { openExternal } from "../app/api.js";
import * as A from "../app/achievements.js";
import { shortAgo } from "../app/sources.js";

const NS = "http://www.w3.org/2000/svg";
function ringOf(pct, perfect) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("class", "ach-ring" + (perfect ? " is-perfect" : ""));
    const c = 2 * Math.PI * 27;
    const mk = (cls, extra) => { const e = document.createElementNS(NS, "circle"); e.setAttribute("cx", 32); e.setAttribute("cy", 32); e.setAttribute("r", 27); e.setAttribute("class", cls); for (const [k, v] of Object.entries(extra || {})) e.setAttribute(k, v); return e; };
    svg.append(mk("track"), mk("fill", { "stroke-dasharray": c, "stroke-dashoffset": c * (1 - pct / 100) }));
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", 32); t.setAttribute("y", 36);
    t.textContent = `${pct}%`;
    if (pct >= 100) t.setAttribute("class", "long");
    svg.appendChild(t);
    return svg;
}

export const gem = (tier) => h("span.ach-gem", { dataset: { tier: tier ? tier.id : "none" }, "aria-hidden": "true" });

function rarityOf(a) {
    const t = A.tierOf(a.percent);
    if (!t) return null;
    return h("span.ach-rarity", { dataset: { tier: t.id }, title: `${t.label}: ${a.percent}% of Steam players have it` },
        gem(t), h("b", null, `${a.percent < 0.1 ? "<0.1" : a.percent}%`), h("small", null, t.label));
}

function tile(a) {
    const t = A.tierOf(a.percent);
    const el = h("div.ach-tile", { dataset: { tier: t ? t.id : "none" }, class: a.achieved ? "is-unlocked" : "is-locked" });
    const img = a.achieved ? a.icon : (a.iconGray || a.icon);
    el.append(img ? h("img.ach-icon", { src: coverSrc(img), alt: "", loading: "lazy" }) : h("span.ach-icon.blank", null, icon("trophy")));
    const text = h("div.ach-text");
    if (a.hidden && !a.achieved) {
        // a secret: veiled until you ask
        el.classList.add("is-hidden");
        const reveal = h("button.ach-reveal", { type: "button", onclick: (e) => { e.stopPropagation(); el.classList.remove("is-hidden"); reveal.remove(); } }, icon("eye"), "Reveal");
        text.append(h("b.ach-name", null, h("span.real", null, a.name), h("span.veil", null, "Hidden achievement")),
            h("p.ach-desc", null, h("span.real", null, a.desc || "Steam keeps this one secret until you unlock it."), h("span.veil", null, "A secret. Reveal it if you don't mind spoilers.")), reveal);
    } else {
        text.append(h("b.ach-name", null, a.name), a.desc ? h("p.ach-desc", null, a.desc) : (a.hidden ? h("p.ach-desc.muted", null, "A secret achievement") : null));
    }
    el.append(text);
    const side = h("div.ach-side", null, rarityOf(a));
    if (a.achieved) side.append(h("small.ach-when", { title: a.unlockedAt ? new Date(a.unlockedAt).toLocaleString() : "" }, a.unlockedAt ? A.dayLabel(a.unlockedAt) : "Unlocked"));
    el.append(side);
    return el;
}

const LIMIT = 8;
const VIEWS = [
    { id: "next", label: "Next up", hint: "What you haven't got yet, the ones most players earn first", pick: A.nextUp },
    { id: "recent", label: "Recent", hint: "Your unlocks, newest first", pick: A.recent, byDay: true },
    { id: "rarest", label: "Rarest", hint: "Your unlocks, the rarest first", pick: A.rarest },
    { id: "all", label: "All", hint: "Every achievement in this game", pick: A.all }
];

// Steam answers "Profile is not public" for achievements when the profile's
// Game details aren't Public, even if the profile itself is: what to change,
// a button to the setting and one to look again. check() resolves to the
// new state; "still private" says Steam can be slow to notice.
export function privateNote(check, { tries = 0 } = {}) {
    const again = h("button.btn.sm", { type: "button" }, icon("refresh"), "Check again");
    const el = h("div.ach-note.ach-private", null,
        h("p", null, icon("lock"), h("b", null, "Steam is keeping your achievements private."),
            " It only shares them when your profile's ", h("b", null, "Game details"), " are set to Public."),
        h("ol", null,
            h("li", null, "Open your Steam privacy settings (signed in to Steam)."),
            h("li", null, "Set ", h("b", null, "Game details"), " to ", h("b", null, "Public"), "."),
            h("li", null, "Come back here and press Check again.")),
        tries ? h("p.muted", null, "Still private. Steam can take a few minutes to notice the change, so try again shortly.") : null,
        h("div.ach-private-actions", null,
            h("button.btn.sm.primary", { type: "button", onclick: () => openExternal(A.PRIVACY_URL) }, icon("external"), "Open Steam privacy settings"),
            again));
    again.onclick = async () => {
        again.disabled = true; again.classList.add("is-busy");
        const state = await check().catch(() => null);
        if (state === "private" && el.isConnected) el.replaceWith(privateNote(check, { tries: tries + 1 }));
        else { again.disabled = false; again.classList.remove("is-busy"); }
    };
    return el;
}

// A note when there's nothing to show, saying what to do about it
function noteFor(state, check) {
    if (state === "private") return privateNote(check);
    if (state === "no-steamid") return h("p.ach-note", null, "Add your SteamID64 in ", h("a", { href: "#settings" }, "Settings"), " (Steam playtime) and your achievements show up here.");
    if (state === "server-update") return h("p.ach-note", null, "Achievements need a small update to Riftgate's online service, coming shortly.");
    return h("p.ach-note", null, "Steam didn't answer. ", h("button.linkish", { type: "button", "data-retry": "1" }, "Try again"));
}

// The section in a Steam game's details
export function achievementsBox(item) {
    const appid = item && (item.steamAppId || (item.raw && item.raw.steamAppId));
    if (!appid || item.kind !== "library") return null;
    const box = h("section.detail-section.ach", { "aria-label": "Achievements" });
    const head = h("div.ach-head", null, h("h3", null, icon("trophy"), "Achievements"), h("span.muted", null, "Steam"));
    const again = h("button.icon-btn.ach-refresh", { type: "button", title: "Check Steam again", "aria-label": "Check Steam again" }, icon("refresh"));
    head.append(again);
    const body = h("div.ach-body", null, h("div.ach-loading", null, h("span.skeleton-line"), h("span.skeleton-line.short")));
    box.append(head, body);

    let view = null, expanded = false, data = null;
    async function load(fresh) {
        again.classList.add("is-busy");
        const r = await A.game(appid, { fresh }).catch(() => null);
        again.classList.remove("is-busy");
        if (!r || r.state === "none") { box.hidden = true; return r && r.state; }
        if (r.state !== "ok") {
            // the private note keeps itself on screen while it's still private
            if (r.state === "private" && body.querySelector(".ach-private")) return r.state;
            clear(body).append(noteFor(r.state, () => load(true)));
            const btn = body.querySelector("[data-retry]");
            if (btn) btn.onclick = () => load(true);
            return r.state;
        }
        data = r;
        if (!view) view = r.unlocked === r.total ? "rarest" : r.unlocked === 0 ? "next" : "next";
        paint();
        if (fresh) A.summary({ fresh: true });
        return r.state;
    }
    again.onclick = () => load(true);

    function paint() {
        const r = data, pct = Math.round((r.unlocked / r.total) * 100), perfect = r.unlocked === r.total;
        clear(body);
        // the overview: the ring, the count, your tiers, what's rarest
        const counts = A.tierCounts(r.items);
        const best = A.rarest(r.items)[0];
        const last = A.recent(r.items)[0];
        const tiers = h("div.ach-tiers", { title: "Your unlocks by how rare they are" },
            ...counts.map(({ tier, n }) => h("span.ach-tierbar", { dataset: { tier: tier.id }, style: { flexGrow: n }, title: `${n} ${tier.label} (${tier.hint})` })));
        const legend = h("div.ach-legend", null, ...counts.map(({ tier, n }) => h("span", { dataset: { tier: tier.id } }, gem(tier), `${n} ${tier.label}`)));
        body.append(h("div.ach-overview", null,
            ringOf(pct, perfect),
            h("div.ach-overview-text", null,
                perfect ? h("p.ach-perfect", null, icon("trophy"), `Perfect: all ${r.total} unlocked`)
                    : h("p", null, h("b", null, `${r.unlocked} of ${r.total}`), ` unlocked · ${r.total - r.unlocked} to go`),
                counts.length ? tiers : null, counts.length ? legend : null,
                h("p.muted.ach-facts", null,
                    best && typeof best.percent === "number" ? h("span", null, "Rarest: ", h("b", null, best.name), ` (${best.percent}%)`) : null,
                    last && last.unlockedAt ? h("span", null, `Last unlocked ${A.dayLabel(last.unlockedAt).toLowerCase()}`) : null,
                    h("span", null, `Checked ${shortAgo(r.updatedAt)}`)))));
        // the four ways to look
        const chips = h("div.chips.ach-views", { role: "tablist" });
        for (const v of VIEWS) {
            const n = v.id === "next" ? r.total - r.unlocked : v.id === "all" ? r.total : r.unlocked;
            if (!n && v.id !== "all") continue;
            chips.append(h("button.chip", { type: "button", role: "tab", "aria-selected": String(view === v.id), "aria-pressed": String(view === v.id), title: v.hint,
                onclick: () => { view = v.id; expanded = false; paint(); } }, v.label, h("span.n", null, n)));
        }
        body.append(chips);
        const v = VIEWS.find((x) => x.id === view) || VIEWS[0];
        const list = v.pick(r.items);
        const shown = expanded ? list : list.slice(0, LIMIT);
        const wrap = h("div.ach-list");
        if (v.byDay) {
            let day = null;
            for (const a of shown) {
                const d = A.dayLabel(a.unlockedAt);
                if (d !== day) { wrap.append(h("p.ach-day", null, d)); day = d; }
                wrap.append(tile(a));
            }
        } else shown.forEach((a) => wrap.append(tile(a)));
        body.append(wrap);
        if (list.length > shown.length) body.append(h("button.btn.sm.ach-more", { type: "button", onclick: () => { expanded = true; paint(); } }, `Show all ${list.length}`));
    }

    load(false);
    return box;
}
