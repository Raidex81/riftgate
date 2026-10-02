// Riftgate 2 — one Item shape for everything.
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

export function fromFreeGame(g) {
    return {
        key: journalKey("game", g.name),
        kind: "free", type: "game",
        vr: !!g.vr,
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
        popularity: g.popularity || 0,
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
        tmdbShowId: s.id,
        url: `https://www.themoviedb.org/tv/${s.id}`,
        mature: !!s.isMature,
        raw: s
    };
}

// A title from a streaming service's catalogue (film or series).
export function fromProviderTitle(t) {
    if (t.mediaType === "movie") {
        return fromFilm({ id: t.id, title: t.name, description: t.description, poster: t.image, backdrop: t.backdrop, releaseDate: t.releaseDate, rating: t.rating, isMature: t.isMature });
    }
    return fromTmdbShow({ id: t.id, name: t.name, description: t.description, image: t.image, backdrop: t.backdrop, firstAirDate: t.releaseDate, rating: t.rating, isMature: t.isMature }, false);
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

export const TYPE_LABEL = { game: "Game", app: "App", film: "Film", series: "Series", anime: "Anime", book: "Book" };
