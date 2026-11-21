// node tests/videos.test.js — the Watch page's videos (services/videos.js): every
// section's channels well formed, a channel feed read right (Shorts left out),
// the most watched of the last days picked with no channel filling a row, and
// videos about your own games and shows found by whole words.
"use strict";
const assert = require("assert");
const v = require("../services/videos");

// sections: games, free to play, movies, series, books; channel ids look like channel ids, none twice
assert.deepStrictEqual(v.SECTIONS.map((s) => s.id), ["games", "free", "movies", "series", "books"]);
const ids = v.SECTIONS.flatMap((s) => s.channels.map(([id]) => id));
ids.forEach((id) => assert.ok(/^UC[\w-]{22}$/.test(id), id));
assert.strictEqual(new Set(ids).size, ids.length, "a channel in two sections");
assert.ok(v.feedUrl("UCKy1dAqELo0zrOtPkf0eTMw").startsWith("https://www.youtube.com/feeds/videos.xml?channel_id="));

// a feed
const entry = (id, title, published, views, shorts) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>UCKy1dAqELo0zrOtPkf0eTMw</yt:channelId><title>${title}</title><link rel="alternate" href="https://www.youtube.com/${shorts ? "shorts/" : "watch?v="}${id}"/><author><name>IGN</name><uri>x</uri></author><published>${published}</published><media:group><media:title>${title}</media:title><media:description>Subscribe &amp; more</media:description><media:community><media:starRating count="20"/><media:statistics views="${views}"/></media:community></media:group></entry>`;
const xml = `<?xml version="1.0"?><feed><title>IGN</title>` +
    entry("aaaaaaaaaaa", "GTA 6 &amp; the jet", "2026-11-20T10:00:00+00:00", 500, true) +
    entry("bbbbbbbbbbb", "Wuthering Waves - Official Gameplay Reveal", "2026-11-19T10:00:00+00:00", 31073) +
    entry("ccccccccccc", "Hollow Knight: Silksong Review", "2026-11-01T10:00:00+00:00", 900000) + `</feed>`;
const feed = v.parseFeed(xml);
assert.deepStrictEqual(feed.map((x) => [x.id, x.title, x.channel, x.views, x.short]), [
    ["aaaaaaaaaaa", "GTA 6 & the jet", "IGN", 500, true],
    ["bbbbbbbbbbb", "Wuthering Waves - Official Gameplay Reveal", "IGN", 31073, false],
    ["ccccccccccc", "Hollow Knight: Silksong Review", "IGN", 900000, false]]);
assert.strictEqual(feed[1].description, "Subscribe & more");
assert.deepStrictEqual(v.parseFeed("<feed></feed>"), []);

// the most watched: Shorts out; the last two weeks, or the month when that's too few
const now = Date.parse("2026-11-21T12:00:00Z");
assert.deepStrictEqual(v.mostWatched(feed, { days: 14, now }).map((x) => x.id), ["ccccccccccc", "bbbbbbbbbbb"], "too few in two weeks: the month");
const many = Array.from({ length: 30 }, (_, i) => ({ id: `v${String(i).padStart(10, "0")}`, title: `T${i}`, channel: i < 20 ? "Big" : `C${i}`, published: new Date(now - i * 3600e3).toISOString(), views: 1000 - i, short: false }));
const top = v.mostWatched(many, { days: 7, max: 12, now });
assert.strictEqual(top.length, 12);
assert.ok(top.filter((x) => x.channel === "Big").length <= 4, "one channel fills at most a third of a row");
assert.ok(top.every((x, i) => !i || top[i - 1].views >= x.views), "most watched first");
assert.deepStrictEqual(v.mostWatched([{ ...many[0], published: new Date(now - 40 * 86400e3).toISOString() }], { now }), [], "older than a month: out");

// about yours: whole words only, the name as you have it
const yours = v.aboutYours(feed, ["Hollow Knight: Silksong", "It", "Waves"]);
assert.deepStrictEqual(yours.map((x) => [x.id, x.about]), [["ccccccccccc", "Hollow Knight: Silksong"], ["bbbbbbbbbbb", "Waves"]]);
assert.deepStrictEqual(v.aboutYours(feed, ["Wave"]), [], "part of a word doesn't count");
assert.deepStrictEqual(v.aboutYours(feed, []), []);

console.log("videos: ok");
