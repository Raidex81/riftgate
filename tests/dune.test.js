// node tests/dune.test.js — the Dune: Awakening companion's data (services/dune.js):
// weapons ranked best to weakest, armour read right, a dungeon's hazard and boss,
// recipes down to what you gather, and where a piece drops or how it's researched.
"use strict";
const assert = require("assert");
const d = require("../services/dune");
const sample = require("./fixtures/dune-sample.json");

// wiki pictures live under the MD5 of their name
assert.ok(/^https:\/\/media\.awakening\.wiki\/wiki\/[0-9a-f]\/[0-9a-f]{2}\/T_UI_X\.png$/.test(d.fileUrl("T_UI_X.png")));
assert.strictEqual(d.pageUrl("Regis GRDA 44"), "https://awakening.wiki/Regis_GRDA_44");
assert.strictEqual(d.familyOf("Regis Karpov 38"), "Karpov 38");

// weapons: every one with stats read (a row with none is left out), ranked within guns and melee by sustained damage
const weapons = d.rankWeapons(sample.weapons.map(d.weapon).filter(Boolean));
assert.strictEqual(weapons.length, sample.weapons.length - 1);
assert.strictEqual(d.weapon({ item_id: "CHOAMSword", name: "CHOAM Sword", image: null, item_tags: null }), null);
for (const group of ["ranged", "melee"]) {
    const g = weapons.filter((w) => w.group === group);
    assert.ok(g.length > 1, group);
    g.forEach((w, i) => { assert.strictEqual(w.rank, i + 1); if (i) assert.ok(g[i - 1].score >= w.score, `${group} order`); });
}
const grda = weapons.find((w) => w.name === "Regis GRDA 44");
assert.strictEqual(grda.tier, 6);
assert.ok(grda.score > 0 && grda.score <= grda.dps, "sustained never beats burst");
assert.ok(weapons.find((w) => w.name === "A Dart for Every Man").unique);

// armour: the slot, the tier, mitigation; a suit goes in the suit slot
const garments = sample.garments.map(d.garment).filter(Boolean);
const chest = garments.find((g) => g.name === "Bulwark Chest");
assert.strictEqual(chest.slot, "Torso");
assert.ok(chest.unique && chest.armor > 0);
assert.ok(chest.mit.blade < 0, "a penalty stays negative");
assert.strictEqual(garments.find((g) => g.name === "Radiation Suit Mk6").slot, "Suit");

// a dungeon: its hazard (from the pop-up picture), boss, strategy and rewards, and no wiki markup left over
const ts = d.dungeon("Testing Station 24", sample.dungeon);
assert.strictEqual(ts.hazard, "Darkness");
assert.ok(ts.boss && ts.boss.name, "boss");
assert.ok(ts.boss.parts.length, "strategy");
assert.ok(!/\[\[|\]\]|\{\{/.test(JSON.stringify(ts.boss)), "plain text");

// a recipe, and the whole tree down to what you gather
const page = (ing, makes, water = 100) => `== Crafting ==\n=== Crafted By ===\n{| class="wikitable"\n|-\n! Production Types\n! Ingredients\n! Products\n|-\n|\n* [[Fabricator]]\n|\n${ing.map(([n, q]) => `* [[File:${n}.png|32x32px|link=${n}]] [[${n}]] x${q}`).join("\n")}\n* [[File:Water.png|32x32px]] ${water}mL Water\n* [[File:T.png|32x32px]] 5.0s\n|\n* [[File:${makes}.png|32x32px|link=${makes}]] [[${makes}]] x1\n|-\n|}`;
const gun = d.recipesOf(page([["Steel Ingot", 4], ["Mechanical Parts", 2]], "Gun"));
assert.strictEqual(gun.length, 1);
assert.deepStrictEqual(gun[0].ingredients.map((i) => [i.name, i.qty]), [["Steel Ingot", 4], ["Mechanical Parts", 2]]);
assert.strictEqual(gun[0].water, 100);
const pages = {
    Gun: { recipes: gun },
    "Steel Ingot": { recipes: d.recipesOf(page([["Iron Ore", 3]], "Steel Ingot", 10)) },
    "Iron Ore": { recipes: [], where: "Mined from iron deposits." },
    "Mechanical Parts": { recipes: [], where: "Found in Great House ruins." }
};
const farm = d.farmList([{ name: "Gun", qty: 2 }], pages);
const raw = Object.fromEntries(farm.raw.map((m) => [m.name, m.qty]));
assert.deepStrictEqual(raw, { "Iron Ore": 24, "Mechanical Parts": 4 });
assert.strictEqual(farm.raw.find((m) => m.name === "Iron Ore").where, "Mined from iron deposits.");
assert.ok(farm.made.some((m) => m.name === "Steel Ingot" && m.qty === 8));

// where a Unique drops: the places, the chance that follows them, the Exchange; unfilled templates say nothing
const drop = d.obtainOf("Flavour.\n== Obtainment ==\n{{hatnote|See [[X]] for details.}}\n=== Schematic<noinclude> Obtainment</noinclude> ===\n{{Unconfirmed}} The schematic is found in [[Wreck of the Proxenus]], [[Mysa Tarill (Landmark)|Mysa Tarill]] and [[Testing Station 71]] with a drop chance of '''14.286'''% and can be found on [[The Exchange]]. The item then needs to be [[X#Crafting|crafted]] to be used.\n{{Map:Hagga Basin|layout=mini|marker=x}}\n== Item Data ==");
assert.deepStrictEqual(drop.places.map((p) => [p.name, p.label, p.chance]), [["Wreck of the Proxenus", "Wreck of the Proxenus", 14.286], ["Mysa Tarill (Landmark)", "Mysa Tarill", 14.286], ["Testing Station 71", "Testing Station 71", 14.286]]);
assert.strictEqual(drop.exchange, true);
const mixed = d.obtainOf("=== Schematic Obtainment ===\nThe schematic is found in [[Batigh Grotto]] with a drop chance of [CHANCE]%, [[Sentinel City]] with a drop chance of 7.8% and can be found on [[The Exchange]].");
assert.deepStrictEqual(mixed.places.map((p) => p.chance), [null, 7.8]);
const unknown = d.obtainOf("=== Schematic Obtainment ===\nThe schematic is found in [LOCATION] with a drop chance of [CHANCE]% and can be found on [[The Exchange]].");
assert.deepStrictEqual(unknown.places, []);
assert.strictEqual(unknown.text, null);
assert.deepStrictEqual(d.obtainOf("=== Schematic Obtainment ===\nThe schematic is found in Deep Desert, and can be found on [[The Exchange]].").places.map((p) => p.name), ["Deep Desert"]);
assert.strictEqual(d.obtainOf("Just a description of the item, nothing more."), null);
// a material's lead line says where it's found; flavour text doesn't count
assert.strictEqual(d.whereOf("Titanium ore is found in the deep desert.\n== Item Data =="), "Titanium ore is found in the deep desert.");
assert.strictEqual(d.whereOf("A fine blade, light in the hand.\n== Item Data =="), null);

// research: every schematic's tier, Intel cost and what it needs first, sets included
const research = d.researchOf("'''{{TierTag|Plastanium}}'''\n{{FlexContainer|\n{{ResearchInfobox\n|title = CHOAM Heavy Armor\n|cost = 40\n|image = a.png\n|contents = CHOAM Heavy Helmet~CHOAM Heavy Boots\n}}\n\n{{ResearchInfobox\n|title = Regis Dual Blades\n|cost = 40\n|image = b.png\n|prereq = [[A Deadly Poison]]\n}}");
assert.deepStrictEqual(research["CHOAM Heavy Boots"], { tier: "Plastanium", cost: 40, prereq: null, group: "CHOAM Heavy Armor" });
assert.strictEqual(research["Regis Dual Blades"].prereq, "A Deadly Poison");

console.log("dune: ok");
