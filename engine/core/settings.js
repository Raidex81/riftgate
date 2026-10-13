// Riftgate's settings (settings.json in the data folder): what every new
// install starts with, reading them, and changing a few at once without
// losing anything another section saved.
"use strict";
const data = require("./data");

const FILE = "settings.json";

const DEFAULT_SETTINGS = {
    uiSounds: true,
    startupSound: true,
    ambientBackground: true,
    colorTheme: "riftgate",
    lastSeenVersion: null,
    lastSeenTourVersion: null,
    launchAtStartup: false,
    defaultCategory: "ask",
    confirmBeforeRemove: true,
    gridDensity: "comfortable",
    trailerVolume: 50,
    runInBackground: false,
    dismissedImports: [],
    categoryOrder: ["game", "vr", "app", "other"],
    sectionOrder: ["new", "installed", "free-games", "theatre", "reading-room", "shared-folder", "applications"],
    // The single app-wide region setting -- drives Theatre (showtimes,
    // streaming providers), New tab (upcoming movies/shows region), and
    // Store (Steam pricing region + display currency). movieCountry and
    // upcomingMoviesCountry below are legacy/superseded: kept only so an
    // existing install's prior choice can be migrated into `country`
    // instead of silently resetting to US (see renderer.js).
    country: "US",
    movieCountry: "US",
    upcomingMoviesCountry: "US",
    startupSection: "new",
    lastReadingRoomTab: "buyfree",
    movieCity: "",
    // "Your cinema" per city, keyed "PT|Lisbon" -> { id, name, label, url }.
    cinemaByCity: {},
    // Country + city asked once per computer (see maybeAskLocation).
    locationConfirmed: false,
    // "auto" = on while a controller is connected, "on", or "off".
    tvMode: "auto",
    startupAnimation: true,
    // Alerts (see r2RunAlerts): new free games and last-day reminders, wishlist price drops
    freeGameAlerts: true,
    wishlistAlerts: true,
    seasonalEvents: true,
    // Opt-in anonymous weekly count (null = not asked yet)
    usageStats: null,
    usageId: null,
    usageLastWeek: null,
    deviceId: null,
    username: null,
    // SteamID64 the user enters in Settings, plus the last playtime pull
    // from Steam's API — see refresh-steam-playtime below. Not a secret,
    // just an identifier (like a username), so it's fine to sit in plain
    // settings.json alongside everything else here.
    steamId64: "",
    steamPlaytimes: {},
    steamPlaytimesUpdatedAt: null,
    // "Mark as seen/watched" state for TV episodes (keyed by
    // "showId|season|number", so a newly aired episode gets a fresh key
    // and naturally shows as unwatched) and movies (keyed by TMDB id).
    seenEpisodes: {},
    seenMovies: {}
};

// Everything, with the defaults filled in for anything not saved yet.
const read = () => ({ ...DEFAULT_SETTINGS, ...(data.readJson(data.file(FILE), {}) || {}) });

// Change some settings; everything else stays as it is on disk right now.
function update(patch) {
    const next = { ...read(), ...patch };
    data.writeJson(data.file(FILE), next);
    return next;
}

module.exports = { DEFAULT_SETTINGS, FILE, read, update };
