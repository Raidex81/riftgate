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

// augments: each kind from the wiki's Augmentations page, the places its schematics drop, every augment's grades;
// which kinds go on an item; the strongest one suggested
const B = "'''";
const augPage = [
    `${B}Augmentations${B} increase the power of {{TierTag|Plastanium}} items.`, "== How to use ==", "Crafted.", "== Weapons Augments ==", "",
    "=== Melee ===", "", "=== Generic Ranged  ===", "Found in {{JumpTo|Dungeons|Overland Locations}}", "",
    "=== Scattergun ===", "Found in [[Testing Station 89]]", '{| class="wikitable"', "|-", "| [[File:T_UI_IconAugA_D.png]]", "| [[Scattergun Rampage Enhancement]]",
    `| ${B}Grade 2 : ${B} Damage +5.0% to +8.0%, Reload Speed +10.0% to +15.0% </br> ${B}Grade 5 : ${B} Damage +17.0% to +20.0%, Reload Speed +40.0% to +50.0%`,
    "|-", "| [[File:T_UI_IconAugB_D.png]]", "| [[Scattergun Range]]", `| ${B}Grade 5 : ${B} Damage -5.0%, Effective Range +44.0% to +50.0%`, "|}", "",
    "=== Missile Launcher ===", "Found in {{JumpTo|Dungeons|Overland Locations}}", "",
    "== Garment Augment ==", "Found in all {{JumpTo|Dungeons|Overland Locations}}.", '{| class="wikitable"', "|-", "| [[File:T_UI_IconAugmentModBaseArmor_D.png]]", "| [[Garment Reinforcement]]",
    `| ${B}Grade 1 : ${B} Armor +2.0% to +4.0% </br> ${B}Grade 5 : ${B} Armor +17.0% to +20.0%`, "|}", "",
    "== Universal Augments ==", "Found in all overland dungeons.", '{| class="wikitable"', "|-", "| [[File:T_UI_IconAugmentModNoDeathDurabilityDmg_D.png]]", "| [[Protective Coating]]",
    `| ${B}Grade 5 : ${B} Durability Loss on Defeat 0`, "|}", "", "{{OverviewFooter|Systems}}"].join("\n");
const kinds = d.augmentsOf(augPage);
assert.deepStrictEqual(kinds.map((k) => k.applies), ["melee", "ranged", "scattergun", "missile launcher", "garment", "all"]);
const scatter = kinds.find((k) => k.applies === "scattergun");
assert.deepStrictEqual(scatter.places.map((p) => p.name), ["Testing Station 89"]);
assert.deepStrictEqual(scatter.augments.map((a) => a.name), ["Scattergun Rampage Enhancement", "Scattergun Range"]);
assert.deepStrictEqual(scatter.augments[0].grades.map((g) => [g.grade, g.effects.map((e) => [e.stat, e.lo, e.hi])]), [[2, [["Damage", 5, 8], ["Reload Speed", 10, 15]]], [5, [["Damage", 17, 20], ["Reload Speed", 40, 50]]]]);
assert.deepStrictEqual(kinds.find((k) => k.applies === "garment").augments[0].grades.map((g) => [g.grade, g.effects[0].lo, g.effects[0].hi]), [[1, 2, 4], [5, 17, 20]], "the last row of a table is read too");
assert.strictEqual(kinds.find((k) => k.applies === "ranged").found, "Found in Dungeons");
// a GRDA is a scattergun (by its picture); a missile launcher by its id; melee and armour get their own
const forGrda = d.augmentsFor({ name: "Regis GRDA 44", id: "Scattergun_Prototype3", image: "https://x/T_UI_IconWpn2HChoamScattergun01_T6R_D.png", cls: "Shotgun", group: "ranged" }, kinds);
assert.deepStrictEqual(forGrda.map((k) => k.applies), ["ranged", "scattergun", "all"]);
assert.deepStrictEqual(d.augmentsFor({ name: "The Ancient Way", id: "RocketLauncher_Unique_Homing_06", group: "ranged" }, kinds).map((k) => k.applies), ["ranged", "missile launcher", "all"]);
assert.deepStrictEqual(d.augmentsFor({ name: "Regis Dirk", group: "melee" }, kinds).map((k) => k.applies), ["melee", "all"]);
assert.deepStrictEqual(d.augmentsFor({ name: "Bulwark Chest", armor: 525, mit: {} }, kinds).map((k) => k.applies), ["garment", "all"]);
// more damage and faster reloads beat range bought with damage; nothing to gain suggests nothing
const best = d.bestAugment(forGrda.flatMap((k) => k.augments));
assert.deepStrictEqual([best.a.name, best.grade], ["Scattergun Rampage Enhancement", 5]);
assert.strictEqual(d.bestAugment(kinds.find((k) => k.applies === "all").augments), null);

// boss videos: the fight, from a guide; never a stream, a blind first try or a walkthrough of the whole dungeon
const vq = { boss: "Dr. Lemenger", place: "Testing Station 24" };
const vids = [
    { id: "live", title: "Dune Awakening - Lemenger BLIND first time!! (LIVE)" },
    { id: "walk", title: "Dune Awakening Testing Station 24 Full Walkthrough - All Loot & Boss" },
    { id: "place", title: "Testing Station No. 24 Dune Awakening dungeon guide" },
    { id: "guide", title: "How to beat Dr. Lemenger EASY - Dune Awakening Boss Guide" },
    { id: "fight", title: "Dune Awakening | Testing Station 24 Boss Fight (Solo)" },
    { id: "other", title: "Elden Ring Malenia guide" }];
assert.strictEqual(d.pickBossVideo(vids, vq).id, "guide");
assert.strictEqual(d.pickBossVideo(vids.filter((v) => v.id !== "guide"), vq).id, "fight");
assert.strictEqual(d.pickBossVideo(vids.filter((v) => ["live", "walk", "place", "other"].includes(v.id)), vq), null, "nothing rather than a stream or a walkthrough");
assert.strictEqual(d.pickBossVideo(vids, vq, new Set(["guide"])).id, "fight", "one marked wrong is never picked again");
assert.strictEqual(d.bossVideoScore({ id: "x", title: "Lemenger boss fight guide", live: "live" }, vq), -Infinity);

// skills: an archetype's infobox and skill tables (a field missing its "=" read anyway, links turned to words);
// the specializations in both of the wiki's table layouts; the best skills for a goal, never the other kind of fight's
const row = (n, t, desc, cost, notes) => `{{SkillRow|name=${n}|type=${t}|${desc}|cost=${cost}|notes=${notes}}}`;
const trooper = d.skillsOf("Trooper", ["{{ArchetypeInfobox", "|name        = Trooper", "|image       = [[File:T_UI_SkillTree_Trooper_D.png|250px|center]]", "|focus       = Offense & demolition",
    "|skillpoints = 132", "|basictrainer  = Ghavouri", "|basiclocation = Griffin's Reach Outpost", "|advtrainer    = Kara Valk", "|advlocation   = Arrakeen", "}}", "== Skills ==",
    "{{SkillTable", "|name=Gunnery", "|tabledesc=Damage with Disruptors, Scatterguns, and Heavy Weapons.", "|rows=",
    row("Energy Capsule", "Ability", "desc=Better targeting and increased ranged damage.", "2|cooldown=25", "Ranged Damage: +35%"),
    row("Ranged Damage", "Passive", "descYour aim leads to bonus damage using all ranged weapons.", "1/3/4", "Damage: 3%/6%/9%"),
    row("Gunsmith", "Passive", "desc=Reduces the durability cost of each repair.", "1/3/4", "Max Durability Loss -15%/-20%/-25%"), "}}",
    "{{SkillTable", "|name=Close Quarters", "|tabledesc=Blades.", "|rows=",
    row("Blade Damage", "Passive", "desc=More damage with swords and knives, using a [[Holtzman|shield]] or not.", "1/3/4", "Damage: 5%/10%/15%"), "}}"].join("\n"));
assert.deepStrictEqual([trooper.name, trooper.focus, trooper.points, trooper.basic, trooper.advanced], ["Trooper", "Offense & demolition", 132, { name: "Ghavouri", where: "Griffin's Reach Outpost" }, { name: "Kara Valk", where: "Arrakeen" }]);
assert.ok(/T_UI_SkillTree_Trooper_D\.png$/.test(trooper.image));
assert.deepStrictEqual(trooper.trees.map((t) => [t.name, t.skills.length]), [["Gunnery", 3], ["Close Quarters", 1]]);
const rd = trooper.trees[0].skills[1];
assert.deepStrictEqual([rd.name, rd.type, rd.cost, rd.points, rd.ranks, rd.notes], ["Ranged Damage", "Passive", [1, 3, 4], 8, 3, "Damage: 3%/6%/9%"]);
assert.ok(/bonus damage/.test(rd.desc), "a desc without its = is still read");
assert.strictEqual(trooper.trees[0].skills[0].cooldown, 25);
assert.ok(/using a shield or not/.test(trooper.trees[1].skills[0].desc));
const guns = d.skillPicks([trooper], "guns").map((s) => s.name);
assert.deepStrictEqual(guns.slice(0, 2), ["Ranged Damage", "Energy Capsule"]);
assert.ok(!guns.includes("Blade Damage") && !guns.includes("Gunsmith"));
assert.deepStrictEqual(d.skillPicks([trooper], "melee").map((s) => s.name), ["Blade Damage"]);
assert.deepStrictEqual(d.skillPicks([trooper], "craft").map((s) => s.name), ["Gunsmith"]);
const specs = d.specializationsOf([
    "'''Specializations''' came with the Landsraad.", "== <translate><!--T:3--> Crafting</translate> ==", "<translate>Boosts for crafting.</translate>",
    "=== <translate><!--T:5--> Primary Bonuses</translate> ===", "<div class=\"mw-collapsible-content\">", "{| class='wikitable'",
    "!<translate>Level</translate>!!<translate>Name</translate>!!<translate>Description</translate>!!<translate>Effect</translate>!!XP Cost!!Cumulative XP!!Spice Cost!!Spice Cost Cumulative",
    "|-", "| 1 ||<translate>Ranged Augmentation Limit</translate>||Allows more augments on ranged weapons.||Ranged Augmentation Limit: +1 || 100 || 100 || 0 || 0",
    "|-", "| 2 ||  ||  ||  || 105 || 205 ||  || 0", "|-", "| 3 ||Repair Master||Repairs cost less durability.||Max Durability Loss: -5.0% || 110 || 315 || 2 || 2", "|}", "</div>",
    "=== Secondary Bonuses ===", "{| class='wikitable'", "!Level!!Crafted Item Durability!!Cumulative", "|-", "| 1 || +1% || +1%", "|-", "| 2 || +1% || +2%", "|}",
    "== Gathering ==", "Boosts for gathering.", "=== Primary Bonuses ===", "{| class='wikitable'", "!Level", "!Name", "!Description", "!Effect", "!Increase", "!Increase Cumulative", "!XP", "!Cumulative XP", "!Spice", "!Cumulative Spice Cost",
    "|-", "| 1", "|Effective Salvaging", "|Scrap nodes may give more.", "|Bonus Yield Chance (Scrap)", "| +30%", "| +30%", "| 100", "|100", "| 2", "|2", "|}"].join("\n"));
assert.deepStrictEqual(specs.map((x) => [x.name, x.primary.map((b) => [b.level, b.name, b.effect, b.spice])]), [
    ["Crafting", [[1, "Ranged Augmentation Limit", "Ranged Augmentation Limit: +1", 0], [3, "Repair Master", "Max Durability Loss: -5.0%", 2]]],
    ["Gathering", [[1, "Effective Salvaging", "Bonus Yield Chance (Scrap): +30%", 2]]]]);
assert.deepStrictEqual(specs[0].secondary, [{ stat: "Crafted item durability", each: "+1%", total: "+2%", levels: 2 }]);

console.log("dune: ok");
