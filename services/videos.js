// The Watch page's videos (engine/videos.js fetches them). Pure: which YouTube
// channels each section follows, reading a channel's public feed, and picking
// the most watched videos of the last days. YouTube's channel feeds
// (youtube.com/feeds/videos.xml) are free and need no key, so the page costs
// none of the YouTube search quota that trailers share.
"use strict";

// Hand-picked channels per section (every id checked against its channel's feed).
// A section's videos are the most watched of all its channels together.
const SECTIONS = [
    { id: "games", label: "Games", interest: "games", channels: [
        ["UCKy1dAqELo0zrOtPkf0eTMw", "IGN"], ["UCbu2SsF-Or3Rsn3NxqODImw", "GameSpot"], ["UC-2Y8dQb0S6DtpxNgAKoJKA", "PlayStation"],
        ["UCjBp_7RuDBUYbd1LegWEJ8g", "Xbox"], ["UCGIY_O-8vW4rfX98KlMkvRg", "Nintendo of America"], ["UChmZ6QbxgHlmX3ISIHxIpQQ", "Steam"],
        ["UCgaPRP68bbyHnfkPhWWBrNw", "PC Gamer"], ["UCJx5KP-pCUmL9eZUv-mIcNw", "GameTrailers"]] },
    { id: "free", label: "Free to play", interest: "free", channels: [
        ["UC5Qk8mWBwtMyEj7iQQYRk1A", "Epic Games"], ["UClG8odDC8TS6Zpqk9CGVQiQ", "Fortnite"], ["UC2t5bjwHdUX4vM2g8TRDq5g", "League of Legends"],
        ["UC8CX0LD98EDXl4UYX1MDCXg", "VALORANT"], ["UCiS882YPwZt1NfaM0gR0D9Q", "Genshin Impact"], ["UC2PeMPA8PAOp-bynLoCeMLA", "Honkai: Star Rail"],
        ["UCWzmOSSiSPbVnVu3ZAyDx2w", "Marvel Rivals"], ["UC0ZV6M2THA81QT9hrVWJG3A", "Apex Legends"], ["UCBIdHvSAyoud-CNZOVKW2-w", "Warframe"],
        ["UCBjQwd62OJgixzW49TKGERg", "Rocket League"], ["UCjiPEaapiHbJMoAdi_L8fNA", "Roblox"]] },
    { id: "movies", label: "Movies", interest: "screen", channels: [
        ["UCjmJDM5pRKbUlVIzDYYWb6g", "Warner Bros."], ["UCq0OueAsdxH6b8nyAspwViw", "Universal Pictures"], ["UCz97F7dMxBNOfGYu3rx8aCw", "Sony Pictures"],
        ["UCF9imwPMSGz4Vq1NiTWCC7g", "Paramount Pictures"], ["UCvC4D8onUfXzvjTOM-dBfEA", "Marvel Entertainment"], ["UCuPivVjnfNo4mb3Oog_frZg", "A24"],
        ["UCi8e0iOVk1fEOogdfu4YgfA", "Rotten Tomatoes Trailers"]] },
    { id: "series", label: "Series", interest: "screen", channels: [
        ["UCWOA1ZGywLbqmigxE4Qlvuw", "Netflix"], ["UCQJWtTnAHhEG5w4uN0udnUQ", "Prime Video"], ["UCx-KWLTKlB83hDI6UKECtJQ", "HBO Max"],
        ["UCVTQuK2CaWaTgSsoNkn5AiQ", "HBO"], ["UC1Myj674wRVXB9I4c6Hm5zA", "Apple TV"], ["UCIrgJInjLS2BhlHOMDW7v0g", "Disney Plus"],
        ["UCE5mQnNl8Q4H2qcv4ikaXeA", "Hulu"], ["UC6pGDc4bFGD1_36IKv3FnYg", "Crunchyroll"], ["UCBSs9x2KzSLhyyA9IKyt4YA", "Netflix Anime"]] },
    { id: "books", label: "Books", interest: "books", channels: [
        ["UCw--xPGVVxYzRsWyV1nFqgg", "Daniel Greene"], ["UCy6Qlkv2hif7KPtmMmNUGUw", "PeruseProject"], ["UCmT3SYwGCZvzFLTo_18Cvnw", "BooksandLala"],
        ["UCW5R53ckTBE4JJtUmc64lng", "BookswithEmilyFox"], ["UCOkc2PP2lPDUMLg0p6rGGDQ", "polandbananasBOOKS"], ["UC6i_QSkT7pCQH1llVVGd6cA", "readwithcindy"]] }
];
const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

const XML = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'" };
const unxml = (s) => String(s || "").replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => XML[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? unxml(m[1]) : null; };
const attr = (xml, name, a) => { const m = new RegExp(`<${name}\\s[^>]*\\b${a}="([^"]*)"`).exec(xml); return m ? unxml(m[1]) : null; };

// A channel's feed: its latest videos (Shorts left out: they're made for phones, and the page plays full videos)
function parseFeed(xml) {
    const channel = tag(String(xml || "").split("<entry>")[0], "title");
    return String(xml || "").split("<entry>").slice(1).map((e) => {
        const id = tag(e, "yt:videoId");
        if (!id || !/^[\w-]{11}$/.test(id)) return null;
        const link = attr(e, "link", "href") || "";
        return {
            id, title: tag(e, "title") || "", channel: tag(tag(e, "author") || "", "name") || channel || "",
            channelId: tag(e, "yt:channelId") || null, published: tag(e, "published"),
            views: Number(attr(e, "media:statistics", "views")) || 0,
            short: /\/shorts\//.test(link),
            description: (tag(e, "media:description") || "").slice(0, 400)
        };
    }).filter(Boolean);
}

// The most watched of a section's videos published in the last `days` days (or, when that's
// too few, the last month's), one channel never filling more than a third of the row
function mostWatched(videos, { days = 14, max = 24, now = Date.now() } = {}) {
    const fresh = (d) => (videos || []).filter((v) => v && !v.short && v.published && now - Date.parse(v.published) <= d * 86400e3 && now >= Date.parse(v.published) - 3600e3);
    let pool = fresh(days);
    if (pool.length < 8) pool = fresh(Math.max(days, 31));
    const seen = new Set(), perChannel = new Map(), cap = Math.max(3, Math.ceil(max / 3));
    return pool.slice().sort((a, b) => b.views - a.views || Date.parse(b.published) - Date.parse(a.published))
        .filter((v) => { if (seen.has(v.id)) return false; seen.add(v.id); const n = perChannel.get(v.channel) || 0; if (n >= cap) return false; perChannel.set(v.channel, n + 1); return true; })
        .slice(0, max);
}

// Videos about what's yours: a title naming one of your games or shows (whole words, at least
// 4 letters, so "It" or "Up" don't match everything)
function aboutYours(videos, titles, max = 12) {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const names = new Map();
    (titles || []).forEach((t) => { const n = norm(t); if (n.length >= 4 && !names.has(n)) names.set(n, String(t).trim()); });
    if (!names.size) return [];
    const out = [];
    for (const v of videos || []) {
        const t = ` ${norm(v.title)} `;
        const hit = [...names.keys()].find((n) => t.includes(` ${n} `));
        if (hit && !out.some((x) => x.id === v.id)) out.push({ ...v, about: names.get(hit) });
    }
    return out.sort((a, b) => b.views - a.views).slice(0, max);
}

module.exports = { SECTIONS, feedUrl, parseFeed, mostWatched, aboutYours, unxml };
