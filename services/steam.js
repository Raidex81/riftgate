// Steam Store / SteamSpy API calls — availability/delisting checks, VR
// classification, and the two ways of discovering free games (SteamSpy
// tag search, and Steam's own bulk store search used only on first run).
// Local Steam library scanning (finding installed games on disk) is a
// different concern and stays in main.js — this is only the web API
// surface. Caching and the overall refresh orchestration
// (fetchSteamFreeGames) also stay in main.js, since they're tied to
// main.js's local cache files, not to Steam itself.
const { httpsGetJsonPlain, httpsGetTextPlain } = require("./http");

// Steam's appdetails response carries a "categories" array of store-page
// badges — things like "Single-player", "Steam Achievements", "VR Only",
// "VR Supported". checkSteamAppAvailability already fetches this exact
// response for every game it verifies, so reading VR support out of it is
// free — no extra request. "VR Only" means a headset is required to play
// at all (native VR); "VR Supported" means an ordinary flatscreen game
// that ALSO works in VR (adapted). Neither, or unrecognized data, is null.
function categorizeSteamVrSupport(categories) {
    if (!Array.isArray(categories)) return null;
    const descriptions = categories.map((c) => (c && c.description ? String(c.description).toLowerCase() : ""));
    if (descriptions.some((d) => d.includes("vr only"))) return "native";
    if (descriptions.some((d) => d.includes("vr support"))) return "adapted";
    return null;
}

// freegames-vr.json entries were originally a bare vr string per appid;
// they're now a {vr, releaseDate} object so the same cache/appdetails
// fetch can carry both. These two accessors read either shape so an
// existing user's on-disk cache from before releaseDate existed keeps
// working instead of losing its already-learned VR data on upgrade.
function getSteamVr(entry) {
    if (!entry) return null;
    return typeof entry === "string" ? entry : entry.vr || null;
}

function getSteamReleaseDate(entry) {
    if (!entry || typeof entry === "string") return null;
    return entry.releaseDate || null;
}

// Steam has two independent ways a "free" game can stop being real, and
// only checking one of them was exactly what let delisted titles like
// Need For Speed: Hot Pursuit keep showing up here: appdetails' own
// "success" flag catches an appid that's fully gone (the request
// redirects/fails), but far more often the store PAGE still loads fine
// (so appdetails keeps returning success:true with the game's old data)
// while showing a "Notice: <game> is no longer available on the Steam
// store" banner instead of a buy button. That banner only ever exists in
// the page's actual HTML — Steam's public API has no field for it — so
// it has to be checked for directly.
// Returns { show: boolean, delisted: boolean }. "delisted" (the store
// page/listing itself is gone) is permanent — once true, this appid is
// blacklisted for good, since a genuinely removed listing never comes
// back. "show: false, delisted: false" means the opposite: the listing
// is still perfectly real, it's just not priced at $0 right now (a
// limited-time promo ending is the common case) — this should only ever
// exclude it from THIS refresh's output, never a permanent blacklist,
// since the exact same title can legitimately go free again later (a
// future promo, a different giveaway) and needs to be able to reappear
// once SteamSpy/Steam's own data reflects that.
async function checkSteamAppAvailability(appid) {
    let apiAvailable = true;
    let stillFree = true;
    let vr = null;
    let releaseDate = null;
    try {
        // No filters=basic here on purpose — "basic" trims the response
        // down far enough that it drops is_free, which is exactly the
        // field this needs: SteamSpy's own price field (used to build the
        // initial list) can lag behind a limited-time promo ending, so a
        // title that flipped back to paid stayed listed as free here
        // until this specific check actually asked Steam's own data for
        // its current price instead of just whether the page still loads.
        const detail = await httpsGetJsonPlain(`https://store.steampowered.com/api/appdetails?appids=${appid}`, 10000);
        const entry = detail && detail[appid];
        apiAvailable = !!(entry && entry.success);
        if (apiAvailable && entry.data) {
            stillFree = entry.data.is_free === true;
            vr = categorizeSteamVrSupport(entry.data.categories);
            // Same reasoning as VR above — release_date rides along on this
            // same appdetails response for free, no extra request. Only
            // kept when Steam has an actual date (coming_soon means the
            // date field is empty/placeholder).
            if (entry.data.release_date && !entry.data.release_date.coming_soon && entry.data.release_date.date) {
                releaseDate = entry.data.release_date.date;
            }
        }
    } catch (err) {
        // A failed/timed-out request confirms nothing either way — treat
        // as available/free so a network hiccup can never masquerade as a
        // delisting or a price change.
        apiAvailable = true;
        stillFree = true;
    }

    if (!apiAvailable) return { show: false, delisted: true, vr, releaseDate };
    if (!stillFree) return { show: false, delisted: false, vr, releaseDate };

    try {
        const page = await httpsGetTextPlain(`https://store.steampowered.com/app/${appid}/?l=english`, 10000);
        if (page.statusCode === 200 && /is no longer available on the steam store/i.test(page.body)) {
            return { show: false, delisted: true, vr, releaseDate };
        }
    } catch (err) {
        // Same reasoning as above — an unreadable page proves nothing.
    }

    return { show: true, delisted: false, vr, releaseDate };
}

// First-run-only helper: Steam's own store search (the /search/results/
// endpoint the storefront's search box itself calls) supports filtering
// directly by live price (maxprice=free) and by type (category1=998 =
// Games, so DLC/software/soundtracks are excluded up front). That's a
// completely different endpoint from the "storesearch" autocomplete API
// mentioned above — this one is the real catalog browser and happily
// returns everything that matches, paginated 100 at a time. Since every
// result already reflects Steam's CURRENT price, none of them need the
// slow one-by-one appdetails/store-page verification pass that the
// normal SteamSpy-tag-based path still needs — this is only ever used
// once, on the very first run the app has ever had, specifically to
// avoid that huge first-time verification backlog.
async function fetchSteamFreeGamesBulkSearch() {
    const results = [];
    const seen = new Set();
    const PAGE_SIZE = 100;
    const MAX_PAGES = 60; // generous cap, well beyond how many free Steam games actually exist
    const rowRe = /data-ds-appid="(\d+)"[\s\S]*?<span class="title">([^<]*)<\/span>/g;

    for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * PAGE_SIZE;
        const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=${PAGE_SIZE}&maxprice=free&category1=998&infinite=1`;
        let data;
        try {
            data = await httpsGetJsonPlain(url, 15000);
        } catch (err) {
            console.error(`[free-games] Bulk Steam search request failed at start=${start}:`, err.message || err);
            break;
        }

        const html = (data && data.results_html) || "";
        if (!html) break;

        rowRe.lastIndex = 0;
        let match;
        let foundOnPage = 0;
        while ((match = rowRe.exec(html)) !== null) {
            const appid = match[1];
            foundOnPage++;
            if (seen.has(appid)) continue;
            seen.add(appid);
            const name = (match[2] || "").trim() || `App ${appid}`;
            results.push({ appid, name, price: "0" });
        }

        if (foundOnPage < PAGE_SIZE) break; // last page reached

        // Small courteous pause between pages — far fewer requests total
        // than the per-item verification loop this replaces ever needed.
        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    console.log(`[free-games] Bulk Steam search (first run): found ${results.length} free game(s) directly.`);
    return results;
}

// Turns a SteamSpy tag-entry's raw positive/negative review counts into a
// percent-positive figure — Steam's own review convention (e.g. "94%
// Positive"), rather than inventing a star scale for something that isn't
// scored that way. Requires a modest sample so a title with 2 reviews can't
// show a meaningless "100%"; returns null (badge just stays hidden) below
// that floor or when SteamSpy has no review data at all for this entry.
function computeSteamSpyRating(item) {
    const positive = Number(item && item.positive) || 0;
    const negative = Number(item && item.negative) || 0;
    const total = positive + negative;
    if (total < 10) return null;
    return Math.round((positive / total) * 100);
}

module.exports = {
    categorizeSteamVrSupport,
    getSteamVr,
    getSteamReleaseDate,
    checkSteamAppAvailability,
    fetchSteamFreeGamesBulkSearch,
    computeSteamSpyRating
};
