// node tests/content.test.js — engine/content.js without Electron or the internet.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { EventEmitter } = require("events");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-content-"));
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => tmp }, safeStorage: { isEncryptionAvailable: () => false } };
    return origLoad.call(this, req, ...rest);
};

// a fake internet: answers by URL, counts requests, can go down
const NOW = Date.now(), DAY = 864e5;
let DOWN = false; const hits = [];
const answers = {
    "api.steampowered.com": (u) => ({ appnews: { newsitems: u.includes("appid=10") ? [
        { gid: "1", title: "Update 1.2 is out", url: "https://store.steampowered.com/news/1", date: Math.floor((NOW - 2 * DAY) / 1000), contents: "[h1]Big[/h1] changes {STEAM_CLAN_IMAGE}/abc.png and <b>fixes</b> https://x.y", tags: ["patchnotes"] },
        { gid: "2", title: "Old news", url: "https://store.steampowered.com/news/2", date: Math.floor((NOW - 90 * DAY) / 1000), contents: "old" }
    ] : u.includes("appid=20") ? [{ gid: "3", title: "Ancient", url: "https://store.steampowered.com/news/3", date: Math.floor((NOW - 60 * DAY) / 1000), contents: "x" }] : [] } }),
    "api.jikan.moe": (u) => ({ pagination: { has_next_page: u.includes("page=1") }, data: u.includes("page=1") ? [
        { mal_id: 1, title: "Sora no Kanata", title_english: "Beyond the Sky", members: 500, score: 8.1, airing: true, type: "TV", broadcast: { day: "Saturdays", time: "23:30" }, images: { jpg: { large_image_url: "https://cdn.myanimelist.net/a.jpg" } }, synopsis: "A sky. [Written by MAL Rewrite]", genres: [{ name: "Fantasy" }] },
        { mal_id: 2, title: "Song", type: "Music", members: 9999 }
    ] : [{ mal_id: 3, title: "Kaze", members: 900, airing: false, type: "TV", episodes: 12 }, { mal_id: 1, title: "dup", members: 1 }] }),
    "librivox.org": () => ({ books: [
        { id: "7", title: "The <i>Sea</i> Wolf", language: "English", totaltime: "11:02:03", totaltimesecs: 39723, url_librivox: "https://librivox.org/the-sea-wolf/", authors: [{ first_name: "Jack", last_name: "London" }], coverart_jpg: "https://archive.org/c.jpg", description: "<p>A tale.</p>", genres: [{ name: "Adventure" }] },
        { id: "8", title: "Le Livre", language: "French", totaltimesecs: 100, url_librivox: "https://librivox.org/x/" },
        { id: "9", title: "Not done", language: "English", totaltimesecs: 0, url_librivox: "https://librivox.org/y/" }
    ] })
};
const https = require("https");
https.get = function (url, opts, cb) {
    cb = typeof opts === "function" ? opts : cb; url = String(url);
    hits.push(url);
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => req; req.end = () => req;
    setImmediate(() => {
        if (DOWN) return req.emit("error", Object.assign(new Error("offline"), { code: "ENOTFOUND" }));
        const host = new URL(url).hostname, body = answers[host] ? answers[host](url) : {};
        const res = new EventEmitter(); res.statusCode = 200; cb(res);
        res.emit("data", JSON.stringify(body)); res.emit("end");
    });
    return req;
};
global.setTimeout = ((st) => (fn, ms, ...a) => st(fn, Math.min(ms || 0, 5), ...a))(global.setTimeout);

const handlers = {};
const content = require("../engine/content");
content.register({ handle: (c, fn) => { handlers[c] = fn; } });
const call = (c, ...a) => handlers[c]({}, ...a);

(async () => {
    // news: the developers' posts, plain text, patch notes marked
    let news = await call("r2-steam-news", "10");
    assert.strictEqual(news.length, 2);
    assert.ok(hits[0].includes("feeds=steam_community_announcements"), "only the developers' own posts");
    assert.strictEqual(news[0].text, "Big changes and fixes");
    assert.strictEqual(news[0].patch, true);
    // kept for 6 hours: no second request
    let n = hits.length; await call("r2-steam-news", "10"); assert.strictEqual(hits.length, n);
    // the newest post of each recent game, only from the last month
    const recent = await call("r2-steam-news-recent", ["10", "20", "abc", "10"]);
    assert.deepStrictEqual(recent.map((r) => [r.appid, r.id]), [["10", "1"]]);
    assert.deepStrictEqual(await call("r2-steam-news", "../x"), []);

    // anime: two pages, music videos and repeats left out, most followed first
    const season = await call("r2-anime-season");
    assert.deepStrictEqual(season.map((a) => a.title), ["Kaze", "Beyond the Sky"]);
    const sky = season.find((a) => a.malId === 1);
    assert.deepStrictEqual(sky.broadcast, { day: 6, time: "23:30" });
    assert.strictEqual(sky.synopsis, "A sky.");

    // audiobooks: English, finished recordings only, plain text
    const books = await call("r2-audiobooks");
    assert.deepStrictEqual(books.map((b) => b.title), ["The Sea Wolf"]);
    assert.strictEqual(books[0].author, "Jack London");
    assert.strictEqual(books[0].description, "A tale.");

    // offline: the saved copies, still complete
    DOWN = true;
    fs.writeFileSync(path.join(tmp, "cache-audiobooks.json"), JSON.stringify({ latest: { at: 1, value: books } }));
    assert.strictEqual((await call("r2-audiobooks")).length, 1, "a stale saved list beats nothing");
    // ...and a game never asked about before: nothing, no crash
    assert.deepStrictEqual(await call("r2-steam-news-recent", ["30"]), []);
    console.log("content: all checks passed");
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
