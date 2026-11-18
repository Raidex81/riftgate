// Guides & mods for a game: the sites worth opening while you play it (wikis
// and databases), where its mods are, and its community guides. Pure data
// and matching, no network (engine/game-guides.js fetches what this needs:
// the wiki ids Wikidata keeps for each Steam game, Nexus Mods' list of
// games, Steam's Workshop flag).
//
// The best site comes first. For the games below it's picked by hand (the
// database players actually use, like Method.gg's for Dune: Awakening);
// otherwise it's the game's own wiki, then its wiki.gg or Fandom wiki.
"use strict";

const norm = (s) => String(s || "").toLowerCase().replace(/[™®©]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

// Picked by hand: the sites players use for these games. steam: Steam app ids;
// names: for copies that aren't from Steam (normalised, as norm() gives).
const G = (label, url, note) => ({ label, url, note });
const CURATED = [
    { steam: ["1172710"], names: ["dune awakening"], guides: [G("Method.gg database", "https://www.method.gg/dune-awakening/database", "Weapons, armour, items, augmentations, crafting")] },
    { steam: ["1245620"], names: ["elden ring"], guides: [G("Elden Ring Wiki (Fextralife)", "https://eldenring.wiki.fextralife.com/Elden+Ring+Wiki", "Weapons, builds, bosses, maps, quests")] },
    { steam: ["374320"], names: ["dark souls iii", "dark souls 3"], guides: [G("Dark Souls 3 Wiki (Fextralife)", "https://darksouls3.wiki.fextralife.com/Dark+Souls+3+Wiki", "Weapons, builds, bosses, maps")] },
    { steam: ["435150"], names: ["divinity original sin 2", "divinity original sin 2 definitive edition"], guides: [G("Divinity: Original Sin 2 Wiki (Fextralife)", "https://divinityoriginalsin2.wiki.fextralife.com/Divinity+Original+Sin+2+Wiki", "Builds, skills, quests, items")] },
    { steam: ["2344520"], names: ["diablo iv", "diablo 4"], guides: [G("Maxroll (Diablo IV)", "https://maxroll.gg/d4", "Builds, tier lists, items, planners")] },
    { steam: ["238960"], names: ["path of exile"], guides: [G("PoE Wiki", "https://www.poewiki.net/", "The community wiki"), G("PoEDB", "https://poedb.tw/us/", "Items, mods, skills, passives"), G("Maxroll (Path of Exile)", "https://maxroll.gg/poe", "Builds and guides")] },
    { steam: ["2694490"], names: ["path of exile 2"], guides: [G("PoE2DB", "https://poe2db.tw/us/", "Items, mods, skills, passives"), G("Maxroll (Path of Exile 2)", "https://maxroll.gg/poe2", "Builds and guides")] },
    { steam: ["1599340"], names: ["lost ark"], guides: [G("Maxroll (Lost Ark)", "https://maxroll.gg/lost-ark", "Builds, engravings, guides")] },
    { steam: ["899770"], names: ["last epoch"], guides: [G("Last Epoch Tools", "https://www.lastepochtools.com/", "Items, skills, planner"), G("Maxroll (Last Epoch)", "https://maxroll.gg/last-epoch", "Builds and guides")] },
    { steam: ["219990"], names: ["grim dawn"], guides: [G("GrimTools", "https://www.grimtools.com/", "Items, monsters, build calculator")] },
    { steam: ["1086940"], names: ["baldur s gate 3"], guides: [G("bg3.wiki", "https://bg3.wiki/", "Classes, items, quests, builds")] },
    { steam: ["230410"], names: ["warframe"], guides: [G("Warframe Wiki", "https://wiki.warframe.com/", "Frames, weapons, mods, drops")] },
    { steam: ["1085660"], names: ["destiny 2"], guides: [G("light.gg", "https://www.light.gg/", "Weapons, rolls, armour database")] },
    { steam: ["582010"], names: ["monster hunter world"], guides: [G("Kiranico (Monster Hunter: World)", "https://mhworld.kiranico.com/", "Monsters, weapons, armour, items")] },
    { steam: ["427520"], names: ["factorio"], guides: [G("Factorio Wiki", "https://wiki.factorio.com/", "The official wiki")] },
    { steam: ["294100"], names: ["rimworld"], guides: [G("RimWorld Wiki", "https://rimworldwiki.com/", "The official wiki")] },
    { steam: ["440"], names: ["team fortress 2"], guides: [G("Team Fortress Wiki", "https://wiki.teamfortress.com/", "The official wiki")] },
    { steam: ["72850", "489830"], names: ["the elder scrolls v skyrim", "the elder scrolls v skyrim special edition", "skyrim"], guides: [G("UESP (Skyrim)", "https://en.uesp.net/wiki/Skyrim:Skyrim", "Quests, items, places, characters")] },
    { steam: ["252490"], names: ["rust"], guides: [G("Rust wiki (RustClash)", "https://wiki.rustclash.com/", "Items, raiding costs, crafting")] },
    { steam: ["1063730"], names: ["new world", "new world aeternum"], guides: [G("NWDB", "https://nwdb.info/", "Items, recipes, maps")] },
    { steam: ["1284210"], names: ["guild wars 2"], guides: [G("Guild Wars 2 Wiki", "https://wiki.guildwars2.com/", "The official wiki")] },
    { steam: ["570"], names: ["dota 2"], guides: [G("Liquipedia (Dota 2)", "https://liquipedia.net/dota2/", "Heroes, items, tournaments")] },
    { steam: ["730"], names: ["counter strike 2", "counter strike global offensive"], guides: [G("Liquipedia (Counter-Strike)", "https://liquipedia.net/counterstrike/", "Maps, weapons, teams, tournaments")] },
    { steam: ["1623730"], names: ["palworld"], guides: [G("Palworld Wiki", "https://palworld.wiki.gg/", "Pals, breeding, items, maps")] },
    { steam: ["553850"], names: ["helldivers 2"], guides: [G("Helldivers Wiki", "https://helldivers.wiki.gg/", "Stratagems, weapons, enemies")] },
    // not on Steam
    { names: ["world of warcraft"], guides: [G("Wowhead", "https://www.wowhead.com/", "Items, quests, guides, talents")], mods: [G("CurseForge (WoW add-ons)", "https://www.curseforge.com/wow", "Add-ons")] },
    { names: ["minecraft", "minecraft launcher"], guides: [G("Minecraft Wiki", "https://minecraft.wiki/", "The community wiki")], mods: [G("Modrinth", "https://modrinth.com/mods", "Mods, mod packs, shaders"), G("CurseForge (Minecraft)", "https://www.curseforge.com/minecraft", "Mods and mod packs")] },
    { names: ["league of legends"], guides: [G("League of Legends Wiki", "https://wiki.leagueoflegends.com/", "Champions, items, runes")] },
    { names: ["escape from tarkov"], guides: [G("tarkov.dev", "https://tarkov.dev/", "Ammo, items, prices, maps, quests"), G("Escape from Tarkov Wiki", "https://escapefromtarkov.fandom.com/", "The community wiki")] }
];
const BY_STEAM = new Map(), BY_NAME = new Map();
CURATED.forEach((c) => { (c.steam || []).forEach((id) => BY_STEAM.set(id, c)); (c.names || []).forEach((n) => BY_NAME.set(n, c)); });
const curatedFor = (title, appid) => (appid && BY_STEAM.get(String(appid))) || BY_NAME.get(norm(title)) || null;

// a wiki id that is the game's name ("eldenring" for Elden Ring), not a side wiki ("stardewmodding")
const sameName = (id, title) => { const a = norm(id).replace(/ /g, ""), b = norm(title).replace(/ /g, ""); return !!a && (a === b || b.startsWith(a) || a.startsWith(b)); };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
// a wiki in your language if there's one, else the English (or first) one.
// Fandom ids are "eldenring" or "pt-br.valheim"; wiki URLs have a language before the host ("pt.stardewvalleywiki.com")
function pickLang(list, lang, langOf) {
    if (!list || !list.length) return null;
    const mine = lang && lang !== "en" ? list.find((x) => { const l = langOf(x); return l && (l === lang || l.startsWith(lang + "-")); }) : null;
    return mine || list.find((x) => !langOf(x)) || null; // never a third language
}
const fandomLang = (id) => (String(id).includes(".") ? String(id).split(".")[0] : null);
const urlLang = (u) => { const h = host(u).split("."); return h.length > 2 && /^[a-z]{2}(-[a-z]{2})?$/.test(h[0]) ? h[0] : null; };

// wd: what Wikidata keeps for the game ({ fandom: [], wikigg: [], official: [], pcgw, modio, thunderstore })
// nexus: { domain, mods } on Nexus Mods; workshop: the game has a Steam Workshop
function build({ title, appid = null, wd = null, nexus = null, workshop = false, lang = "en" } = {}) {
    const guides = [], mods = [], community = [];
    const seen = new Set();
    const add = (list, l) => { const k = host(l.url) + new URL(l.url).pathname.replace(/\/+$/, ""); if (seen.has(k)) return; seen.add(k); list.push(l); };
    const cur = curatedFor(title, appid);
    if (cur) { (cur.guides || []).forEach((l) => add(guides, l)); (cur.mods || []).forEach((l) => add(mods, l)); }
    if (wd) {
        // English first (usually the fullest), then the one in your language if there is one
        const both = (list, langOf) => [pickLang(list, "en", langOf), lang !== "en" ? pickLang(list, lang, langOf) : null].filter((x, i, a) => x && a.indexOf(x) === i);
        const yours = (x, langOf) => (langOf(x) ? ` · in your language (${langOf(x)})` : "");
        both(wd.official, urlLang).forEach((u) => add(guides, G(`${title} wiki`, u, `The game's own wiki · ${host(u)}${yours(u, urlLang)}`)));
        const gg = (wd.wikigg || []).find((id) => /^[a-z0-9-]+$/i.test(id));
        if (gg) add(guides, G(sameName(gg, title) ? `${title} Wiki (wiki.gg)` : `${gg}.wiki.gg`, `https://${gg}.wiki.gg/`, `Community wiki · ${gg}.wiki.gg`));
        both(wd.fandom, fandomLang).forEach((fd) => {
            const base = String(fd).split(".").pop(), l = fandomLang(fd);
            add(guides, G(sameName(base, title) ? `${title} Wiki (Fandom)` : `${base}.fandom.com`, `https://${base}.fandom.com/${l ? l + "/" : ""}`, `Community wiki · ${base}.fandom.com${l ? "/" + l : ""}${yours(fd, fandomLang)}`));
        });
        if (wd.pcgw) add(guides, G("PCGamingWiki", `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(wd.pcgw).replace(/%2F/g, "/")}`, "Fixes, settings, where saves live"));
        if (wd.modio) add(mods, G("mod.io", `https://mod.io/g/${encodeURIComponent(wd.modio)}`, "Mods for this game"));
        if (wd.thunderstore) add(mods, G("Thunderstore", `https://thunderstore.io/c/${encodeURIComponent(wd.thunderstore)}/`, "Mods, with a mod manager"));
    }
    if (!(wd && wd.pcgw) && appid) add(guides, G("PCGamingWiki", `https://www.pcgamingwiki.com/api/appid.php?appid=${appid}`, "Fixes, settings, where saves live"));
    if (nexus && nexus.domain) add(mods, G("Nexus Mods", `https://www.nexusmods.com/${nexus.domain}/mods/`, nexus.mods ? `${nexus.mods.toLocaleString("en-US")} mods` : "Mods for this game"));
    if (appid && workshop) add(mods, G("Steam Workshop", `https://steamcommunity.com/app/${appid}/workshop/`, "Mods and maps, installed by Steam"));
    if (appid) {
        add(community, G("Steam guides", `https://steamcommunity.com/app/${appid}/guides/`, "Written by players"));
        add(community, G("Steam discussions", `https://steamcommunity.com/app/${appid}/discussions/`, "Questions and answers"));
    }
    const q = encodeURIComponent(`${title} wiki`);
    community.push(G("Search the web", `https://duckduckgo.com/?q=${q}`, `"${title} wiki"`));
    // the best: a hand-picked site, else the game's own wiki, else a community wiki (PCGamingWiki is for fixes, not for playing)
    const best = guides.find((l) => l.label !== "PCGamingWiki") || null;
    return {
        best,
        groups: [
            { id: "guides", label: "Wikis & databases", links: guides },
            { id: "mods", label: "Mods", links: mods },
            { id: "community", label: "Community", links: community }
        ].filter((g) => g.links.length)
    };
}

// Nexus Mods' list of games, by normalised name (and without a subtitle's "the")
function nexusIndex(games) {
    const m = new Map();
    for (const g of games || []) {
        if (!g || !g.domain_name || !g.name) continue;
        const v = { domain: g.domain_name, mods: g.mods || 0 };
        const k = norm(g.name);
        if (!m.has(k) || (m.get(k).mods || 0) < v.mods) m.set(k, v);
    }
    return m;
}

module.exports = { build, nexusIndex, curatedFor, norm, CURATED };
