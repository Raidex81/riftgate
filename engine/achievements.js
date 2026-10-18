// Steam achievements: each game's list (names, descriptions, icons, which are
// hidden), which ones you've unlocked and when, and how rare each one is
// among all Steam players.
//
// Where it comes from: Steam's Web API. Your unlocks and the game's list go
// through Riftgate's media proxy (they need Steam's key); how rare each one
// is comes straight from Steam (no key needed). It needs your SteamID64 in
// Settings and your Steam profile's "Game details" set to Public, the same
// as Steam playtime.
//
// What's kept (in the data folder, achievements/<appid>.json):
//   the game's list for 30 days, rarity for a week, your unlocks for an
//   hour. When Steam doesn't answer, the saved copy is shown (and says so).
// A summary of every game (achievements-summary.json) feeds the Journal's
// Trophy room, Nexus and the cards. It's refreshed in the background for
// the games you've played since the last look (Steam playtime changed),
// a few minutes after start and every six hours.
//
// Needs from other sections (given by main.js): steamApi(path, query), a
// request to Steam through the media proxy.
"use strict";
const fs = require("fs");
const path = require("path");
const { httpsGetJsonPlain } = require("../services/http");
const data = require("./core/data");
const settings = require("./core/settings");
const windowRef = require("./core/window");
const providers = require("./providers");

const HOUR = 3600e3, DAY = 24 * HOUR;
const SCHEMA_TTL = 30 * DAY, RARITY_TTL = 7 * DAY, UNLOCKS_TTL = HOUR;
const SWEEP_EVERY = 6 * HOUR, SWEEP_MAX = 30, RECHECK_UNCHANGED = 7 * DAY;

const dir = () => data.file("achievements");
const gameFile = (appid) => path.join(dir(), `${appid}.json`);
const summaryFile = () => data.file("achievements-summary.json");
const validAppId = (v) => (/^\d{1,10}$/.test(String(v)) ? String(v) : null);

// Why there's nothing to show, in words the interface can act on
class Unavailable extends Error { constructor(state, message) { super(message || state); this.state = state; } }

function steamId() {
    const id = String(settings.read().steamId64 || "").trim();
    return /^\d{17}$/.test(id) ? id : null;
}

// Steam's own words for a profile it won't show, or a game without achievements
function classify(err) {
    const body = err && err.body && (err.body.playerstats || err.body);
    const msg = String((body && body.error) || (err && err.message) || "");
    if (/not public|private/i.test(msg) || (err && err.statusCode === 403 && /playerstats/i.test(JSON.stringify(err.body || {})))) return "private";
    if (/no stats|no achievements|not found/i.test(msg)) return "none";
    if (/allowlist/i.test(msg)) return "server-update";
    return null;
}

function register(ipcMain, { steamApi }) {
    const readGame = (appid) => data.readJson(gameFile(appid), {}) || {};
    const saveGame = (appid, g) => {
        try { fs.mkdirSync(dir(), { recursive: true }); } catch (e) { /* exists */ }
        data.writeJson(gameFile(appid), g);
    };

    // The game's achievements: names, descriptions, icons, hidden or not
    async function schemaOf(appid, g) {
        if (g.schema && Date.now() - g.schema.at < SCHEMA_TTL) return g.schema;
        try {
            const r = await steamApi("/ISteamUserStats/GetSchemaForGame/v2/", { appid, l: "english" });
            const game = (r && r.game) || {};
            const list = ((game.availableGameStats || {}).achievements || []).map((a) => ({
                id: String(a.name), name: String(a.displayName || a.name), desc: String(a.description || ""),
                icon: a.icon || null, iconGray: a.icongray || null, hidden: Number(a.hidden) === 1
            }));
            g.schema = { at: Date.now(), name: game.gameName || null, list };
            return g.schema;
        } catch (err) {
            const state = classify(err);
            if (state === "server-update") throw new Unavailable(state);
            if (g.schema) { providers.servedSaved(g.schema.at); return g.schema; }
            throw state ? new Unavailable(state) : err;
        }
    }

    // How many players have each one (public, no key)
    async function rarityOf(appid, g) {
        if (g.rarity && Date.now() - g.rarity.at < RARITY_TTL) return g.rarity;
        try {
            const r = await httpsGetJsonPlain(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appid}&format=json`, 10000);
            const map = {};
            for (const a of ((r && r.achievementpercentages) || {}).achievements || []) {
                const p = Number(a.percent);
                if (a.name && Number.isFinite(p)) map[a.name] = Math.round(p * 10) / 10;
            }
            g.rarity = { at: Date.now(), map };
            return g.rarity;
        } catch (err) {
            // rarity is a bonus: without it the list still shows
            if (g.rarity) { providers.servedSaved(g.rarity.at); return g.rarity; }
            return { at: 0, map: {} };
        }
    }

    // Which ones you have, and when (unix seconds; 1 = unlocked, date unknown)
    async function unlocksOf(appid, g, fresh) {
        const id = steamId();
        if (!id) throw new Unavailable("no-steamid");
        if (!fresh && g.unlocks && g.unlocks.steamId === id && Date.now() - g.unlocks.at < UNLOCKS_TTL) return g.unlocks;
        try {
            const r = await steamApi("/ISteamUserStats/GetPlayerAchievements/v0001/", { steamid: id, appid });
            const ps = (r && r.playerstats) || {};
            if (ps.success === false) throw Object.assign(new Error(ps.error || "Steam said no"), { body: r });
            const map = {};
            for (const a of ps.achievements || []) if (Number(a.achieved) === 1) map[a.apiname] = Number(a.unlocktime) || 1;
            g.unlocks = { at: Date.now(), steamId: id, map };
            return g.unlocks;
        } catch (err) {
            const state = classify(err);
            if (state) throw new Unavailable(state);
            if (g.unlocks && g.unlocks.steamId === id) { providers.servedSaved(g.unlocks.at); return g.unlocks; }
            throw err;
        }
    }

    // One game, put together: every achievement with yours and its rarity
    async function game(appid, { fresh = false } = {}) {
        const g = readGame(appid);
        const schema = await schemaOf(appid, g);
        if (!schema.list.length) { saveGame(appid, g); noteSummary(appid, { name: schema.name, total: 0 }); return { state: "none", appid }; }
        const [unlocks, rarity] = await Promise.all([unlocksOf(appid, g, fresh), rarityOf(appid, g)]);
        saveGame(appid, g);
        const items = schema.list.map((a) => {
            const t = unlocks.map[a.id];
            return { ...a, achieved: !!t, unlockedAt: t > 1 ? t * 1000 : null, percent: typeof rarity.map[a.id] === "number" ? rarity.map[a.id] : null };
        });
        const out = { state: "ok", appid, name: schema.name, total: items.length, unlocked: items.filter((a) => a.achieved).length, items, updatedAt: unlocks.at };
        noteSummary(appid, out);
        return out;
    }

    // ---- the summary across games ---------------------------------------------
    const readSummary = () => data.readJson(summaryFile(), { games: {} }) || { games: {} };
    function noteSummary(appid, r) {
        const s = readSummary();
        const before = s.games[appid] || {};
        const minutes = (settings.read().steamPlaytimes || {})[appid];
        if (!r.total) { s.games[appid] = { name: r.name || before.name || null, total: 0, at: Date.now(), playtimeAt: minutes ?? null }; data.writeJson(summaryFile(), s); return 0; }
        const got = r.items.filter((a) => a.achieved);
        const rarest = got.filter((a) => a.percent !== null).sort((a, b) => a.percent - b.percent)[0] || null;
        const recent = got.filter((a) => a.unlockedAt).sort((a, b) => b.unlockedAt - a.unlockedAt).slice(0, 6)
            .map((a) => ({ id: a.id, name: a.name, icon: a.icon, at: a.unlockedAt, percent: a.percent }));
        s.games[appid] = {
            name: r.name || before.name || null, total: r.total, unlocked: got.length,
            lastUnlockAt: recent[0] ? recent[0].at : before.lastUnlockAt || null,
            rarest: rarest ? { id: rarest.id, name: rarest.name, icon: rarest.icon, percent: rarest.percent } : null,
            recent, at: Date.now(), playtimeAt: minutes ?? null
        };
        delete s.state;
        data.writeJson(summaryFile(), s);
        return Math.max(0, got.length - (before.unlocked || 0));
    }

    function summary() {
        const s = readSummary();
        const recent = [];
        for (const [appid, g] of Object.entries(s.games)) for (const a of g.recent || []) recent.push({ ...a, appid, game: g.name });
        recent.sort((a, b) => b.at - a.at);
        return { steamId: !!steamId(), state: s.state || null, games: s.games, recent: recent.slice(0, 40), sweptAt: s.sweptAt || null };
    }

    // ---- the background look at games you've played -------------------------------
    // force: look again at every game you've played (after you change your
    // Steam privacy, say), not only the ones whose playtime changed
    let sweeping = null;
    function sweep({ force = false } = {}) {
        if (sweeping) return sweeping;
        sweeping = (async () => {
            if (!steamId()) return summary();
            const minutes = settings.read().steamPlaytimes || {};
            const s = readSummary();
            const due = Object.entries(minutes)
                .filter(([appid, m]) => validAppId(appid) && m > 0)
                .filter(([appid, m]) => { const g = s.games[appid]; return force || !g || g.playtimeAt !== m || Date.now() - (g.at || 0) > RECHECK_UNCHANGED; })
                .sort((a, b) => b[1] - a[1])
                .slice(0, SWEEP_MAX);
            let fresh = 0, i = 0, stop = false;
            const worker = async () => {
                while (!stop && i < due.length) {
                    const [appid] = due[i++];
                    try {
                        const before = (readSummary().games[appid] || {}).unlocked || 0;
                        const r = await game(appid, { fresh: true }); // played since: ask Steam, not the saved copy
                        if (r.state === "ok") fresh += Math.max(0, r.unlocked - before);
                    } catch (err) {
                        if (err.state === "private" || err.state === "server-update") {
                            stop = true;
                            const now = readSummary(); now.state = err.state; data.writeJson(summaryFile(), now);
                        } else if (err.state === "none") noteSummary(appid, { total: 0 });
                    }
                }
            };
            await Promise.all([worker(), worker(), worker()]);
            const done = readSummary(); done.sweptAt = Date.now();
            if (!stop && force) delete done.state; // Steam answered: whatever stopped it before is gone
            data.writeJson(summaryFile(), done);
            if (fresh > 0) windowRef.send("r2-achievements-changed", { unlocked: fresh });
            return summary();
        })().finally(() => { sweeping = null; });
        return sweeping;
    }
    setTimeout(() => sweep().catch(() => {}), 3 * 60 * 1000);
    setInterval(() => sweep().catch(() => {}), SWEEP_EVERY);

    ipcMain.handle("r2-achievements-game", async (event, appid, opts = {}) => {
        const id = validAppId(appid);
        if (!id) return { state: "none" };
        try { return await game(id, { fresh: !!(opts && opts.fresh) }); }
        catch (err) {
            if (err instanceof Unavailable) return { state: err.state, appid: id };
            console.error(`[achievements] ${id}:`, err.message || err);
            return { state: "error", appid: id };
        }
    });
    ipcMain.handle("r2-achievements-summary", async () => summary());
    ipcMain.handle("r2-achievements-sweep", async (event, opts = {}) => sweep({ force: !!(opts && opts.force) }).catch(() => summary()));
}

module.exports = { register, classify };
