// Cinemas near the chosen city (the Theatre's "Your cinema" picker).
// OpenStreetMap asks apps to keep request volume low, so each city's list is
// kept on disk for two weeks (a day when nothing was found, so a city that
// was just mapped shows up soon), and concurrent asks for the same city
// share one request.
// v2: lists saved by the old Overpass-only lookup are dropped — a busy
// server could leave a city saved as "no cinemas" for a day.
// v3: a chain's website is only used in the countries where it runs cinemas
// (cinepolis.com, Cinépolis's Mexican site, blocks visitors from Portugal).
"use strict";
const { app } = require("electron");
const { fetchCinemas } = require("../services/cinemas");
const data = require("./core/data");
const providers = require("./providers");

const CINEMAS_CACHE_FILE = "cache-cinemas-v3.json";
const CINEMAS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CINEMAS_EMPTY_TTL_MS = 24 * 60 * 60 * 1000;
const cinemasInFlight = new Map();

function register(ipcMain) {
    ipcMain.handle("get-cinemas", async (event, { countryCode, city, refresh } = {}) => {
        const cc = typeof countryCode === "string" && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null;
        const cityName = typeof city === "string" ? city.trim() : "";
        if (!cc || !cityName || cityName.length > 80) return { cinemas: [], error: null };

        const key = `${cc}|${cityName.toLowerCase()}`;
        const cache = data.loadCache(CINEMAS_CACHE_FILE) || {};
        const cached = cache[key];
        if (cached && Array.isArray(cached.cinemas) && !refresh) {
            const ttl = cached.cinemas.length > 0 ? CINEMAS_TTL_MS : CINEMAS_EMPTY_TTL_MS;
            if (Date.now() - (cached.savedAt || 0) < ttl) return { cinemas: cached.cinemas, error: null };
        }

        if (!cinemasInFlight.has(key)) {
            const job = fetchCinemas(cc, cityName, app.getVersion())
                .then((cinemas) => {
                    const fresh = data.loadCache(CINEMAS_CACHE_FILE) || {};
                    fresh[key] = { savedAt: Date.now(), cinemas };
                    // Keep the file small: only the 40 most recently fetched cities.
                    const keys = Object.keys(fresh).sort((x, y) => (fresh[y].savedAt || 0) - (fresh[x].savedAt || 0));
                    keys.slice(40).forEach((k) => delete fresh[k]);
                    data.saveCache(CINEMAS_CACHE_FILE, fresh);
                    return cinemas;
                })
                .finally(() => cinemasInFlight.delete(key));
            cinemasInFlight.set(key, job);
        }

        try {
            return { cinemas: await cinemasInFlight.get(key), error: null };
        } catch (err) {
            console.error(`[cinemas] ${cc} ${cityName} failed:`, err.message || err);
            // An old list beats none when OpenStreetMap is busy.
            if (cached && Array.isArray(cached.cinemas)) {
                providers.servedSaved(cached.savedAt);
                return { cinemas: cached.cinemas, error: null };
            }
            return { cinemas: [], error: "Couldn't load cinemas right now — try again in a moment." };
        }
    });
}

module.exports = { register };
