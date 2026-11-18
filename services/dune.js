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

// ---- Augmentations (the wiki's Augmentations page) -------------------------------------------------------
// Each kind of augment the wiki lists, where its schematics are found, and every augment with its grades:
// [{ title, applies: "melee" | "ranged" | "garment" | "all" | "<weapon family>", found, places, augments: [{ name, image, grades: [{ grade, effects: [{ stat, lo, hi, unit, text }] }] }] }]
function effectOf(text) {
    const t = plain(text).replace(/\s+/g, " ").trim();
    const m = /^(.*?)\s*([+-−]?\d+(?:\.\d+)?)\s*(%?)(?:\s*to\s*([+-−]?\d+(?:\.\d+)?)\s*%?)?$/.exec(t);
    if (!m || !m[1]) return t ? { stat: t, lo: null, hi: null, unit: "", text: t } : null;
    const n = (v) => Number(String(v).replace("−", "-"));
    return { stat: m[1].replace(/[:\s]+$/, ""), lo: n(m[2]), hi: m[4] != null ? n(m[4]) : n(m[2]), unit: m[3] || "", text: t };
}
function augmentRows(body) {
    const out = [];
    const table = /\{\|[\s\S]*?\n\|\}/g;
    let t;
    while ((t = table.exec(body))) {
        t[0].replace(/\n\|\}\s*$/, "").split(/\n\|-/).forEach((row) => {
            const cells = row.split(/\n\|(?!\})/).slice(1).map((c) => c.trim());
            const fileCell = cells.find((c) => /\[\[File:/i.test(c)) || "";
            const nameCell = cells.find((c) => /^\[\[(?!File:)[^\]]+\]\]$/i.test(c)) || cells.find((c) => !/\[\[File:/i.test(c) && !/Grade/i.test(c) && plain(c));
            const gradeCell = cells.find((c) => /Grade\s*\d/i.test(c));
            if (!nameCell || !gradeCell) return;
            const file = /\[\[File:([^\]|]+)/i.exec(fileCell);
            const grades = [];
            const re = /'*\s*Grade\s*(\d)\s*:?\s*'*\s*:?\s*([\s\S]*?)(?=('*\s*Grade\s*\d)|$)/gi;
            let g;
            while ((g = re.exec(gradeCell))) {
                const effects = g[2].split(/<\/?br\s*\/?>|,(?![^(]*\))|;/i).map(effectOf).filter(Boolean);
                if (effects.length) grades.push({ grade: Number(g[1]), effects });
            }
            if (grades.length) out.push({ name: plain(nameCell), image: file ? fileUrl(file[1].trim()) : null, grades });
        });
    }
    return out;
}
const AUG_KEYS = { "generic ranged": "ranged", melee: "melee", "garment augment": "garment", "garment augments": "garment", "universal augments": "all", "universal augment": "all" };
function augmentsOf(text) {
    const src = String(text || "").replace(/\{\{JumpTo\|([^|}]+)\|[^}]*\}\}/gi, "$1").replace(/\{\{TierTag\|([^|}]+)\}\}/gi, "$1");
    const secs = sections(src);
    const out = [];
    let inWeapons = false;
    for (const sec of secs) {
        const head = sec.heading.trim(), low = head.toLowerCase();
        if (sec.depth === 2) inWeapons = /weapon/i.test(head);
        if (sec.depth === 2 && inWeapons) continue;
        if (!(sec.depth === 3 && inWeapons) && !(sec.depth === 2 && AUG_KEYS[low])) continue;
        const firstFound = lines(sec.body).map((l) => l.text).find((l) => /^Found/i.test(l)) || null;
        const places = [...sec.body.matchAll(/Found[^\n]*/gi)].flatMap((m) => [...m[0].matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)].map((x) => ({ name: x[1].trim(), label: (x[2] || x[1]).trim(), chance: null })));
        out.push({ title: head, applies: AUG_KEYS[low] || low, found: firstFound, places, augments: augmentRows(sec.body) });
    }
    return out;
}
// which of those kinds go on an item: its weapon family's, the generic ranged or melee ones, or the garment ones; and the universal ones
function augmentsFor(item, kinds) {
    if (!item || !Array.isArray(kinds)) return [];
    const hay = `${item.name} ${item.id || ""} ${item.image || ""} ${item.cls || ""}`.toLowerCase().replace(/[_-]/g, " ");
    const weaponKind = (k) => {
        const words = k.applies.replace(/\bmissile launcher\b/, "rocketlauncher|missile launcher|rocket launcher").split("|");
        return words.some((w) => hay.includes(w) || hay.replace(/\s+/g, "").includes(w.replace(/\s+/g, "")));
    };
    return kinds.filter((k) => {
        if (k.applies === "all") return true;
        if (item.group === "melee") return k.applies === "melee";
        if (item.group === "ranged") return k.applies === "ranged" || (!["melee", "garment"].includes(k.applies) && weaponKind(k));
        if (item.armor != null && item.mit) return k.applies === "garment";
        return false;
    });
}
// the strongest augment for an item on the wiki's numbers: its best grade, what it adds weighed by what matters most
// (damage and armour most, then fire rate, magazine and reload), what it takes away subtracted
const AUG_WEIGHT = [[/damage|dmg/i, 3], [/armou?r/i, 3], [/fire rate|rate of fire|attack speed|rpm/i, 2], [/magazine|clip|ammo capacity/i, 1.5], [/reload speed|reload rate/i, 1.5], [/reload|recoil|spread|heat|stamina|power (drain|usage|consumption)|cooldown/i, -1], [/accuracy|stability|range|mitigation/i, 1], [/durability/i, 0.3]];
function augmentScore(a) {
    const top = (a.grades || []).slice().sort((x, y) => y.grade - x.grade)[0];
    if (!top) return { score: 0, grade: null };
    let score = 0;
    top.effects.forEach((e) => {
        if (e.lo == null) return;
        const w = (AUG_WEIGHT.find(([re]) => re.test(e.stat)) || [null, 0.5])[1];
        score += w * (e.lo + e.hi) / 2;
    });
    return { score: Math.round(score * 10) / 10, grade: top.grade };
}
function bestAugment(list) {
    const scored = (list || []).map((a) => ({ a, ...augmentScore(a) })).filter((x) => x.grade != null);
    scored.sort((x, y) => y.score - x.score);
    return scored.length && scored[0].score > 0 ? scored[0] : null;
}

// ---- Boss videos: a guide that shows how to beat it, not someone's first try --------------------------------------
// YouTube's titles say which is which: "guide", "how to beat", "strategy", "easy", "solo" for the first;
// "blind", "first time", "live", "stream", "episode 4", "part 2", "let's play" for the second.
const GUIDE_WORDS = [[/\bguides?\b/, 4], [/how to (beat|kill|defeat|solo|cheese|do)\b/, 5], [/\bstrat(egy|egies|s)?\b/, 4], [/\b(tips|tricks)\b/, 3], [/\bmechanics?\b/, 3],
    [/\b(easy|easiest|fast|quick|simple)\b/, 2], [/\b(cheese|cheesed|exploit)\b/, 2], [/\bsolo\b/, 2], [/\bexplained\b/, 2], [/\b(build|loadout)\b/, 1], [/\bboss fight\b/, 3], [/\bboss\b/, 2], [/\b(kill|killed|defeat|defeated|beat|beating)\b/, 1]];
const PLAY_WORDS = [[/\bblind\b/, 6], [/first (time|try|attempt|look|impressions?)\b/, 6], [/\b(live|livestream|stream|streaming|vod)\b/, 6], [/\breact(ion|s|ing)?\b/, 5],
    [/let'?s play/, 6], [/\b(ep|episode|part|pt|day)\.? ?#?\d+/, 5], [/#\d+\b/, 3], [/\bplaythrough\b/, 4], [/\b(funny|fails?|rage|died|dying|wipe)\b/, 3], [/\b(gameplay|no commentary)\b/, 2], [/\b(shorts?)\b/, 3],
    // a walkthrough of the whole dungeon, not the fight
    [/\bwalk ?through\b/, 7], [/\b(full|complete|entire|whole)\b.{0,20}\b(dungeon|run|clear|station|guide)\b/, 6], [/\b(all|every) (bosses|dungeons|stations)\b/, 6], [/\b(lore|story|location|loot route|farm route|map|keycards?|puzzles?)\b/, 3], [/\b100%/, 4]];
function bossVideoScore(v, { boss = "", place = "" } = {}) {
    const title = String(v.title || "").toLowerCase().replace(/&#39;|&#x27;/g, "'"), desc = String(v.description || "").toLowerCase();
    if (!/dune/.test(title + " " + desc)) return -Infinity;
    if (v.live && v.live !== "none") return -Infinity;
    const words = String(boss).toLowerCase().replace(/^(dr\.?|doctor|lieutenant|planetologist)\s+/, "").split(/\s+/).filter((w) => w.length > 2);
    // the fight itself: the boss named, or the place named together with "boss" (a title naming only the place is a run through the whole dungeon)
    const placeLow = String(place).toLowerCase(), placeHit = placeLow && (title.includes(placeLow) || title.replace(/\bno\.?\s*/g, "").includes(placeLow));
    const named = words.some((w) => title.includes(w)) || (placeHit && /\bboss\b/.test(title));
    if (!named) return -Infinity;
    let score = 0;
    GUIDE_WORDS.forEach(([re, w]) => { if (re.test(title)) score += w; else if (re.test(desc)) score += w / 3; });
    PLAY_WORDS.forEach(([re, w]) => { if (re.test(title)) score -= w; else if (re.test(desc)) score -= w / 3; });
    return Math.round(score * 10) / 10;
}
// the best of several searches' results: guide-like first; a plain one only if no guide was found
function pickBossVideo(results, q, wrong = new Set()) {
    const seen = new Set();
    const scored = results.filter((v) => v && v.id && !wrong.has(v.id) && !seen.has(v.id) && seen.add(v.id))
        .map((v, i) => ({ v, i, score: bossVideoScore(v, q) })).filter((x) => x.score > -Infinity);
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored.length && scored[0].score >= 0 ? { ...scored[0].v, score: scored[0].score } : null;
}

// ---- Skills: the archetypes' skill trees and the Landsraad specializations --------------------------------------
const ARCHETYPES = ["Trooper", "Mentat", "Planetologist", "Bene Gesserit", "Swordmaster"];
// "{{Name|a=1|b=[[X|Y]]}}" -> { a: "1", b: "Y" }: a template's fields, links already turned to their words
function fieldsOf(body) {
    const f = {};
    const src = String(body || "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\|desc(?!\s*=)/g, "|desc=");
    src.split(/\|(?=\s*[a-z_0-9]+\s*=)/i).slice(1).forEach((part) => { const i = part.indexOf("="); f[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim(); });
    return f;
}
const costOf = (c) => String(c || "").split("/").map((x) => Number(x)).filter((x) => isFinite(x) && x > 0);
function skillsOf(title, text) {
    const src = String(text || "");
    const box = /\{\{ArchetypeInfobox([\s\S]*?)\n\}\}/.exec(src);
    const info = box ? fieldsOf(box[1].replace(/\[\[File:([^\]|]+)[^\]]*\]\]/g, "$1")) : {};
    const trees = [];
    const re = /\{\{SkillTable\s*([\s\S]*?)\n\}\}/g;
    let m;
    while ((m = re.exec(src))) {
        const body = m[1];
        const rowsAt = body.search(/\|\s*rows\s*=/);
        const head = fieldsOf(rowsAt >= 0 ? body.slice(0, rowsAt) : body);
        const skills = [...body.slice(Math.max(0, rowsAt)).matchAll(/\{\{SkillRow([\s\S]*?)\}\}(?=\s*(\{\{SkillRow|$))/g)].map((r) => {
            const f = fieldsOf(r[1]);
            if (!f.name) return null;
            const cost = costOf(f.cost);
            return { name: plain(f.name), type: plain(f.type) || "Passive", desc: plain(f.desc || ""), cost, points: cost.reduce((a, b) => a + b, 0), ranks: cost.length || 1,
                cooldown: Number(f.cooldown) || null, duration: Number(f.duration) || null, stamina: Number(f.stamina) || null, notes: plain(f.notes || "") || null };
        }).filter(Boolean);
        if (skills.length) trees.push({ name: plain(head.name || ""), desc: plain(head.tabledesc || ""), skills });
    }
    if (!trees.length) return null;
    return { name: plain(info.name || title), image: info.image ? fileUrl(info.image.trim()) : null, focus: plain(info.focus || "") || null, quote: plain(info.quote || "") || null,
        points: Number(info.skillpoints) || trees.reduce((n, t) => n + t.skills.reduce((a, s) => a + s.points, 0), 0),
        basic: info.basictrainer ? { name: plain(info.basictrainer), where: plain(info.basiclocation || "") || null } : null,
        advanced: info.advtrainer ? { name: plain(info.advtrainer), where: plain(info.advlocation || "") || null } : null,
        url: pageUrl(title), trees };
}
// the Specializations page: five of them, each with its primary bonuses (bought with spice) and its secondary ones
function specializationsOf(text) {
    const src = String(text || "").replace(/<\/?translate>|<!--T:\d+-->/g, "").replace(/<\/?div[^>]*>/g, "");
    const out = [];
    let cur = null, part = null;
    for (const sec of sections(src)) {
        if (sec.depth === 2) { cur = { name: sec.heading, desc: lines(sec.body).map((l) => l.text).find((t) => t.length > 20) || null, primary: [], secondary: [] }; out.push(cur); continue; }
        if (!cur || sec.depth !== 3) continue;
        part = /secondary/i.test(sec.heading) ? "secondary" : "primary";
        const table = /\{\|[\s\S]*?\n\|\}/.exec(sec.body);
        if (!table) continue;
        // header and cells come one per line or several per line ("!a!!b", "| 1 || x"): both read the same
        const heads = (table[0].match(/^!.*$/gm) || []).flatMap((l) => l.slice(1).split("!!")).map((x) => plain(x).toLowerCase());
        const col = (re) => heads.findIndex((x) => re.test(x));
        const rows = table[0].replace(/\n\|\}\s*$/, "").split(/\n\|-/).slice(1).map((r) => ("\n" + r.trim()).split(/\n\||\|\|/).slice(1).map((c) => plain(c)));
        if (part === "primary") {
            const at = { level: col(/^level$/), name: col(/^name$/), desc: col(/^description$/), effect: col(/^effect$/), inc: col(/^increase$/), spice: col(/^spice( cost)?$/) };
            rows.forEach((c) => {
                const name = c[at.name >= 0 ? at.name : 1];
                if (!name) return;
                const effect = c[at.effect >= 0 ? at.effect : 3] || null, inc = at.inc >= 0 ? c[at.inc] : null;
                cur.primary.push({ level: Number(c[at.level >= 0 ? at.level : 0]) || null, name, desc: c[at.desc >= 0 ? at.desc : 2] || null,
                    effect: effect && inc && !effect.includes(inc) ? `${effect}: ${inc}` : effect, spice: Number(c[at.spice >= 0 ? at.spice : 6]) || 0 });
            });
        } else if (rows.length) {
            const last = rows[rows.length - 1];
            cur.secondary.push({ stat: plain(heads[1] || "Bonus").replace(/^./, (x) => x.toUpperCase()), each: rows[0][1] || null, total: last[2] || last[1] || null, levels: rows.length });
        }
    }
    return out.filter((s) => s.primary.length || s.secondary.length);
}
// The best skills for what you want to do, read from what each one does: the words of its name, description
// and effect weighed for that goal (and against it: a melee skill isn't one for a gunfight)
const GOALS = {
    guns: { spec: "Combat", words: [[/\b(ranged|guns?|disruptor|scattergun|rifle|pistol|heavy weapons?|headshots?|darts?|reload|ammo|marksman|sniper|lasgun|flamethrower|missile)\b/, 3], [/\bdamage\b/, 2], [/\b(shields?|health|heal|healing|armou?r|resist|mitigation)\b/, 1.5], [/\b(stun|slow|grenade|drone|turret|explo\w*|blast|suppress\w*)\b/, 1.5]], against: /\b(melee|blades?|swords?|knife|knives|dirk|rapier|kindjal|parry)\b/ },
    melee: { spec: "Combat", words: [[/\b(melee|blades?|swords?|knife|knives|dirk|rapier|kindjal|weirding|parry|block|lunge|bleed\w*|strikes?|slash\w*)\b/, 3], [/\bdamage\b/, 2], [/\b(dodge|dash|evade|stamina)\b/, 1.5], [/\b(shields?|health|heal|healing|armou?r|resist)\b/, 1.5], [/\b(stun|knock\w*|slow|push\w*)\b/, 1.5]], against: /\b(ranged|guns?|disruptor|scattergun|rifle|pistol|heavy weapons?)\b/ },
    farm: { spec: "Gathering", words: [[/\b(gather\w*|harvest\w*|mining|mine|cutteray|ores?|yields?|resources?|salvag\w*|scaveng\w*|loot\w*|spice|dew|blood|compactor|refin\w*|fiber|plants?)\b/, 3], [/\b(inventory|carry|volume|capacity|weight|vehicles?|buggy|sandbike)\b/, 2], [/\b(water|hydrat\w*|heat|sun\w*)\b/, 1], [/\b(durability|repairs?)\b/, 1]] },
    explore: { spec: "Exploration", words: [[/\b(sprint\w*|speed|move\w*|movement|climb\w*|fall\w*|jump\w*|suspensors?|glid\w*|dash)\b/, 3], [/\b(stamina|water|heat|sunstroke|worms?|sand|surviv\w*)\b/, 2], [/\b(scan\w*|survey\w*|maps?|detect\w*|reveal\w*|ornithopters?|vehicles?)\b/, 2]] },
    craft: { spec: "Crafting", words: [[/\b(craft\w*|repairs?|durability|refin\w*|fabricat\w*|schematics?|batch|build\w*|bases?)\b/, 3], [/\b(water|power)\b/, 1]] }
};
function skillPicks(archetypes, goal, max = 10) {
    const g = GOALS[goal];
    if (!g) return [];
    const out = [];
    (archetypes || []).forEach((a) => a.trees.forEach((t) => t.skills.forEach((s) => {
        // its name and effect say the most, its description less, its tree's a little
        const parts = [[s.name, 2], [s.notes || "", 1.5], [s.desc, 1], [t.desc, 0.3]].map(([x, w]) => [x.toLowerCase(), w]);
        // a skill for the other kind of fight isn't one for this; and "damage" alone doesn't make a skill fit
        if (g.against && (g.against.test(s.name.toLowerCase()) || g.against.test(s.desc.toLowerCase()))) return;
        let score = 0, fits = false;
        g.words.forEach(([re, w]) => parts.forEach(([x, k]) => { if (re.test(x)) { score += w * k; if (!/damage/.test(re.source) && k >= 1) fits = true; } }));
        if (!fits) return;
        if (score > 0) out.push({ ...s, archetype: a.name, tree: t.name, score: Math.round(score * 10) / 10 });
    })));
    out.sort((a, b) => b.score - a.score || a.points - b.points || a.name.localeCompare(b.name));
    return out.slice(0, max);
}

module.exports = { ARCHETYPES, GOALS, skillsOf, specializationsOf, skillPicks, bossVideoScore, pickBossVideo, augmentsOf, augmentsFor, bestAugment, augmentScore, effectOf, gadget, recipesOf, whereOf, obtainOf, researchOf, pickRecipe, farmList, fileUrl, pageUrl, plain, sections, lines, weapon, rankWeapons, garment, dungeon, familyOf, HAZARDS, MITIGATIONS };
