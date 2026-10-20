// More to discover, from three public sources that need no key:
//   Steam news   the latest announcements and patch notes of a Steam game
//                (its developers' own posts, not press articles)
//   Jikan        this season's anime, from MyAnimeList, with when each new
//                episode airs
//   LibriVox     free public-domain audiobooks, read by volunteers
//
// What's kept (in the data folder): each game's news for 6 hours, the season
// for 12 hours, the audiobooks for a day. When a source doesn't answer, the
// saved copy is shown (and says so). Nothing is fetched for a row you've hidden:
// the interface only asks when a row is on screen.
"use strict";
const { httpsGetJsonPlain } = require("../services/http");
const data = require("./core/data");
const providers = require("./providers");

const HOUR = 3600e3;
const NEWS_FILE = "cache-steam-news.json", NEWS_TTL = 6 * HOUR, NEWS_GAMES_MAX = 10, NEWS_DAYS = 30;
const ANIME_FILE = "cache-anime-season.json", ANIME_TTL = 12 * HOUR;
const BOOKS_FILE = "cache-audiobooks.json", BOOKS_TTL = 24 * HOUR;

const validAppId = (v) => (/^\d{1,10}$/.test(String(v)) ? String(v) : null);

// Steam posts are BBCode and HTML; a card wants a sentence of plain text
function plain(s, max = 260) {
    const t = String(s || "")
        .replace(/\{STEAM_CLAN_IMAGE\}[^\s"]*/g, " ")
        .replace(/\[(img|video|previewyoutube)[^\]]*\][\s\S]*?\[\/\1\]/gi, " ")
        .replace(/\[\/?[a-z0-9*]+(=[^\]]*)?\]/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}

// A list kept on disk: fresh enough -> as is; otherwise ask, and on a failure
// fall back to the saved copy
async function kept(file, key, ttl, fetcher) {
    const all = data.loadCache(file) || {};
    const saved = all[key];
    if (saved && Date.now() - (saved.at || 0) < ttl) return saved.value;
    try {
        const value = await fetcher();
        const now = data.loadCache(file) || {};
        now[key] = { at: Date.now(), value };
        data.saveCache(file, now);
        return value;
    } catch (err) {
        if (saved) { providers.servedSaved(saved.at); return saved.value; }
        throw err;
    }
}

// ---- Steam news ----------------------------------------------------------------
async function steamNews(appid) {
    return kept(NEWS_FILE, appid, NEWS_TTL, async () => {
        const r = await httpsGetJsonPlain(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=6&maxlength=600&feeds=steam_community_announcements&format=json`, 12000);
        return (((r && r.appnews) || {}).newsitems || []).map((n) => ({
            id: String(n.gid), title: String(n.title || "").trim(), url: n.url || null,
            at: (Number(n.date) || 0) * 1000, text: plain(n.contents),
            patch: Array.isArray(n.tags) && n.tags.some((t) => /patchnotes/i.test(t))
        })).filter((n) => n.title && n.url && /^https:\/\//i.test(n.url));
    });
}

// ---- This season's anime (Jikan, MyAnimeList) -----------------------------------
const JST_DAYS = { Mondays: 1, Tuesdays: 2, Wednesdays: 3, Thursdays: 4, Fridays: 5, Saturdays: 6, Sundays: 0 };
async function animeSeason() {
    return kept(ANIME_FILE, "now", ANIME_TTL, async () => {
        const out = [];
        for (let page = 1; page <= 2; page++) {
            const r = await httpsGetJsonPlain(`https://api.jikan.moe/v4/seasons/now?sfw=true&limit=25&page=${page}`, 15000);
            for (const a of (r && r.data) || []) {
                if (!a || a.type === "Music" || a.type === "PV" || a.type === "CM") continue;
                const b = a.broadcast || {};
                out.push({
                    malId: a.mal_id, url: a.url || null,
                    title: a.title_english || a.title || "", titleJa: a.title || "",
                    image: (a.images && a.images.webp && a.images.webp.large_image_url) || (a.images && a.images.jpg && a.images.jpg.large_image_url) || null,
                    synopsis: String(a.synopsis || "").replace(/\s*\[Written by MAL Rewrite\]\s*$/i, "").trim(),
                    score: typeof a.score === "number" ? a.score : null, members: a.members || 0,
                    episodes: a.episodes || null, airing: !!a.airing, type: a.type || null,
                    // when a new episode airs, in Japan time (the interface shows it in yours)
                    broadcast: b.day in JST_DAYS && /^\d{2}:\d{2}$/.test(b.time || "") ? { day: JST_DAYS[b.day], time: b.time } : null,
                    genres: (a.genres || []).map((g) => g.name).filter(Boolean),
                    studios: (a.studios || []).map((s) => s.name).filter(Boolean),
                    trailer: (a.trailer && a.trailer.youtube_id) || null
                });
            }
            if (!(r && r.pagination && r.pagination.has_next_page)) break;
            await new Promise((res) => setTimeout(res, 450)); // Jikan: no more than 3 requests a second
        }
        const seen = new Set();
        return out.filter((a) => a.title && !seen.has(a.malId) && seen.add(a.malId)).sort((x, y) => y.members - x.members);
    });
}

// ---- Free audiobooks (LibriVox) --------------------------------------------------
async function audiobooks() {
    return kept(BOOKS_FILE, "latest", BOOKS_TTL, async () => {
        const r = await httpsGetJsonPlain("https://librivox.org/api/feed/audiobooks/?format=json&extended=1&coverart=1&limit=120&sort_order=desc", 25000);
        return ((r && r.books) || [])
            .filter((b) => b && b.title && /^english$/i.test(b.language || "") && Number(b.totaltimesecs) > 0 && b.url_librivox)
            .map((b) => ({
                id: String(b.id), title: plain(b.title, 140),
                author: (b.authors || []).map((a) => [a.first_name, a.last_name].filter(Boolean).join(" ").trim()).filter(Boolean).join(", "),
                description: plain(b.description, 700),
                cover: b.coverart_jpg || b.coverart_thumbnail || null,
                url: b.url_librivox, totalTime: b.totaltime || null, seconds: Number(b.totaltimesecs) || 0,
                year: /^\d{3,4}$/.test(String(b.copyright_year || "")) ? String(b.copyright_year) : null,
                genres: (b.genres || []).map((g) => g.name).filter(Boolean)
            }))
            .slice(0, 60);
    });
}

function register(ipcMain) {
    ipcMain.handle("r2-steam-news", async (event, appid) => {
        const id = validAppId(appid);
        return id ? steamNews(id) : [];
    });
    // the newest post of each game you've played lately (the newest first)
    ipcMain.handle("r2-steam-news-recent", async (event, appids) => {
        const ids = [...new Set((Array.isArray(appids) ? appids : []).map(validAppId).filter(Boolean))].slice(0, NEWS_GAMES_MAX);
        const since = Date.now() - NEWS_DAYS * 24 * HOUR;
        const all = await Promise.all(ids.map((id) => steamNews(id).then((l) => ({ id, l }), () => ({ id, l: [] }))));
        return all.map(({ id, l }) => { const n = l.find((x) => x.at >= since); return n ? { ...n, appid: id } : null; })
            .filter(Boolean).sort((a, b) => b.at - a.at);
    });
    ipcMain.handle("r2-anime-season", async () => animeSeason());
    ipcMain.handle("r2-audiobooks", async () => audiobooks());
}

module.exports = { register, plain };
