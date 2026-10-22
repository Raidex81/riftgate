// node tests/imports.test.js — engine/imports.js: the export files of
// Letterboxd, Goodreads, IMDb and MyAnimeList, matching to TMDB, and the
// Steam wishlist, without Electron or the internet.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const Module = require("module");
const { EventEmitter } = require("events");
const AdmZip = require("adm-zip");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-import-"));
let steamId = "76561198000000001";
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => tmp }, dialog: {} };
    return origLoad.call(this, req, ...rest);
};
const settings = require("../engine/core/settings");
const hits = [];
const https = require("https");
https.get = function (url, opts, cb) {
    cb = typeof opts === "function" ? opts : cb; url = String(url);
    hits.push(url);
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req; req.end = () => req;
    setImmediate(() => {
        let body = {};
        if (url.includes("GetWishlist")) body = { response: { items: [{ appid: 20, priority: 2 }, { appid: 10, priority: 1 }, { appid: 30, priority: 3 }] } };
        if (url.includes("GetItems")) body = { response: { store_items: [
            { appid: 10, name: "Half-Life", assets: { asset_url_format: "steam/apps/10/abc/${FILENAME}", library_capsule: "library_600x900.jpg" } },
            { appid: 20, name: "Portal" }] } };
        const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; cb(res);
        res.emit("data", JSON.stringify(body)); res.emit("end");
    });
    return req;
};
const im = require("../engine/imports");
const write = (name, v) => { const p = path.join(tmp, name); fs.writeFileSync(p, v); return p; };

(async () => {
    // CSV: quotes, doubled quotes, commas and line breaks inside quotes, a BOM
    assert.deepStrictEqual(im.parseCsv("﻿a,b\r\n1,\"x, \"\"y\"\"\nz\"\r\n"), [{ a: "1", b: "x, \"y\"\nz" }]);

    // Letterboxd: the export zip
    const lb = new AdmZip();
    lb.addFile("letterboxd-me-2026/watched.csv", Buffer.from("Date,Name,Year,Letterboxd URI\n2024-01-02,The Thing,1982,https://boxd.it/a\n2024-02-03,Heat,1995,https://boxd.it/b\n"));
    lb.addFile("letterboxd-me-2026/ratings.csv", Buffer.from("Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,The Thing,1982,https://boxd.it/a,4.5\n2024-03-01,Alien,1979,https://boxd.it/c,2.5\n"));
    lb.addFile("letterboxd-me-2026/diary.csv", Buffer.from("Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-05-05,Heat,1995,https://boxd.it/d,5,Yes,,2024-05-04\n"));
    lb.addFile("letterboxd-me-2026/reviews.csv", Buffer.from("Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-05-05,Heat,1995,https://boxd.it/d,5,,\"Best, \"\"ever\"\"\",,2024-05-04\n"));
    lb.addFile("letterboxd-me-2026/likes/films.csv", Buffer.from("Date,Name,Year,Letterboxd URI\n2024-05-05,Heat,1995,https://boxd.it/b\n"));
    lb.addFile("letterboxd-me-2026/watchlist.csv", Buffer.from("Date,Name,Year,Letterboxd URI\n2024-06-01,Dune: Part Two,2024,https://boxd.it/e\n2024-06-01,Heat,1995,https://boxd.it/b\n"));
    const l = im.readFile(write("letterboxd.zip", lb.toBuffer()));
    assert.strictEqual(l.source, "letterboxd");
    const by = Object.fromEntries(l.items.map((i) => [i.title, i]));
    assert.strictEqual(l.items.length, 4);
    assert.deepStrictEqual([by.Heat.status, by.Heat.rating, by.Heat.favourite, by.Heat.note], ["completed", 5, true, "Best, \"ever\""]);
    assert.strictEqual(new Date(by.Heat.at).toISOString().slice(0, 10), "2024-05-04", "the latest watch");
    assert.deepStrictEqual([by["The Thing"].rating, by.Alien.rating, by.Alien.status], [5, 3, "completed"]);
    assert.strictEqual(by["Dune: Part Two"].status, "planned");
    // one CSV on its own
    const one = im.readFile(write("ratings.csv", "Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Up,2009,https://boxd.it/u,3\n"));
    assert.deepStrictEqual([one.source, one.items[0].rating, one.items[0].status], ["letterboxd", 3, "completed"]);

    // Goodreads
    const gr = im.readFile(write("goodreads_library_export.csv", [
        "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies",
        "1,\"The Last Wish (The Witcher, #0.5)\",Andrzej Sapkowski,\"Sapkowski, Andrzej\",,\"=\"\"0316029181\"\"\",\"=\"\"9780316029186\"\"\",5,4.1,Orbit,Paperback,360,2008,1993,2023/05/14,2023/04/01,,,read,Loved it,,,1,0",
        "2,Dune,Frank Herbert,\"Herbert, Frank\",,,,0,4.2,Ace,Paperback,600,1990,1965,,2024/01/01,to-read,to-read (#1),to-read,,,,0,0",
        "3,Emma,Jane Austen,\"Austen, Jane\",,,,0,4,,,,,1815,,2024/01/01,currently-reading,,currently-reading,,,,0,0"
    ].join("\n")));
    assert.strictEqual(gr.source, "goodreads");
    assert.deepStrictEqual(gr.items.map((b) => [b.title, b.author, b.status, b.rating]), [["The Last Wish", "Andrzej Sapkowski", "completed", 5], ["Dune", "Frank Herbert", "planned", 0], ["Emma", "Jane Austen", "progress", 0]]);
    assert.strictEqual(gr.items[0].isbn, "9780316029186");
    assert.strictEqual(gr.items[0].year, 1993);
    assert.strictEqual(new Date(gr.items[0].at).getFullYear(), 2023);

    // IMDb: ratings (both the old and the new "Title Type" names)
    const ib = im.readFile(write("ratings.csv", [
        "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
        "tt0113277,9,2024-01-01,Heat,Heat,https://www.imdb.com/title/tt0113277/,Movie,8.3,170,1995,Crime,1,1995-12-15,Michael Mann",
        "tt0903747,10,2024-02-01,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,tvSeries,9.5,49,2008,Drama,1,2008-01-20,",
        "tt1,7,2024-02-01,Pilot,Pilot,u,TV Episode,9,49,2008,Drama,1,2008-01-20,",
        "tt2,8,2024-02-01,Portal 2,Portal 2,u,Video Game,9,0,2011,Puzzle,1,2011-04-18,"
    ].join("\n")));
    assert.strictEqual(ib.source, "imdb");
    assert.deepStrictEqual(ib.items.map((i) => [i.type, i.title, i.rating, i.status]), [["film", "Heat", 5, "completed"], ["series", "Breaking Bad", 5, "completed"], ["game", "Portal 2", 4, "completed"]]);
    const wl = im.readFile(write("WATCHLIST.csv", "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated\n1,tt3,2024-01-01,2024-01-01,,Arrival,Arrival,u,movie,7.9,116,2016,Drama,1,2016-11-11,,,\n"));
    assert.deepStrictEqual(wl.items.map((i) => [i.title, i.status]), [["Arrival", "planned"]]);

    // MyAnimeList (.xml.gz)
    const xml = `<?xml version="1.0"?><myanimelist><myinfo><user_name>me</user_name></myinfo>
      <anime><series_animedb_id>16498</series_animedb_id><series_title><![CDATA[Shingeki no Kyojin]]></series_title><series_episodes>25</series_episodes><my_watched_episodes>25</my_watched_episodes><my_finish_date>2021-03-04</my_finish_date><my_score>9</my_score><my_status>Completed</my_status></anime>
      <anime><series_animedb_id>1</series_animedb_id><series_title>Cowboy Bebop &amp; Co</series_title><series_episodes>26</series_episodes><my_watched_episodes>13</my_watched_episodes><my_score>0</my_score><my_status>Watching</my_status></anime>
    </myanimelist>`;
    const mal = im.readFile(write("animelist_1.xml.gz", zlib.gzipSync(xml)));
    assert.strictEqual(mal.source, "myanimelist");
    assert.deepStrictEqual(mal.items.map((a) => [a.title, a.status, a.rating, a.progress]), [["Shingeki no Kyojin", "completed", 5, undefined], ["Cowboy Bebop & Co", "progress", 0, 50]]);
    assert.ok(im.readFile(write("manga.xml", "<myanimelist><manga><series_title>x</series_title></manga></myanimelist>")).error);
    assert.ok(im.readFile(write("other.csv", "a,b\n1,2\n")).error);

    // matching: by title and year, anime only to animation, each asked once
    const asked = [];
    const tmdb = async (p, q) => {
        asked.push(`${p} ${q.query} ${q.year || q.first_air_date_year || ""}`);
        if (p === "/search/movie" && q.query === "Heat") return { results: [{ id: 99, title: "Heat", release_date: "1986-01-01" }, { id: 949, title: "Heat", release_date: "1995-12-15", poster_path: "/h.jpg", genre_ids: [80] }] };
        if (p === "/search/movie" && q.query === "Nothing") return { results: [] };
        if (p === "/search/tv" && q.query === "Shingeki no Kyojin") return { results: [{ id: 5, name: "Some drama", genre_ids: [18] }, { id: 1429, name: "Attack on Titan", genre_ids: [16, 10759], first_air_date: "2013-04-07" }] };
        if (p === "/search/tv") return { results: [{ id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20" }] };
        throw new Error("down");
    };
    const items = [ib.items[0], { type: "film", title: "Nothing", year: 2001 }, ib.items[1], mal.items[0], gr.items[0]];
    const m = await im.match(items, tmdb);
    assert.deepStrictEqual(m.items[0].match.tmdbId, 949, "the one from the right year");
    assert.strictEqual(m.items[0].match.image, "https://image.tmdb.org/t/p/w500/h.jpg");
    assert.strictEqual(m.items[1].match, undefined);
    assert.strictEqual(m.items[2].match.tmdbShowId, 1396);
    assert.strictEqual(m.items[3].match.title, "Attack on Titan");
    assert.strictEqual(m.items[4].match, undefined, "books need no lookup");
    assert.ok(asked.some((a) => a === "/search/movie Nothing "), "a film not found by its year is tried without it");
    const n = asked.length;
    await im.match(items, tmdb);
    assert.strictEqual(asked.length, n, "matches are remembered");

    // Steam wishlist: in your order, with names and art
    settings.update({ steamId64: steamId });
    const w = await im.steamWishlist();
    assert.deepStrictEqual(w.items.map((g) => [g.steamAppId, g.title]), [["10", "Half-Life"], ["20", "Portal"]]);
    assert.strictEqual(w.items[0].image, "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/10/abc/library_600x900.jpg");
    assert.ok(hits.some((u) => u.includes("GetWishlist/v1/?steamid=" + steamId)));
    settings.update({ steamId64: "" });
    assert.ok((await im.steamWishlist()).error);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("imports: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
