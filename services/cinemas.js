// Cinemas near a city, for the "Your cinema" picker in Theatre and New.
//
// Data comes from OpenStreetMap: Nominatim turns the city into coordinates,
// then Overpass lists every venue tagged amenity=cinema within
// CINEMA_RADIUS_METERS of it. Both are free public services with usage
// policies (identify the app, keep requests low), so main.js caches the
// result per city and only asks again after a couple of weeks.
//
// OpenStreetMap often lacks a cinema's own website, so a cinema that
// belongs to a known chain falls back to the chain's official site; only
// what's left over has no link, and the UI then searches for that exact
// cinema instead.
const https = require("https");

const CINEMA_RADIUS_METERS = 15000;
const REQUEST_TIMEOUT_MS = 30000;
const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];

// Official sites of the big chains. `match` is compared (lower-case,
// accents removed) against the cinema's brand, operator and name; a
// per-country `urls` entry wins over the chain's default `url`.
const CINEMA_CHAINS = [
    { match: ["cinemas nos", "cinema nos", "nos cinemas"], url: "https://www.cinemas.nos.pt/" },
    { match: ["castello lopes"], url: "https://castellolopescinemas.pt/" },
    { match: ["cineplace"], url: "https://cineplace.pt/cinemas/" },
    { match: ["uci"], url: "https://www.ucicinemas.pt/", urls: { IT: "https://www.ucicinemas.it/", DE: "https://www.uci-kinowelt.de/" } },
    { match: ["cinema city"], url: "https://www.cinemacity.pt/", urls: { PL: "https://www.cinema-city.pl/", CZ: "https://www.cinemacity.cz/", HU: "https://www.cinemacity.hu/", RO: "https://www.cinemacity.ro/", IL: "https://www.cinema-city.co.il/" } },
    { match: ["amc"], url: "https://www.amctheatres.com/" },
    { match: ["regal"], url: "https://www.regmovies.com/" },
    { match: ["cinemark"], url: "https://www.cinemark.com/" },
    { match: ["odeon"], url: "https://www.odeon.co.uk/" },
    { match: ["vue"], url: "https://www.myvue.com/" },
    { match: ["cineworld"], url: "https://www.cineworld.co.uk/" },
    { match: ["everyman"], url: "https://www.everymancinema.com/" },
    { match: ["picturehouse"], url: "https://www.picturehouses.com/" },
    { match: ["pathe"], url: "https://www.pathe.fr/", urls: { NL: "https://www.pathe.nl/", CH: "https://www.pathe.ch/" } },
    { match: ["ugc"], url: "https://www.ugc.fr/" },
    { match: ["cgr"], url: "https://www.cgrcinemas.fr/" },
    { match: ["kinepolis"], url: "https://kinepolis.be/", urls: { FR: "https://kinepolis.fr/", ES: "https://kinepolis.es/", NL: "https://kinepolis.nl/", DE: "https://kinepolis.de/", LU: "https://kinepolis.lu/" } },
    { match: ["cinesa"], url: "https://www.cinesa.es/" },
    { match: ["yelmo"], url: "https://www.yelmocines.es/" },
    { match: ["cinestar"], url: "https://www.cinestar.de/" },
    { match: ["cinemaxx"], url: "https://www.cinemaxx.de/" },
    { match: ["cineplex"], url: "https://www.cineplex.com/" },
    { match: ["hoyts"], url: "https://www.hoyts.com.au/" },
    { match: ["event cinemas"], url: "https://www.eventcinemas.com.au/" },
    { match: ["cinepolis"], url: "https://cinepolis.com/" },
    { match: ["cinemex"], url: "https://cinemex.com/" }
];

function plain(text) {
    return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Whole-word match, so "uci" doesn't hit "Lucia" and "vue" doesn't hit "Belvue".
function mentions(haystack, needle) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

function findChain(tags) {
    const haystack = plain([tags.brand, tags.operator, tags.name].filter(Boolean).join(" | "));
    return CINEMA_CHAINS.find((c) => c.match.some((m) => mentions(haystack, m))) || null;
}

function chainWebsite(chain, countryCode) {
    return chain ? (chain.urls && chain.urls[countryCode]) || chain.url : null;
}

// "Cinema NOS" or "UCI Cinemas" says only the chain; "Cinema NOS Alvaláxia"
// or "Cinema Ideal" already names the venue.
const GENERIC_CINEMA_WORDS = new Set(["cinema", "cinemas", "cine", "cines", "kino", "theatre", "theatres", "theater", "theaters", "movies", "the", "de", "do", "da"]);
function nameIsJustChain(name, chain) {
    let rest = plain(name);
    if (chain) chain.match.forEach((m) => { rest = rest.split(m).join(" "); });
    return rest.split(/[^a-z0-9]+/).every((w) => w.length <= 2 || GENERIC_CINEMA_WORDS.has(w));
}

function cleanWebsite(raw) {
    if (typeof raw !== "string") return null;
    let value = raw.trim().split(/[;\s]/)[0];
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getJson(url, userAgent) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": userAgent, Accept: "application/json" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("Request timed out")));
    });
}

// A cinema this close to a shopping centre's mapped centre is inside it.
const MALL_MATCH_KM = 0.25;

function mallAround(malls, lat, lon) {
    let best = null;
    let bestKm = MALL_MATCH_KM;
    for (const m of malls) {
        const km = distanceKm(lat, lon, m.lat, m.lon);
        if (km <= bestKm) {
            best = m.name;
            bestKm = km;
        }
    }
    return best;
}


async function geocodeCity(city, countryCode, userAgent) {
    const params = new URLSearchParams({ format: "jsonv2", limit: "1", city, countrycodes: countryCode.toLowerCase() });
    const results = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, userAgent);
    const first = Array.isArray(results) ? results[0] : null;
    if (!first) return null;
    const lat = parseFloat(first.lat);
    const lon = parseFloat(first.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function queryOverpass(query, userAgent) {
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            return await getJson(`${endpoint}?data=${encodeURIComponent(query)}`, userAgent);
        } catch (err) {
            lastError = err; // busy or down: try the next public instance
        }
    }
    throw lastError || new Error("No Overpass endpoint answered");
}

// Returns [{ id, name, label, url, urlSource: "cinema"|"chain"|null, distanceKm }]
// sorted nearest first.
async function fetchCinemas(countryCode, city, appVersion) {
    const userAgent = `Riftgate/${appVersion} (https://github.com/Raidex81/Riftgate)`;
    const center = await geocodeCity(city, countryCode, userAgent);
    if (!center) return [];

    // Shopping centres come along so a multiplex can be named by the mall
    // it's in: OpenStreetMap often calls five different venues just
    // "Cinema NOS", and "Cinema NOS — NorteShopping" is what people know.
    const around = `(around:${CINEMA_RADIUS_METERS},${center.lat},${center.lon})`;
    const query = `[out:json][timeout:25];(nwr["amenity"="cinema"]${around};nwr["shop"="mall"]${around};);out center tags;`;
    const data = await queryOverpass(query, userAgent);
    const elements = (data && data.elements) || [];
    const position = (el) => ({ lat: el.lat ?? (el.center && el.center.lat), lon: el.lon ?? (el.center && el.center.lon) });
    const malls = elements
        .filter((el) => el.tags && el.tags.shop === "mall" && typeof el.tags.name === "string" && el.tags.name.trim())
        .map((el) => ({ name: el.tags.name.trim().slice(0, 80), ...position(el) }))
        .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon));

    const cinemas = [];
    for (const el of elements) {
        const tags = el.tags || {};
        if (tags.amenity !== "cinema") continue;
        const name = typeof tags.name === "string" ? tags.name.trim().slice(0, 120) : "";
        if (!name) continue;
        const { lat, lon } = position(el);
        const located = Number.isFinite(lat) && Number.isFinite(lon);
        const own = cleanWebsite(tags.website || tags["contact:website"] || tags.url);
        const chainInfo = findChain(tags);
        const chain = own ? null : chainWebsite(chainInfo, countryCode);
        cinemas.push({
            id: `osm-${el.type}-${el.id}`,
            name,
            // Only a name that says nothing but the chain gets its mall added:
            // an independent next door to a shopping centre isn't inside it.
            mall: located && nameIsJustChain(name, chainInfo) ? mallAround(malls, lat, lon) : null,
            area: String(tags["addr:suburb"] || tags["addr:place"] || "").slice(0, 80),
            url: own || chain,
            urlSource: own ? "cinema" : chain ? "chain" : null,
            distanceKm: located ? Math.round(distanceKm(center.lat, center.lon, lat, lon) * 10) / 10 : null
        });
    }

    // The same venue is sometimes mapped twice (a building and a point).
    const unique = [];
    for (const c of cinemas) {
        const twin = unique.find((u) => plain(u.name) === plain(c.name) && u.distanceKm !== null && c.distanceKm !== null && Math.abs(u.distanceKm - c.distanceKm) < 0.2);
        if (twin) {
            if (!twin.url && c.url) Object.assign(twin, { url: c.url, urlSource: c.urlSource });
            if (!twin.mall && c.mall) twin.mall = c.mall;
            continue;
        }
        unique.push(c);
    }

    // A chain-only name gets its shopping centre; several with the same
    // name and no mall fall back to the neighbourhood (the picker also
    // shows each one's distance).
    const counts = new Map();
    unique.forEach((c) => counts.set(plain(c.name), (counts.get(plain(c.name)) || 0) + 1));
    unique.forEach((c) => {
        const shared = counts.get(plain(c.name)) > 1;
        if (c.mall) c.label = `${c.name} — ${c.mall}`;
        else if (shared && c.area && !plain(c.name).includes(plain(c.area))) c.label = `${c.name} — ${c.area}`;
        else c.label = c.name;
        delete c.mall;
        delete c.area;
    });

    unique.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return unique;
}

module.exports = { fetchCinemas, CINEMA_CHAINS };
