// TVMaze — free, public, no API key/login needed. Used only for TV show
// tracking (search, episode lists, next-episode lookups); this only reads
// air-date metadata, never anything related to downloading or streaming
// episodes.
const { httpsGetJsonPlain } = require("./http");

function searchShows(query) {
    return httpsGetJsonPlain(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
}

function getShowEpisodes(showId) {
    return httpsGetJsonPlain(`https://api.tvmaze.com/shows/${showId}/episodes`);
}

// embed=nextepisode pulls the show's next scheduled episode into the same
// response, avoiding a second round-trip.
function getShowWithNextEpisode(showId) {
    return httpsGetJsonPlain(`https://api.tvmaze.com/shows/${showId}?embed=nextepisode`);
}

module.exports = {
    searchShows,
    getShowEpisodes,
    getShowWithNextEpisode
};
