// Free-games web-API sourcing: Epic, GOG, GamerPower, itch.io, and the
// hand-curated "always free" list (League of Legends, Overwatch, War
// Thunder, etc. — titles distributed outside every store Riftgate can
// query live). Each fetcher here is a pure "call a URL, transform the
// result" function with no knowledge of main.js's own state.
//
// What deliberately stays in main.js instead: fetchSteamFreeGames (tied
// to main.js's on-disk verified/unavailable/VR caches and its Steam
// rate-limit batching — see services/steam.js's own header comment for
// the same reasoning), every readFreeGames*Cache/saveFreeGames*Cache
// function (main.js's disk-cache I/O), and mergeFreshCuratedGames (reads
// main.js's seen-cache). This mirrors the boundary services/steam.js
// already established: only the web-API surface moves out, caching and
// refresh orchestration stay put.
const { httpsGetJsonPlain, httpsGetTextPlain } = require("./http");

// Epic's own public promotions endpoint — the same one their launcher and
// many community tools use to show the current free games.
async function fetchEpicFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
        );

        const elements = data.data.Catalog.searchStore.elements || [];
        const now = Date.now();

        // Epic's structure is nested: each element has a list of "promotion
        // windows", and each window has its own inner list of offers with
        // a start/end date and a discount setting. The previous version
        // only checked whether the OUTER list was non-empty, which missed
        // games sitting in a shape it didn't expect and could just as
        // easily include one whose window had already ended — this checks
        // the actual dates and discount percentage, so it only includes
        // games that are genuinely free RIGHT NOW, and shouldn't miss any
        // that legitimately are.
        function isCurrentlyFree(el) {
            const windows = (el.promotions && el.promotions.promotionalOffers) || [];
            for (const promoWindow of windows) {
                for (const offer of promoWindow.promotionalOffers || []) {
                    const start = new Date(offer.startDate).getTime();
                    const end = new Date(offer.endDate).getTime();
                    const pct = offer.discountSetting && offer.discountSetting.discountPercentage;
                    if (pct === 0 && now >= start && now <= end) return true;
                }
            }
            return false;
        }

        return elements
            .filter(isCurrentlyFree)
            .map((el) => {
                const image = (el.keyImages || []).find(
                    (img) => img.type === "OfferImageWide" || img.type === "Thumbnail"
                );

                const tagNames = (el.tags || []).map((t) => t.name).filter(Boolean);

                return {
                    id: `epic-${el.id}`,
                    name: el.title,
                    description: el.description || null,
                    image: image ? image.url : null,
                    url: `https://store.epicgames.com/en-US/p/${(el.productSlug || el.urlSlug || "").replace(/\/home$/, "")}`,
                    source: "Epic Games",
                    tags: tagNames,
                    // Epic's own tag list occasionally includes "VR" outright
                    // for a promo giveaway built for VR — no way to tell
                    // native vs. adapted from this data, but a VR-tagged
                    // free giveaway is virtually always a native VR title.
                    vr: tagNames.some((t) => /^vr$|virtual reality/i.test(t)) ? "native" : null
                };
            });
    } catch (err) {
        console.error("[free-games] Epic fetch failed:", err.message || err);
        return [];
    }
}

// GOG's modern storefront (the React-based site) calls this catalog API
// directly — the old www.gog.com/games/ajax/filtered endpoint used
// previously appears to have stopped returning results reliably.
async function fetchGogFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://catalog.gog.com/v1/catalog?limit=48&order=desc:trending&productType=in:game&price=between:0,0&countryCode=US&locale=en-US&currencyCode=USD",
            10000
        );

        const products = data.products || [];

        // Defensive price check, same reasoning as Steam's — only exclude
        // an item if we can positively confirm it's NOT free, since we
        // can't be fully certain of GOG's exact field shape without live
        // testing; anything ambiguous is kept rather than dropped.
        const genuinelyFree = products.filter((p) => {
            const amount = p.price && p.price.final && p.price.final.amount;
            if (amount === undefined) return true;
            return parseFloat(amount) === 0;
        });

        console.log(`[free-games] GOG: found ${products.length} results, ${genuinelyFree.length} confirmed free.`);

        // GOG's catalog API doesn't expose a reliable VR flag the way
        // Steam's appdetails categories do — genuinely detecting it here
        // would mean guessing at field names GOG has never documented, so
        // this is left null (unknown) rather than risk mislabeling. A GOG
        // VR title still shows up fine everywhere else, just not under the
        // cross-platform VR view.
        return genuinelyFree.map((p) => ({
            id: `gog-${p.id}`,
            name: p.title,
            description: null,
            image: p.coverHorizontal || p.coverVertical || null,
            url: p.slug ? `https://www.gog.com/en/game/${p.slug}` : "https://www.gog.com",
            source: "GOG",
            tags: [(p.genres && p.genres[0] && (p.genres[0].name || p.genres[0])) || "Other"],
            vr: null
        }));
    } catch (err) {
        console.error("[free-games] GOG fetch failed:", err.message || err);
        return [];
    }
}

function decodeHtmlEntities(str) {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

// GamerPower aggregates giveaways from many stores at once, including ones
// Riftgate already fetches natively with real availability verification
// (Steam/Epic/GOG) and itch.io (fetched separately below) — only entries
// for a platform with no dedicated fetcher of its own are kept here, so
// nothing ever shows twice and this never overrides the more carefully
// verified native result. If GamerPower currently has nothing for a given
// platform (Origin, Battle.net, etc. have never shown up in its data),
// that platform simply produces no entries here — no empty bucket is ever
// created for it.
async function fetchGamerPowerFreeGames() {
    try {
        const data = await httpsGetJsonPlain(
            "https://www.gamerpower.com/api/giveaways?type=game&sort-by=date",
            10000
        );

        const list = Array.isArray(data) ? data : (data && Array.isArray(data.giveaways) ? data.giveaways : []);
        const COVERED_PLATFORMS = ["steam", "epic games store", "gog", "itch.io", "itch"];

        return list
            .map((g) => {
                if (!g || g.status === "Expired") return null;
                if (g.type && g.type !== "Game") return null;

                const platformsRaw = (g.platforms || "").split(",").map((p) => p.trim()).filter(Boolean);
                const lower = platformsRaw.map((p) => p.toLowerCase());

                // Riftgate is a PC launcher — skip mobile-only/console-only
                // giveaways, which GamerPower also lists alongside PC ones.
                const isVrPlatform = lower.includes("vr");
                if (!lower.includes("pc") && !isVrPlatform) return null;

                const distinctPlatforms = platformsRaw.filter((p) => p.toLowerCase() !== "pc");
                const sourcePlatform = distinctPlatforms.find((p) => !COVERED_PLATFORMS.includes(p.toLowerCase()));
                if (!sourcePlatform) return null;

                const name = (g.title || "")
                    .replace(/\s*Giveaway\s*$/i, "")
                    .replace(/\s*\([^)]*\)\s*$/, "")
                    .trim() || g.title;

                return {
                    id: `gamerpower-${g.id}`,
                    name,
                    description: g.description || null,
                    image: g.image || g.thumbnail || null,
                    url: g.open_giveaway_url || g.gamerpower_url || "https://www.gamerpower.com",
                    source: sourcePlatform,
                    tags: [],
                    vr: isVrPlatform ? "native" : null
                };
            })
            .filter(Boolean);
    } catch (err) {
        console.error("[free-games] GamerPower fetch failed:", err.message || err);
        return [];
    }
}

// itch.io has no public discovery API — its "new & popular, free" browse
// page is plain server-rendered HTML (verified live), so this scrapes it
// directly. itch.io does NOT keep a fixed attribute order within a tag
// (href sometimes comes before class="...", sometimes after), so each
// anchor's attributes are captured as one blob and href/class are found
// independently inside it rather than assuming either order.
// Shared scraper for any itch.io "free games" listing page — the general
// new-and-popular list and the dedicated VR-tag list have identical markup,
// just a different URL and a different fixed vr value for everything found
// on that page (itch.io's own tag browsing doesn't return per-game
// metadata beyond title/url/image, so vr is set by the caller rather than
// detected here).
async function fetchItchFreeGamesFromPage(url, vr) {
    try {
        const page = await httpsGetTextPlain(url, 10000);
        if (page.statusCode !== 200) {
            throw new Error(`HTTP ${page.statusCode}`);
        }

        // The trailing space in the delimiter below is load-bearing, not
        // cosmetic — every real cell's wrapper div is `class="game_cell
        // has_cover lazy_images"` (the class list always continues after a
        // space), but itch.io also nests two OTHER elements inside that same
        // div whose class names happen to start with the same "game_cell"
        // prefix with no space: `class="game_cell_tools"` (the "add to
        // collection" button) and `class="game_cell_data"`. Splitting on the
        // bare `class="game_cell` (no trailing space) matched those too,
        // fracturing a single real cell into multiple pieces right between
        // its cover image and its title link — the image ended up alone in
        // one piece with no title (silently dropped by the `!title` check
        // below) while the title ended up alone in the next piece with no
        // image, so this returned a title for every game but `image: null`
        // for literally all of them, no matter what URL they pointed to.
        // Requiring the space after "game_cell" only matches the real
        // wrapper div, never the two nested lookalikes.
        const cells = page.body.split('class="game_cell ').slice(1);
        const games = [];

        for (const chunk of cells) {
            const anchorRegex = /<a\b([^>]*)>([^<]*)<\/a>/g;
            let title = null;
            let gameUrl = null;
            let m;
            while ((m = anchorRegex.exec(chunk))) {
                if (!/class="title game_link"/.test(m[1])) continue;
                const hrefMatch = m[1].match(/href="([^"]+)"/);
                if (!hrefMatch) continue;
                title = decodeHtmlEntities(m[2].trim());
                gameUrl = hrefMatch[1];
                break;
            }
            if (!title || !gameUrl) continue;

            const imageMatch = chunk.match(/data-lazy_src="([^"]+)"/);

            games.push({
                id: "itch-" + gameUrl.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
                name: title,
                description: null,
                image: imageMatch ? imageMatch[1] : null,
                url: gameUrl,
                source: "itch.io",
                tags: [],
                vr: vr || null
            });
        }

        return games.slice(0, 48);
    } catch (err) {
        console.error(`[free-games] itch.io fetch failed (${url}):`, err.message || err);
        return [];
    }
}

async function fetchItchFreeGames() {
    const games = await fetchItchFreeGamesFromPage("https://itch.io/games/new-and-popular/free", null);
    console.log(`[free-games] itch.io: found ${games.length} free games.`);
    return games;
}

// itch.io's own "VR" tag, scoped to free games — a completely separate
// listing page from the general new-and-popular one above, so it needs its
// own fetch rather than being derived from the same data. Every game
// itch.io files under this tag was built specifically for VR (itch has no
// "flatscreen game that also happens to support VR" distinction the way
// Steam does), so all of these come back tagged "native".
async function fetchItchVrFreeGames() {
    const games = await fetchItchFreeGamesFromPage("https://itch.io/games/free/tag-vr", "native");
    console.log(`[free-games] itch.io VR: found ${games.length} free VR game(s).`);
    return games;
}

// Battle.net (Blizzard), EA/EA App, Riot Games, and Ubisoft Connect all
// have well-known, permanently free-to-play titles, but none of them
// expose a public "what's free right now" API the way Epic/Steam/
// GamerPower do — Ubisoft's and EA's own free-to-play pages are
// JS-rendered storefronts with no stable public endpoint, and Blizzard
// doesn't publish one at all. Per Alfredo's explicit request, these are
// hand-curated instead of skipped. Every title below was checked against
// that publisher's own current site (or, for Battle.net, a dedicated
// tracker cross-referencing Blizzard's own statements) at the time this
// was written, and only genuinely, PERMANENTLY free-to-play titles are
// included — never a time-limited promo, and never a game that just has a
// free trial or demo. Unlike every other source in this file, a static
// list can't self-correct if a title's free status ever changes, so this
// is the one place that needs occasional manual upkeep.
//
// There's no live signal to score popularity against for any of these
// (see popularityFromRank/popularityFromValue above), so every entry gets
// the same flat, deliberately high score instead of a fabricated ranking
// — every title on this list is a genuinely major, globally-known release
// (League of Legends, Valorant, Overwatch, Apex Legends, etc.), so a high
// flat baseline is more honest than pretending to rank them precisely
// against each other.
const CURATED_ALWAYS_FREE_POPULARITY = 85;

function getCuratedAlwaysFreeGames() {
    return [
        // Battle.net (Blizzard) — every family in Battle.net's current
        // catalog was checked live against its own shop/product page (Sept
        // 2026); this is the complete result, not a partial pass. Free:
        // Overwatch, Hearthstone, Diablo Immortal, Heroes of the Storm
        // (fully free since launch, simply missed earlier), StarCraft II's
        // base game (Wings of Liberty campaign + multiplayer + co-op, free
        // since Nov 2017 — only the Heart of the Swarm/Legacy of the Void
        // "Campaign Collection" costs anything), the original StarCraft
        // (base game AND the Brood War expansion, both included in the free
        // "StarCraft" tier — only the graphically-upgraded "Remastered" and
        // "Cartooned" tiers of the same product cost money), and Call of
        // Duty: Warzone (a genuinely standalone download, not a mode gated
        // behind a paid Call of Duty purchase). Checked and confirmed NOT
        // free, despite each having a tier that could be mistaken for one:
        // World of Warcraft (the "free trial" is time/level-capped, not the
        // genuine article), World of Warcraft Classic (needs an active
        // subscription), Diablo, Diablo II, Diablo III (also only a capped
        // "Try For Free" trial, not the real game), Diablo IV, and every
        // Warcraft RTS title (Orcs & Humans, II, III/Reforged, and their
        // Remastered/Battle Chest editions) — none of them has a genuinely
        // free tier the way StarCraft's classic version does.
        {
            id: "curated-battlenet-overwatch",
            name: "Overwatch",
            description: "Blizzard's team-based hero shooter — free to play in full, monetized only through optional cosmetics and battle passes.",
            image: "https://blz-contentstack-images.akamaized.net/v3/assets/blt2477dcaf4ebd440c/blt45586c965db08717/6823abc24dee72d806fff5e2/OpenGraph.jpg",
            url: "https://overwatch.blizzard.com/en-us/",
            source: "Battle.net",
            releaseDate: "2016",
            tags: ["Shooter"]
        },
        {
            id: "curated-battlenet-hearthstone",
            name: "Hearthstone",
            description: "Blizzard's digital collectible card game — free to play, with optional card packs to speed up collecting.",
            image: "https://d39zum0jwvcigt.cloudfront.net/_next/static/images/default-475d770302527dbab7708dca2af05afd.jpg",
            url: "https://hearthstone.blizzard.com/en-us/",
            source: "Battle.net",
            releaseDate: "2014",
            tags: ["Card Game"]
        },
        {
            id: "curated-battlenet-diablo-immortal",
            name: "Diablo Immortal",
            description: "A full Diablo action-RPG built for free play — the complete campaign and core gameplay loop cost nothing, separate from the paid Diablo 4.",
            image: "https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt47deaa9e2be4b752/6a1f4beaeb54a6907d694fb8/DI_Warlock_OG-Image@2x_enUS.jpg",
            url: "https://diabloimmortal.blizzard.com/en-us/",
            source: "Battle.net",
            releaseDate: "2022",
            tags: ["RPG"]
        },
        {
            id: "curated-battlenet-heroes-of-the-storm",
            name: "Heroes of the Storm",
            description: "Blizzard's team brawler MOBA, starring heroes and villains from across the Warcraft, StarCraft, and Diablo universes — free to play, now in permanent maintenance mode with no new content but fully playable.",
            image: "https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/blt8c01f980b76eb350/67ce291560fcdc2c6cfed487/og_image.webp",
            url: "https://heroesofthestorm.blizzard.com/en-us/",
            source: "Battle.net",
            releaseDate: "2015",
            tags: ["MOBA"]
        },
        {
            id: "curated-battlenet-starcraft-2",
            name: "StarCraft II",
            description: "Blizzard's real-time strategy classic — the Wings of Liberty base campaign, full multiplayer, and co-op have been free to play since 2017. Only the Heart of the Swarm/Legacy of the Void expansion campaigns cost extra.",
            image: "https://blz-contentstack-images.akamaized.net/v3/assets/blt9c12f249ac15c7ec/bltbe2068a317e02d9f/6966bac0fb2fd910dbda4a26/og_image.webp",
            url: "https://starcraft2.blizzard.com/en-us/",
            source: "Battle.net",
            releaseDate: "2010",
            tags: ["Strategy"]
        },
        {
            id: "curated-battlenet-starcraft",
            name: "StarCraft",
            description: "Blizzard's original 1998 real-time strategy classic — includes the full campaign and the Brood War expansion, both free to play in their original (non-Remastered) form.",
            image: "https://blz-contentstack-images.akamaized.net/v3/assets/bltf408a0557f4e4998/blt2677c62b90f6fa37/612546ec23c35625084478ac/9458-47270.png",
            url: "https://starcraft.blizzard.com/en-us",
            source: "Battle.net",
            releaseDate: "1998",
            tags: ["Strategy"]
        },
        {
            id: "curated-battlenet-cod-warzone",
            name: "Call of Duty: Warzone",
            description: "Call of Duty's standalone free-to-play battle royale — playable through the Battle.net app with no other Call of Duty purchase required.",
            image: "https://imgs.callofduty.com/content/dam/atvi/callofduty/cod-touchui/warzone2/blackops7/evergreen/WZ_LP-Update_Meta.webp",
            url: "https://www.callofduty.com/warzone",
            source: "Battle.net",
            releaseDate: "2020",
            tags: ["Battle Royale"]
        },

        // EA / EA App (Origin) — Apex Legends is EA's flagship permanently
        // free PC title. EA's other officially-listed free-to-play games
        // (FC Mobile, Star Wars: Galaxy of Heroes) are mobile-only, so
        // they're left off a PC launcher's list.
        {
            id: "curated-ea-apex-legends",
            name: "Apex Legends",
            description: "EA's free-to-play battle royale — pick a legend and fight to be the last squad standing.",
            image: "https://media.contentapi.ea.com/content/dam/eacom/images/2019/02/apex-hero-medium-eacom-free-games-7x2-xl.jpg.adapt.crop3x5.320w.jpg",
            url: "https://www.ea.com/games/apex-legends",
            source: "EA",
            releaseDate: "2019",
            tags: ["Battle Royale"]
        },

        // Riot Games — every one of Riot's PC releases is permanently free
        // to play; there's no paid tier for any of them.
        {
            id: "curated-riot-league-of-legends",
            name: "League of Legends",
            description: "Riot's flagship 5v5 MOBA — free to play, with every champion earnable through normal play.",
            image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/565197caf987af4e4da307df6e2b235a28714736-837x469.jpg?accountingTag=LoL&w=1200&h=630&fm=webp&fit=crop&crop=center",
            url: "https://www.leagueoflegends.com/en-us/",
            source: "Riot Games",
            releaseDate: "2009",
            tags: ["MOBA"]
        },
        {
            id: "curated-riot-valorant",
            name: "VALORANT",
            description: "Riot's free-to-play tactical hero shooter.",
            image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/7b60e8bb6c1828831931dad87633604c2264fa26-3440x1020.jpg?accountingTag=VAL&auto=format&fit=fill&q=80&h=440",
            url: "https://playvalorant.com/en-us/",
            source: "Riot Games",
            releaseDate: "2020",
            tags: ["Shooter"]
        },
        {
            id: "curated-riot-tft",
            name: "Teamfight Tactics",
            description: "Riot's free-to-play auto-battler, set in the League of Legends universe.",
            image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/d63adacd93e313c1e61bbeb2eb37d8c4ca85848d-1920x1080.jpg?accountingTag=TFT&w=1200&h=630&fm=webp&fit=crop&crop=center",
            url: "https://teamfighttactics.leagueoflegends.com/en-us/",
            source: "Riot Games",
            releaseDate: "2019",
            tags: ["Strategy"]
        },
        {
            id: "curated-riot-legends-of-runeterra",
            name: "Legends of Runeterra",
            description: "Riot's free-to-play collectible card game set in the League of Legends universe, pitting champions and regions of Runeterra against each other in fast, strategic duels.",
            image: "https://playruneterra.com/assets/ccc9b55ec5fec88d1a616e7dec4795282a3aba52/static/image/share-image.jpg",
            url: "https://playruneterra.com/en-us/",
            source: "Riot Games",
            releaseDate: "2020",
            tags: ["Card Game"]
        },
        {
            id: "curated-riot-2xko",
            name: "2XKO",
            description: "Riot's free-to-play 2v2 tag-team fighting game starring League of Legends champions, built around accessible combos and cross-platform online play.",
            image: "https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/0d8da14d9cc0c69376e8fb42cc6344276bf937ad-1200x600.jpg?accountingTag=2XKO?w=1200&h=630&fm=webp&fit=crop&crop=center",
            url: "https://2xko.riotgames.com/en-us/",
            source: "Riot Games",
            releaseDate: "2026",
            tags: ["Fighting"]
        },

        // Ubisoft Connect — pulled straight from Ubisoft's own live
        // "Free to Play" page (ubisoft.com/en-us/games/free); titles,
        // links and cover images all verified directly against it.
        {
            id: "curated-ubisoft-brawlhalla",
            name: "Brawlhalla",
            description: "Ubisoft's free-to-play platform fighter, cross-play across every platform.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/5UmjmHnuHsCtRZMCNyWg0k/d90be8ba795837385ccd8784e9f51e3d/bwl_keyart-gamecard__2_.jpg?imwidth=360",
            url: "https://register.ubisoft.com/brawlhalla-free",
            source: "Ubisoft Connect",
            releaseDate: "2017",
            tags: ["Fighting"]
        },
        {
            id: "curated-ubisoft-roller-champions",
            name: "Roller Champions",
            description: "Ubisoft's free-to-play team sport — skate, pass, and score in a full-contact rollerskating arena.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/7eA295Gbsyn8ydRdJmRCM/f9952315a8fa57d52d3942d212c7f4fa/Boxart_341x450.jpg?imwidth=360",
            url: "https://rollerchampions.com/download",
            source: "Ubisoft Connect",
            releaseDate: "2023",
            tags: ["Sports"]
        },
        {
            id: "curated-ubisoft-trackmania",
            name: "Trackmania",
            description: "Ubisoft's free-to-play arcade racer — Starter Access is free forever.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/1Uc4fQDNodTnBRDqQi2n1r/aea1351df0a91e52325aacb528d4cc1f/tm-boxshot.jpg?imwidth=360",
            url: "https://register.ubisoft.com/trackmania",
            source: "Ubisoft Connect",
            releaseDate: "2020",
            tags: ["Racing"]
        },
        {
            id: "curated-ubisoft-rabbids-coding",
            name: "Rabbids Coding",
            description: "Ubisoft's free game that teaches real programming logic using the Rabbids.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/7I7Q8banzwVxEwMDPfIQHH/4d139e3bde5a3fc0c2076a13c13c5e96/Product_Page_Packshot_464x608_EN.jpg?imwidth=360",
            url: "https://register.ubisoft.com/rabbids-coding",
            source: "Ubisoft Connect",
            releaseDate: "2019",
            tags: ["Educational"]
        },
        {
            id: "curated-ubisoft-division-resurgence",
            name: "The Division Resurgence",
            description: "Ubisoft's free-to-play entry in The Division universe — solo or co-op in a shared open world.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/5yJHcf0MD74zeLthxoSEdN/ff8d96081bac8fda1196beb50e495ece/TDM_KEYART.jpg",
            url: "https://register.ubisoft.com/the-division-resurgence",
            source: "Ubisoft Connect",
            tags: ["Shooter"]
        },
        {
            id: "curated-ubisoft-battlecore-arena",
            name: "BattleCore Arena",
            description: "Ubisoft's free-to-play hero shooter.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/1bsdTEbSIrToINLUPiU0TD/7f8a26a4ce3e62d629f6c08439a02444/BCA_Packshot.jpg?imwidth=360",
            url: "https://battlecorearena.com/",
            source: "Ubisoft Connect",
            tags: ["Shooter"]
        },
        {
            id: "curated-ubisoft-rocksmith-plus",
            name: "Rocksmith+",
            description: "Ubisoft's free-to-try guitar and bass learning app.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/1k4oo2ekPcs0VLFkUxCHZP/a443aef524eb668032bb3076c0cc7f33/rsplus-game_info-boxart-keyart-02-348x434.jpg?imwidth=360",
            url: "https://rocksmith.com/free_uco",
            source: "Ubisoft Connect",
            releaseDate: "2023",
            tags: ["Music"]
        },
        {
            id: "curated-ubisoft-growtopia",
            name: "Growtopia",
            description: "Ubisoft's free-to-play sandbox MMO — build, farm, and trade in a fully player-created world.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/6bvLvl9L19tj4bN0fEpx7o/23644f262dc50a3739b8a48f7f86a248/growtopia.jpg?imwidth=360",
            url: "https://register.ubisoft.com/Growtopia-free",
            source: "Ubisoft Connect",
            releaseDate: "2013",
            tags: ["Sandbox"]
        },
        {
            id: "curated-ubisoft-r6-siege",
            name: "Rainbow Six Siege",
            description: "Ubisoft's tactical shooter — the base game is now available with permanent Free Access.",
            image: "https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/1WpJrasPLQBD7v8YTBPO3Y/a755a438093342339d74f909bde9e828/R6_KEYART_960x540__1_.jpg",
            url: "https://rainbow6.com/freeaccess",
            source: "Ubisoft Connect",
            releaseDate: "2015",
            tags: ["Shooter"]
        },

        // Epic Games Store's own permanently-free titles — verified live
        // against their individual store pages (Sept 2026), each showing
        // "Base Game / Free". These never appear via fetchEpicFreeGames()
        // above, because that only reads Epic's freeGamesPromotions feed
        // (the rotating weekly giveaways) — a title that's ALWAYS free
        // isn't a "promotion" and never shows up in that feed at all.
        // Tagged source "Epic Games" so they fold into the same platform
        // row as the weekly freebies rather than getting their own.
        {
            id: "curated-epic-fortnite",
            name: "Fortnite",
            description: "Epic's own battle royale (plus Zero Build, Festival, LEGO Fortnite, and more) — the base game is permanently free.",
            image: "https://cdn1.epicgames.com/offer/fn/FNBR_42-00_C7S4_Hacking_Logo_EGS_Launcher_Blade_2560x1440_2560x1440-2a1fdbde46f54d0d88b8662808fd592f",
            url: "https://store.epicgames.com/en-US/p/fortnite",
            source: "Epic Games",
            releaseDate: "2017",
            tags: ["Battle Royale"]
        },
        {
            id: "curated-epic-rocket-league",
            name: "Rocket League",
            description: "Psyonix's car-soccer hybrid, published by Epic — the base game is permanently free.",
            image: "https://cdn1.epicgames.com/offer/9773aa1aa54f4f7b80e44bef04986cea/EGS_RocketLeague_PsyonixLLC_S1_2560x1440-1a37e26b20fb4f3ebd825e64bc7914eb",
            url: "https://store.epicgames.com/en-US/p/rocket-league",
            source: "Epic Games",
            releaseDate: "2015",
            tags: ["Sports"]
        },
        {
            id: "curated-epic-fall-guys",
            name: "Fall Guys",
            description: "Mediatonic's massively-multiplayer party royale, published by Epic — the base game is permanently free.",
            image: "https://cdn1.epicgames.com/offer/50118b7f954e450f8823df1614b24e80/FGSS04_KeyArt_OfferImageLandscape_2560x1440_2560x1440-89c8edd4ffe307f5d760f286a28c3404",
            url: "https://store.epicgames.com/en-US/p/fall-guys",
            source: "Epic Games",
            releaseDate: "2020",
            tags: ["Party"]
        },

        // Wargaming.net Game Center — Wargaming's own launcher, separate
        // from Steam, for its three permanently free-to-play military
        // MMOs. Verified live against each game's own homepage (Sept 2026).
        {
            id: "curated-wargaming-world-of-tanks",
            name: "World of Tanks",
            description: "Wargaming's free-to-play tank MMO — command armor from both World War eras in massive online battles.",
            image: "https://worldoftanks.com/static/6.16.0_bbf399/common/img/wot_artboard.png",
            url: "https://worldoftanks.com/en/",
            source: "Wargaming.net",
            releaseDate: "2010",
            tags: ["MMO"]
        },
        {
            id: "curated-wargaming-world-of-warships",
            name: "World of Warships",
            description: "Wargaming's free-to-play naval MMO — command historic warships in massive online battles.",
            image: "https://worldofwarships.com/dcont/fb/image/d3f0840e-8587-11ef-9aab-005056902a5f.jpg",
            url: "https://worldofwarships.com/en/",
            source: "Wargaming.net",
            releaseDate: "2015",
            tags: ["MMO"]
        },
        {
            id: "curated-wargaming-world-of-warplanes",
            name: "World of Warplanes",
            description: "Wargaming's free-to-play aerial combat MMO.",
            image: "https://worldofwarplanes.com/static/1.22.0/common/img/world-of-warplanes_social.jpg",
            url: "https://worldofwarplanes.com/en/",
            source: "Wargaming.net",
            releaseDate: "2013",
            tags: ["MMO"]
        },
        {
            id: "curated-wargaming-world-of-tanks-blitz",
            name: "World of Tanks Blitz",
            description: "The free-to-play, cross-platform companion to World of Tanks, built for shorter 7-vs-7 matches on PC, mobile, and consoles.",
            image: "https://wargaming.com/media/uploads/games/wotb/wotb_1920_1080.jpg",
            url: "https://wotblitz.com/",
            source: "Wargaming.net",
            releaseDate: "2014",
            tags: ["MMO"]
        },

        // Gaijin.net — Gaijin Entertainment's own launcher for its
        // permanently free-to-play combined-arms MMO.
        {
            id: "curated-gaijin-war-thunder",
            name: "War Thunder",
            description: "Gaijin's free-to-play combined-arms MMO — planes, tanks, and ships across historical battlegrounds.",
            image: "https://warthunder.com/i/opengraph-wt.jpg",
            url: "https://warthunder.com/en/",
            source: "Gaijin.net",
            releaseDate: "2012",
            tags: ["MMO"]
        },
        {
            id: "curated-gaijin-enlisted",
            name: "Enlisted",
            description: "Gaijin's free-to-play squad-based WWII shooter, commanding AI soldiers alongside other players across historic battlefronts.",
            image: "https://enlisted.net/i/enl-opengraph.jpg",
            url: "https://enlisted.net/en/",
            source: "Gaijin.net",
            releaseDate: "2021",
            tags: ["Shooter"]
        },
        {
            id: "curated-gaijin-crossout",
            name: "Crossout",
            description: "Gaijin's free-to-play vehicular combat MMO — build armed, armored vehicles from scavenged parts and battle other players in a post-apocalyptic wasteland.",
            image: "https://patchnotes.cdn.gaijin.net/crossout/Images/main-kv.jpg",
            url: "https://crossout.net/en/",
            source: "Gaijin.net",
            releaseDate: "2017",
            tags: ["Action"]
        },

        // Grinding Gear Games — Path of Exile is free-to-play with no
        // paid tier for the core game (monetized via cosmetics/stash
        // space only), available via its own standalone client.
        {
            id: "curated-ggg-path-of-exile",
            name: "Path of Exile",
            description: "Grinding Gear Games' free-to-play action-RPG — the full game and all content updates are free, monetized only through cosmetics.",
            image: "https://web.poecdn.com/protected/image/favicon/ogimage.png?key=DDHQnVxwj0AxeMbsPiRoEQ",
            url: "https://www.pathofexile.com/",
            source: "Grinding Gear Games",
            releaseDate: "2013",
            tags: ["RPG"]
        },

        // Meta Quest -- Meta's own Quest/Horizon Store has no public API and
        // its web storefront is a JS-rendered app with nothing usable in the
        // raw HTML (same situation as EA/Ubisoft above), so this list is
        // hand-curated from Alfredo's own Quest library instead of live-fetched.
        // Grouped into genre subsections below purely for readability -- every
        // entry here still goes through the exact same alwaysFree/dedup handling
        // as every other curated platform. Alfredo checks these manually from
        // time to time to confirm they're still free; there's no automated
        // re-verification for this platform the way Steam gets.

        // --- Meta Quest: Museums & Culture ---
        {
            id: "curated-metaquest-kremer-collection-vr-museum",
            name: "The Kremer Collection VR Museum",
            description: "A virtual gallery of the Kremer Collection's Dutch and Flemish Golden Age paintings, walkable in VR the way the real collection is displayed.",
            image: "covers/meta-quest/kremer-collection-vr-museum.jpg",
            url: "https://www.google.com/search?q=The+Kremer+Collection+VR+Museum+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Museums & Culture"],
            vr: "native"
        },
        {
            id: "curated-metaquest-virtual-museum-de-fornaris",
            name: "Virtual Museum De Fornaris",
            description: "A VR walkthrough of the De Fornaris art museum's collection.",
            image: "covers/meta-quest/virtual-museum-de-fornaris.jpg",
            url: "https://www.google.com/search?q=Virtual+Museum+De+Fornaris+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Museums & Culture"],
            vr: "native"
        },
        {
            id: "curated-metaquest-anne-frank-house-vr",
            name: "Anne Frank House VR",
            description: "An official VR tour of the Anne Frank House in Amsterdam, recreating the rooms of the Secret Annex.",
            image: "covers/meta-quest/anne-frank-house-vr.jpg",
            url: "https://www.google.com/search?q=Anne+Frank+House+VR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Museums & Culture"],
            vr: "native"
        },

        // --- Meta Quest: Exploration & Travel ---
        {
            id: "curated-metaquest-google-earth-vr",
            name: "Google Earth VR",
            description: "Google's own VR viewer for exploring the entire planet -- cities, landmarks, and terrain -- at any scale.",
            image: "covers/meta-quest/google-earth-vr.jpg",
            url: "https://www.google.com/search?q=Google+Earth+VR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },
        {
            id: "curated-metaquest-notre-dame-de-paris-journey-back-in-time",
            name: "Notre-Dame de Paris: Journey Back in Time",
            description: "A VR reconstruction of Notre-Dame Cathedral across its history, including before and after the 2019 fire.",
            image: "covers/meta-quest/notre-dame-de-paris-journey-back-in-time.jpg",
            url: "https://www.google.com/search?q=Notre-Dame+de+Paris:+Journey+Back+in+Time+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },
        {
            id: "curated-metaquest-smithsonian-journeys-venice",
            name: "Smithsonian Journeys: Venice",
            description: "A Smithsonian-produced VR travelogue through Venice's canals and architecture.",
            image: "covers/meta-quest/smithsonian-journeys-venice.jpg",
            url: "https://www.google.com/search?q=Smithsonian+Journeys:+Venice+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },
        {
            id: "curated-metaquest-baalbek-reborn-temples",
            name: "Baalbek Reborn: Temples",
            description: "A digital reconstruction of the ancient Roman temple complex at Baalbek, Lebanon, in VR.",
            image: "covers/meta-quest/baalbek-reborn-temples.jpg",
            url: "https://www.google.com/search?q=Baalbek+Reborn:+Temples+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },
        {
            id: "curated-metaquest-oika",
            name: "Oika",
            description: "A calm VR relaxation space built around a campfire scene.",
            image: "covers/meta-quest/oika.jpg",
            url: "https://www.google.com/search?q=Oika+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },
        {
            id: "curated-metaquest-get-lost-in-nature-with-luke",
            name: "Get Lost In Nature With Luke",
            description: "A guided VR nature-walk relaxation experience.",
            image: "covers/meta-quest/get-lost-in-nature-with-luke.jpg",
            url: "https://www.google.com/search?q=Get+Lost+In+Nature+With+Luke+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Exploration & Travel"],
            vr: "native"
        },

        // --- Meta Quest: Documentaries & Stories ---
        {
            id: "curated-metaquest-1943-berlin-blitz",
            name: "1943 Berlin Blitz",
            description: "A BBC-produced VR documentary putting the viewer inside a WWII bombing raid over Berlin.",
            image: "covers/meta-quest/1943-berlin-blitz.jpg",
            url: "https://www.google.com/search?q=1943+Berlin+Blitz+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-easter-rising-voice-of-a-rebel",
            name: "Easter Rising: Voice of a Rebel",
            description: "A BBC VR docudrama following a fictionalized participant through Dublin's 1916 Easter Rising.",
            image: "covers/meta-quest/easter-rising-voice-of-a-rebel.jpg",
            url: "https://www.google.com/search?q=Easter+Rising:+Voice+of+a+Rebel+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-the-peoples-house",
            name: "The People's House",
            description: "An official VR tour of the White House with Barack and Michelle Obama.",
            image: "covers/meta-quest/the-peoples-house.jpg",
            url: "https://www.google.com/search?q=The+People's+House+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-rapid-fire-a-brief-history-of-flight",
            name: "Rapid Fire: a brief history of flight",
            description: "A VR documentary short covering the history of powered flight.",
            image: "covers/meta-quest/rapid-fire-a-brief-history-of-flight.jpg",
            url: "https://www.google.com/search?q=Rapid+Fire:+a+brief+history+of+flight+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-home-after-war",
            name: "Home After War",
            description: "An Emmy-nominated VR documentary following people rebuilding their lives after conflict.",
            image: "covers/meta-quest/home-after-war.jpg",
            url: "https://www.google.com/search?q=Home+After+War+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-traveling-while-black",
            name: "Traveling While Black",
            description: "An Emmy-nominated VR documentary on the Black American travel experience, centered on Washington D.C.'s Ben's Chili Bowl.",
            image: "covers/meta-quest/traveling-while-black.jpg",
            url: "https://www.google.com/search?q=Traveling+While+Black+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-the-book-of-distance",
            name: "The Book of Distance",
            description: "A VR documentary retelling the director's grandfather's immigration story through personal documents.",
            image: "covers/meta-quest/the-book-of-distance.jpg",
            url: "https://www.google.com/search?q=The+Book+of+Distance+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-henry",
            name: "Henry",
            description: "Oculus Story Studio's Emmy-winning animated VR short about a lonely hedgehog on his birthday.",
            image: "covers/meta-quest/henry.jpg",
            url: "https://www.google.com/search?q=Henry+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-invasion",
            name: "INVASION!",
            description: "Oculus Story Studio's Emmy-winning animated VR short about two rabbits encountering alien visitors.",
            image: "covers/meta-quest/invasion.jpg",
            url: "https://www.google.com/search?q=INVASION!+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-the-last-goodbye",
            name: "The Last Goodbye",
            description: "A VR documentary following a Holocaust survivor's return to the Majdanek concentration camp.",
            image: "covers/meta-quest/the-last-goodbye.jpg",
            url: "https://www.google.com/search?q=The+Last+Goodbye+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-lost",
            name: "Lost",
            description: "Oculus Story Studio's animated VR short about a lost robot searching a forest for its way home.",
            image: "covers/meta-quest/lost.jpg",
            url: "https://www.google.com/search?q=Lost+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-jurassic-world-blue",
            name: "Jurassic World: Blue",
            description: "An official Jurassic World VR experience, accompanying a raptor through Isla Nublar.",
            image: "covers/meta-quest/jurassic-world-blue.jpg",
            url: "https://www.google.com/search?q=Jurassic+World:+Blue+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-shelter-in-place",
            name: "Shelter in Place",
            description: "A narrative VR experience.",
            image: "covers/meta-quest/shelter-in-place.jpg",
            url: "https://www.google.com/search?q=Shelter+in+Place+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-experience-colorblindness",
            name: "eXPerience: Colorblindness",
            description: "A VR experience simulating color vision deficiency to build awareness of what colorblindness looks like.",
            image: "covers/meta-quest/experience-colorblindness.jpg",
            url: "https://www.google.com/search?q=eXPerience:+Colorblindness+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },
        {
            id: "curated-metaquest-introduction-to-virtual-reality",
            name: "Introduction to Virtual Reality",
            description: "A short onboarding VR experience introducing newcomers to what VR can do.",
            image: "covers/meta-quest/introduction-to-virtual-reality.jpg",
            url: "https://www.google.com/search?q=Introduction+to+Virtual+Reality+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Documentaries & Stories"],
            vr: "native"
        },

        // --- Meta Quest: Social & Multiplayer Worlds ---
        {
            id: "curated-metaquest-vrchat",
            name: "VRChat",
            description: "A free-to-play social VR platform with user-created worlds and avatars, cross-platform with its Steam release.",
            image: "covers/meta-quest/vrchat.jpg",
            url: "https://www.google.com/search?q=VRChat+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Social & Multiplayer Worlds"],
            vr: "native"
        },
        {
            id: "curated-metaquest-rec-room",
            name: "Rec Room",
            description: "A free-to-play social VR platform with user-made games and hangout spaces, cross-platform with its Steam release.",
            image: "covers/meta-quest/rec-room.jpg",
            url: "https://www.google.com/search?q=Rec+Room+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Social & Multiplayer Worlds"],
            vr: "native"
        },
        {
            id: "curated-metaquest-bigscreen-beta",
            name: "Bigscreen Beta",
            description: "A social VR app for watching movies, streaming desktops, and hanging out together in shared virtual rooms.",
            image: "covers/meta-quest/bigscreen-beta.jpg",
            url: "https://www.google.com/search?q=Bigscreen+Beta+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Social & Multiplayer Worlds"],
            vr: "native"
        },
        {
            id: "curated-metaquest-contraverse-expo",
            name: "Contraverse Expo",
            description: "A social VR expo space for browsing and demoing other VR titles.",
            image: "covers/meta-quest/contraverse-expo.jpg",
            url: "https://www.google.com/search?q=Contraverse+Expo+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Social & Multiplayer Worlds"],
            vr: "native"
        },

        // --- Meta Quest: Creativity & Tools ---
        {
            id: "curated-metaquest-open-brush",
            name: "Open Brush",
            description: "A free, open-source VR painting and 3D-sketching tool, the community-maintained successor to Google's Tilt Brush.",
            image: "covers/meta-quest/open-brush.jpg",
            url: "https://www.google.com/search?q=Open+Brush+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },
        {
            id: "curated-metaquest-gravity-sketch",
            name: "Gravity Sketch",
            description: "A free VR 3D design and modeling tool used for industrial design and collaborative sketching.",
            image: "covers/meta-quest/gravity-sketch.jpg",
            url: "https://www.google.com/search?q=Gravity+Sketch+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },
        {
            id: "curated-metaquest-quill-by-smoothstep",
            name: "Quill by Smoothstep",
            description: "A VR illustration and animation tool for painting and animating in 3D space.",
            image: "covers/meta-quest/quill-by-smoothstep.jpg",
            url: "https://www.google.com/search?q=Quill+by+Smoothstep+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },
        {
            id: "curated-metaquest-embodyme",
            name: "EmbodyMe",
            description: "A VR face-tracking avatar app.",
            image: "covers/meta-quest/embodyme.jpg",
            url: "https://www.google.com/search?q=EmbodyMe+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },
        {
            id: "curated-metaquest-wrench-engine-building-demo",
            name: "Wrench: Engine Building Demo",
            description: "A free demo of Wrench, a VR engine-building and mechanic simulator.",
            image: "covers/meta-quest/wrench-engine-building-demo.jpg",
            url: "https://www.google.com/search?q=Wrench:+Engine+Building+Demo+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },
        {
            id: "curated-metaquest-tribe-xr-dj-academy",
            name: "Tribe XR | DJ Academy",
            description: "A VR DJ-training app that teaches real DJ techniques on a simulated set of decks.",
            image: "covers/meta-quest/tribe-xr-dj-academy.jpg",
            url: "https://www.google.com/search?q=Tribe+XR+|+DJ+Academy+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Creativity & Tools"],
            vr: "native"
        },

        // --- Meta Quest: Media Players & Utilities ---
        {
            id: "curated-metaquest-deovr-rift",
            name: "DeoVR Rift",
            description: "A VR video player built for 180 degree/360 degree and VR-format video content.",
            image: "covers/meta-quest/deovr-rift.jpg",
            url: "https://www.google.com/search?q=DeoVR+Rift+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },
        {
            id: "curated-metaquest-playa-video-player",
            name: "PLAY'A Video Player",
            description: "A general-purpose VR video player.",
            image: "covers/meta-quest/playa-video-player.jpg",
            url: "https://www.google.com/search?q=PLAY'A+Video+Player+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },
        {
            id: "curated-metaquest-viveport-video",
            name: "Viveport Video",
            description: "HTC Viveport's VR video player app.",
            image: "covers/meta-quest/viveport-video.jpg",
            url: "https://www.google.com/search?q=Viveport+Video+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },
        {
            id: "curated-metaquest-steamvr",
            name: "SteamVR",
            description: "Valve's SteamVR runtime/companion app, used to run SteamVR-compatible PC VR titles from a Quest headset.",
            image: "covers/meta-quest/steamvr.jpg",
            url: "https://www.google.com/search?q=SteamVR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },
        {
            id: "curated-metaquest-blackbox",
            name: "Blackbox",
            description: "A minimalist puzzle-box VR app.",
            image: "covers/meta-quest/blackbox.jpg",
            url: "https://www.google.com/search?q=Blackbox+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },
        {
            id: "curated-metaquest-inlight-spark",
            name: "Inlight Spark",
            description: "A VR relaxation/ambient app set on the open water.",
            image: "covers/meta-quest/inlight-spark.jpg",
            url: "https://www.google.com/search?q=Inlight+Spark+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Media Players & Utilities"],
            vr: "native"
        },

        // --- Meta Quest: Puzzle, Board & Card Games ---
        {
            id: "curated-metaquest-magic-table-chess",
            name: "Magic Table Chess",
            description: "A VR chess app set at a virtual table, playable solo or against others.",
            image: "covers/meta-quest/magic-table-chess.jpg",
            url: "https://www.google.com/search?q=Magic+Table+Chess+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Puzzle, Board & Card Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-pokerstars-vegas-infinite",
            name: "PokerStars - Vegas Infinite",
            description: "PokerStars' free-to-play VR casino, with poker, slots, blackjack, roulette, and craps.",
            image: "covers/meta-quest/pokerstars-vegas-infinite.jpg",
            url: "https://www.google.com/search?q=PokerStars+-+Vegas+Infinite+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Puzzle, Board & Card Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-poker-vr",
            name: "Poker VR",
            description: "A free VR poker app with customizable player avatars.",
            image: "covers/meta-quest/poker-vr.jpg",
            url: "https://www.google.com/search?q=Poker+VR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Puzzle, Board & Card Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-arthur-owls-word-block",
            name: "Arthur Owl's Word Block",
            description: "A VR word-puzzle game.",
            image: "covers/meta-quest/arthur-owls-word-block.jpg",
            url: "https://www.google.com/search?q=Arthur+Owl's+Word+Block+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Puzzle, Board & Card Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-dillyminesweeper",
            name: "DillyMineSweeper",
            description: "A VR take on the classic Minesweeper puzzle.",
            image: "covers/meta-quest/dillyminesweeper.jpg",
            url: "https://www.google.com/search?q=DillyMineSweeper+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Puzzle, Board & Card Games"],
            vr: "native"
        },

        // --- Meta Quest: Fitness & Wellness ---
        {
            id: "curated-metaquest-tripp",
            name: "TRIPP",
            description: "A VR meditation and mindfulness app with guided sessions and generative visuals.",
            image: "covers/meta-quest/tripp.jpg",
            url: "https://www.google.com/search?q=TRIPP+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Fitness & Wellness"],
            vr: "native"
        },
        {
            id: "curated-metaquest-punch-fit",
            name: "PUNCH FIT",
            description: "A VR boxing-style fitness workout app.",
            image: "covers/meta-quest/punch-fit.jpg",
            url: "https://www.google.com/search?q=PUNCH+FIT+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Fitness & Wellness"],
            vr: "native"
        },
        {
            id: "curated-metaquest-free-my-sight",
            name: "FREE MY SIGHT",
            description: "A VR eye-relaxation/vision-exercise app.",
            image: "covers/meta-quest/free-my-sight.jpg",
            url: "https://www.google.com/search?q=FREE+MY+SIGHT+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Fitness & Wellness"],
            vr: "native"
        },

        // --- Meta Quest: Action & Arcade Games ---
        {
            id: "curated-metaquest-hyper-dash",
            name: "Hyper Dash",
            description: "A free-to-play VR arena shooter.",
            image: "covers/meta-quest/hyper-dash.jpg",
            url: "https://www.google.com/search?q=Hyper+Dash+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-zenith-nexus",
            name: "Zenith: Nexus",
            description: "An MMO-style VR action-RPG.",
            image: "covers/meta-quest/zenith-nexus.jpg",
            url: "https://www.google.com/search?q=Zenith:+Nexus+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-downshot",
            name: "DOWNSHOT",
            description: "A VR arcade shooter.",
            image: "covers/meta-quest/downshot.jpg",
            url: "https://www.google.com/search?q=DOWNSHOT+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-vroom-kaboom",
            name: "VROOM KABOOM",
            description: "A VR vehicle-combat arcade game.",
            image: "covers/meta-quest/vroom-kaboom.jpg",
            url: "https://www.google.com/search?q=VROOM+KABOOM+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-base-blitz",
            name: "Base Blitz",
            description: "A VR tower-defense/base-combat arcade game.",
            image: "covers/meta-quest/base-blitz.jpg",
            url: "https://www.google.com/search?q=Base+Blitz+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-starfighter-arduxim-multiplayer",
            name: "Starfighter Arduxim Multiplayer",
            description: "A multiplayer VR space-combat game.",
            image: "covers/meta-quest/starfighter-arduxim-multiplayer.jpg",
            url: "https://www.google.com/search?q=Starfighter+Arduxim+Multiplayer+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-asteroid-shooter",
            name: "Asteroid Shooter",
            description: "A VR arcade shooter set in an asteroid field.",
            image: "covers/meta-quest/asteroid-shooter.jpg",
            url: "https://www.google.com/search?q=Asteroid+Shooter+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-pro-fishing-challenge-vr",
            name: "Pro Fishing Challenge VR",
            description: "A VR fishing simulator.",
            image: "covers/meta-quest/pro-fishing-challenge-vr.jpg",
            url: "https://www.google.com/search?q=Pro+Fishing+Challenge+VR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-rc-playground",
            name: "RC Playground",
            description: "A VR remote-control vehicle sandbox.",
            image: "covers/meta-quest/rc-playground.jpg",
            url: "https://www.google.com/search?q=RC+Playground+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-mini-golf-hustler",
            name: "Mini Golf Hustler",
            description: "A VR mini-golf game.",
            image: "covers/meta-quest/mini-golf-hustler.jpg",
            url: "https://www.google.com/search?q=Mini+Golf+Hustler+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-harvest-vr",
            name: "Harvest VR",
            description: "A VR farming game.",
            image: "covers/meta-quest/harvest-vr.jpg",
            url: "https://www.google.com/search?q=Harvest+VR+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-glyph",
            name: "Glyph",
            description: "A VR puzzle-platformer built around rolling a ball through ancient ruins.",
            image: "covers/meta-quest/glyph.jpg",
            url: "https://www.google.com/search?q=Glyph+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-complex",
            name: "COMPLEX",
            description: "A VR arcade puzzle game.",
            image: "covers/meta-quest/complex.jpg",
            url: "https://www.google.com/search?q=COMPLEX+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-corpus-misty",
            name: "Corpus Misty",
            description: "A VR experience/game.",
            image: "covers/meta-quest/corpus-misty.jpg",
            url: "https://www.google.com/search?q=Corpus+Misty+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-butts-the-vr-experience",
            name: "\\\"BUTTS\\\": The VR Experience",
            description: "A comedic multiplayer VR party game.",
            image: "covers/meta-quest/butts-the-vr-experience.jpg",
            url: "https://www.google.com/search?q=\\\\\\\"BUTTS\\\\\\\":+The+VR+Experience+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-heart-of-the-emberstone-coliseum",
            name: "Heart of the Emberstone: Coliseum",
            description: "A VR coliseum-combat game, part of the Heart of the Emberstone series.",
            image: "covers/meta-quest/heart-of-the-emberstone-coliseum.jpg",
            url: "https://www.google.com/search?q=Heart+of+the+Emberstone:+Coliseum+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-epic-roller-coasters",
            name: "Epic Roller Coasters",
            description: "A free VR roller-coaster simulator with multiple rides.",
            image: "covers/meta-quest/epic-roller-coasters.jpg",
            url: "https://www.google.com/search?q=Epic+Roller+Coasters+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        },
        {
            id: "curated-metaquest-toy-with-funi",
            name: "Toy with Funi",
            description: "A cute, casual VR toy-box style app.",
            image: "covers/meta-quest/toy-with-funi.jpg",
            url: "https://www.google.com/search?q=Toy+with+Funi+site%3Ameta.com",
            source: "Meta Quest",
            releaseDate: null,
            tags: ["Action & Arcade Games"],
            vr: "native"
        }
    ].map((entry) => ({
        ...entry,
        popularity: CURATED_ALWAYS_FREE_POPULARITY,
        // These titles are permanently free, not a rotating promo — they
        // never "age out" of being free the way a limited-time Epic/Steam
        // giveaway does, so treating them as newly-discovered content for
        // their first 7 days (the way every other source's games are) is
        // misleading and, worse, buries them in the Newly Added row
        // instead of the dedicated platform row they should always have.
        // renderFreeGames checks this to route them straight to their own
        // platform section from the very first refresh onward.
        alwaysFree: true
    }));
}

// Wrapped in an async function only so it fits the same
// Promise.allSettled pattern as every other source below — the data
// itself is static, so this can never actually fail.
async function fetchCuratedAlwaysFreeGames() {
    try {
        return getCuratedAlwaysFreeGames();
    } catch (err) {
        console.error("[free-games] Curated always-free list failed to build:", err.message || err);
        return [];
    }
}

function normalizeGameName(name) {
    return (name || "")
        .toLowerCase()
        .replace(/[®™©]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

// Platforms that ONLY ever appear via the curated list — there is no live
// feed (Steam/Epic/GOG/GamerPower/itch.io) that could ever legitimately
// carry League of Legends, Overwatch, War Thunder, World of Tanks, or Path
// of Exile, since none of them are distributed through any of those
// stores. A live tracker like GamerPower occasionally lists an unrelated
// promo for one of these games (a starter pack, in-game currency, a beta
// key) under the same or a very similar title, which used to trip the
// name-based dedup below and make the ENTIRE platform disappear even
// though the "duplicate" wasn't really the same listing at all. Curated
// entries on these platforms skip the dedup check entirely and always
// show. (Epic Games, EA, and Ubisoft Connect are deliberately left out —
// Apex Legends and Rainbow Six Siege really are also legitimately
// findable live on Steam, so those DO need the dedup check.)
const CURATED_ONLY_PLATFORMS = new Set([
    "Battle.net", "Riot Games", "Wargaming.net", "Gaijin.net", "Grinding Gear Games", "Meta Quest"
]);

function dedupeCuratedAgainstLive(curatedGames, liveGames) {
    const liveGameNames = new Set(liveGames.map((g) => normalizeGameName(g.name)));
    return curatedGames.filter((g) =>
        CURATED_ONLY_PLATFORMS.has(g.source) || !liveGameNames.has(normalizeGameName(g.name))
    );
}

module.exports = {
    fetchEpicFreeGames,
    fetchGogFreeGames,
    decodeHtmlEntities,
    fetchGamerPowerFreeGames,
    fetchItchFreeGamesFromPage,
    fetchItchFreeGames,
    fetchItchVrFreeGames,
    getCuratedAlwaysFreeGames,
    fetchCuratedAlwaysFreeGames,
    normalizeGameName,
    CURATED_ONLY_PLATFORMS,
    dedupeCuratedAgainstLive
};
