// TMDB (The Movie Database) helpers: locale lookup, poster fallback,
// trailer picking, and the provider-search result mappers shared by the
// Theatre/Streaming and NEW sections' movie & TV lookups. Every function
// here is a pure "given TMDB's response, shape it for the UI" transform
// with no knowledge of main.js's own state.
//
// What deliberately stays in main.js instead: getWatchProvidersList and
// its in-memory watchProvidersListCache (cache orchestration, same
// reasoning as services/steam.js and services/free-games.js keeping
// their own caching in main.js), and every ipcMain.handle registration.
const { mediaProxyGetJsonPlain } = require("./supabase");
const { textContainsMatureKeyword } = require("./content-filters");

// TMDB's poster/metadata association can be locale-specific — a movie
// releasing in a given region sometimes only has its poster properly
// indexed under that region's own language context. The region
// parameter was already dynamic (following the user's selected
// country), but language was hardcoded to en-US regardless, which is
// very likely why films specific to a non-English region (Portuguese
// titles releasing in Portugal, for example) were missing their cover
// art — requesting English-locale data for a Portugal-region query.
const TMDB_LANGUAGE_BY_COUNTRY = {
    US: "en-US",
    GB: "en-GB",
    PT: "pt-PT",
    CA: "en-CA",
    AU: "en-AU",
    DE: "de-DE",
    FR: "fr-FR",
    ES: "es-ES",
    BR: "pt-BR",
    IT: "it-IT",
    NL: "nl-NL",
    BE: "nl-BE",
    IE: "en-IE",
    CH: "de-CH",
    AT: "de-AT",
    MX: "es-MX",
    AR: "es-AR",
    CL: "es-CL",
    CO: "es-CO",
    JP: "ja-JP",
    KR: "ko-KR",
    CN: "zh-CN",
    HK: "zh-HK",
    TW: "zh-TW",
    IN: "hi-IN",
    RU: "ru-RU",
    SE: "sv-SE",
    NO: "no-NO",
    DK: "da-DK",
    FI: "fi-FI",
    PL: "pl-PL",
    TR: "tr-TR",
    GR: "el-GR",
    CZ: "cs-CZ",
    HU: "hu-HU",
    RO: "ro-RO",
    ZA: "en-ZA",
    NZ: "en-NZ",
    PH: "en-PH",
    ID: "id-ID",
    MY: "ms-MY",
    SG: "en-SG",
    TH: "th-TH",
    VN: "vi-VN",
    SA: "ar-SA",
    AE: "ar-AE",
    EG: "ar-EG",
    IL: "he-IL",
    UA: "uk-UA"
};

// Supplementary lookup for a movie or TV show that came back with no
// poster from the main (English-locale) listing — TMDB's /images endpoint
// isn't tied to a single language the way the listing endpoint is, so it
// can surface a poster (a release specific to Portugal, Japan, wherever,
// included) without having to switch the whole request to a different
// locale, which is what broke English descriptions the first time this
// was attempted. Shared by movies and TV shows — mediaType is "movie" or
// "tv", matching TMDB's own URL structure for both.
async function fetchFallbackPoster(mediaType, mediaId, preferredLanguage) {
    try {
        const data = await mediaProxyGetJsonPlain("tmdb", `/${mediaType}/${mediaId}/images`, {});
        const posters = data.posters || [];
        if (posters.length === 0) return null;

        // Prefer one matching the user's region if available, otherwise
        // fall back to the neutral/language-less posters TMDB often has,
        // otherwise just take whatever's first — any poster beats none,
        // regardless of which country or language it happens to be from.
        const preferred = posters.find((p) => p.iso_639_1 === (preferredLanguage || "").split("-")[0]);
        const neutral = posters.find((p) => !p.iso_639_1);
        const chosen = preferred || neutral || posters[0];

        return chosen ? `https://image.tmdb.org/t/p/w500${chosen.file_path}` : null;
    } catch (err) {
        return null;
    }
}

// Prefers a real "Trailer" over a "Teaser" — but falls back to a teaser
// rather than nothing, since that's frequently all that exists yet for a
// title that hasn't released. Within whichever type is used, an official
// upload is preferred over an arbitrary fan/regional one, since TMDB
// doesn't guarantee "best" results come first.
function pickBestYoutubeTrailer(videos) {
    const youtubeVideos = (videos || []).filter((v) => v.site === "YouTube");
    const trailers = youtubeVideos.filter((v) => v.type === "Trailer");
    const teasers = youtubeVideos.filter((v) => v.type === "Teaser");
    const pool = trailers.length ? trailers : teasers;
    const best = pool.find((v) => v.official) || pool[0];
    return best ? best.key : null;
}

async function mapProviderMovie(m, tmdbLanguage) {
    let image = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
    if (!image) image = await fetchFallbackPoster("movie", m.id, tmdbLanguage);
    return {
        id: m.id,
        mediaType: "movie",
        name: m.title,
        description: m.overview,
        image,
        releaseDate: m.release_date,
        popularity: m.popularity || 0,
        rating: typeof m.vote_average === "number" && m.vote_average > 0 ? m.vote_average : null,
        isMature: !!m.adult || textContainsMatureKeyword(m.title) || textContainsMatureKeyword(m.overview)
    };
}

async function mapProviderShow(s, tmdbLanguage) {
    let image = s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null;
    if (!image) image = await fetchFallbackPoster("tv", s.id, tmdbLanguage);
    return {
        id: s.id,
        mediaType: "tv",
        name: s.name,
        description: s.overview,
        image,
        releaseDate: s.first_air_date,
        popularity: s.popularity || 0,
        rating: typeof s.vote_average === "number" && s.vote_average > 0 ? s.vote_average : null,
        isMature: textContainsMatureKeyword(s.name) || textContainsMatureKeyword(s.overview)
    };
}

module.exports = {
    TMDB_LANGUAGE_BY_COUNTRY,
    fetchFallbackPoster,
    pickBestYoutubeTrailer,
    mapProviderMovie,
    mapProviderShow
};
