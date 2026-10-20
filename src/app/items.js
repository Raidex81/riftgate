// Riftgate — one Item shape for everything.
// The engine returns a dozen different shapes (library games, free games,
// deals, TMDB films and series, TVMaze shows, Open Library/Gutenberg books,
// local eBooks, RAWG upcoming games). Each is normalised here once, so every
// card, row, detail panel, search result and Journal entry works the same
// for every kind of content.
//
// Item = {
//   key        Journal identity (same game in Free Games and Library = same key)
//   kind       where it came from: library|free|deal|film|series|anime|book|ebook|upcoming|show
//   type       what it is (colour + labels): game|app|film|series|anime|book
//   title, sub, desc, image, fallback, backdrop, url, source,
//   rating     0–10 or null;   date (ISO or year);   price {final, original, currency, discount}
//   raw        the original object, for actions that need engine fields
// }

export function slug(s) {
    return (s || "").toLowerCase().normalize("NFKD").replace(/[®™©]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function journalKey(type, title, extra) {
    return `${type}:${slug(title)}${extra ? "~" + slug(extra) : ""}`;
}

const libraryType = (g) => (g.category === "app" ? "app" : "game");

export function fromLibrary(g) {
    const type = libraryType(g);
    return {
        key: journalKey(type, g.name),
        kind: "library", type,
        vr: g.category === "vr",
        title: g.name,
        sub: g.category === "vr" ? "VR" : (type === "app" ? "App" : (g.tags && g.tags[0]) || "Game"),
        desc: g.description && g.description !== "No description available." ? g.description : "",
        image: g.image && g.image !== "covers/default.jpg" ? g.image : null,
        url: null,
        playtime: g.playtimeSeconds || 0,
        launches: g.launches || 0,
        lastPlayed: g.lastPlayed || null,
        addedAt: g.addedAt || null,
        favourite: !!g.favorite,
        raw: g
    };
}

// How popular a free game is, from whatever the store gave us (reviews,
// a rank, a score), the same scale Riftgate 1.x sorts by
function freePopularity(g) {
    if (typeof g.reviewCount === "number" && g.reviewCount > 0) return Math.min(100, 20 * Math.log10(g.reviewCount)) + (typeof g.rating === "number" ? (g.rating - 70) / 10 : 0);
    if (typeof g.popularityRank === "number") return Math.max(20, 55 - g.popularityRank * .5);
    if (typeof g.popularity === "number") return g.popularity;
    if (g.source === "Epic Games" || g.source === "GOG") return 50;
    if (g.source === "Steam") return 25;
    return 30;
}

export function fromFreeGame(g) {
    return {
        key: journalKey("game", g.name),
        kind: "free", type: "game",
        vr: g.vr === "native" || g.vr === "adapted" ? g.vr : (g.vr ? "native" : null),
        genre: Array.isArray(g.tags) && g.tags[0] ? String(g.tags[0]) : null,
        title: g.name,
        sub: g.source,
        desc: g.description || "",
        image: g.image || null,
        fallback: g.fallbackImage || null,
        url: g.url,
        source: g.source,
        date: g.releaseDate || null,
        firstSeenAt: g.firstSeenAt || null,
        alwaysFree: !!g.alwaysFree,
        popularity: freePopularity(g),
        raw: g
    };
}

export function fromDeal(d) {
    return {
        key: journalKey("game", d.name),
        kind: "deal", type: "game",
        title: d.name,
        sub: d.source,
        image: d.image || null,
        fallback: d.fallbackImage || null,
        url: d.url,
        source: d.source,
        rating: typeof d.ratingPercent === "number" ? d.ratingPercent / 10 : (typeof d.metacriticScore === "number" ? d.metacriticScore / 10 : null),
        ratingText: d.ratingText || (d.metacriticScore ? `Metacritic ${d.metacriticScore}` : null),
        price: { final: d.finalPrice, original: d.originalPrice, currency: d.currency || "USD", discount: d.discountPercent || 0 },
        popularity: d.popularity || 0,
        firstSeenAt: d.firstSeenAt || null,
        raw: d
    };
}

// TMDB's genre ids, named (films and series share most of them)
const TMDB_GENRES = { 28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science Fiction", 10770: "TV Movie",
    53: "Thriller", 10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
    10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics" };
const tmdbGenres = (ids) => (Array.isArray(ids) ? ids.map((id) => TMDB_GENRES[id]).filter(Boolean) : []);
const count = (n) => (typeof n === "number" && n >= 0 ? n : null);

export function fromFilm(m) {
    return {
        key: `film:${m.id}`,
        kind: "film", type: "film",
        title: m.title,
        sub: m.releaseDate ? m.releaseDate.slice(0, 4) : "Film",
        desc: m.description || "",
        image: m.poster || null,
        backdrop: m.backdrop || null,
        date: m.releaseDate || null,
        rating: m.rating || null,
        votes: count(m.votes),
        genres: tmdbGenres(m.genreIds),
        tmdbId: m.id,
        url: `https://www.themoviedb.org/movie/${m.id}`,
        mature: !!m.isMature,
        raw: m
    };
}

export function fromTmdbShow(s, anime) {
    const type = anime ? "anime" : "series";
    return {
        key: journalKey(type, s.name),
        kind: type, type,
        title: s.name,
        sub: s.firstAirDate ? `First aired ${s.firstAirDate.slice(0, 4)}` : (anime ? "Anime" : "Series"),
        desc: s.description || "",
        image: s.image || null,
        backdrop: s.backdrop || null,
        date: s.firstAirDate || null,
        rating: s.rating || null,
        votes: count(s.votes),
        genres: tmdbGenres(s.genreIds),
        tmdbShowId: s.id,
        url: `https://www.themoviedb.org/tv/${s.id}`,
        mature: !!s.isMature,
        raw: s
    };
}

// A title from a streaming service's catalogue (film or series).
export function fromProviderTitle(t) {
    if (t.mediaType === "movie") {
        return fromFilm({ id: t.id, title: t.name, description: t.description, poster: t.image, backdrop: t.backdrop, releaseDate: t.releaseDate, rating: t.rating, votes: t.votes, genreIds: t.genreIds, isMature: t.isMature });
    }
    return fromTmdbShow({ id: t.id, name: t.name, description: t.description, image: t.image, backdrop: t.backdrop, firstAirDate: t.releaseDate, rating: t.rating, votes: t.votes, genreIds: t.genreIds, isMature: t.isMature }, false);
}

// A show the user tracks (TVMaze watchlist entry).
export function fromWatchlist(s) {
    return {
        key: journalKey("series", s.name),
        kind: "show", type: "series",
        title: s.name,
        sub: s.premiered ? `Since ${String(s.premiered).slice(0, 4)}` : "Tracked",
        desc: s.description ? String(s.description).replace(/<[^>]+>/g, "") : "",
        image: s.image || null,
        rating: typeof s.rating === "number" ? s.rating : null,
        tvmazeId: s.id,
        raw: s
    };
}

export function fromEpisode(e) {
    const code = `S${String(e.season).padStart(2, "0")}E${String(e.number).padStart(2, "0")}`;
    return {
        key: journalKey("series", e.showName),
        kind: "episode", type: "series",
        title: e.showName,
        sub: `${code}${e.episodeName ? " · " + e.episodeName : ""}`,
        image: e.showImage || null,
        date: e.airdate || null,
        tvmazeId: e.showId,
        next: e.next && e.next.airstamp ? { ...e.next, code: `S${String(e.next.season).padStart(2, "0")}E${String(e.next.number).padStart(2, "0")}` } : null,
        raw: e
    };
}

export function fromBook(b) {
    return {
        key: journalKey("book", b.title, b.author),
        kind: "book", type: "book",
        title: b.title,
        sub: b.author || "",
        desc: b.description || "",
        image: b.cover || null,
        date: b.publishedDate || null,
        url: b.readUrl || b.buyLink || b.infoLink || b.downloadUrl || null,
        access: b.accessLevel || (b.isFree ? "public" : null),
        subjects: Array.isArray(b.subjects) ? b.subjects : [],
        stars: typeof b.stars === "number" ? b.stars : null,   // readers' average, out of 5
        ratings: count(b.ratings),
        downloads: count(b.downloadCount),
        workKey: b.workKey || null,
        raw: b
    };
}

export function fromEbook(b) {
    return {
        key: journalKey("book", b.title, b.author),
        kind: "ebook", type: "book",
        title: b.title || (b.path ? b.path.split(/[\\/]/).pop() : "Book"),
        sub: b.author || "In your library",
        image: b.cover || null,
        favourite: !!b.favorite,
        lastOpened: b.lastOpened || null,
        raw: b
    };
}

export function fromUpcomingGame(g) {
    return {
        key: journalKey("game", g.name),
        kind: "upcoming", type: "game",
        title: g.name,
        sub: g.releaseDate ? `Out ${g.releaseDate}` : "Coming soon",
        image: g.image || null,
        backdrop: g.image || null,
        date: g.releaseDate || null,
        url: g.url,
        platforms: g.platforms || [],
        raw: g
    };
}

// When a new episode airs, in your time: the season's list gives the day and
// hour in Japan; this finds the next one and says it the way your PC does
export function airsLocally(b, now = Date.now()) {
    if (!b || typeof b.day !== "number" || !/^\d{2}:\d{2}$/.test(b.time || "")) return null;
    const [hh, mm] = b.time.split(":").map(Number);
    const jst = new Date(now + 9 * 3600e3); // Japan is UTC+9, all year
    const days = (b.day - jst.getUTCDay() + 7) % 7;
    let at = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + days, hh, mm) - 9 * 3600e3;
    if (at <= now) at += 7 * 24 * 3600e3;
    const d = new Date(at);
    return { at, day: d.toLocaleDateString(undefined, { weekday: "long" }), time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) };
}

// This season's anime (Jikan / MyAnimeList)
export function fromSeasonAnime(a) {
    const airs = a.airing ? airsLocally(a.broadcast) : null;
    return {
        key: journalKey("anime", a.title),
        kind: "anime", type: "anime",
        title: a.title,
        sub: airs ? `New episodes ${airs.day}s, ${airs.time}` : (a.episodes ? `${a.episodes} episodes` : "This season"),
        desc: a.synopsis || "",
        image: a.image || null,
        rating: typeof a.score === "number" ? a.score : null,
        votes: count(a.members),
        genres: Array.isArray(a.genres) ? a.genres : [],
        airs,
        url: a.url || null,
        source: "MyAnimeList",
        raw: a
    };
}

// A free audiobook (LibriVox): public domain, read by volunteers
function runtime(seconds) {
    const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
    return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`;
}
export function fromAudiobook(b) {
    return {
        key: journalKey("book", b.title, b.author),
        kind: "book", type: "book",
        title: b.title,
        sub: [b.author, b.seconds ? runtime(b.seconds) : null].filter(Boolean).join(" · "),
        desc: b.description || "",
        image: b.cover || null,
        date: b.year || null,
        url: b.url || null,
        access: "public", listen: true,
        subjects: Array.isArray(b.genres) ? b.genres : [],
        source: "LibriVox",
        raw: b
    };
}

// A post from a game's developers on Steam (news, an update, patch notes)
export function fromGameNews(n, game) {
    if (!n || !game) return null;
    return {
        key: `news:${n.id}`,
        kind: "news", type: "game",
        title: game.title,
        sub: `${n.patch ? "Patch notes: " : ""}${n.title}`,
        desc: n.text || "",
        image: game.image || null,
        fallback: game.fallback || null,
        date: n.at ? new Date(n.at).toISOString().slice(0, 10) : null,
        url: n.url,
        source: "Steam",
        game,
        raw: n
    };
}

// A search hit from web-search-all (sections: game, movie, show, book).
export function fromSearchHit(r) {
    const map = { game: "game", movie: "film", show: "series", tv: "series", book: "book" };
    const type = map[r.section] || "game";
    return {
        key: type === "film" ? `film:${r.id}` : journalKey(type, r.title, r.author),
        kind: "search", type,
        title: r.title,
        sub: r.year || r.author || "",
        image: r.image || null,
        url: r.link || null,
        tmdbId: type === "film" ? r.id : null,
        raw: r
    };
}

// An app from the community Applications list. GitHub projects get their
// social card as artwork.
export function fromCommunityApp(a) {
    let repo = null;
    try { const u = new URL(a.url); if (/(^|\.)github\.com$/i.test(u.hostname)) { const p = u.pathname.split("/").filter(Boolean); if (p.length >= 2) repo = `${p[0]}/${p[1]}`; } } catch {}
    const og = repo ? `https://opengraph.githubassets.com/riftgate/${repo}` : null;
    return {
        key: journalKey("app", a.name),
        kind: "community", type: "app",
        title: a.name,
        sub: a.author ? `by ${a.author}` : (repo ? `by ${repo.split("/")[0]}` : "Community app"),
        desc: a.description || "",
        image: og, backdrop: og,
        url: a.url,
        source: repo ? "GitHub" : (() => { try { return new URL(a.url).hostname.replace(/^www\./, ""); } catch { return null; } })(),
        visits: typeof a.visit_count === "number" ? a.visit_count : (typeof a.visits === "number" ? a.visits : 0),
        date: a.created_at || null,
        appId: a.id,
        raw: a
    };
}

export const TYPE_LABEL = { game: "Game", app: "App", film: "Film", series: "Series", anime: "Anime", book: "Book" };
