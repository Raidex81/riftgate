// The Watch page: the most watched videos of the last two weeks from hand-picked
// game, film, TV and book channels (services/videos.js). Read from YouTube's
// public channel feeds, which are free and need no key: the page never touches
// the YouTube search quota that trailers and boss videos share. Kept for two
// hours; if YouTube can't be reached, the last ones are shown.
"use strict";
const { httpsGetTextPlain, runWithConcurrencyLimit } = require("../services/http");
const videos = require("../services/videos");
const data = require("./core/data");
const providers = require("./providers");

const FILE = "cache-videos.json", TTL = 2 * 3600e3;

let pending = null;
async function readAll() {
    const jobs = videos.SECTIONS.flatMap((s) => s.channels.map(([id, name]) => ({ section: s.id, id, name })));
    const got = await runWithConcurrencyLimit(jobs, 6, async (j) => {
        const r = await httpsGetTextPlain(videos.feedUrl(j.id), 12000);
        if (!r || r.statusCode !== 200) throw new Error(`YouTube answered ${r && r.statusCode}`);
        return videos.parseFeed(r.body).map((v) => ({ ...v, channel: v.channel || j.name }));
    });
    const by = {};
    let ok = 0;
    got.forEach((g, i) => { const sec = jobs[i].section; by[sec] = by[sec] || []; if (g.status === "fulfilled") { ok++; by[sec].push(...g.value); } });
    if (!ok) throw new Error("YouTube's channel feeds didn't answer");
    return { at: Date.now(), all: by };
}

function load({ fresh = false } = {}) {
    const saved = data.loadCache(FILE);
    if (!fresh && saved && saved.all && Date.now() - (saved.at || 0) < TTL) return Promise.resolve(saved);
    if (!pending) pending = readAll().then((v) => { data.saveCache(FILE, v); return v; })
        .catch((err) => { if (saved && saved.all) { providers.servedSaved(saved.at); return saved; } throw err; })
        .finally(() => { pending = null; });
    return pending;
}

function register(ipcMain) {
    // { at, sections: [{ id, label, interest, videos }], yours } (days: 7, 14 or 31; titles: your games and shows, for "About yours")
    ipcMain.handle("r2-videos", async (event, q = {}) => {
        const days = [7, 14, 31].includes(Number(q && q.days)) ? Number(q.days) : 14;
        const titles = Array.isArray(q && q.titles) ? q.titles.filter((t) => typeof t === "string").slice(0, 400).map((t) => t.slice(0, 120)) : [];
        try {
            const v = await load({ fresh: !!(q && q.fresh) });
            const sections = videos.SECTIONS.map((s) => ({ id: s.id, label: s.label, interest: s.interest, channels: s.channels.map(([, n]) => n),
                videos: videos.mostWatched(v.all[s.id] || [], { days, max: 24 }) }));
            const everything = Object.values(v.all).flat();
            const recent = videos.mostWatched(everything, { days: 31, max: 400 });
            return { at: v.at, days, sections, yours: videos.aboutYours(recent, titles, 12) };
        } catch (err) { return { error: err.message || "YouTube couldn't be reached" }; }
    });
}

module.exports = { register };
