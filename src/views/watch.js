// Riftgate — Watch: the most watched videos of the last days from game, film,
// TV and book channels on YouTube, a row per section (and one about your own
// games and shows), played right here on a big screen. From each channel's
// public feed (engine/videos.js), so it costs none of the YouTube quota.

import { h, icon, clear } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as D from "../app/data.js";
import * as interests from "../app/interests.js";
import * as journal from "../app/store.js";
import { locale } from "../app/i18n.js";
import { ago } from "../app/format.js";
import { shortAgo } from "../app/sources.js";

const RANGES = [[7, "This week"], [14, "Two weeks"], [31, "This month"]];
const thumb = (id, q = "mqdefault") => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const views = (n) => { try { return new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n || 0); } catch (e) { return String(n || 0); } };

export default {
    async render(root) {
        root.classList.add("wt");
        let days = journal.pref("watch:days", 14);
        if (!RANGES.some(([d]) => d === days)) days = 14;
        const ranges = h("div.chips", { role: "group", "aria-label": "Published" });
        const refresh = h("button.btn", { type: "button", onclick: () => load(true) }, icon("refresh"), "Refresh");
        const head = h("div.view-head", null,
            h("div", null, h("h1", null, "Watch"), h("p.muted", null, "The most watched videos from game, film, TV and book channels on YouTube. Pick one and it plays here.")),
            h("div.actions", null, ranges, refresh));

        // the big screen: the chosen video, its details, and what's next
        const screen = h("div.wt-screen");
        const info = h("div.wt-info");
        const stage = h("section.wt-stage", { "aria-label": "Now playing" }, screen, info);
        const rows = h("div.wt-rows");
        const foot = h("p.wt-foot.muted");
        root.append(head, stage, rows, foot);

        let order = [], current = null, data = null;
        const paintRanges = () => clear(ranges).append(...RANGES.map(([d, label]) => h("button.chip", { type: "button", "aria-pressed": String(d === days), onclick: () => { if (d === days) return; days = d; journal.setPref("watch:days", d); paintRanges(); load(false); } }, label)));
        paintRanges();

        function show(v, { play = false, scroll = false } = {}) {
            current = v;
            root.querySelectorAll(".wt-card.on").forEach((c) => c.classList.remove("on"));
            root.querySelectorAll(`.wt-card[data-id="${v.id}"]`).forEach((c) => c.classList.add("on"));
            clear(screen);
            if (play) screen.append(h("iframe", { src: `https://www.youtube.com/embed/${v.id}?autoplay=1&rel=0&modestbranding=1`, title: v.title, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true }));
            else screen.append(h("button.wt-poster", { type: "button", "aria-label": `Play ${v.title}`, onclick: () => show(v, { play: true }) },
                h("img", { src: thumb(v.id, "maxresdefault"), alt: "", onerror: (e) => { if (!/hqdefault/.test(e.target.src)) e.target.src = thumb(v.id, "hqdefault"); else e.target.style.visibility = "hidden"; } }),
                h("span.wt-play", null, icon("play"))));
            const i = order.findIndex((x) => x.id === v.id), next = order[i + 1];
            clear(info).append(
                h("div.wt-tags", null, v.section ? h("span.wt-tag", null, v.section) : null, v.about ? h("span.wt-tag.yours", { translate: "no" }, v.about) : null),
                h("h2", { translate: "no" }, v.title),
                h("p.wt-meta", null, h("b", { translate: "no" }, v.channel), " · ", h("span", { translate: "no" }, views(v.views)), " ", h("span", null, "views"), " · ", h("span", null, ago(v.published))),
                v.description ? h("p.wt-desc", { translate: "no" }, v.description.split("\n")[0].slice(0, 220)) : null,
                h("div.wt-btns", null,
                    !play ? h("button.btn.primary", { type: "button", onclick: () => show(v, { play: true }) }, icon("play"), "Play video") : null,
                    next ? h("button.btn", { type: "button", title: next.title, onclick: () => show(next, { play: true, scroll: true }) }, "Next", icon("right")) : null,
                    h("button.btn.ghost", { type: "button", onclick: () => openExternal(`https://www.youtube.com/watch?v=${v.id}`) }, icon("external"), "YouTube")));
            if (scroll) stage.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        // a card: the picture, its rank and views, the title and channel
        const card = (v, n) => h("button.wt-card", { type: "button", dataset: { id: v.id }, title: v.title, onclick: () => show(v, { play: true, scroll: true }) },
            h("span.wt-thumb", null, h("img", { src: thumb(v.id), alt: "", loading: "lazy", onerror: (e) => { e.target.style.visibility = "hidden"; } }), h("span.wt-rank", null, `#${n}`), h("span.wt-views", null, icon("eye"), views(v.views)), h("span.wt-hover", null, icon("play"))),
            h("span.wt-title", { translate: "no" }, v.title),
            h("span.wt-sub", null, h("span", { translate: "no" }, v.channel), " · ", h("span", null, ago(v.published))));

        function row(title, sub, list, label) {
            const track = h("div.wt-track", null, ...list.map((v, i) => card({ ...v, section: v.section || label }, i + 1)));
            const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" });
            return h("section.wt-row", null,
                h("div.wt-rowhead", null, h("div", null, h("h2", null, title), sub ? h("p.muted", null, sub) : null),
                    h("div.wt-arrows", null, h("button.icon-btn", { type: "button", "aria-label": "Back", onclick: () => step(-1) }, icon("left")), h("button.icon-btn", { type: "button", "aria-label": "More", onclick: () => step(1) }, icon("right")))),
                track);
        }

        async function load(fresh) {
            refresh.disabled = true;
            if (!data) { clear(rows).append(h("div.wt-loading", null, ...[0, 1, 2].map(() => h("span.skeleton-line")))); clear(screen).append(h("div.wt-screen-wait")); }
            // your games and shows, for the row about them
            const titles = [];
            try { (await D.library()).forEach((g) => g && g.title && titles.push(g.title)); } catch (e) { /* */ }
            try { (await D.watchlist()).forEach((s) => s && s.title && titles.push(s.title)); } catch (e) { /* */ }
            const r = await call("r2-videos", { days, fresh: !!fresh, titles }).catch((e) => ({ error: e.message }));
            refresh.disabled = false;
            if (!r || r.error || !r.sections) {
                if (!data) { clear(rows).append(h("div.empty", null, icon("alert"), h("h3", null, "YouTube didn't answer"), h("p", null, (r && r.error) || "Check your connection and try again."), h("button.btn", { type: "button", onclick: () => load(true) }, icon("refresh"), "Try again"))); clear(screen); clear(info); }
                return;
            }
            data = r;
            // sections in the order of your interests; one you turned off isn't shown
            const sections = r.sections.map((s, i) => ({ ...s, i, lvl: interests.level(s.interest) })).filter((s) => s.lvl > 0 && s.videos.length)
                .sort((a, b) => b.lvl - a.lvl || a.i - b.i);
            clear(rows);
            order = [];
            if (r.yours && r.yours.length) { rows.append(row("About your games and shows", "Videos naming something in your Library or the shows you follow.", r.yours, null)); order.push(...r.yours); }
            for (const s of sections) {
                rows.append(row(s.label, `From ${s.channels.slice(0, 4).join(", ")}${s.channels.length > 4 ? " and more" : ""}.`, s.videos.map((v) => ({ ...v, section: s.label })), s.label));
                order.push(...s.videos.map((v) => ({ ...v, section: s.label })));
            }
            if (!order.length) { rows.append(h("p.muted", null, "No videos in this time. Try a longer one.")); clear(screen); clear(info); return; }
            // the big screen starts on the most watched of all (not playing until you say)
            const top = [...order].sort((a, b) => b.views - a.views)[0];
            show(current && order.some((v) => v.id === current.id) ? order.find((v) => v.id === current.id) : top);
            foot.textContent = `Videos from YouTube, read from each channel's public feed. Updated ${shortAgo(r.at)}.`;
        }
        load(false);
    }
};
