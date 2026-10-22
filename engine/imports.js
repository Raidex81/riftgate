// Bringing your history in from other sites: the export files Letterboxd,
// Goodreads, IMDb and MyAnimeList give you for free, and your public Steam
// wishlist. Each file becomes a list of plain items (what it is, its title,
// your status, rating and dates); the interface turns them into Journal
// entries without touching anything you already set in Riftgate.
//
// Films and series are matched to TMDB once (so they open like any other
// film in Riftgate), a few at a time; every match is remembered in
// cache-import-matches.json, so importing the same file again asks nothing.
// Books need no lookup (their cover comes from Open Library by ISBN).
"use strict";
const { dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const AdmZip = require("adm-zip");
const { httpsGetJsonPlain } = require("../services/http");
const data = require("./core/data");
const settings = require("./core/settings");
const windowRef = require("./core/window");

const MAX_ITEMS = 5000;
const MAX_FILE = 60 * 1024 * 1024;
const MATCH_FILE = "cache-import-matches.json";

// ---- Reading the files ------------------------------------------------------------
// CSV with quotes, doubled quotes and line breaks inside quotes -> [{ column: value }]
function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else q = false; }
            else cell += c;
        } else if (c === "\"") q = true;
        else if (c === ",") { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); cell = "";
            if (row.length > 1 || row[0] !== "") rows.push(row);
            row = [];
        } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

const clean = (s, max = 300) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const year = (s) => { const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(s || "")); return m ? Number(m[1]) : null; };
const when = (s) => { const t = Date.parse(String(s || "").replace(/\//g, "-")); return Number.isFinite(t) && t > 0 ? t : null; };
const gems = (v, outOf) => { const n = Number(v); return n > 0 ? Math.min(5, Math.max(1, Math.round((n / outOf) * 5))) : 0; };

// Letterboxd: watched, ratings, diary, reviews, likes and watchlist (the
// export's CSV files, from the zip or picked one by one)
function letterboxd(files) {
    const films = new Map();
    const film = (r) => {
        const title = clean(r.Name), y = year(r.Year);
        if (!title) return null;
        const k = `${title.toLowerCase()}|${y || ""}`;
        if (!films.has(k)) films.set(k, { type: "film", title, year: y, url: /^https:\/\/(boxd\.it|letterboxd\.com)\//.test(r["Letterboxd URI"] || "") ? r["Letterboxd URI"] : null });
        return films.get(k);
    };
    const done = (f, r) => { f.status = "completed"; const t = when(r["Watched Date"]) || when(r.Date); if (t && (!f.at || t > f.at)) f.at = t; };
    for (const r of files["watched.csv"] || []) { const f = film(r); if (f) done(f, r); }
    for (const r of files["diary.csv"] || []) { const f = film(r); if (f) { done(f, r); if (r.Rating) f.rating = gems(r.Rating, 5); } }
    for (const r of files["ratings.csv"] || []) { const f = film(r); if (f) { f.rating = gems(r.Rating, 5) || f.rating; if (!f.status) done(f, r); } }
    for (const r of files["reviews.csv"] || []) { const f = film(r); if (f && r.Review) f.note = clean(r.Review, 1500); }
    for (const r of files["likes/films.csv"] || files["films.csv"] || []) { const f = film(r); if (f) f.favourite = true; }
    for (const r of files["watchlist.csv"] || []) { const f = film(r); if (f && !f.status) { f.status = "planned"; f.added = when(r.Date); } }
    return [...films.values()];
}

// Goodreads: "Export Library" (goodreads_library_export.csv)
const SHELF = { read: "completed", "currently-reading": "progress", "to-read": "planned", "did-not-finish": "dropped", dnf: "dropped", abandoned: "dropped", "on-hold": "hold" };
function goodreads(rows) {
    return rows.map((r) => {
        const title = clean(String(r.Title || "").replace(/\s*\([^()]*#[\d.]+\)\s*$/, ""));
        if (!title) return null;
        const isbn = String(r.ISBN13 || r.ISBN || "").replace(/[^0-9X]/gi, "");
        const shelf = String(r["Exclusive Shelf"] || "").toLowerCase();
        return {
            type: "book", title, author: clean(r.Author, 120), year: year(r["Original Publication Year"]) || year(r["Year Published"]),
            status: SHELF[shelf] || (shelf ? "planned" : null), rating: gems(r["My Rating"], 5),
            at: shelf === "read" ? when(r["Date Read"]) || when(r["Date Added"]) : null, added: when(r["Date Added"]),
            note: clean(r["My Review"], 1500) || undefined, isbn: isbn.length >= 10 ? isbn : null,
            url: /^\d+$/.test(r["Book Id"] || "") ? `https://www.goodreads.com/book/show/${r["Book Id"]}` : null
        };
    }).filter(Boolean);
}

// IMDb: your ratings, your watchlist or any of your lists (CSV export)
const IMDB_TYPE = { movie: "film", tvmovie: "film", video: "film", short: "film", tvspecial: "film", tvshort: "film", tvseries: "series", tvminiseries: "series", videogame: "game" };
function imdb(rows) {
    return rows.map((r) => {
        const type = IMDB_TYPE[String(r["Title Type"] || "").toLowerCase().replace(/[^a-z]/g, "")];
        const title = clean(r.Title);
        if (!type || !title) return null;
        const rating = gems(r["Your Rating"], 10);
        const rated = rating > 0;
        return {
            type, title, year: year(r.Year), imdbId: /^tt\d+$/.test(r.Const || "") ? r.Const : null,
            status: rated ? "completed" : "planned", rating,
            at: rated ? when(r["Date Rated"]) : null, added: when(r.Created) || when(r["Date Rated"]),
            url: /^tt\d+$/.test(r.Const || "") ? `https://www.imdb.com/title/${r.Const}/` : null
        };
    }).filter(Boolean);
}

// MyAnimeList: Export → Anime list (animelist_….xml, or the .xml.gz)
const MAL_STATUS = { completed: "completed", watching: "progress", "plan to watch": "planned", "on-hold": "hold", dropped: "dropped" };
function myAnimeList(xml) {
    const out = [];
    const tag = (block, name) => { const m = new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${name}>`).exec(block); return m ? (m[1] !== undefined ? m[1] : m[2]).trim() : ""; };
    const ents = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    for (const m of String(xml).matchAll(/<anime>([\s\S]*?)<\/anime>/g)) {
        const b = m[1];
        const title = clean(ents(tag(b, "series_title")));
        if (!title) continue;
        const id = tag(b, "series_animedb_id");
        const st = MAL_STATUS[tag(b, "my_status").toLowerCase()] || null;
        const eps = Number(tag(b, "series_episodes")) || 0, seen = Number(tag(b, "my_watched_episodes")) || 0;
        out.push({
            type: "anime", title, malId: /^\d+$/.test(id) ? id : null, status: st, rating: gems(tag(b, "my_score"), 10),
            progress: st === "progress" && eps ? Math.round((seen / eps) * 100) : undefined,
            at: st === "completed" ? when(tag(b, "my_finish_date")) : null, added: when(tag(b, "my_start_date")),
            url: /^\d+$/.test(id) ? `https://myanimelist.net/anime/${id}` : null
        });
    }
    return out;
}

// What a file is, and its items: { source, items } or { error }
function readFile(file) {
    const st = fs.statSync(file);
    if (st.size > MAX_FILE) return { error: "That file is too large." };
    const name = path.basename(file).toLowerCase();
    let buf = fs.readFileSync(file);
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    // a zip: Letterboxd's export (or a zipped MyAnimeList/Goodreads file)
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
        const zip = new AdmZip(buf);
        const files = {};
        for (const e of zip.getEntries()) {
            if (e.isDirectory || e.header.size > MAX_FILE) continue;
            const n = e.entryName.toLowerCase().replace(/^[^/]*letterboxd[^/]*\//, "");
            if (/\.csv$/.test(n)) files[n] = e;
            else if (/\.xml(\.gz)?$/.test(n) && !files.xml) files.xml = e;
        }
        if (files["watched.csv"] || files["ratings.csv"] || files["diary.csv"] || files["watchlist.csv"]) {
            const csvs = {};
            for (const k of ["watched.csv", "diary.csv", "ratings.csv", "reviews.csv", "likes/films.csv", "watchlist.csv"]) if (files[k]) csvs[k] = parseCsv(files[k].getData().toString("utf8"));
            return { source: "letterboxd", items: letterboxd(csvs) };
        }
        const inner = files.xml || Object.values(files)[0];
        if (!inner) return { error: "That zip doesn't hold an export Riftgate knows." };
        buf = inner.getData();
        if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    }
    const text = buf.toString("utf8");
    if (/<myanimelist>/i.test(text.slice(0, 4000))) {
        if (!/<anime>/.test(text)) return { error: "That's a MyAnimeList manga list. Export your anime list instead." };
        return { source: "myanimelist", items: myAnimeList(text) };
    }
    const rows = parseCsv(text);
    const cols = new Set(Object.keys(rows[0] || {}));
    if (cols.has("Exclusive Shelf") && cols.has("Title")) return { source: "goodreads", items: goodreads(rows) };
    if (cols.has("Const") && cols.has("Title Type")) return { source: "imdb", items: imdb(rows) };
    if (cols.has("Letterboxd URI") && cols.has("Name")) {
        const kind = cols.has("Review") ? "reviews.csv" : cols.has("Watched Date") ? "diary.csv" : cols.has("Rating") ? "ratings.csv" : /watchlist/.test(name) ? "watchlist.csv" : /like/.test(name) ? "likes/films.csv" : "watched.csv";
        return { source: "letterboxd", items: letterboxd({ [kind]: rows }) };
    }
    return { error: "Riftgate doesn't recognise that file. Use the export from Letterboxd, Goodreads, IMDb or MyAnimeList." };
}

function summary(items) {
    const counts = {};
    for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;
    return {
        counts,
        rated: items.filter((i) => i.rating).length,
        completed: items.filter((i) => i.status === "completed").length,
        planned: items.filter((i) => i.status === "planned").length
    };
}

// ---- Matching films and series to TMDB -------------------------------------------
const tmdbImage = (p, size = "w500") => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
async function matchOne(it, tmdb) {
    if (it.type === "film") {
        const q = { query: it.title, include_adult: "false" };
        if (it.year) q.year = String(it.year);
        let r = await tmdb("/search/movie", q);
        let list = (r && r.results) || [];
        if (!list.length && it.year) { r = await tmdb("/search/movie", { query: it.title, include_adult: "false" }); list = (r && r.results) || []; }
        const y = (m) => year(m.release_date);
        const best = list.find((m) => it.year && y(m) === it.year) || list.find((m) => it.year && Math.abs((y(m) || 0) - it.year) === 1) || list[0];
        return best ? { tmdbId: best.id, title: best.title, image: tmdbImage(best.poster_path), backdrop: tmdbImage(best.backdrop_path, "w1280"), date: best.release_date || null, genreIds: (best.genre_ids || []).slice(0, 6) } : null;
    }
    if (it.type === "series" || it.type === "anime") {
        const q = { query: it.title, include_adult: "false" };
        if (it.year && it.type === "series") q.first_air_date_year = String(it.year);
        const r = await tmdb("/search/tv", q);
        const list = (r && r.results) || [];
        const best = it.type === "anime" ? list.find((s) => (s.genre_ids || []).includes(16)) || null : list.find((s) => !it.year || year(s.first_air_date) === it.year) || list[0];
        return best ? { tmdbShowId: best.id, title: best.name, image: tmdbImage(best.poster_path), backdrop: tmdbImage(best.backdrop_path, "w1280"), date: best.first_air_date || null, genreIds: (best.genre_ids || []).slice(0, 6) } : null;
    }
    return null;
}

const matchKey = (it) => `${it.type}|${it.title.toLowerCase()}|${it.year || ""}`;
async function match(items, tmdb, onProgress = () => {}) {
    const memo = data.loadCache(MATCH_FILE) || {};
    const todo = items.filter((it) => (it.type === "film" || it.type === "series" || it.type === "anime") && !(matchKey(it) in memo));
    let done = 0, failed = 0, i = 0;
    onProgress({ done: 0, total: todo.length });
    const worker = async () => {
        while (i < todo.length) {
            const it = todo[i++];
            try { memo[matchKey(it)] = await matchOne(it, tmdb); } catch (err) { failed++; }
            done++;
            if (done % 5 === 0 || done === todo.length) onProgress({ done, total: todo.length });
            if (done % 50 === 0) data.saveCache(MATCH_FILE, memo);
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (todo.length) data.saveCache(MATCH_FILE, memo);
    return { items: items.map((it) => { const m = memo[matchKey(it)]; return m ? { ...it, match: m } : it; }), failed };
}

// ---- Your Steam wishlist (public profiles) ----------------------------------------
async function steamWishlist() {
    const id = String(settings.read().steamId64 || "");
    if (!/^\d{17}$/.test(id)) return { error: "Add your SteamID64 under Settings → Steam playtime first." };
    let r;
    try { r = await httpsGetJsonPlain(`https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${id}`, 15000); } catch (err) { return { error: "Steam didn't answer. Try again in a moment." }; }
    const ids = (((r && r.response) || {}).items || []).sort((a, b) => (a.priority || 0) - (b.priority || 0)).map((x) => String(x.appid)).filter((x) => /^\d{1,10}$/.test(x)).slice(0, 300);
    if (!ids.length) return { error: "Steam shows no wishlist for your profile. It may be empty, or private: in Steam, Edit Profile → Privacy Settings → Game details: Public." };
    const names = {};
    for (let i = 0; i < ids.length; i += 100) {
        const input = { ids: ids.slice(i, i + 100).map((appid) => ({ appid: Number(appid) })), context: { language: "english", country_code: "US" }, data_request: { include_assets: true } };
        try {
            const g = await httpsGetJsonPlain(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, 15000);
            for (const s of ((g && g.response) || {}).store_items || []) {
                const a = s.assets || {};
                const file = a.library_capsule || a.header;
                names[s.appid] = { title: clean(s.name, 200), image: a.asset_url_format && file ? `https://shared.fastly.steamstatic.com/store_item_assets/${a.asset_url_format.replace("${FILENAME}", file)}` : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${s.appid}/header.jpg` };
            }
        } catch (err) { /* those keep their number only, and are left out */ }
    }
    const items = ids.filter((x) => names[x] && names[x].title).map((appid) => ({ steamAppId: appid, ...names[appid] }));
    return items.length ? { items } : { error: "Steam didn't say which games those are. Try again in a moment." };
}

function register(ipcMain, { tmdb }) {
    ipcMain.handle("r2-import-pick", async () => {
        const r = await dialog.showOpenDialog(windowRef.get(), {
            title: "Import your history",
            properties: ["openFile"],
            filters: [{ name: "Exports from Letterboxd, Goodreads, IMDb or MyAnimeList", extensions: ["zip", "csv", "xml", "gz"] }]
        });
        if (r.canceled || !r.filePaths[0]) return { canceled: true };
        try {
            const got = readFile(r.filePaths[0]);
            if (got.error) return got;
            const items = got.items.slice(0, MAX_ITEMS);
            if (!items.length) return { error: "There's nothing in that file to bring in." };
            return { source: got.source, name: path.basename(r.filePaths[0]), items, ...summary(items) };
        } catch (err) {
            return { error: "That file couldn't be read. Is it the export, unchanged?" };
        }
    });
    ipcMain.handle("r2-import-match", async (event, items) => {
        if (!Array.isArray(items)) return { items: [], failed: 0 };
        return match(items.slice(0, MAX_ITEMS), tmdb, (p) => windowRef.send("r2-import-progress", p));
    });
    ipcMain.handle("r2-import-steam-wishlist", async () => steamWishlist());
}

module.exports = { register, parseCsv, readFile, letterboxd, goodreads, imdb, myAnimeList, match, steamWishlist };
