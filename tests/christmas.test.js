// node --no-warnings tests/christmas.test.js — the Christmas Rift: its dates,
// the year a season belongs to, the themes that carry a season, Ask the
// Rift's "Christmas", the facts, the pictures, and the Portuguese for it all.
"use strict";
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const load = (p) => import(pathToFileURL(path.join(__dirname, "..", p)).href);

// season.js reaches dom.js, which sets itself up on the page's classes when it
// loads: stand-ins will do (nothing here draws)
global.DOMParser = class { parseFromString() { return { documentElement: {} }; } };
global.Element = class { append() {} prepend() {} };
global.DocumentFragment = class { append() {} prepend() {} };

(async () => {
    const season = await load("src/app/season.js");
    const at = (y, m, d) => new Date(y, m - 1, d, 12);
    const on = (y, m, d) => (season.seasonOn(at(y, m, d)) || {}).id || null;
    assert.strictEqual(on(2026, 11, 10), null, "nothing on 10 November");
    assert.strictEqual(on(2026, 11, 11), "christmas", "the Christmas Rift opens on 11 November");
    assert.strictEqual(on(2026, 12, 25), "christmas");
    assert.strictEqual(on(2027, 1, 1), "christmas", "it crosses the New Year");
    assert.strictEqual(on(2027, 1, 6), "christmas", "it closes after 6 January");
    assert.strictEqual(on(2027, 1, 7), null);
    assert.strictEqual(on(2026, 10, 31), "halloween", "the Hallowed Rift is untouched");
    assert.strictEqual(on(2026, 11, 4), null);
    assert.strictEqual(season.seasonYear(at(2027, 1, 3)), 2026, "January belongs to the Christmas before it");
    assert.strictEqual(season.seasonYear(at(2026, 12, 3)), 2026);
    const xmas = season.SEASONS.find((s) => s.id === "christmas");
    assert.ok(xmas.hello && xmas.theme.colors.accent && xmas.extra["--bolt-core"]);

    // the themes that carry a season, all year
    const { BUILTIN_THEMES } = await load("src/app/themes-builtin.js");
    const carried = BUILTIN_THEMES.filter((t) => t.season).map((t) => t.season).sort();
    assert.deepStrictEqual(carried, ["christmas", "halloween"], "a Hallowed Rift and a Christmas Rift theme");
    assert.strictEqual(new Set(BUILTIN_THEMES.map((t) => t.id)).size, BUILTIN_THEMES.length, "theme ids are unique");

    // Ask the Rift understands Christmas, in English and Portuguese
    const ask = await load("src/app/ask.js");
    for (const q of ["something for christmas", "a xmas film", "um filme de natal"]) {
        const r = ask.understand(q);
        assert.ok(r.want.some((c) => c.id === "christmas"), `"${q}" asks for Christmas`);
    }
    const pool = [
        { key: "f1", type: "film", title: "A Christmas Story", desc: "Ralphie wants one thing for Christmas.", rating: 7.6, votes: 2000, genres: ["Comedy", "Family"] },
        { key: "f2", type: "film", title: "Alien", desc: "In space, no one can hear you scream.", rating: 8.4, votes: 9000, genres: ["Horror", "Science Fiction"] },
        { key: "g1", type: "game", title: "Snowy Village", desc: "A cosy winter game.", raw: { tags: ["Winter", "Casual"] } }
    ];
    const picks = ask.rank(ask.understand("something for christmas"), pool, { limit: 5 }).picks.map((p) => p.item.key);
    assert.ok(picks.includes("f1") && !picks.includes("f2"), "a Christmas film is picked, a space horror isn't");

    // the facts
    const facts = await load("src/app/facts.js");
    const all = facts.christmasFacts();
    assert.ok(all.length >= 20 && all.every((f) => typeof f === "string" && f.endsWith(".")), "twenty-odd Christmas facts, each a sentence");
    for (const w of ["games", "screen", "books"]) assert.ok(facts.SEASON_FACTS.christmas[w].length >= 5, `facts for ${w}`);

    // the pictures: well-formed enough to draw (tags balanced, no stray template bits)
    const art = await load("src/components/yule-art.js");
    const svgs = { sleigh0: art.sleighSVG(0), sleigh1: art.sleighSVG(1), sleighBoth: art.sleighSVG("both"), tree: art.treeSVG(), fireplace: art.fireplaceSVG(),
        elf: art.elfSVG(), snowman: art.snowmanSVG(), hat: art.hatSVG(), holly: art.hollySVG(), ...Object.fromEntries(art.WRAPS.map((_, k) => [`present${k}`, art.presentSVG(k)])) };
    for (const [name, svg] of Object.entries(svgs)) {
        assert.ok(/^<svg[\s>]/.test(svg.trim()) && svg.trim().endsWith("</svg>"), `${name} is an svg`);
        assert.ok(!/undefined|NaN|\$\{/.test(svg), `${name} has nothing left unfilled`);
        const opens = (svg.match(/<(g|svg|defs|linearGradient|radialGradient|style)[\s>]/g) || []).length;
        const closes = (svg.match(/<\/(g|svg|defs|linearGradient|radialGradient|style)>/g) || []).length;
        assert.strictEqual(opens, closes, `${name}: every group is closed`);
    }
    assert.ok(svgs.sleighBoth.includes('class="f0"') && svgs.sleighBoth.includes('class="f1"'), "the app's sleigh has both leg frames");
    assert.ok(svgs.sleigh0.includes("xmlns="), "the opening's sleigh can be drawn as a picture");

    // the Portuguese for everything the season says
    const pt = (await load("src/app/lang/pt.js")).default;
    const must = ["The Christmas Rift is open until 6 January. Snow is falling, and there are presents hidden all over Riftgate.", "Advent calendar", "Ho ho ho", "Christmas picks",
        "Present hunter", "Twenty-four doors", "Jolly", "Christmas Rift", "Hallowed Rift", "Let it snow", "Decorations", "You found a present! {0} of {1}. Inside: {2}", ...all];
    for (const s of must) assert.ok(pt[s], `Portuguese for ${JSON.stringify(s)}`);

    console.log("christmas: all checks passed");
})().catch((e) => { console.error(e); process.exit(1); });
