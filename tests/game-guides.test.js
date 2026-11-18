// node tests/game-guides.test.js — Guides & mods for a game in the Library
// (services/game-guides.js): the best site first, your language beside
// English and never a third one, mods and community links, nothing broken.
"use strict";
const assert = require("assert");
const g = require("../services/game-guides");

// a hand-picked database comes first (Dune: Awakening's on Method.gg)
let r = g.build({ title: "Dune: Awakening", appid: "1172710", wd: { pcgw: "Dune:_Awakening" } });
assert.strictEqual(r.best.url, "https://www.method.gg/dune-awakening/database");
assert.deepStrictEqual(r.groups.map((x) => x.id), ["guides", "community"]);
assert.ok(r.groups[1].links.some((l) => l.url === "https://steamcommunity.com/app/1172710/guides/"));

// the game's own wiki, English first, then yours; a Fandom wiki in a third language never
r = g.build({ title: "Stardew Valley", appid: "413150", lang: "pt",
    wd: { fandom: ["pl.stardewvalley"], wikigg: ["stardewmodding"], official: ["https://stardewvalleywiki.com/Stardew_Valley_Wiki", "https://pt.stardewvalleywiki.com/Stardew_Valley_Wiki", "https://de.stardewvalleywiki.com/Stardew_Valley_Wiki"], pcgw: "Stardew_Valley" },
    nexus: { domain: "stardewvalley", mods: 25000 } });
const urls = r.groups.flatMap((x) => x.links.map((l) => l.url));
assert.strictEqual(r.best.url, "https://stardewvalleywiki.com/Stardew_Valley_Wiki");
assert.ok(urls.includes("https://pt.stardewvalleywiki.com/Stardew_Valley_Wiki") && !urls.some((u) => u.includes("de.stardew") || u.includes("fandom.com/pl")));
assert.ok(r.groups.find((x) => x.id === "guides").links.some((l) => l.label === "stardewmodding.wiki.gg"), "a side wiki is named by its own name");
assert.ok(urls.includes("https://www.nexusmods.com/stardewvalley/mods/"));

// Fandom: English and Brazilian Portuguese for a Portuguese reader; mods from Wikidata and Steam's Workshop
r = g.build({ title: "Valheim", appid: "892970", lang: "pt", wd: { fandom: ["valheim", "pt-br.valheim", "de.valheim"], modio: "valheim", thunderstore: "valheim" }, workshop: true });
const all = r.groups.flatMap((x) => x.links.map((l) => l.url));
assert.ok(all.includes("https://valheim.fandom.com/") && all.includes("https://valheim.fandom.com/pt-br/") && !all.includes("https://valheim.fandom.com/de/"));
assert.ok(all.includes("https://mod.io/g/valheim") && all.includes("https://thunderstore.io/c/valheim/") && all.includes("https://steamcommunity.com/app/892970/workshop/"));
assert.ok(all.includes("https://www.pcgamingwiki.com/api/appid.php?appid=892970"), "PCGamingWiki by Steam id when Wikidata hasn't its page");
assert.notStrictEqual(r.best.label, "PCGamingWiki");

// not on Steam: by name; nothing known: still a way to search
r = g.build({ title: "World of Warcraft" });
assert.strictEqual(r.best.url, "https://www.wowhead.com/");
r = g.build({ title: "Some Unknown Game" });
assert.strictEqual(r.best, null);
assert.deepStrictEqual(r.groups.map((x) => x.id), ["community"]);
assert.ok(r.groups[0].links[0].url.startsWith("https://duckduckgo.com/?q=Some%20Unknown%20Game"));

// Nexus Mods' list by name, the biggest entry winning a tie
const idx = g.nexusIndex([{ name: "Valheim", domain_name: "valheim", mods: 4000 }, { name: "valheim", domain_name: "valheimold", mods: 3 }, { name: "No Mods", domain_name: "x", mods: 0 }]);
assert.strictEqual(idx.get("valheim").domain, "valheim");

// every hand-picked link is a plain https URL, and no game is listed twice
const ids = new Set();
for (const c of g.CURATED) {
    for (const l of [...(c.guides || []), ...(c.mods || [])]) assert.ok(/^https:\/\/[a-z0-9.-]+\//.test(l.url), l.url);
    for (const id of c.steam || []) { assert.ok(!ids.has(id), `Steam ${id} twice`); ids.add(id); }
}
console.log("game-guides: all checks passed");
