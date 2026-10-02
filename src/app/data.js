// Riftgate 2 — data sources. Each loader asks the engine once per session,
// normalises to Items (items.js), and registers with the command palette so
// search covers everything already loaded.

import { cached, country, forget } from "./api.js";
import * as I from "./items.js";
import { registerSource } from "../components/palette.js";

// The engine answers either with a plain array or { success, <key>: [...] }.
export function unwrap(res) {
    if (Array.isArray(res)) return res;
    if (res && typeof res === "object") {
        for (const v of Object.values(res)) if (Array.isArray(v)) return v;
    }
    return [];
}

const loaded = new Map(); // name -> Item[] (for search)
function source(name, channel, map, argsFn) {
    return async ({ fresh = false } = {}) => {
        const args = argsFn ? await argsFn() : [];
        const raw = unwrap(await cached(channel, args, { fresh }));
        const items = raw.map(map).filter((x) => x && x.title);
        loaded.set(name, items);
        return items;
    };
}
const byCountry = async () => [await country()];

export const library = source("library", "load-games", I.fromLibrary);
export const freeGames = source("free", "get-free-games", I.fromFreeGame);
export const deals = source("deals", "get-store-deals", I.fromDeal, byCountry);
export const inCinemas = source("cinemas", "get-now-playing-movies", I.fromFilm, byCountry);
export const upcomingFilms = source("upcomingFilms", "get-upcoming-movies", I.fromFilm, byCountry);
export const newSeries = source("series", "get-new-tv-shows", (s) => I.fromTmdbShow(s, false), byCountry);
export const newAnime = source("anime", "get-new-anime", (s) => I.fromTmdbShow(s, true), byCountry);
export const upcomingGames = source("upcomingGames", "get-upcoming-games", I.fromUpcomingGame);
export const watchlist = source("watchlist", "get-watchlist", I.fromWatchlist);
export const latestEpisodes = source("episodes", "get-latest-episodes", I.fromEpisode);
export const booksPopular = source("booksPopular", "get-openlibrary-popular", I.fromBook);
export const booksBest = source("booksBest", "get-openlibrary-most-sold", I.fromBook);
export const booksNew = source("booksNew", "get-openlibrary-new-releases", I.fromBook);
export const mangaPopular = source("manga", "get-manga-popular", I.fromBook);
export const comicsPopular = source("comics", "get-comics-popular", I.fromBook);
export const classics = source("classics", "get-popular-ebooks", I.fromBook);
export const ebooks = source("ebooks", "get-ebooks", I.fromEbook);

registerSource("all", () => [...loaded.values()].flat());

export function refreshAll() { forget(""); loaded.clear(); }
