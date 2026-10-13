// Riftgate — data sources. Each loader asks the engine once per session,
// normalises to Items (items.js), and registers with the command palette so
// search covers everything already loaded.
//
// Slow sources (free games: every store plus Steam verification; deals)
// answer from the last known list first, instantly, then refresh in the
// background; when the fresh list lands, onChange() listeners repaint.
//
// fullPage() pages through the engine's complete internet lists (TMDB,
// RAWG, Open Library, Gutenberg, itch.io) for every "See all".

import * as gate from "./mature.js";
import { call, cached, country, forget, settings, metaOf } from "./api.js";
import * as I from "./items.js";
import { registerSource } from "../components/palette.js";
import { describe } from "./sources.js";

// The engine answers either with a plain array or { success, <key>: [...] }.
export function unwrap(res) {
    if (Array.isArray(res)) return res;
    if (res && typeof res === "object") {
        for (const v of Object.values(res)) if (Array.isArray(v)) return v;
    }
    return [];
}

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(name) { for (const fn of [...listeners]) { try { fn(name); } catch (err) { console.error(err); } } }

// Each list can carry .status: whether a source failed while loading it, or
// whether it's a saved copy (see sources.js). It isn't an item, so it never
// shows up in for…of, map or length, and it carries through the filter, map,
// slice, flatMap and concat that sections apply before handing a list to a
// row (sort works in place, so it keeps it anyway).
class Listed extends Array {}
for (const m of ["filter", "map", "slice", "flatMap", "concat"]) {
    const base = Array.prototype[m];
    Object.defineProperty(Listed.prototype, m, {
        value(...a) { const r = base.apply(this, a); if (r instanceof Listed) setStatus(r, this.status); return r; },
        writable: true, configurable: true
    });
}
function setStatus(list, status) {
    Object.defineProperty(list, "status", { value: status || null, enumerable: false, configurable: true, writable: true });
    return list;
}
export function withStatus(items, status) {
    const list = items instanceof Listed ? items : Listed.from(items || []);
    return setStatus(list, status);
}
export const statusOf = (items) => (items && items.status) || null;

const loaded = new Map(); // name -> Item[] (for search)
const resets = new Set(); // each source's "forget this session's answer"
function source(name, channel, map, argsFn, quickChannel) {
    let current = null; // promise of Item[] for this session
    resets.add(() => { current = null; });
    const mapAll = (raw) => withStatus(unwrap(raw).map(map).filter((x) => x && x.title), null);
    const live = (args, fresh) => cached(channel, args, { fresh }).then((raw) => {
        const items = withStatus(mapAll(raw), metaOf(channel, args));
        loaded.set(name, items);
        return items;
    });
    return async ({ fresh = false } = {}) => {
        const args = argsFn ? await argsFn() : [];
        if (fresh || !quickChannel) {
            if (fresh || !current) current = live(args, fresh);
            return current;
        }
        if (!current) {
            current = (async () => {
                const quick = mapAll(await call(quickChannel, ...args));
                const full = live(args, false);
                if (!quick.length) return full;
                loaded.set(name, quick);
                full.then((items) => {
                    if (!items.length) {
                        // the refresh failed: keep showing the saved list, and say so
                        if (items.status && items.status.failed && items.status.failed.length) { withStatus(quick, { ...items.status, savedAt: items.status.savedAt || null }); emit(name); }
                        return;
                    }
                    current = Promise.resolve(items);
                    // same list, but now it can say it's a saved copy: repaint for that too
                    if (sameKeys(items, quick) && !items.status) return;
                    emit(name);
                });
                return quick;
            })();
        }
        return current;
    };
}
function sameKeys(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i].key !== b[i].key || a[i].title !== b[i].title) return false;
    return true;
}
const byCountry = async () => [await country()];

const libraryBase = source("library", "load-games", I.fromLibrary);
// Playtime: Riftgate only counts the time it can see a game running (a game
// started through a launcher, like EA's or Steam's, often looks like a minute).
// Steam knows better: for every Steam game in your library (a steam:// link or
// a game inside a Steam library folder), the time shown is Steam's own; other
// games keep Riftgate's count. "Update playtime" in Settings fetches them.
let steamIds = null;
export async function library(opts) {
    const items = await libraryBase(opts);
    const s = await settings({ fresh: !!(opts && opts.fresh) });
    const mins = s.steamPlaytimes || {};
    if (!Object.keys(mins).length) return items;
    steamIds = steamIds || {};
    // steam:// links say which game they are right away
    items.forEach((it) => { const m = it.raw && /^steam:\/\/(?:rungameid|run)\/(\d+)/i.exec(it.raw.path || ""); if (m) steamIds[it.raw.path] = m[1]; });
    // games inside a Steam library folder: the engine reads Steam's manifests (asked once)
    const unknown = items.map((it) => it.raw && it.raw.path).filter((p) => p && !(p in steamIds));
    if (unknown.length) {
        let found = null;
        try { found = await call("r2-steam-appids", unknown); } catch (e) { found = null; }
        if (found && typeof found === "object") { unknown.forEach((p) => { steamIds[p] = found[p] || null; }); }
        // (no answer: an engine from before this, still running; ask again next time)
    }
    return items.map((it) => {
        // Steam games show Steam's own time; everything else, Riftgate's count
        const id = it.raw && steamIds[it.raw.path];
        if (!id || typeof mins[id] !== "number") return it;
        return { ...it, playtime: mins[id] * 60, steamAppId: id, playtimeFrom: "Steam" };
    });
}
export const freeGames = source("free", "get-free-games", I.fromFreeGame, null, "get-cached-free-games");
export const deals = source("deals", "get-store-deals", I.fromDeal, byCountry, "get-cached-store-deals");
// films showing in cinemas now: the only ones that get Find tickets
const inCinema = (m) => ({ ...I.fromFilm(m), inCinemas: true });
export const inCinemas = source("cinemas", "get-now-playing-movies", inCinema, byCountry);
export const upcomingFilms = source("upcomingFilms", "get-upcoming-movies", I.fromFilm, byCountry);
export const newSeries = source("series", "get-new-tv-shows", (s) => I.fromTmdbShow(s, false), byCountry);
export const newAnime = source("anime", "get-new-anime", (s) => I.fromTmdbShow(s, true), byCountry);
export const upcomingGames = source("upcomingGames", "get-upcoming-games", I.fromUpcomingGame);
export const watchlist = source("watchlist", "get-watchlist", I.fromWatchlist);
export const latestEpisodes = source("episodes", "get-latest-episodes", I.fromEpisode);
export const booksPopular = source("booksPopular", "get-openlibrary-popular", I.fromBook, null, "get-cached-openlibrary-popular");
export const booksBest = source("booksBest", "get-openlibrary-most-sold", I.fromBook, null, "get-cached-openlibrary-most-sold");
export const booksNew = source("booksNew", "get-openlibrary-new-releases", I.fromBook, null, "get-cached-openlibrary-new-releases");
export const mangaPopular = source("manga", "get-manga-popular", I.fromBook, null, "get-cached-manga-popular");
export const mangaNew = source("mangaNew", "get-manga-new-releases", I.fromBook, null, "get-cached-manga-new-releases");
export const comicsPopular = source("comics", "get-comics-popular", I.fromBook, null, "get-cached-comics-popular");
export const comicsNew = source("comicsNew", "get-comics-new-releases", I.fromBook, null, "get-cached-comics-new-releases");
export const classics = source("classics", "get-popular-ebooks", I.fromBook, null, "get-cached-popular-ebooks");
export const ebooks = source("ebooks", "get-ebooks", I.fromEbook);
export const communityApps = source("apps", "get-community-apps", I.fromCommunityApp);

registerSource("all", () => [...loaded.values()].flat());

export function refreshAll() { forget(""); loaded.clear(); for (const r of resets) r(); }
// Try again (sources.js): every list is asked for again
window.addEventListener("r2-sources-reset", () => { loaded.clear(); for (const r of resets) r(); });

// ---- Complete lists from the internet, page by page ---------------------------
// `per` engine pages make one page of the browser (about 100 titles).
const show = (anime) => (s) => I.fromTmdbShow(s, anime);
export const FULL = {
    "now-playing": { map: inCinema, per: 5 },
    "upcoming-movies": { map: I.fromFilm, per: 5 },
    "new-series": { map: show(false), per: 5, providers: true },
    "new-anime": { map: show(true), per: 5, providers: true },
    "provider": { map: I.fromProviderTitle, per: 3 },
    "upcoming-games": { map: I.fromUpcomingGame, per: 3 },
    "itch": { map: I.fromFreeGame, per: 3, open: true },
    "buy-books-popular": { map: I.fromBook, per: 3 },
    "buy-books-bestseller": { map: I.fromBook, per: 3 },
    "buy-books-new-releases": { map: I.fromBook, per: 3 },
    "manga-popular": { map: I.fromBook, per: 3 },
    "manga-new-releases": { map: I.fromBook, per: 3 },
    "comics-popular": { map: I.fromBook, per: 3 },
    "comics-new-releases": { map: I.fromBook, per: 3 },
    "classics": { map: I.fromBook, per: 3 }
};

// -> { items, page, pages (null = unknown, keep going), total, error }
export async function fullPage(full, page) {
    const def = FULL[full.kind];
    if (!def) return { items: [], page, pages: 1, total: 0, error: "This list can't be browsed." };
    const cc = await country();
    const first = (page - 1) * def.per + 1;
    const argsFor = (i) => [{ kind: full.kind, page: first + i, countryCode: cc, providerName: full.providerName || undefined }];
    const res = await Promise.all(Array.from({ length: def.per }, (_, i) => cached("get-full-list", argsFor(i))));
    const seen = new Set();
    const items = [];
    let enginePages = null, total = null, error = null, open = false, failedMeta = null;
    res.forEach((r, i) => {
        const meta = metaOf("get-full-list", argsFor(i));
        const sourceFailed = !!(meta && meta.failed && meta.failed.length) && !(r && (r.items || []).length);
        if (sourceFailed) error = error || "Couldn't load this page.";
        if (!r || sourceFailed || (r.error && !(r.items || []).length)) {
            // don't keep a failed page for the session: Try again asks again
            forget("get-full-list" + JSON.stringify(argsFor(i)));
            if (meta && meta.failed && meta.failed.length) failedMeta = failedMeta || meta;
        }
        if (!r) { error = error || "Couldn't load this page. Try again in a moment."; return; }
        if (r.error && !(r.items || []).length) error = error || r.error;
        if (typeof r.totalPages === "number") enginePages = Math.max(enginePages || 0, r.totalPages);
        if (typeof r.totalResults === "number") total = r.totalResults;
        if (def.open && (r.items || []).length && r.totalPages > first + i) open = true;
        (r.items || []).map(def.map).forEach((it) => {
            if (!it || !it.title || gate.hidden(it) || seen.has(it.key)) return;
            if (full.kind === "provider" && full.providerName) it.streamOn = { name: full.providerName };
            seen.add(it.key);
            items.push(it);
        });
    });
    let pages = enginePages ? Math.max(1, Math.ceil(enginePages / def.per)) : page;
    if (open) pages = null; // itch.io and similar: no end announced
    if (def.providers) await withProviders(items);
    // a source that didn't answer: say which, the same way rows do
    if (!items.length && failedMeta) error = describe(failedMeta, 0).text;
    return { items, page, pages, total, error: items.length ? null : error };
}

// ---- Which service streams a show ----------------------------------------------
const providerMemo = new Map(); // tmdb show id -> provider | null
export async function withProviders(items) {
    const shows = items.filter((i) => i && i.tmdbShowId);
    const need = [...new Set(shows.map((i) => i.tmdbShowId).filter((id) => !providerMemo.has(id)))];
    if (need.length) {
        const res = (await call("r2-tv-providers", { ids: need, countryCode: await country() })) || {};
        need.forEach((id) => providerMemo.set(id, res[id] || null));
    }
    shows.forEach((i) => { const p = providerMemo.get(i.tmdbShowId); if (p) i.provider = p; });
    return items;
}

// Free games that are really new this week. On a first run (or after a
// reinstall) every free game is "seen" for the first time in the same scan,
// and none of that is news, so the first scan never counts; nor do the
// permanent free-to-play platforms (they're never a giveaway).
const CURATED_ONLY = new Set(["Battle.net", "EA", "Riot Games", "Ubisoft Connect", "Wargaming.net", "Gaijin.net", "Grinding Gear Games", "Meta Quest"]);
export function newFreeGames(list) {
    const first = Math.min(...list.map((g) => g.firstSeenAt || Infinity));
    const cut = Math.max(Date.now() - 7 * 86400000, isFinite(first) ? first + 3600e3 : 0);
    return list.filter((g) => !g.alwaysFree && !CURATED_ONLY.has(g.source) && (g.firstSeenAt || 0) > cut);
}

// My shows changed (a show added or removed): reload it and its new
// episodes, and let every row showing them repaint
export async function watchlistChanged() {
    forget("get-watchlist"); forget("get-latest-episodes");
    await Promise.all([watchlist({ fresh: true }), latestEpisodes({ fresh: true })]).catch(() => {});
    emit("watchlist");
}
