// Riftgate — Watch: the most watched videos of the last days from game, film,
// TV and book channels on YouTube, a row per section (and one about your own
// games and shows), played right here on a big screen. From each channel's
// public feed (engine/videos.js), so it costs none of the YouTube quota.
// When a video ends the next one starts (Play the next one by itself); a video
// YouTube won't play outside YouTube is skipped. Seen videos get a tick, and
// Watch later keeps a row of your own.

import { h, icon, clear } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as D from "../app/data.js";
import * as interests from "../app/interests.js";
import * as journal from "../app/store.js";
import { ago } from "../app/format.js";
import { shortAgo } from "../app/sources.js";
import { toast } from "../components/toast.js";
import { thumb, views, videoCard, player, markSeen, later, isLater, toggleLater } from "../components/videos.js";

const RANGES = [[7, "This week"], [14, "Two weeks"], [31, "This month"]];

export default {
    async render(root) {
        root.classList.add("wt");
        let days = journal.pref("watch:days", 14);
        if (!RANGES.some(([d]) => d === days)) days = 14;
        let auto = journal.pref("watch:auto", true), wide = journal.pref("watch:wide", false);
        const ranges = h("div.chips", { role: "group", "aria-label": "Published" });
        const refresh = h("button.btn", { type: "button", onclick: () => load(true) }, icon("refresh"), "Refresh");
        const head = h("div.view-head", null,
            h("div", null, h("h1", null, "Watch"), h("p.muted", null, "The most watched videos from game, film, TV and book channels on YouTube. Pick one and it plays here.")),
            h("div.actions", null, ranges, refresh));

        // the big screen: the chosen video, its details, and what's next
        const screen = h("div.wt-screen");
        const info = h("div.wt-info");
        const stage = h("section.wt-stage", { "aria-label": "Now playing" }, screen, info);
        stage.classList.toggle("wide", wide);
        const rows = h("div.wt-rows");
        const foot = h("p.wt-foot.muted");
        root.append(head, stage, rows, foot);

        let order = [], current = null, data = null, playing = null;
        const paintRanges = () => clear(ranges).append(...RANGES.map(([d, label]) => h("button.chip", { type: "button", "aria-pressed": String(d === days), onclick: () => { if (d === days) return; days = d; journal.setPref("watch:days", d); paintRanges(); load(false); } }, label)));
        paintRanges();
        const nextOf = (v) => { const i = order.findIndex((x) => x.id === v.id); return i >= 0 ? order[i + 1] || null : order[0] || null; };

        function show(v, { play = false, scroll = false } = {}) {
            current = v;
            if (playing) { playing.stop(); playing = null; }
            root.querySelectorAll(".wt-card.on").forEach((c) => c.classList.remove("on"));
            root.querySelectorAll(`.wt-card[data-id="${v.id}"]`).forEach((c) => c.classList.add("on"));
            clear(screen);
            if (play) {
                markSeen(v.id);
                root.querySelectorAll(`.wt-card[data-id="${v.id}"]`).forEach((c) => c.classList.add("seen"));
                playing = player(v.id, { title: v.title,
                    onEnd: () => { const n = nextOf(v); if (auto && n) show(n, { play: true }); },
                    onError: () => { const n = nextOf(v); toast("YouTube only plays that one on YouTube"); if (n) show(n, { play: true }); else showInfo(v, true); } });
                screen.append(playing.el);
            } else screen.append(h("button.wt-poster", { type: "button", "aria-label": `Play ${v.title}`, onclick: () => show(v, { play: true }) },
                h("img", { src: thumb(v.id, "maxresdefault"), alt: "", onerror: (e) => { if (!/hqdefault/.test(e.target.src)) e.target.src = thumb(v.id, "hqdefault"); else e.target.style.visibility = "hidden"; } }),
                h("span.wt-play", null, icon("play"))));
            showInfo(v, play);
            if (scroll) stage.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        function showInfo(v, play) {
            const next = nextOf(v);
            const saved = isLater(v.id);
            clear(info).append(
                h("div.wt-tags", null, v.section ? h("span.wt-tag", null, v.section) : null, v.about ? h("span.wt-tag.yours", { translate: "no" }, v.about) : null),
                h("h2", { translate: "no" }, v.title),
                h("p.wt-meta", null, h("b", { translate: "no" }, v.channel), " · ", h("span", { translate: "no" }, views(v.views)), " ", h("span", null, "views"), " · ", h("span", null, ago(v.published))),
                v.description ? h("p.wt-desc", { translate: "no" }, v.description.split("\n")[0].slice(0, 220)) : null,
                h("div.wt-btns", null,
                    !play ? h("button.btn.primary", { type: "button", onclick: () => show(v, { play: true }) }, icon("play"), "Play video") : null,
                    next ? h("button.btn", { type: "button", title: next.title, onclick: () => show(next, { play: true, scroll: true }) }, "Next", icon("right")) : null,
                    h(`button.btn${saved ? ".on" : ""}`, { type: "button", "aria-pressed": String(saved), onclick: () => { const on = toggleLater(v); toast(on ? "Saved to Watch later" : "Taken off Watch later"); showInfo(v, play); paintLater(); } }, icon(saved ? "check" : "plus"), saved ? "In Watch later" : "Watch later"),
                    h("button.btn.ghost", { type: "button", onclick: () => openExternal(`https://www.youtube.com/watch?v=${v.id}`) }, icon("external"), "YouTube")),
                next ? h("div.wt-next", null, h("small", null, "Up next"), h("button.wt-nextcard", { type: "button", onclick: () => show(next, { play: true, scroll: true }) },
                    h("img", { src: thumb(next.id), alt: "", loading: "lazy", onerror: (e) => { e.target.style.visibility = "hidden"; } }),
                    h("span", null, h("b", { translate: "no" }, next.title), h("small", { translate: "no" }, next.channel)))) : null,
                h("div.wt-switches", null,
                    h("label.wt-switch", null, h("input", { type: "checkbox", checked: auto, onchange: (e) => { auto = e.target.checked; journal.setPref("watch:auto", auto); } }), h("span", null, "Play the next one by itself")),
                    h("label.wt-switch", null, h("input", { type: "checkbox", checked: wide, onchange: (e) => { wide = e.target.checked; journal.setPref("watch:wide", wide); stage.classList.toggle("wide", wide); } }), h("span", null, "Wide screen"))));
        }

        function row(title, sub, list, { id, ranked = true } = {}) {
            const track = h("div.wt-track", null, ...list.map((v, i) => videoCard(v, { rank: ranked ? i + 1 : null, onClick: (x) => show(x, { play: true, scroll: true }) })));
            const step = (dir) => track.scrollBy({ left: dir * track.clientWidth * 0.85, behavior: "smooth" });
            return h("section.wt-row", { dataset: { row: id || "" } },
                h("div.wt-rowhead", null, h("div", null, h("h2", null, title), sub ? h("p.muted", null, sub) : null),
                    list.length > 3 ? h("div.wt-arrows", null, h("button.icon-btn", { type: "button", "aria-label": "Back", onclick: () => step(-1) }, icon("left")), h("button.icon-btn", { type: "button", "aria-label": "More", onclick: () => step(1) }, icon("right"))) : null),
                track);
        }
        // Watch later: the videos you saved, the newest first
        function paintLater() {
            const old = rows.querySelector('.wt-row[data-row="later"]');
            const list = later();
            const el = list.length ? row("Watch later", "The videos you saved, to watch when you have time.", list, { id: "later", ranked: false }) : null;
            if (old && el) old.replaceWith(el); else if (old) old.remove(); else if (el) rows.prepend(el);
            if (current) root.querySelectorAll(`.wt-card[data-id="${current.id}"]`).forEach((c) => c.classList.add("on"));
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
            if (r.yours && r.yours.length) { rows.append(row("About your games and shows", "Videos naming something in your Library or the shows you follow.", r.yours, { id: "yours" })); order.push(...r.yours); }
            for (const s of sections) {
                const list = s.videos.map((v) => ({ ...v, section: s.label }));
                rows.append(row(s.label, `From ${s.channels.slice(0, 4).join(", ")}${s.channels.length > 4 ? " and more" : ""}.`, list, { id: s.id }));
                order.push(...list);
            }
            paintLater();
            if (!order.length) { rows.append(h("p.muted", null, "No videos in this time. Try a longer one.")); clear(screen); clear(info); return; }
            // a video asked for from Nexus plays at once; otherwise the big screen starts on the most watched of all
            let asked = null;
            try { asked = JSON.parse(sessionStorage.getItem("watch:open") || "null"); sessionStorage.removeItem("watch:open"); } catch (e) { asked = null; }
            if (asked && asked.id) show(order.find((v) => v.id === asked.id) || asked, { play: true });
            else {
                const top = [...order].sort((a, b) => b.views - a.views)[0];
                show(current && order.some((v) => v.id === current.id) ? order.find((v) => v.id === current.id) : top);
            }
            foot.textContent = `Videos from YouTube, read from each channel's public feed. Updated ${shortAgo(r.at)}.`;
        }
        // N plays the next one (not while you type)
        const keys = (e) => { if (e.key && e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && current) { const n = nextOf(current); if (n) show(n, { play: true }); } };
        document.addEventListener("keydown", keys);
        load(false);
        return () => { document.removeEventListener("keydown", keys); if (playing) playing.stop(); };
    }
};
