// The Dune: Awakening companion's data (engine/dune.js fetches it, the
// Dune: Awakening page shows it). Pure: turning the Dune: Awakening Community
// Wiki's API rows and pages into what Riftgate shows, and ranking weapons and
// armour. Everything here comes from awakening.wiki (data from the game's
// files, CC BY-NC-SA 4.0), credited and linked wherever it's shown.
"use strict";
const crypto = require("crypto");

const WIKI = "https://awakening.wiki";
// a wiki file's address (MediaWiki keeps files under the first characters of the name's MD5)
function fileUrl(name) {
    if (!name) return null;
    const f = String(name).trim().replace(/ /g, "_");
    const h = crypto.createHash("md5").update(f).digest("hex");
    return `https://media.awakening.wiki/wiki/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(f)}`;
}
const pageUrl = (title) => `${WIKI}/${encodeURIComponent(String(title).replace(/ /g, "_")).replace(/%2F/g, "/")}`;
const tagsOf = (s) => { try { const t = JSON.parse(s || "[]"); return Array.isArray(t) ? t : []; } catch (e) { return []; } };
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const pretty = (s) => String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^Smg$/i, "SMG").replace(/^SMG$/, "SMG");
const TIER_WORDS = ["Standard", "Artisan", "House", "Adept", "Regis"];
// "Regis Karpov 38" -> "Karpov 38": the weapon all its Mk versions share
const familyOf = (name) => String(name).replace(new RegExp(`^(${TIER_WORDS.join("|")})\\s+`), "").replace(/\s+Mk\s?\d$/i, "").trim();

// ---- Weapons -------------------------------------------------------------------------
// How hard it hits, kept up: a gun's damage over a whole magazine and its
// reload; a blade's damage per hit times its swings a minute. Ranked by that.
function weapon(x) {
    if (!x || !x.weapon_type || !x.name) return null;
    const tags = tagsOf(x.item_tags);
    const holster = tags.find((t) => t.startsWith("Items.Holsters.")) || "";
    const parts = holster.split(".");
    const tierTag = tags.find((t) => /^LootTier\.\d$/.test(t));
    const tier = tierTag ? Number(tierTag.split(".")[1]) : null;
    const melee = x.weapon_type === "melee";
    let cls, dart = null;
    if (melee) cls = parts[3] || "Melee";
    else { dart = parts[3] || null; cls = parts[5] || parts[4] || "Ranged"; }
    const unique = x.unique_schematic === "Yes" || (tags.includes("Rarity.Rare") && !TIER_WORDS.some((w) => x.name.startsWith(w + " ")));
    let dps = null, sustained = null;
    if (melee) {
        const d = num(x.damage_per_hit), a = num(x.attack_speed);
        if (d != null && a != null) dps = sustained = d * a / 60;
    } else {
        const d = num(x.damage_per_shot), rof = num(x.rate_of_fire), clip = num(x.clip_size), rel = num(x.reload_speed);
        if (d != null && rof) {
            dps = d * rof / 60;
            sustained = clip && rel != null ? (d * clip) / (clip / (rof / 60) + rel) : dps;
        }
    }
    if (sustained == null) return null;
    return {
        id: x.item_id, name: x.name, family: familyOf(x.name), image: fileUrl(x.image), url: pageUrl(x.name),
        group: melee ? "melee" : "ranged", cls: pretty(cls), dart: dart ? `${dart} dart` : null, tier, unique,
        damageType: x.damage_type || (dart ? `${dart} dart` : null), fireMode: x.fire_mode || null,
        damage: round(num(melee ? x.damage_per_hit : x.damage_per_shot)), rate: round(num(melee ? x.attack_speed : x.rate_of_fire), 0),
        clip: num(x.clip_size), reload: num(x.reload_speed), range: num(x.effective_range), accuracy: num(x.accuracy), stability: num(x.stability),
        dps: round(dps), score: round(sustained), desc: plain(x.long_description || x.short_description || "")
    };
}

// best first, within ranged and melee; rank and how close to the best (0..1)
function rankWeapons(list) {
    const out = list.filter(Boolean).sort((a, b) => b.score - a.score || (b.tier || 0) - (a.tier || 0) || a.name.localeCompare(b.name));
    const best = { ranged: 0, melee: 0 }, rank = { ranged: 0, melee: 0 };
    out.forEach((w) => { best[w.group] = Math.max(best[w.group], w.score); });
    out.forEach((w) => { w.rank = ++rank[w.group]; w.of = best[w.group] ? round(w.score / best[w.group], 3) : 0; });
    return out;
}

// ---- Armour ------------------------------------------------------------------------------
const MITIGATIONS = ["light_dart", "heavy_dart", "blade", "concussive", "energy", "fire", "radiation", "poison"];
function garment(x) {
    if (!x || !x.name) return null;
    const tags = tagsOf(x.item_tags);
    const tierTag = tags.find((t) => /^LootTier\.\d$/.test(t));
    const mit = {};
    MITIGATIONS.forEach((k) => { const v = num(x[`${k}_mitigation`]); if (v != null) mit[k] = v; });
    return {
        id: x.item_id, name: x.name, image: fileUrl(x.image), url: pageUrl(x.name), type: x.garment_type || "Other",
        slot: x.equip_slot || "Suit", tier: tierTag ? Number(tierTag.split(".")[1]) : null, unique: x.unique_schematic === "Yes",
        armor: num(x.armor_value) || 0, mit, heat: num(x.heat_protection), stamina: num(x.dash_stamina_cost), desc: plain(x.long_description || x.short_description || "")
    };
}

// ---- Shields, suspensor belts, power packs (the character's other slots) ----------------------------------
function gadget(x) {
    if (!x || !x.name) return null;
    const tags = tagsOf(x.item_tags);
    const holster = tags.find((t) => t.startsWith("Items.Holsters.UtilityTools.")) || "";
    const kind = /\.Shield$/.test(holster) ? "Shield" : /\.Suspensor$/.test(holster) ? "Belt" : /\.Power$/.test(holster) ? "Power" : null;
    if (!kind || /Schematic$/.test(x.name)) return null;
    const tierTag = tags.find((t) => /^LootTier\.\d$/.test(t));
    const stats = {};
    if (num(x.shield_refresh_time) != null) stats["Shield refresh"] = `${x.shield_refresh_time} s`;
    if (num(x.suspensor_power_drain) != null) stats["Power drain"] = `${x.suspensor_power_drain} / s`;
    if (x.worm_attraction_intensity) stats["Worm attraction"] = String(x.worm_attraction_intensity);
    if (num(x.power_pack_maximum_power) != null) stats["Maximum power"] = x.power_pack_maximum_power;
    if (num(x.power_pack_regen) != null) stats["Power regeneration"] = `${x.power_pack_regen} / s`;
    const tier = tierTag ? Number(tierTag.split(".")[1]) : null;
    return { id: x.item_id, name: x.name, image: fileUrl(x.image), url: pageUrl(x.name), kind, slot: kind, tier, unique: x.unique_schematic === "Yes" || tags.includes("Rarity.Rare"),
        stats, score: num(x.power_pack_maximum_power) || (tier || 0), desc: plain(x.long_description || x.short_description || "") };
}

// ---- Dungeons ------------------------------------------------------------------------------
// The hazard each one is built around (from its title card: "...Ecolab136Fire...") and the armour stat that helps
const HAZARDS = {
    Fire: { stat: "fire", label: "Fire", tip: "Fire mitigation keeps burns down." },
    Poison: { stat: "poison", label: "Poison", tip: "Poison mitigation; bandages and medkits remove poison when used." },
    Radiation: { stat: "radiation", label: "Radiation", tip: "Radiation mitigation, and Iodine Pills for longer fights." },
    Electricity: { stat: "energy", label: "Electricity", tip: "Energy mitigation softens the electrified floors and walls." },
    Darkness: { stat: null, label: "Darkness", tip: "No environmental damage: the best protection overall." }
};

// wikitext to plain text (links keep their words, files and templates go)
function plain(s) {
    return String(s || "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\[\[(?:File|Image):(?:[^\[\]]|\[\[[^\]]*\]\])*\]\]/gi, "")
        .replace(/\{\{[^{}]*\}\}/g, "").replace(/\{\{[^{}]*\}\}/g, "")
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
        .replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, "$1").replace(/\[https?:\/\/[^\]]+\]/g, "")
        .replace(/'{2,}/g, "")
        .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ")
        .trim();
}
// a section's lines as paragraphs and bullet points: [{ text, level }]
function lines(block) {
    return String(block || "").split("\n").map((l) => {
        const m = /^(\*+|#+)\s*(.*)$/.exec(l.trim());
        const text = plain(m ? m[2] : l);
        return text ? { text, level: m ? m[1].length : 0 } : null;
    }).filter(Boolean).filter((l) => !/^(Placeholder|Optional caption|USE "EDIT SOURCE")/i.test(l.text) && !/^\[?TO ?DO/i.test(l.text));
}
// a page's sections: { heading, depth, body }
function sections(text) {
    const out = [];
    const re = /^(={2,5})\s*(.+?)\s*\1\s*$/gm;
    let m, last = { heading: "", depth: 1, start: 0 };
    while ((m = re.exec(text))) {
        out.push({ ...last, body: text.slice(last.start, m.index) });
        last = { heading: plain(m[2]).replace(/:$/, ""), depth: m[1].length, start: m.index + m[0].length };
    }
    out.push({ ...last, body: text.slice(last.start) });
    return out;
}
function dungeon(title, text) {
    text = String(text || "");
    const card = /\[\[File:(T_UI_DungeonPopUp[^|\]]+)/i.exec(text);
    const hz = card && /(Fire|Poison|Radiation|Electricity|Darkness)/i.exec(card[1]);
    const hazard = hz ? hz[1][0].toUpperCase() + hz[1].slice(1).toLowerCase() : null;
    const tagline = (/^''([^'][^\n]*?)''\s*$/m.exec(text) || [])[1];
    const secs = sections(text);
    const bi = secs.findIndex((s) => /^Boss Fight$/i.test(s.heading));
    let boss = null;
    if (bi >= 0) {
        const head = secs[bi].body;
        const name = (/\[\[(?!File:)([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(head) || [])[1] || null;
        const pic = (/\[\[File:([^|\]]+\.(?:jpg|jpeg|png))/i.exec(head) || [])[1] || null;
        const intro = lines(head.replace(/\[\[(?!File:)[^\]]+\]\]\s*$/m, "")).filter((l) => l.text !== plain(`[[${name}]]`));
        const parts = [];
        for (let i = bi + 1; i < secs.length && secs[i].depth > 2; i++) {
            const ls = lines(secs[i].body);
            if (ls.length) parts.push({ title: secs[i].heading.replace(/^Phase (\d+)$/i, "Phase $1"), lines: ls });
        }
        boss = { name: name ? plain(name) : null, image: pic ? fileUrl(pic) : null, intro, parts, url: name ? pageUrl(name) : null };
    }
    const rw = secs.find((s) => /^Rewards$/i.test(s.heading));
    const rewards = rw ? lines(rw.body).map((l) => l.text.replace(/^\d+\.\s*/, "")).filter((t) => t.length < 60) : [];
    const about = secs.find((s) => /^Details$/i.test(s.heading));
    const details = about ? lines(about.body).filter((l) => !/^<Talk about/.test(l.text)).slice(0, 4) : [];
    return { title, url: pageUrl(title), image: card ? fileUrl(card[1]) : null, hazard, hazardInfo: hazard ? HAZARDS[hazard] : null, tagline: tagline ? plain(tagline) : null, details, boss, rewards, text: plain(text).slice(0, 20000) };
}

// ---- Crafting ---------------------------------------------------------------------------------
// The wiki's generated "Crafted By" table: one row per recipe, three cells
// (where it's made, what goes in, what comes out). Ingredient lines look like
// "* [[File:Icon.png|...]] [[Copper Ingot]] x8"; water "530mL Water"; time "15.0s".
function recipesOf(text) {
    const m = /===\s*Crafted By\s*===([\s\S]*?)(?:\n\|\}|$)/.exec(String(text || ""));
    if (!m) return [];
    return m[1].split(/\n\|-/).map((row) => {
        const cells = row.split(/\n\|(?!-)/).slice(1);
        if (cells.length < 3) return null;
        const items = (cell) => cell.split("\n").map((l) => {
            const im = /\[\[File:([^|\]]+)[^\]]*\]\]\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*x\s*([\d,.]+)/.exec(l);
            return im ? { name: im[2].trim(), qty: Number(im[3].replace(/,/g, "")), image: fileUrl(im[1]) } : null;
        }).filter(Boolean);
        const stations = (cells[0].match(/\[\[([^\]|]+)/g) || []).map((s) => s.slice(2));
        const water = /([\d,.]+)\s*mL Water/.exec(cells[1]);
        const time = /([\d.]+)s\b/.exec(cells[1].replace(/\[\[[^\]]*\]\]/g, ""));
        const out = items(cells[2]);
        return { stations, ingredients: items(cells[1]), water: water ? Number(water[1].replace(/,/g, "")) : 0, time: time ? Number(time[1]) : null, makes: out };
    }).filter((r) => r && r.ingredients.length && r.makes.length);
}
// What the wiki says about where something comes from: its "Obtainment" section, else its opening lines
// the wiki's unfilled templates ("found in [LOCATION] with a drop chance of [CHANCE]%") say nothing yet
const UNFILLED = /\[(LOCATION|CHANCE|MARKER_ID|TODO)\]/i;
// a line that says where (not the item's flavour text)
const SAYS_WHERE = /\b(found|find|drops?|dropped|loot|looted|gather|gathered|harvest|mined?|mining|sold|vendor|buy|bought|purchas|reward|obtain|trade|traded|salvag|spawn|located|farm)/i;
function whereOf(text) {
    const secs = sections(String(text || ""));
    const ob = secs.find((s) => /^(Schematic Obtainment|Obtainment|Obtaining|Location|Locations|How to obtain|Where to find)$/i.test(s.heading) && lines(s.body).some((l) => !/^See .+ for details/i.test(l.text)));
    const lead = lines(secs[0] ? secs[0].body : "").map((l) => l.text).filter((t) => t.length > 12 && !/^\{\{/.test(t));
    const src = (ob ? lines(ob.body).map((l) => l.text) : lead).filter((t) => !/^See .+ for details/i.test(t))
        .map((t) => t.replace(/\s*with a drop chance of \[CHANCE\]%/gi, "")).filter((t) => !UNFILLED.test(t) && SAYS_WHERE.test(t));
    return src.filter((t, i, a) => a.indexOf(t) === i).slice(0, 3).join(" ").slice(0, 400) || null;
}
// Where a piece drops: a Unique's schematic is "found in [[Place]] with a drop chance of N%",
// several places sharing the chance that follows them; and whether it's traded on the Exchange.
// { places: [{ name, label, chance }], exchange, text } or null
function obtainOf(text) {
    const secs = sections(String(text || ""));
    const ob = secs.find((s) => /^Schematic Obtainment$/i.test(s.heading)) || secs.find((s) => /^(Obtainment|Obtaining|Locations?|Where to find)$/i.test(s.heading));
    if (!ob) return null;
    const body = ob.body.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{(Map|hatnote|Incomplete|Unconfirmed)[^{}]*\}\}/gi, "");
    const places = [];
    let exchange = false;
    const re = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]|drop chance of\s*'*\s*([\d.]+|\[CHANCE\])\s*'*\s*%?|\b(Deep Desert)\b/gi;
    let m, pending = [];
    const found = body.search(/found in|drops? (?:in|from)|looted|obtained (?:in|from)/i);
    const stop = body.search(/needs to be|can be found on/i);
    while ((m = re.exec(body))) {
        if (m[1]) {
            const name = m[1].trim();
            if (/^(The Exchange|Exchange)$/i.test(name)) { exchange = true; continue; }
            if (/^(File|Image|Category|:Category)/i.test(name) || found < 0 || m.index < found || (stop >= 0 && m.index > stop)) continue;
            const p = { name, label: (m[2] || name).trim(), chance: null };
            places.push(p); pending.push(p);
        } else if (m[3]) { const c = Number(m[3]); pending.forEach((p) => { p.chance = isFinite(c) ? c : null; }); pending = []; }
        else if (m[4] && found >= 0 && m.index > found && (stop < 0 || m.index < stop) && !places.some((p) => /deep desert/i.test(p.name))) places.push({ name: "Deep Desert", label: "Deep Desert", chance: null });
    }
    const uniq = places.filter((p, i, a) => a.findIndex((q) => q.name === p.name) === i).slice(0, 12);
    // otherwise a sentence that plainly says where (not the item's flavour text, which often mentions finding or mining)
    const w = whereOf(text);
    const words = w && /\b(drops? (?:in|from)|dropped by|found in|sold by|bought from|rewarded? (?:for|from|by)|vendor|looted (?:in|from))\b/i.test(w) ? w : null;
    if (!uniq.length && !exchange && !words) return null;
    return { places: uniq, exchange, text: uniq.length ? null : words };
}
// The Research page: what each schematic costs in Intel, in which tier, and what it needs first.
// { "Regis GRDA 44": { tier: "Plastanium", cost: 40, prereq: null, group: "Regis GRDA 44" } }
function researchOf(text) {
    const out = {};
    const src = String(text || "");
    const re = /\{\{TierTag\|([^}|]+)\}\}|\{\{ResearchInfobox([\s\S]*?)\n\}\}/g;
    let m, tier = null;
    while ((m = re.exec(src))) {
        if (m[1]) { tier = m[1].trim(); continue; }
        const f = {};
        m[2].split(/\n\|/).forEach((part) => { const i = part.indexOf("="); if (i > 0) f[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim(); });
        const title = plain(f.title || "");
        if (!title) continue;
        const entry = { tier, cost: Number(f.cost) || null, prereq: plain(f.prereq || "") || null, group: title };
        const names = f.contents ? f.contents.split("~").map((x) => plain(x)).filter(Boolean) : [title];
        names.forEach((n) => { if (!out[n]) out[n] = entry; });
        if (!out[title]) out[title] = entry;
    }
    return out;
}
// one recipe for a product, the one made in the fewest steps of the smallest station
const pickRecipe = (list, name) => (list || []).filter((r) => r.makes.some((m) => m.name === name))[0] || (list || [])[0] || null;

// The whole tree, down to what you gather: totals of raw materials (what to farm), what's made on the way, water and time
function farmList(wants, pages) {
    const raw = new Map(), made = new Map(), schem = [];
    let water = 0, time = 0;
    const visit = (name, qty, depth, path) => {
        const p = pages[name];
        const r = p && pickRecipe(p.recipes, name);
        if (!r || depth > 8 || path.has(name)) {
            const cur = raw.get(name) || { name, qty: 0, image: (p && p.image) || null, where: (p && p.where) || null, url: pageUrl(name) };
            cur.qty += qty; raw.set(name, cur);
            return;
        }
        const out = (r.makes.find((m) => m.name === name) || r.makes[0]).qty || 1;
        const runs = Math.ceil(qty / out);
        if (depth > 0) { const c = made.get(name) || { name, qty: 0, image: p.image || null, station: r.stations[0] || null }; c.qty += qty; made.set(name, c); }
        water += runs * (r.water || 0); time += runs * (r.time || 0);
        const next = new Set(path).add(name);
        r.ingredients.forEach((i) => visit(i.name, i.qty * runs, depth + 1, next));
    };
    for (const w of wants) {
        const p = pages[w.name];
        if (p && !pickRecipe(p.recipes, w.name)) schem.push({ name: w.name, where: p.where, url: pageUrl(w.name) });
        visit(w.name, w.qty || 1, 0, new Set());
    }
    const byQty = (a, b) => b.qty - a.qty || a.name.localeCompare(b.name);
    // what you equip but can't craft isn't a material to farm
    wants.forEach((w) => { const p = pages[w.name]; if (p && !pickRecipe(p.recipes, w.name)) raw.delete(w.name); });
    return { raw: [...raw.values()].sort(byQty), made: [...made.values()].sort(byQty), water, time, uncraftable: schem };
}

module.exports = { gadget, recipesOf, whereOf, obtainOf, researchOf, pickRecipe, farmList, fileUrl, pageUrl, plain, sections, lines, weapon, rankWeapons, garment, dungeon, familyOf, HAZARDS, MITIGATIONS };
