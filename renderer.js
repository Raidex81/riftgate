const { ipcRenderer, clipboard } = require("electron");

const libraryContainer = document.getElementById("libraryContainer");
const addBtn = document.getElementById("addBtn");
const ambientBg = document.getElementById("ambientBg");
const introScreen = document.getElementById("introScreen");
const introAddBtn = document.getElementById("introAddBtn");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const surpriseBtn = document.getElementById("surpriseBtn");

introAddBtn.addEventListener("click", () => addBtn.click());

searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderLibrary();
});

sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    renderLibrary();
});

surpriseBtn.addEventListener("click", openWheelModal);

let allGames = [];

let searchTerm = "";

let sortMode = "name";

let draggedGamePath = null;
let draggedCategoryKey = null;

// Moves a game to sit right before targetPath within targetCategory
// (reassigning its category too, if dropped into a different one), then
// renumbers the whole category's order field and persists it.
async function reorderGames(draggedPath, targetCategory, targetPath, insertAfter, gridEl) {

    const draggedGame = allGames.find((g) => g.path === draggedPath);
    if (!draggedGame) return;

    draggedGame.category = targetCategory;

    // Base the reorder on what's actually visible right now (the current
    // sort mode's displayed sequence), not the raw "order" field — so the
    // drop lands exactly where the user visually dropped it, regardless
    // of which sort mode was active.
    let categoryGames;

    if (gridEl) {
        categoryGames = Array.from(gridEl.querySelectorAll(".game-card"))
            .map((el) => allGames.find((g) => g.path === el.dataset.path))
            .filter((g) => g && g.path !== draggedPath);
    } else {
        categoryGames = allGames
            .filter((g) => (g.category || "game") === targetCategory && g.path !== draggedPath)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    if (targetPath) {
        let targetIndex = categoryGames.findIndex((g) => g.path === targetPath);
        if (targetIndex === -1) {
            targetIndex = categoryGames.length;
        } else if (insertAfter) {
            targetIndex += 1;
        }
        categoryGames.splice(targetIndex, 0, draggedGame);
    } else {
        categoryGames.push(draggedGame);
    }

    categoryGames.forEach((g, i) => {
        g.order = i;
    });

    sortMode = "custom";
    sortSelect.value = "custom";

    for (const g of categoryGames) {
        await ipcRenderer.invoke(
            "update-game",
            { path: g.path, order: g.order, category: g.category }
        );
    }

    renderLibrary();
}

let soundEnabled = false;

let settings = {
    uiSounds: true,
    startupSound: true,
    hoverTrailers: true,
    ambientBackground: true,
    lightTheme: false,
    colorTheme: "riftgate",
    launchAtStartup: false,
    defaultCategory: "ask",
    confirmBeforeRemove: true,
    gridDensity: "comfortable",
    trailerVolume: 50,
    runInBackground: false,
    categoryOrder: ["game", "app", "vr", "other"],
    movieCountry: "US",
    startupSection: "new",
    movieCity: "",
    startupAnimation: true
};

let CATEGORY_ORDER = ["game", "app", "vr", "other"];

const CATEGORY_LABELS = {
    game: "🎮 Games",
    app: "🖥️ Apps",
    vr: "🥽 VR",
    other: "📦 Other"
};

const CATEGORY_BADGES = {
    game: "🎮 Game",
    app: "🖥️ App",
    vr: "🥽 VR",
    other: "📦 Other"
};

function setAmbientTheme(category) {
    if (!settings.ambientBackground) return;
    ambientBg.classList.remove("theme-game", "theme-app", "theme-vr", "theme-other");
    ambientBg.classList.add(`theme-${category}`);
}

// --- Path modal ---------------------------------------------------------

const pathModal = document.getElementById("pathModal");
const modalPathText = document.getElementById("modalPathText");
const copyPathBtn = document.getElementById("copyPathBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

let currentModalPath = "";

function openPathModal(gamePath) {
    currentModalPath = gamePath;
    modalPathText.textContent = gamePath;
    pathModal.classList.add("active");
}

function closePathModal() {
    pathModal.classList.remove("active");
}

closeModalBtn.addEventListener("click", closePathModal);

pathModal.addEventListener("click", (event) => {
    if (event.target === pathModal) closePathModal();
});

copyPathBtn.addEventListener("click", () => {
    clipboard.writeText(currentModalPath);
    copyPathBtn.textContent = "Copied!";
    setTimeout(() => {
        copyPathBtn.textContent = "Copy Path";
    }, 1200);
});

// --- Description popup (shown on hover, since the card only shows a
// few truncated lines via CSS line-clamp) ---------------------------

const descModal = document.getElementById("descModal");
const descModalTitle = document.getElementById("descModalTitle");
const descModalText = document.getElementById("descModalText");

// Anchored near the hovered card (not centered on screen) so it can never
// structurally overlap the source card — that overlap was the real cause
// of the old "blinking" bug for cards near the viewport center.
function openDescModal(gameName, description, anchorEl) {
    descModalTitle.textContent = gameName;
    descModalText.textContent = description;

    const box = descModal.querySelector(".modal-box");
    box.style.maxHeight = "none";
    box.style.overflowY = "visible";

    // Measure while invisible-but-rendered, so we know the REAL height
    // this description needs before deciding where to place it — this is
    // what stops long text from ever getting cut off.
    descModal.style.visibility = "hidden";
    descModal.classList.add("active");

    const rect = anchorEl.getBoundingClientRect();
    const modalWidth = 340;

    let left = rect.left + rect.width / 2 - modalWidth / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - modalWidth - 12));
    descModal.style.left = `${left}px`;
    descModal.style.width = `${modalWidth}px`;

    const naturalHeight = descModal.getBoundingClientRect().height;
    const maxAllowed = window.innerHeight - 24;
    const finalHeight = Math.min(naturalHeight, maxAllowed);

    if (naturalHeight > maxAllowed) {
        box.style.maxHeight = `${maxAllowed}px`;
        box.style.overflowY = "auto";
    }

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const showBelow = spaceBelow >= finalHeight + 20 || spaceBelow >= spaceAbove;

    if (showBelow) {
        const top = Math.min(rect.bottom + 10, window.innerHeight - finalHeight - 12);
        descModal.style.top = `${Math.max(12, top)}px`;
        descModal.style.bottom = "auto";
    } else {
        const bottom = Math.min(window.innerHeight - rect.top + 10, window.innerHeight - 12);
        descModal.style.bottom = `${bottom}px`;
        descModal.style.top = "auto";
    }

    descModal.style.visibility = "visible";
}

function closeDescModal() {
    descModal.classList.remove("active");
}

descModal.addEventListener("mouseleave", closeDescModal);

// --- Notes & tags modal --------------------------------------------------

const notesModal = document.getElementById("notesModal");
const notesModalTitle = document.getElementById("notesModalTitle");
const notesModalText = document.getElementById("notesModalText");
const tagsModalInput = document.getElementById("tagsModalInput");
const notesCloseBtn = document.getElementById("notesCloseBtn");
const notesSaveBtn = document.getElementById("notesSaveBtn");
const fixInfoInput = document.getElementById("fixInfoInput");
const fixInfoBtn = document.getElementById("fixInfoBtn");
const fixInfoStatus = document.getElementById("fixInfoStatus");
const fixTrailerInput = document.getElementById("fixTrailerInput");
const fixTrailerBtn = document.getElementById("fixTrailerBtn");
const fixTrailerStatus = document.getElementById("fixTrailerStatus");

let notesModalGame = null;

function openNotesModal(game) {
    notesModalGame = game;
    notesModalTitle.textContent = `Notes & Tags — ${game.name}`;
    notesModalText.value = game.notes || "";
    tagsModalInput.value = (game.tags || []).join(", ");
    fixInfoInput.value = game.searchName || "";
    fixInfoStatus.textContent = "";
    fixTrailerInput.value = "";
    fixTrailerStatus.textContent = "";
    notesModal.classList.add("active");
}

function closeNotesModal() {
    notesModal.classList.remove("active");
    notesModalGame = null;
    renderLibrary();
}

notesCloseBtn.addEventListener("click", closeNotesModal);

notesModal.addEventListener("click", (event) => {
    if (event.target === notesModal) closeNotesModal();
});

notesSaveBtn.addEventListener("click", async () => {
    if (!notesModalGame) return;

    const notes = notesModalText.value.trim();
    const tags = tagsModalInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

    notesModalGame.notes = notes;
    notesModalGame.tags = tags;

    await ipcRenderer.invoke(
        "update-game",
        { path: notesModalGame.path, notes, tags }
    );

    closeNotesModal();
});

// Lets the user correct the name Riftgate searches with, when the
// auto-matched description/cover/trailer turned out to be for the wrong
// thing entirely. Re-fetches description immediately using that name,
// clears the cached trailer so the next hover looks it up fresh, and
// fills in a cover too if the card is still on the placeholder.
fixInfoBtn.addEventListener("click", async () => {
    if (!notesModalGame) return;

    const searchName = fixInfoInput.value.trim();
    if (!searchName) return;

    fixInfoStatus.textContent = "Looking it up...";
    fixInfoBtn.disabled = true;

    notesModalGame.searchName = searchName;

    const updates = { path: notesModalGame.path, searchName, trailerId: null };

    const description = await ipcRenderer.invoke("fetch-description", searchName);
    if (description) {
        notesModalGame.description = description;
        updates.description = description;
    }

    if (!notesModalGame.image || notesModalGame.image === "covers/default.jpg") {
        const cover = await ipcRenderer.invoke("fetch-online-cover", searchName);
        if (cover) {
            notesModalGame.image = cover;
            updates.image = cover;
        }
    }

    await ipcRenderer.invoke("update-game", updates);

    await ipcRenderer.invoke(
        "save-override",
        { name: notesModalGame.name, image: updates.image, trailerId: undefined }
    );

    fixInfoBtn.disabled = false;
    fixInfoStatus.textContent = description
        ? "Updated! Closing this window will refresh the card."
        : "Couldn't find a match for that name — try being more specific.";
});

function extractYoutubeId(input) {
    const match = input.match(
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
    );
    if (match) return match[1];

    // Also accept a bare 11-character video ID typed directly
    if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();

    return null;
}

fixTrailerBtn.addEventListener("click", async () => {
    if (!notesModalGame) return;

    const videoId = extractYoutubeId(fixTrailerInput.value.trim());

    if (!videoId) {
        fixTrailerStatus.textContent = "Couldn't read a video ID from that — paste the full YouTube link.";
        return;
    }

    notesModalGame.trailerId = videoId;

    await ipcRenderer.invoke(
        "update-game",
        { path: notesModalGame.path, trailerId: videoId }
    );

    await ipcRenderer.invoke(
        "save-override",
        { name: notesModalGame.name, trailerId: videoId }
    );

    fixTrailerStatus.textContent = "Trailer updated! Hover the card to see it.";
});

// --- Milestone celebrations -----------------------------------------------

const MILESTONES = [5, 10, 25, 50, 100, 250, 500];
const milestoneToast = document.getElementById("milestoneToast");
let milestoneTimer = null;

function checkMilestone(game) {
    if (!MILESTONES.includes(game.launches)) return;

    milestoneToast.textContent = `🎉 ${game.launches}th launch of ${game.name}!`;
    milestoneToast.classList.add("active");

    clearTimeout(milestoneTimer);
    milestoneTimer = setTimeout(() => {
        milestoneToast.classList.remove("active");
    }, 4000);
}

// --- Wheel of fortune (Surprise Me) ---------------------------------------

const wheelModal = document.getElementById("wheelModal");
const wheelEl = document.getElementById("wheelEl");
const wheelMessage = document.getElementById("wheelMessage");
const wheelResult = document.getElementById("wheelResult");
const wheelResultImg = document.getElementById("wheelResultImg");
const wheelResultName = document.getElementById("wheelResultName");
const wheelPlayBtn = document.getElementById("wheelPlayBtn");
const wheelSpinAgainBtn = document.getElementById("wheelSpinAgainBtn");
const wheelQuitBtn = document.getElementById("wheelQuitBtn");

const SPIN_NAG_MESSAGES = [
    "Hmm, let's see what we get...",
    "Really? Let's go again...",
    "Still can't decide, huh?",
    "Okay, this is getting a little ridiculous.",
    "The wheel is starting to judge you.",
    "At this point, just pick literally anything.",
    "The wheel has seen a lot, but never this much indecision.",
    "Somewhere, a game controller is losing patience.",
    "Statistically, you've had time to beat a whole game by now.",
    "This is the wheel's cardio for today.",
    "New record for most spins by someone who says they're \"fine either way.\"",
    "Legend says this wheel has never stopped spinning."
];

let nagQueue = [];
let lastNagMessage = null;

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Never repeats the same message twice in a row, even across a fresh
// reshuffle once the pool runs out.
function getNextNagMessage() {
    if (nagQueue.length === 0) {
        nagQueue = shuffle(SPIN_NAG_MESSAGES);

        if (nagQueue.length > 1 && nagQueue[0] === lastNagMessage) {
            [nagQueue[0], nagQueue[1]] = [nagQueue[1], nagQueue[0]];
        }
    }

    const next = nagQueue.shift();
    lastNagMessage = next;
    return next;
}

let wheelGames = [];
let wheelRotation = 0;
let wheelSpinCount = 0;
let wheelWinner = null;
let wheelMode = "game";

function wheelItemName(item) {
    return wheelMode === "movie" ? item.title : item.name;
}

function wheelItemImage(item) {
    return wheelMode === "movie" ? (item.poster || "covers/default.jpg") : (item.image || "covers/default.jpg");
}

function truncateForWheel(name, maxChars) {
    if (name.length <= maxChars) return name;
    return name.slice(0, maxChars - 1) + ".";
}

// Static decorative ring of "nail"/light-bulb style rivets around the
// wheel's rim, like a classic TV game-show wheel. Built once — it doesn't
// depend on the games list, and stays fixed while only the disc spins.
function buildWheelRim() {
    const rim = document.getElementById("wheelRim");
    if (!rim || rim.childElementCount > 0) return;

    const nailCount = 20;

    for (let i = 0; i < nailCount; i++) {
        const angle = i * (360 / nailCount);
        const nail = document.createElement("div");
        nail.className = "wheel-nail";
        nail.style.transform = `translate(-50%,-50%) rotate(${angle}deg) translateY(-142px)`;
        rim.appendChild(nail);
    }
}

function buildWheel(games) {
    const segAngle = 360 / games.length;

    // Evenly spaced hues around the color wheel so every slice is visibly
    // distinct, however many games there are.
    const colors = games.map((_, i) =>
        `hsl(${Math.round(i * (360 / games.length))}, 72%, 52%)`
    );

    const gradientStops = colors
        .map((c, i) => `${c} ${i * segAngle}deg ${(i + 1) * segAngle}deg`)
        .join(", ");

    wheelEl.style.background = `conic-gradient(${gradientStops})`;
    wheelEl.innerHTML = "";

    // Wide wedges (few slices) have room for upright horizontal text.
    // Narrow wedges (many slices) fit more if the text runs along the
    // radius instead — that's the "only vertical if it fits better" rule.
    const useHorizontal = segAngle >= 40;
    const maxChars = useHorizontal ? 9 : 13;

    games.forEach((game, i) => {
        const midAngle = i * segAngle + segAngle / 2;
        // conic-gradient measures angles clockwise FROM THE TOP, but an
        // unrotated translate naturally points right (3 o'clock) — the
        // -90 corrects for that so labels land on their actual wedge.
        const rotationForPosition = midAngle - 90;

        const label = document.createElement("div");
        label.className = "wheel-label";
        label.style.transform = `translate(-50%,-50%) rotate(${rotationForPosition}deg)`;

        const positioner = document.createElement("div");
        positioner.className = "wheel-label-pos";
        positioner.style.transform = "translate(90px, -6px)";

        const span = document.createElement("span");
        span.className = "wheel-label-text";
        span.textContent = truncateForWheel(wheelItemName(game), maxChars);
        span.style.maxWidth = useHorizontal ? "78px" : "100px";

        if (useHorizontal) {
            // Counter-rotate so the text reads upright regardless of where
            // it sits on the wheel, then center it on the anchor point
            // instead of letting it hang off to one side.
            span.style.transform = `translateX(-50%) rotate(${-rotationForPosition}deg)`;
            span.style.transformOrigin = "center";
        }

        positioner.appendChild(span);
        label.appendChild(positioner);
        wheelEl.appendChild(label);
    });
}

function spinWheelTo(index, totalGames) {
    const segAngle = 360 / totalGames;
    const centerAngle = index * segAngle + segAngle / 2;
    const targetMod = (360 - centerAngle) % 360;

    const baseTurns = 7 * 360;
    let newRotation = (wheelRotation - (wheelRotation % 360)) + baseTurns + targetMod;

    if (newRotation <= wheelRotation) newRotation += 360;

    wheelRotation = newRotation;
    wheelEl.style.transform = `rotate(${wheelRotation}deg)`;
}

function spin() {
    wheelResult.classList.remove("active");

    const winnerIndex = Math.floor(Math.random() * wheelGames.length);
    wheelWinner = wheelGames[winnerIndex];

    spinWheelTo(winnerIndex, wheelGames.length);

    setTimeout(() => {
        wheelResultImg.src = wheelItemImage(wheelWinner);
        wheelResultName.textContent = wheelItemName(wheelWinner);
        wheelPlayBtn.textContent = wheelMode === "movie" ? "🎟️ Find Tickets" : "Play";
        wheelResult.classList.add("active");
    }, 6000);
}

function openWheelModal() {
    if (currentSection === "theatre") {
        wheelMode = "movie";
        wheelGames = moviesCache;

        if (wheelGames.length < 2) {
            alert("No movies loaded yet — open In Theaters first, or add at least 2 games to spin for a game instead.");
            return;
        }
    } else {
        wheelMode = "game";
        wheelGames = allGames.filter((g) => (g.category || "game") === "game");

        if (wheelGames.length < 2) {
            alert("Add at least 2 games to spin the wheel!");
            return;
        }
    }

    wheelSpinCount = 0;
    wheelMessage.textContent = "";
    wheelResult.classList.remove("active");
    buildWheel(wheelGames);
    wheelModal.classList.add("active");

    // Give the browser two paint frames to actually render the modal and
    // the wheel's starting position before we change the transform —
    // otherwise the very first spin's transition gets skipped entirely.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            spin();
        });
    });
}

function closeWheelModal() {
    wheelModal.classList.remove("active");
}

wheelSpinAgainBtn.addEventListener("click", () => {
    wheelSpinCount++;
    wheelMessage.textContent = getNextNagMessage();
    spin();
});

wheelQuitBtn.addEventListener("click", closeWheelModal);

wheelPlayBtn.addEventListener("click", async () => {
    if (!wheelWinner) return;

    if (wheelMode === "movie") {
        const countryCode = movieCountrySelect.value || "US";
        const city = movieCitySelect.value;
        const countryName = COUNTRY_NAMES[countryCode] || "";
        const domain = GOOGLE_DOMAIN_BY_COUNTRY[countryCode] || "com";

        const queryParts = [wheelWinner.title, "showtimes", "tickets"];
        if (city) queryParts.push(city);
        queryParts.push(countryName);

        const query = encodeURIComponent(queryParts.filter(Boolean).join(" "));
        ipcRenderer.invoke("open-external", `https://www.google.${domain}/search?q=${query}`);
    } else {
        await ipcRenderer.invoke("launch-app", wheelWinner.path);
    }

    closeWheelModal();
});

// --- Changelog / what's new ------------------------------------------------

const CHANGELOG = {
    "1.18.0": [
        "New: a startup animation — the diamond logo assembles from 4 pieces flying in through real 3D space, using your current theme's colors automatically",
        "New: an enhanced startup chime — 4 quick assembly clicks timed to the animation, resolving into the original 3-note chord",
        "New: a \"Startup animation\" toggle in the sidebar (Sound section), independent of the existing Startup sound toggle",
        "Fixed: Free Games category filter showed the confusing label \"Free to Play\" for Steam games instead of \"Steam\" — now shows the store name, consistent with how Epic's genres display"
    ],
    "1.17.0": [
        "Removed: the entire language/translation system (language selector, all 6 languages, live description translation) — it was the single biggest and most sweeping recent change, touching nearly every card across the app, and the most likely cause of widespread issues",
        "Kept: all the legitimate bug fixes since 1.13.0 — the hidden mute button under the \"watch larger\" button, Free Games hanging with no timeout, and trailers running one-at-a-time instead of in parallel are all still fixed",
        "Note: this is not a byte-for-byte rollback to 1.13.0 — a literal rollback would have brought those bugs back, so this keeps the working fixes while removing what's believed to be the actual source of the recent instability"
    ],
    "1.16.0": [
        "Reverted: Free Games back to the simpler, working version (Epic + Steam only, no GOG, no store filter, grouped by genre/source) — undid everything added after the \"not retrieving\" report, while keeping the request timeout and per-store resilience fixes",
        "Fixed: Upcoming Games (and everywhere else) trailer lookups now run all fallback searches in parallel instead of one-by-one, so trailers show up reliably within a normal hover instead of sometimes arriving too late",
        "Improved: Recently Released now refreshes every 10 minutes instead of every hour",
        "New: added French, Italian, German, and Spanish — 6 languages total",
        "New: descriptions (movie synopses, game/show descriptions) now translate automatically via a free translation service when using a non-English language, while game/movie/series/app names always stay as-is",
        "New: the fun fact ticker and every sidebar label, toggle, and dropdown option now fully translate with the selected language"
    ],
    "1.15.0": [
        "Fixed: Free Games not retrieving anything — a rate-limited/hanging request to SteamSpy could stall the whole feature with no fallback; every request now has a timeout, and a failure in categorization can no longer wipe out the actual game list",
        "Fixed: the mute button on new-style cards (New Series, Upcoming Games, and others) was actually being rendered — it was just hidden underneath the new \"watch larger\" button, since both were positioned in the exact same spot",
        "Improved: trailer search now tries several fallback queries (official, plain name, description-assisted, most-watched) before giving up, instead of stopping after one strict attempt — should find a related video far more often",
        "Improved: Free Games filters reordered — category/genre first, store (Steam/Epic/GOG) second",
        "Improved: if one free-game store's fetch fails entirely, the other two still load normally instead of the whole section coming up empty"
    ],
    "1.14.0": [
        "New: a language selector (English/Português) under the fact ticker, in every section — translates Riftgate's own menus, headings, and blurbs (content pulled live from external sources, like movie descriptions, stays in its original language)",
        "New: independent filter/search bars for Recently Released and My Shows, separate from the global search",
        "New: a Store filter for Free Games (Steam/Epic Games/GOG only), alongside the existing category filter",
        "Improved: Free Games are now grouped alphabetically by store, and games within each store are alphabetical too",
        "Improved: \"New\" now appears first in the section dropdown, matching it being the default view",
        "Improved: the section switcher now stays visible while scrolling down a long list, and returns to its normal spot when you scroll back up",
        "Improved: scrollbars are noticeably more visible",
        "Renamed: \"Close Launcher\" is now \"Close App\""
    ],
    "1.13.0": [
        "New: a City selector next to Country in Theatre — pick where you want to watch, from a curated list of major cities per country",
        "Improved: \"Find Tickets & Showtimes\" now searches using the right country's Google domain and includes your selected city, instead of a generic .com search"
    ],
    "1.12.0": [
        "New: the app's taskbar/title-bar icon now recolors to match your chosen theme, live — the static .exe file icon can't change at runtime, but everything shown while Riftgate is running now does",
        "Removed: the Reduce Motion setting",
        "Improved: grid density is now one setting for every section (Installed, Free Games, Theatre, New) instead of two separate ones"
    ],
    "1.11.0": [
        "New: GOG is now a real integrated free-games source, pulling live from GOG's own free-games catalog — alongside Steam and Epic, not a redirect link",
        "New: Free Games are now grouped by store (Steam / Epic Games / GOG), with the genre dropdown working as a filter on top of that",
        "New: pick which section Riftgate starts on from the sidebar (Startup & Behavior)",
        "New: every game, app, free game, and TV show card now has the same \"watch larger\" button movies already had",
        "Improved: fun facts are now shuffled per section instead of repeating in the same order every time",
        "Removed: the GOG \"browse\" redirect button, replaced by the real integration above"
    ],
    "1.10.0": [
        "New: the \"New\" section is now the default view when Riftgate opens",
        "New: Free Games are now categorized by real genre (RTS, MMORPG, FPS, Battle Royale, and more) via SteamSpy's tag data",
        "New: a \"Browse GOG's Free Games\" link — GOG has no public API for this, so this opens their real free-games page instead",
        "Fixed: Steam free games are now cross-checked against SteamSpy's live price data, so \"free\" games that actually cost money no longer show up",
        "Fixed: descriptions can no longer be cut off — the popup now measures the real text height and only scrolls in the rare case it can't fit on screen at all",
        "Fixed: the category picker (and section switcher) no longer closes if you move the mouse down into it — a hover-gap timing bug",
        "Improved: the section switcher is now a much more visible pill button with a smooth arrow/dropdown animation"
    ],
    "1.9.0": [
        "New: a whole \"NEW\" section — upcoming movies, new TV series, and upcoming games, all with hover trailers and sound",
        "New: Surprise Me now works in Theatre — spins to pick a movie to watch instead of a game",
        "New: Recently Released now shows every tracked show's latest episode with its air date and a \"Where to Watch\" button",
        "Fixed: replaced the broken Steam free-games source (which only ever returned ~12 results) with SteamSpy's proper bulk catalog API",
        "Fixed: mute/unmute now applies instantly everywhere, instead of needing to hover away and back",
        "Fixed: description popup can no longer overflow past the edge of the window",
        "Improved: trailer search now falls back to the most-watched result when no official trailer is found",
        "Improved: grid density (compact/comfortable) now has its own separate setting for browsing sections (Free Games, Theatre), independent from Installed"
    ],
    "1.8.0": [
        "New: In Theaters is now live — TMDB API key added",
        "New: trailer searches are now type-aware (games, apps, VR, and TV series each search for the right kind of trailer, avoiding cross-category mismatches)",
        "New: click \"Running\" again if it gets stuck, to manually mark an app as closed",
        "Fixed: Surprise Me button text was invisible due to a leftover style from its old topbar version — now shows properly with an animated rolling die",
        "Improved: fun fact ticker is noticeably slower, giving more time to read",
        "Improved: banner tagline now mentions media alongside games and apps"
    ],
    "1.7.0": [
        "New: Free Games now pulls a much bigger Steam catalog (up to 800 titles) plus Epic, with a search bar and category filter",
        "New: Free Games are grouped by category, with a \"See more\" toggle on any row with more than 2 lines",
        "New: Free Game and My Shows cards now show a hover trailer with sound toggle, just like Installed",
        "New: My Shows cards now show a real description, fetched and cached just like games",
        "Improved: your last-selected country for In Theaters is now remembered across restarts",
        "Improved: section descriptions are now centered and easier to read",
        "Improved: Movies, My Shows grids also get the \"See more\" treatment when there's a lot to show"
    ],
    "1.6.0": [
        "New: movie cards now have full trailer sound toggle, description hover popup, and a large \"theater mode\" popup button, plus a direct YouTube link",
        "New: Free Games now also pulls from Steam, with a \"Newly Added\" row that lasts a week before joining the general list",
        "New: Recently Released episodes refresh automatically every hour",
        "New: fun fact ticker now shows movie/TV facts while in the Theatre section",
        "Improved: country selector for In Theaters moved to its own bar under the fact ticker",
        "Improved: Installed and Free Games/Theatre sections now have short explanatory blurbs"
    ],
    "1.5.0": [
        "New: a section switcher (Installed / Free Games / Applications / Theatre)",
        "New: Free Games section, populated live from Epic's free game promotions",
        "New: Theatre section — track any TV series and see new episodes in a Recently Released row",
        "New: Theatre also shows movies currently in theaters by country, with real showtimes via your browser",
        "Fixed: app names are now read from the file itself (e.g. chrome.exe → \"Google Chrome\") instead of guessed from the filename, fixing wrong covers/descriptions/trailers"
    ],
    "1.4.0": [
        "New: drag a shortcut or .exe straight from the desktop/Explorer onto Riftgate to add it",
        "New: drag a category's heading onto another to swap their positions",
        "New: dropping a card onto the left or right half of another now inserts before or after it",
        "Improved: mods button now only shows for Games and VR, not Apps/Other",
        "Improved: wheel labels are bigger and properly centered",
        "Fixed: favorited games no longer snap back to the front when using Custom Order",
        "Fixed: trailer volume slider is thinner again"
    ],
    "1.2.0": [
        "New: bottom-right Surprise Me, notification bell, and Close Launcher buttons, always visible",
        "New: Surprise Me spins a wheel to randomly pick a game for you",
        "New: fun fact ticker slides one gaming trivia fact at a time and stays visible while scrolling",
        "New: fix a wrong description/cover by telling Riftgate what a game actually is",
        "New: Startup & Behavior settings — launch at Windows startup, default category, confirm before removing",
        "New: Display & Accessibility settings — compact grid, reduce motion, trailer volume slider",
        "New: Run in background (system tray), with a choice to minimize or close completely",
        "New: Riftgate now detects games installed via Steam/Epic on startup and asks to add them",
        "New: Red theme added",
        "Improved: cover art can now be changed anytime, not just when missing",
        "Improved: wheel spin-again comments never repeat",
        "Improved: cover and trailer search now tries more name variants before giving up",
        "Improved: every wheel slice now has its own distinct color, with a more 3D look",
        "Fixed: fullscreen mode now fully hides the title bar",
        "Fixed: hovering a description no longer blinks",
        "Fixed: the wheel now actually spins on the first try, not just on Spin Again",
        "Fixed: the wheel spin properly decelerates before landing",
        "Fixed: the wheel's pointer now correctly matches the announced winner",
        "Fixed: the fun fact ticker slides in from off-screen instead of appearing mid-screen",
        "Fixed: banner title text no longer blends into the logo — much more readable now",
        "Fixed: trailer volume slider now visually fills all the way at maximum"
    ],
    "1.1.0": [
        "New: sidebar with sound, display, and 6 color themes plus light/dark mode",
        "New: hover trailers with a mute/unmute toggle",
        "New: frameless window with a custom title bar",
        "New: favorites, notes & tags, playtime tracking, recently played/added sorting"
    ]
};

const notifyBtn = document.getElementById("notifyBtn");
const changelogModal = document.getElementById("changelogModal");
const changelogBody = document.getElementById("changelogBody");
const changelogCloseBtn = document.getElementById("changelogCloseBtn");
const versionFooter = document.getElementById("versionFooter");
const closeLauncherBtn = document.getElementById("closeLauncherBtn");

let appVersion = null;

function renderChangelog() {
    changelogBody.innerHTML = Object.entries(CHANGELOG)
        .map(([version, items]) => `
            <div class="changelog-version">v${version}</div>
            <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
        `)
        .join("");
}

function openChangelogModal() {
    renderChangelog();
    changelogModal.classList.add("active");
}

notifyBtn.addEventListener("click", openChangelogModal);
changelogCloseBtn.addEventListener("click", () => changelogModal.classList.remove("active"));

changelogModal.addEventListener("click", (event) => {
    if (event.target === changelogModal) changelogModal.classList.remove("active");
});

closeLauncherBtn.addEventListener("click", () => {
    ipcRenderer.invoke("window-close");
});

// --- Auto-update popup (checks GitHub Releases via electron-updater) ------

const updateModal = document.getElementById("updateModal");
const updateModalBody = document.getElementById("updateModalBody");
const updateProgressWrap = document.getElementById("updateProgressWrap");
const updateProgressFill = document.getElementById("updateProgressFill");
const updateProgressLabel = document.getElementById("updateProgressLabel");
const updateModalActions = document.getElementById("updateModalActions");
const updateLaterBtn = document.getElementById("updateLaterBtn");
const updateNowBtn = document.getElementById("updateNowBtn");

ipcRenderer.on("update-available", (event, info) => {
    updateModalBody.innerHTML = `
        <p style="margin-bottom:10px;">Version <strong>${info.version}</strong> is available. Here's what's new:</p>
        <p style="white-space:pre-line;color:var(--text-secondary);font-size:13px;">${info.releaseNotes || "See the release on GitHub for details."}</p>
    `;
    updateProgressWrap.style.display = "none";
    updateModalActions.style.display = "flex";
    updateNowBtn.disabled = false;
    updateLaterBtn.disabled = false;
    updateModal.classList.add("active");
});

ipcRenderer.on("update-download-progress", (event, percent) => {
    updateProgressFill.style.width = `${percent}%`;
    updateProgressLabel.textContent = `Downloading update... ${percent}%`;
});

ipcRenderer.on("update-downloaded", () => {
    updateProgressLabel.textContent = "Update downloaded — restarting to install...";
    setTimeout(() => {
        ipcRenderer.invoke("quit-and-install-update");
    }, 1200);
});

ipcRenderer.on("update-error", (event, message) => {
    console.error("[updater]", message);
    // Fails quietly — the user can keep using the current version, and
    // the check simply retries on the next launch.
    updateModal.classList.remove("active");
});

updateNowBtn.addEventListener("click", () => {
    updateModalActions.style.display = "none";
    updateProgressWrap.style.display = "block";
    updateProgressFill.style.width = "0%";
    updateProgressLabel.textContent = "Downloading update...";
    ipcRenderer.invoke("start-update-download");
});

updateLaterBtn.addEventListener("click", () => {
    // No dismissal is remembered on purpose — this will show again on the
    // next restart until the user actually updates, as required.
    updateModal.classList.remove("active");
});

async function checkForUpdatePopup() {
    appVersion = await ipcRenderer.invoke("get-app-version");
    versionFooter.textContent = `Riftgate v${appVersion}`;

    const bottomBarVersion = document.getElementById("bottomBarVersion");
    if (bottomBarVersion) bottomBarVersion.textContent = `v${appVersion}`;

    if (settings.lastSeenVersion !== appVersion) {
        openChangelogModal();
        saveSetting("lastSeenVersion", appVersion);
    }
}

// --- New-game detection (Steam / Epic) --------------------------------

const importModal = document.getElementById("importModal");
const importModalText = document.getElementById("importModalText");
const importLaterBtn = document.getElementById("importLaterBtn");
const importYesBtn = document.getElementById("importYesBtn");

let importQueue = [];
let currentImport = null;

function showNextImportPrompt() {
    if (importQueue.length === 0) {
        importModal.classList.remove("active");
        currentImport = null;
        return;
    }

    currentImport = importQueue.shift();
    importModalText.textContent =
        `Found "${currentImport.name}" installed via ${currentImport.source}. Add it to Riftgate?`;
    importModal.classList.add("active");
}

importLaterBtn.addEventListener("click", async () => {
    if (currentImport) {
        await ipcRenderer.invoke("dismiss-import", currentImport.path);
    }
    showNextImportPrompt();
});

importYesBtn.addEventListener("click", async () => {
    if (!currentImport) return;

    const gameName = currentImport.name;
    const override = await ipcRenderer.invoke("get-override", gameName);

    let cover = override && override.image ? override.image : null;

    if (!cover) {
        cover = await ipcRenderer.invoke("find-cover", gameName);

        if (cover === "covers/default.jpg") {
            cover = await ipcRenderer.invoke("fetch-online-cover", gameName);
        }
    }

    if (!cover) {
        cover = "covers/default.jpg";
    }

    const game = {
        name: gameName,
        path: currentImport.path,
        image: cover,
        category: "game"
    };

    if (override && override.trailerId) {
        game.trailerId = override.trailerId;
    }

    await ipcRenderer.invoke("save-game", game);

    allGames.push(game);
    renderLibrary();

    showNextImportPrompt();
});

async function checkForNewGames() {
    const found = await ipcRenderer.invoke("scan-new-games");
    if (found && found.length > 0) {
        importQueue = found;
        showNextImportPrompt();
    }
}

// --- Category modal (used when adding a new entry) ---------------------

const categoryModal = document.getElementById("categoryModal");
const categoryButtons = document.querySelectorAll(".categoryOption");

let resolveCategoryChoice = null;

categoryButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        const choice = btn.dataset.category;
        categoryModal.classList.remove("active");

        if (resolveCategoryChoice) {
            resolveCategoryChoice(choice);
            resolveCategoryChoice = null;
        }
    });
});

function askCategory() {
    return new Promise((resolve) => {
        resolveCategoryChoice = resolve;
        categoryModal.classList.add("active");
    });
}

// --- Sidebar --------------------------------------------------------------

const toggleUiSounds = document.getElementById("toggleUiSounds");
const toggleStartupSound = document.getElementById("toggleStartupSound");
const toggleStartupAnimation = document.getElementById("toggleStartupAnimation");
const toggleHoverTrailers = document.getElementById("toggleHoverTrailers");
const toggleAmbientBg = document.getElementById("toggleAmbientBg");
const refreshMetadataBtn = document.getElementById("refreshMetadataBtn");
const statCounts = document.getElementById("statCounts");
const statLaunches = document.getElementById("statLaunches");
const toggleFullscreen = document.getElementById("toggleFullscreen");
const toggleLightTheme = document.getElementById("toggleLightTheme");
const themeButtons = document.querySelectorAll(".themeOption");

function applyTheme(isLight) {
    document.body.classList.toggle("light-theme", isLight);
}

function applyColorTheme(themeName) {
    document.body.classList.remove(
        "theme-riftgate", "theme-cyberpunk", "theme-emerald",
        "theme-crimson", "theme-ocean", "theme-gold", "theme-red",
        "theme-frost", "theme-venom"
    );
    document.body.classList.add(`theme-${themeName}`);

    themeButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === themeName);
    });

    // Recolors the running app's taskbar/title-bar icon to match — the
    // static .exe file icon itself can't change at runtime, only the
    // icon shown while the app is actually running.
    ipcRenderer.invoke("set-app-icon", themeName);
}

themeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        const themeName = btn.dataset.theme;
        applyColorTheme(themeName);
        saveSetting("colorTheme", themeName);
    });
});

const toggleLaunchAtStartup = document.getElementById("toggleLaunchAtStartup");
const toggleConfirmRemove = document.getElementById("toggleConfirmRemove");
const defaultCategorySelect = document.getElementById("defaultCategorySelect");
const startupSectionSelect = document.getElementById("startupSectionSelect");
const gridDensitySelect = document.getElementById("gridDensitySelect");

const trailerVolumeSlider = document.getElementById("trailerVolumeSlider");
const toggleRunInBackground = document.getElementById("toggleRunInBackground");

function applyGridDensity(density) {
    document.body.classList.toggle("density-compact", density === "compact");
}

toggleLaunchAtStartup.addEventListener("change", () => {
    saveSetting("launchAtStartup", toggleLaunchAtStartup.checked);
    ipcRenderer.invoke("set-launch-at-startup", toggleLaunchAtStartup.checked);
});

toggleRunInBackground.addEventListener("change", () => {
    saveSetting("runInBackground", toggleRunInBackground.checked);
    ipcRenderer.invoke("set-run-in-background", toggleRunInBackground.checked);
});

toggleConfirmRemove.addEventListener("change", () => {
    saveSetting("confirmBeforeRemove", toggleConfirmRemove.checked);
});

defaultCategorySelect.addEventListener("change", () => {
    saveSetting("defaultCategory", defaultCategorySelect.value);
});

startupSectionSelect.addEventListener("change", () => {
    saveSetting("startupSection", startupSectionSelect.value);
});

gridDensitySelect.addEventListener("change", () => {
    applyGridDensity(gridDensitySelect.value);
    saveSetting("gridDensity", gridDensitySelect.value);
});

function updateVolumeSliderFill() {
    const val = trailerVolumeSlider.value;
    trailerVolumeSlider.style.background =
        `linear-gradient(to right, var(--accent-1) 0%, var(--accent-1) ${val}%, var(--bg-tertiary) ${val}%, var(--bg-tertiary) 100%)`;
}

trailerVolumeSlider.addEventListener("input", () => {
    settings.trailerVolume = Number(trailerVolumeSlider.value);
    updateVolumeSliderFill();
    applyVolumeToAllFrames();
});

trailerVolumeSlider.addEventListener("change", () => {
    saveSetting("trailerVolume", Number(trailerVolumeSlider.value));
});

function applySettingsToUI() {
    toggleUiSounds.checked = settings.uiSounds;
    toggleStartupSound.checked = settings.startupSound;
    toggleStartupAnimation.checked = settings.startupAnimation !== false;
    toggleHoverTrailers.checked = settings.hoverTrailers;
    toggleAmbientBg.checked = settings.ambientBackground;
    toggleLightTheme.checked = settings.lightTheme;
    applyTheme(settings.lightTheme);
    applyColorTheme(settings.colorTheme || "riftgate");

    toggleLaunchAtStartup.checked = settings.launchAtStartup;
    toggleRunInBackground.checked = settings.runInBackground;
    toggleConfirmRemove.checked = settings.confirmBeforeRemove;
    defaultCategorySelect.value = settings.defaultCategory || "ask";
    startupSectionSelect.value = settings.startupSection || "new";
    gridDensitySelect.value = settings.gridDensity || "comfortable";
    trailerVolumeSlider.value = settings.trailerVolume;
    updateVolumeSliderFill();

    applyGridDensity(settings.gridDensity || "comfortable");

    movieCountrySelect.value = settings.movieCountry || "US";
    populateCitySelect(movieCountrySelect.value, settings.movieCity);
}

async function loadSettings() {
    settings = await ipcRenderer.invoke("load-settings");

    if (Array.isArray(settings.categoryOrder) && settings.categoryOrder.length === CATEGORY_ORDER.length) {
        CATEGORY_ORDER = settings.categoryOrder;
    }

    applySettingsToUI();
}

async function saveSetting(key, value) {
    settings[key] = value;
    await ipcRenderer.invoke("save-settings", { [key]: value });
}

toggleUiSounds.addEventListener("change", () => saveSetting("uiSounds", toggleUiSounds.checked));
toggleStartupSound.addEventListener("change", () => saveSetting("startupSound", toggleStartupSound.checked));
toggleStartupAnimation.addEventListener("change", () => saveSetting("startupAnimation", toggleStartupAnimation.checked));
toggleHoverTrailers.addEventListener("change", () => saveSetting("hoverTrailers", toggleHoverTrailers.checked));
toggleAmbientBg.addEventListener("change", () => saveSetting("ambientBackground", toggleAmbientBg.checked));

toggleLightTheme.addEventListener("change", () => {
    applyTheme(toggleLightTheme.checked);
    saveSetting("lightTheme", toggleLightTheme.checked);
});

// --- Custom titlebar (window is frameless) ---------------------------

const winMinBtn = document.getElementById("winMinBtn");
const winMaxBtn = document.getElementById("winMaxBtn");
const winCloseBtn = document.getElementById("winCloseBtn");

winMinBtn.addEventListener("click", () => ipcRenderer.invoke("window-minimize"));
winCloseBtn.addEventListener("click", () => ipcRenderer.invoke("window-close"));

winMaxBtn.addEventListener("click", async () => {
    const isMaximized = await ipcRenderer.invoke("window-maximize-toggle");
    winMaxBtn.textContent = isMaximized ? "❐" : "▢";
});

ipcRenderer.on("maximize-changed", (event, isMaximized) => {
    winMaxBtn.textContent = isMaximized ? "❐" : "▢";
});

// Fullscreen is live window state, not a saved preference — talk to the
// main process directly rather than going through settings.json.
toggleFullscreen.addEventListener("change", () => {
    ipcRenderer.invoke("toggle-fullscreen");
});

// Keep the checkbox in sync no matter how fullscreen was toggled (this
// button, F11, or the OS's own window controls).
ipcRenderer.on("fullscreen-changed", (event, isFullscreen) => {
    toggleFullscreen.checked = isFullscreen;
    document.body.classList.toggle("is-fullscreen", isFullscreen);
});

refreshMetadataBtn.addEventListener("click", async () => {
    refreshMetadataBtn.textContent = "🔄 Refreshing...";
    allGames = await ipcRenderer.invoke("refresh-metadata");
    renderLibrary();
    refreshMetadataBtn.textContent = "🔄 Refresh All Metadata";
});

function updateSidebarStats() {
    const counts = { game: 0, app: 0, vr: 0, other: 0 };
    let totalLaunches = 0;

    allGames.forEach((g) => {
        counts[g.category || "game"]++;
        totalLaunches += g.launches || 0;
    });

    statCounts.textContent = `🎮 ${counts.game} · 🖥️ ${counts.app} · 🥽 ${counts.vr} · 📦 ${counts.other}`;
    statLaunches.textContent = `🚀 ${totalLaunches} total launches`;
}

// --- Sound effects (synthesized, no audio files needed) -------------------

let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playStartupChime() {
    if (!settings.startupSound) return;

    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    // Four quick, percussive "pieces snapping together" ticks, timed to
    // land roughly with the diamond quadrants assembling, then a final
    // resonant chord once it's fully formed.
    const clicks = [
        { freq: 1200, start: 0.00 },
        { freq: 1400, start: 0.10 },
        { freq: 1600, start: 0.20 },
        { freq: 1800, start: 0.30 }
    ];

    clicks.forEach((c) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.value = c.freq;

        gain.gain.setValueAtTime(0, now + c.start);
        gain.gain.linearRampToValueAtTime(0.12, now + c.start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + c.start + 0.09);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now + c.start);
        osc.stop(now + c.start + 0.12);
    });

    const notes = [
        { freq: 440.00, start: 0.45, dur: 0.30 },
        { freq: 659.25, start: 0.57, dur: 0.42 },
        { freq: 880.00, start: 0.69, dur: 0.55 }
    ];

    notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = n.freq;

        gain.gain.setValueAtTime(0, now + n.start);
        gain.gain.linearRampToValueAtTime(0.16, now + n.start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.05);
    });
}

let lastHoveredEl = null;

function playHoverTick() {
    if (!settings.uiSounds) return;

    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 920;

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
}

function playClickTick() {
    if (!settings.uiSounds) return;

    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.08);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
}

const SOUND_TARGET_SELECTOR = 'button, input[type="checkbox"], label.sidebar-toggle';

document.addEventListener("mouseover", (event) => {
    const el = event.target.closest(SOUND_TARGET_SELECTOR);
    if (el && el !== lastHoveredEl) {
        lastHoveredEl = el;
        playHoverTick();
    }
});

document.addEventListener("mouseout", (event) => {
    const el = event.target.closest(SOUND_TARGET_SELECTOR);
    if (el && el === lastHoveredEl && !el.contains(event.relatedTarget)) {
        lastHoveredEl = null;
    }
});

document.addEventListener("click", (event) => {
    const el = event.target.closest(SOUND_TARGET_SELECTOR);
    if (el) playClickTick();
});

// --- Rendering -----------------------------------------------------------

function matchesSearch(game) {
    if (!searchTerm) return true;
    if (game.name.toLowerCase().includes(searchTerm)) return true;
    if (game.tags && game.tags.some((t) => t.toLowerCase().includes(searchTerm))) return true;
    return false;
}

function sortGames(games) {
    const sorted = [...games];

    sorted.sort((a, b) => {
        // Favorites float to the top in every sort mode EXCEPT custom —
        // if the user is manually dragging things around, that's an
        // explicit choice that shouldn't get silently overridden.
        if (sortMode !== "custom") {
            const favDiff = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
            if (favDiff !== 0) return favDiff;
        }

        if (sortMode === "recent-played") {
            return (b.lastPlayed || 0) - (a.lastPlayed || 0);
        }
        if (sortMode === "recent-added") {
            return (b.addedAt || 0) - (a.addedAt || 0);
        }
        if (sortMode === "most-played") {
            return (b.playtimeSeconds || 0) - (a.playtimeSeconds || 0);
        }
        if (sortMode === "custom") {
            return (a.order || 0) - (b.order || 0);
        }
        return a.name.localeCompare(b.name);
    });

    return sorted;
}

function renderLibrary() {

    libraryContainer.innerHTML = "";

    if (allGames.length === 0) {
        introScreen.classList.add("active");
    } else {
        introScreen.classList.remove("active");
    }

    CATEGORY_ORDER.forEach((category) => {

        let gamesInCategory = allGames
            .filter((g) => (g.category || "game") === category)
            .filter(matchesSearch);

        gamesInCategory = sortGames(gamesInCategory);

        if (gamesInCategory.length === 0) return;

        const section = document.createElement("div");
        section.className = "category-section";

        const heading = document.createElement("h2");
        heading.textContent = CATEGORY_LABELS[category];
        heading.title = "Drag to swap this section's position with another";
        heading.draggable = true;
        heading.dataset.category = category;

        heading.addEventListener("dragstart", (event) => {
            draggedCategoryKey = category;
            event.dataTransfer.effectAllowed = "move";
        });

        heading.addEventListener("dragover", (event) => {
            if (!draggedCategoryKey || draggedCategoryKey === category) return;
            event.preventDefault();
            heading.classList.add("heading-drag-over");
        });

        heading.addEventListener("dragleave", () => {
            heading.classList.remove("heading-drag-over");
        });

        heading.addEventListener("drop", (event) => {
            event.preventDefault();
            heading.classList.remove("heading-drag-over");
            if (!draggedCategoryKey || draggedCategoryKey === category) return;

            const fromIndex = CATEGORY_ORDER.indexOf(draggedCategoryKey);
            const toIndex = CATEGORY_ORDER.indexOf(category);
            if (fromIndex === -1 || toIndex === -1) return;

            const newOrder = [...CATEGORY_ORDER];
            [newOrder[fromIndex], newOrder[toIndex]] = [newOrder[toIndex], newOrder[fromIndex]];
            CATEGORY_ORDER = newOrder;

            saveSetting("categoryOrder", CATEGORY_ORDER);
            draggedCategoryKey = null;
            renderLibrary();
        });

        section.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "games-grid";
        section.appendChild(grid);

        grid.addEventListener("dragover", (event) => {
            if (draggedGamePath || event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
            }
        });

        grid.addEventListener("drop", async (event) => {

            if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                await addGameFromExternalFile(file.path, category);
                return;
            }

            // Only handle internal reorder drops on empty grid space — drops
            // directly on a card are already handled by that card's own
            // listener, and this would double-fire since the event bubbles
            // up to the grid.
            if (event.target !== grid || !draggedGamePath) return;
            event.preventDefault();
            reorderGames(draggedGamePath, category, null);
        });

        gamesInCategory.forEach((game) => {
            const card = buildCard(game);
            grid.appendChild(card);

            if (!game.description) {
                ensureDescription(game, card);
            }
        });

        libraryContainer.appendChild(section);
    });

    updateSidebarStats();
}

function formatPlaytime(seconds) {
    if (!seconds || seconds < 60) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `⏱ ${hours}h ${minutes}m`;
    return `⏱ ${minutes}m`;
}

function buildCard(game) {

    const card = document.createElement("div");

    card.className = "game-card";
    card.dataset.path = game.path;
    card.draggable = true;

    const image =
        game.image || "covers/default.jpg";

    const description =
        game.description || "Loading description...";

    const category = game.category || "game";

    const isDefaultCover = !game.image || game.image === "covers/default.jpg";

    const playtimeText = formatPlaytime(game.playtimeSeconds);
    const hasNotes = !!(game.notes || (game.tags && game.tags.length));

    card.innerHTML = `
    <div class="categoryPicker">
        <button class="categoryBadge" title="Change category">${CATEGORY_BADGES[category]}</button>
        <div class="categoryFlyout">
            <div class="categoryFlyout-inner">
                <button class="categoryFlyoutOption" data-category="game">🎮 Game</button>
                <button class="categoryFlyoutOption" data-category="app">🖥️ App</button>
                <button class="categoryFlyoutOption" data-category="vr">🥽 VR</button>
                <button class="categoryFlyoutOption" data-category="other">📦 Other</button>
            </div>
        </div>
    </div>
    <button class="favoriteBtn ${game.favorite ? "active" : ""}" title="Favorite">${game.favorite ? "★" : "☆"}</button>

    <div class="cover-wrap">
        <img class="cover-img" src="${image}" alt="${game.name}">
        <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
        <button class="enlargeBtn" title="Watch larger">⛶</button>
        <button class="manualCoverBtn" title="${isDefaultCover ? "Choose a cover image" : "Change cover image"}">🖼️ ${isDefaultCover ? "Add cover" : "Change cover"}</button>
    </div>

    <button class="removeBtn">✕</button>

    <div class="game-info">
        <h3>${game.name}</h3>
        ${playtimeText ? `<p class="game-playtime">${playtimeText}</p>` : ""}
        <p class="game-desc">${description}</p>
        <div class="card-footer">
            <button class="launchBtn">Launch</button>
            <button class="pathBtn" title="Show file path">📂</button>
            ${category === "game" || category === "vr" ? '<button class="modsBtn" title="Find mods">🧩</button>' : ""}
            <button class="notesBtn ${hasNotes ? "has-notes" : ""}" title="Notes & tags">📝</button>
        </div>
    </div>
`;

    const launchBtn = card.querySelector(".launchBtn");

    launchBtn.addEventListener("click", async () => {

        if (launchBtn.classList.contains("running")) {
            // Some launchers hand off to a differently-named process that
            // our polling can't follow, so "Running" can occasionally get
            // stuck even after the app closed — clicking it again lets the
            // user manually clear that.
            const confirmed = confirm(`Still shows as Running. Has ${game.name} actually closed?`);
            if (confirmed) {
                await ipcRenderer.invoke("force-stop-tracking", game.path);
                launchBtn.textContent = "Launch";
                launchBtn.classList.remove("running");
            }
            return;
        }

        const result = await ipcRenderer.invoke("launch-app", game.path);

        if (result && result.started) {
            launchBtn.textContent = "Running";
            launchBtn.classList.add("running");
        }

        if (result && result.launches) {
            game.launches = result.launches;
            checkMilestone(game);
        }
    });

    card.querySelector(".favoriteBtn")
        .addEventListener("click", async (event) => {
            event.stopPropagation();

            game.favorite = !game.favorite;

            await ipcRenderer.invoke(
                "update-game",
                { path: game.path, favorite: game.favorite }
            );

            renderLibrary();
        });

    card.querySelector(".notesBtn")
        .addEventListener("click", (event) => {
            event.stopPropagation();
            openNotesModal(game);
        });

    card.querySelector(".removeBtn")
        .addEventListener("click", async () => {

            const confirmed =
                !settings.confirmBeforeRemove || confirm(`Remove ${game.name}?`);

            if (!confirmed) return;

            await ipcRenderer.invoke(
                "remove-game",
                game.path
            );

            allGames = allGames.filter((g) => g.path !== game.path);
            renderLibrary();
        });

    card.querySelector(".pathBtn")
        .addEventListener("click", () => {
            openPathModal(game.path);
        });

    const modsBtn = card.querySelector(".modsBtn");
    if (modsBtn) {
        modsBtn.addEventListener("click", () => openMods(game));
    }

    let descHoverTimer = null;
    const descEl = card.querySelector(".game-desc");

    descEl.addEventListener("mouseenter", () => {
        clearTimeout(descHoverTimer);
        descHoverTimer = setTimeout(() => {
            if (game.description) {
                openDescModal(game.name, game.description, descEl);
            }
        }, 1000);
    });

    descEl.addEventListener("mouseleave", () => {
        clearTimeout(descHoverTimer);
        closeDescModal();
    });

    card.querySelectorAll(".categoryFlyoutOption")
        .forEach((btn) => {
            btn.addEventListener("click", async (event) => {
                event.stopPropagation();

                const newCategory = btn.dataset.category;

                if (newCategory === (game.category || "game")) return;

                game.category = newCategory;

                await ipcRenderer.invoke(
                    "update-game",
                    { path: game.path, category: newCategory }
                );

                renderLibrary();
            });
        });

    card.querySelector(".soundToggle")
        .addEventListener("click", (event) => {
            event.stopPropagation();
            soundEnabled = !soundEnabled;
            updateAllSoundToggles();
            applySoundToAllFrames();
        });

    card.querySelector(".enlargeBtn")
        .addEventListener("click", async (event) => {
            event.stopPropagation();
            let trailerId = game.trailerId;
            if (trailerId === undefined) {
                trailerId = await ipcRenderer.invoke("fetch-trailer", game.searchName || game.name, game.category || "game", game.description);
                game.trailerId = trailerId;
                if (trailerId) {
                    await ipcRenderer.invoke("update-game", { path: game.path, trailerId });
                }
            }
            if (trailerId) openTheaterMode(trailerId);
        });

    const manualCoverBtn = card.querySelector(".manualCoverBtn");

    if (manualCoverBtn) {
        manualCoverBtn.addEventListener("click", async (event) => {
            event.stopPropagation();

            const newCover = await ipcRenderer.invoke("select-cover-image", game.name);

            if (!newCover) return;

            game.image = newCover;

            await ipcRenderer.invoke(
                "update-game",
                { path: game.path, image: newCover }
            );

            renderLibrary();
        });
    }

    // --- Hover-to-preview trailer + ambient background ---

    let hoverTimer = null;

    card.addEventListener("mouseenter", () => {
        setAmbientTheme(game.category || "game");

        if (settings.hoverTrailers) {
            hoverTimer = setTimeout(() => showTrailer(game, card), 350);
        }
    });

    card.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        hideTrailer(card);
        // Ambient background is sticky on purpose — it stays until another
        // card is hovered, so nothing changes here.
    });

    // --- Drag and drop reordering (also allows dropping into another
    // category), plus dropping a shortcut/exe straight from Explorer ---

    card.addEventListener("dragstart", (event) => {
        draggedGamePath = game.path;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        document.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    });

    card.addEventListener("dragover", (event) => {
        if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            return;
        }
        if (!draggedGamePath || draggedGamePath === game.path) return;
        event.preventDefault();
        card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
        card.classList.remove("drag-over");
    });

    card.addEventListener("drop", async (event) => {
        event.preventDefault();
        card.classList.remove("drag-over");

        if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
            const file = event.dataTransfer.files[0];
            await addGameFromExternalFile(file.path, game.category || "game");
            return;
        }

        if (!draggedGamePath || draggedGamePath === game.path) return;

        // Which half of the card was it dropped on? Left = insert before,
        // right = insert after — this is what makes it possible to land
        // something after the very last card in a row.
        const rect = card.getBoundingClientRect();
        const insertAfter = (event.clientX - rect.left) > rect.width / 2;

        reorderGames(
            draggedGamePath,
            game.category || "game",
            game.path,
            insertAfter,
            card.closest(".games-grid")
        );
    });

    return card;
}

// Adds a game dropped in from outside Riftgate (a desktop/folder shortcut
// or .exe dragged straight in). Resolves .lnk shortcuts to their real
// target first, then runs through the normal add flow.
// Prefers the exe's real embedded name (e.g. "Google Chrome" from
// chrome.exe) over the bare filename, so cover/description/trailer lookups
// search for the right thing instead of a shortened/generic name.
async function resolveRealName(exePath, fallbackName) {
    if (!exePath.toLowerCase().endsWith(".exe")) return fallbackName;

    const description = await ipcRenderer.invoke("get-exe-description", exePath);

    if (description && description.length > 1 && description.toLowerCase() !== fallbackName.toLowerCase()) {
        return description;
    }

    return fallbackName;
}

async function addGameFromExternalFile(filePath, category) {

    const resolvedPath = await ipcRenderer.invoke("resolve-shortcut", filePath);

    if (allGames.some((g) => g.path === resolvedPath)) return;

    const rawName = resolvedPath
        .split("\\")
        .pop()
        .replace(/\.(exe|lnk)$/i, "");

    const gameName = await resolveRealName(resolvedPath, rawName);

    const override = await ipcRenderer.invoke("get-override", gameName);

    let cover = override && override.image ? override.image : null;

    if (!cover) {
        cover = await ipcRenderer.invoke("find-cover", gameName);

        if (cover === "covers/default.jpg") {
            cover = await ipcRenderer.invoke("fetch-online-cover", gameName);
        }
    }

    if (!cover) {
        cover = "covers/default.jpg";
    }

    const game = {
        name: gameName,
        path: resolvedPath,
        image: cover,
        category: category || "game"
    };

    if (override && override.trailerId) {
        game.trailerId = override.trailerId;
    }

    await ipcRenderer.invoke("save-game", game);

    allGames.push(game);
    renderLibrary();
}


async function showTrailer(game, card) {

    if (!settings.hoverTrailers) return;

    const coverWrap = card.querySelector(".cover-wrap");

    if (!coverWrap || coverWrap.querySelector(".trailer-frame")) {
        return;
    }

    let trailerId = game.trailerId;

    if (trailerId === undefined) {
        trailerId = await ipcRenderer.invoke("fetch-trailer", game.searchName || game.name, game.category || "game", game.description);
        game.trailerId = trailerId;

        if (trailerId) {
            await ipcRenderer.invoke(
                "update-game",
                { path: game.path, trailerId }
            );
        }
    }

    // The mouse may have already left before the fetch finished
    if (!card.matches(":hover") || !trailerId || !settings.hoverTrailers) {
        return;
    }

    const iframe = document.createElement("iframe");
    iframe.className = "trailer-frame";
    iframe.src =
        `https://www.youtube.com/embed/${trailerId}` +
        `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${trailerId}` +
        `&modestbranding=1&rel=0&showinfo=0&enablejsapi=1`;
    iframe.allow = "autoplay; encrypted-media";
    iframe.frameBorder = "0";

    coverWrap.appendChild(iframe);

    // Give the embedded player a moment to actually initialize before
    // sending it a volume command.
    setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
}

function hideTrailer(card) {
    const frame = card.querySelector(".trailer-frame");
    if (frame) frame.remove();
}

// Opens a mod search for the game in the browser — nothing else. Google's
// own ranking naturally surfaces the most popular/relevant modding sites
// first, so no artificial site-bias is needed here.
function openMods(game) {
    const query = encodeURIComponent(`${game.searchName || game.name} mods`);
    ipcRenderer.invoke("open-external", `https://www.google.com/search?q=${query}`);
}

function updateAllSoundToggles() {
    document.querySelectorAll(".soundToggle").forEach((btn) => {
        btn.textContent = soundEnabled ? "🔊" : "🔇";
    });
}

function postPlayerCommand(iframe, func, args) {
    if (!iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: args || [] }),
        "*"
    );
}

function applySoundToAllFrames() {
    document.querySelectorAll(".trailer-frame").forEach((frame) => {
        // postMessage mute/unMute commands can get silently dropped if the
        // embedded player's message channel isn't fully ready yet — instead,
        // rebuild the iframe's own URL with the correct mute param, which
        // reloads it in the right state instantly and reliably every time.
        try {
            const url = new URL(frame.src);
            url.searchParams.set("mute", soundEnabled ? "0" : "1");
            url.searchParams.set("autoplay", "1");
            frame.src = url.toString();
        } catch (err) {
            postPlayerCommand(frame, soundEnabled ? "unMute" : "mute");
        }
    });
}

function applyVolumeToAllFrames() {
    document.querySelectorAll(".trailer-frame").forEach((frame) => {
        postPlayerCommand(frame, "setVolume", [settings.trailerVolume]);
    });
}

async function ensureDescription(game, card) {

    const description =
        await ipcRenderer.invoke(
            "fetch-description",
            game.searchName || game.name
        );

    const finalText =
        description || "No description available.";

    game.description = finalText;

    const descEl = card.querySelector(".game-desc");

    if (descEl) {
        descEl.textContent = finalText;
    }

    if (description) {
        await ipcRenderer.invoke(
            "update-game",
            { path: game.path, description }
        );
    }
}

// When a launched process exits, flip its card's button back to "Launch"
// and refresh its playtime total (and check for a milestone).
ipcRenderer.on("app-exited", (event, payload) => {
    const exePath = payload.path;
    const card = libraryContainer.querySelector(`[data-path="${CSS.escape(exePath)}"]`);
    if (!card) return;

    const launchBtn = card.querySelector(".launchBtn");
    if (launchBtn) {
        launchBtn.textContent = "Launch";
        launchBtn.classList.remove("running");
    }

    const game = allGames.find((g) => g.path === exePath);
    if (game && payload.playtimeSeconds !== null && payload.playtimeSeconds !== undefined) {
        game.playtimeSeconds = payload.playtimeSeconds;

        const playtimeText = formatPlaytime(game.playtimeSeconds);
        let playtimeEl = card.querySelector(".game-playtime");

        if (playtimeText) {
            if (!playtimeEl) {
                playtimeEl = document.createElement("p");
                playtimeEl.className = "game-playtime";
                card.querySelector("h3").insertAdjacentElement("afterend", playtimeEl);
            }
            playtimeEl.textContent = playtimeText;
        }
    }
});

async function loadGames() {

    allGames =
        await ipcRenderer.invoke(
            "load-games"
        );

    renderLibrary();
}

addBtn.addEventListener(
    "click",
    async () => {

        const exePath =
            await ipcRenderer.invoke(
                "select-exe"
            );

        if (!exePath) return;

        const rawName =
            exePath
                .split("\\")
                .pop()
                .replace(".exe", "");

        const gameName = await resolveRealName(exePath, rawName);

        const category =
            settings.defaultCategory && settings.defaultCategory !== "ask"
                ? settings.defaultCategory
                : await askCategory();

        const override = await ipcRenderer.invoke("get-override", gameName);

        let cover = override && override.image ? override.image : null;

        if (!cover) {
            cover = await ipcRenderer.invoke(
                "find-cover",
                gameName
            );

            // No local match found, try fetching one online (SteamGridDB)
            if (cover === "covers/default.jpg") {
                cover = await ipcRenderer.invoke(
                    "fetch-online-cover",
                    gameName
                );
            }
        }

        // Online lookup also failed — don't interrupt the flow with a file
        // picker. Fall back to the placeholder; a small "Add cover" button
        // shows up on the card so the user can pick one manually whenever
        // they want, instead of being forced to right now.
        if (!cover) {
            cover = "covers/default.jpg";
        }

        const game = {
            name: gameName,
            path: exePath,
            image: cover,
            category: category
        };

        if (override && override.trailerId) {
            game.trailerId = override.trailerId;
        }

        await ipcRenderer.invoke(
            "save-game",
            game
        );

        allGames.push(game);
        renderLibrary();
    }
);

const GAMING_FACTS = [
    "The best-selling video game console of all time is the PlayStation 2, with over 155 million units sold.",
    "Tetris was created in 1984 by Soviet software engineer Alexey Pajitnov.",
    "The word \"esports\" first appeared in reference to a 1980s Space Invaders tournament run by Atari.",
    "Minecraft has sold over 300 million copies, making it the best-selling video game of all time.",
    "The first commercially successful video game was Pong, released by Atari in 1972.",
    "Shigeru Miyamoto originally designed Mario as a carpenter, not a plumber.",
    "The longest video game marathon on a racing game lasted over 48 hours.",
    "Super Mario Bros. was originally going to be called \"Jumpman\" after Mario's arcade debut in Donkey Kong.",
    "The Legend of Zelda's Hyrule was inspired by the countryside around Kyoto, Japan, where Miyamoto grew up.",
    "Pac-Man's name comes from the Japanese onomatopoeia \"paku-paku,\" the sound of a mouth opening and closing.",
    "The first video game console, the Magnavox Odyssey, was released in 1972 and used cartridges with no processor.",
    "World of Warcraft once had more subscribers than the population of several small countries.",
    "Space Invaders was so popular in Japan in 1978 that it caused a national coin shortage.",
    "The GTA series has sold over 415 million copies combined across the franchise.",
    "Doom (1993) was so influential that first-person shooters were once informally called \"Doom clones.\"",
    "The PlayStation was originally developed as a Nintendo peripheral before Sony made it standalone.",
    "Pokémon is one of the highest-grossing media franchises in history, spanning games, cards, and shows.",
    "The Sims is the best-selling PC game franchise of all time.",
    "Speedrunning communities have completed some games in well under 10 minutes through frame-perfect tricks.",
    "The first esports tournament was held in 1972 at Stanford University for the game Spacewar!",
];

const MOVIE_FACTS = [
    "The first movie ever made, \"Roundhay Garden Scene\" (1888), is only about 2 seconds long.",
    "Titanic and Avatar, both directed by James Cameron, were the two highest-grossing films for over a decade.",
    "The Wilhelm Scream is a famous sound effect that has been reused in hundreds of films since 1951.",
    "Marlon Brando was paid a percentage of the profits for \"Superman\" instead of a flat fee for his brief role.",
    "\"Breaking Bad\" was originally pitched as a story about a man turning into a fly, before becoming about chemistry.",
    "The Friends cast famously negotiated as a group to each earn $1 million per episode by the show's later seasons.",
    "Alfred Hitchcock made a cameo appearance in almost every one of his own films.",
    "The Simpsons is the longest-running American scripted primetime TV series in history.",
    "The word \"Oscar\" for the Academy Award is said to have come from a librarian remarking the statue looked like her uncle Oscar.",
    "Peter Jackson's Lord of the Rings trilogy was filmed almost entirely back-to-back before any film was released.",
    "Stan Lee has a cameo in nearly every Marvel Cinematic Universe film released during his lifetime.",
    "\"Game of Thrones\" was filmed across more countries than almost any other TV series, including Iceland, Croatia, and Morocco.",
];

const factQueues = {}; // one shuffled queue per section, so facts don't repeat too soon
let lastFactShown = {}; // last fact shown per section, to avoid an immediate repeat on reshuffle

function getNextFact(sectionKey, facts) {
    if (!factQueues[sectionKey] || factQueues[sectionKey].length === 0) {
        factQueues[sectionKey] = shuffle(facts);

        if (factQueues[sectionKey].length > 1 && factQueues[sectionKey][0] === lastFactShown[sectionKey]) {
            [factQueues[sectionKey][0], factQueues[sectionKey][1]] = [factQueues[sectionKey][1], factQueues[sectionKey][0]];
        }
    }

    const next = factQueues[sectionKey].shift();
    lastFactShown[sectionKey] = next;
    return next;
}

function showNextFact() {
    const track = document.getElementById("factTickerTrack");
    if (!track) return;

    const sectionKey = currentSection === "theatre" ? "theatre" : "games";
    const facts = sectionKey === "theatre" ? MOVIE_FACTS : GAMING_FACTS;
    const icon = sectionKey === "theatre" ? "🎬" : "🎮";

    track.innerHTML = "";

    const item = document.createElement("span");
    item.className = "fact-ticker-item";
    item.textContent = `${icon} ${getNextFact(sectionKey, facts)}`;
    track.appendChild(item);

    item.addEventListener("animationend", () => {
        item.remove();
        setTimeout(showNextFact, 5000);
    });
}

function initFactTicker() {
    showNextFact();
}

// --- Section switching (Installed / Free Games / Applications / Theatre) ---

const sectionTitle = document.getElementById("sectionTitle");
const sectionOptions = document.querySelectorAll(".sectionOption");
const sidebarNavButtons = document.querySelectorAll(".sidebarNavBtn");
const installedTopbar = document.getElementById("installedTopbar");
const installedBlurb = document.getElementById("installedBlurb");
const theatreTopbar = document.getElementById("theatreTopbar");
const freeGamesContainer = document.getElementById("freeGamesContainer");
const applicationsContainer = document.getElementById("applicationsContainer");
const theatreContainer = document.getElementById("theatreContainer");

// --- Language / translation ------------------------------------------------
// Covers Riftgate's own static UI chrome (nav, headings, blurbs, common
// buttons and placeholders). Content pulled live from external APIs
// (movie descriptions, game names, etc.) stays in whatever language that
// source returns — translating that would need a separate machine
// translation service, not just a UI dictionary.

const SECTION_LABELS = {
    installed: "📀 Installed",
    "free-games": "🎁 Free Games",
    applications: "🧰 Applications",
    theatre: "🎬 Theatre",
    new: "🆕 New"
};

let freeGamesLoaded = false;
let moviesLoaded = false;
let currentSection = "installed";

// Floating icon sets for the ambient background layer — generic gaming
// peripherals and generic cinema objects (not any copyrighted character or
// trademarked logo), so each section feels distinct but consistent with
// the others in style.
const AMBIENT_ICON_SETS = {
    gaming: ["🎮", "🕹️", "🖱️", "⌨️", "🎯", "🥽"],
    cinema: ["🎬", "🎞️", "🍿", "🎫", "📺", "🎭"],
    apps: ["🧰", "🖥️", "📱", "💾", "🗂️", "⚙️"]
};

function setAmbientIcons(section) {
    const layer = document.getElementById("ambientIconsLayer");
    if (!layer) return;

    let iconSet;
    if (section === "theatre") {
        iconSet = AMBIENT_ICON_SETS.cinema;
    } else if (section === "applications") {
        iconSet = AMBIENT_ICON_SETS.apps;
    } else if (section === "new") {
        iconSet = [...AMBIENT_ICON_SETS.gaming, ...AMBIENT_ICON_SETS.cinema];
    } else {
        iconSet = AMBIENT_ICON_SETS.gaming;
    }

    layer.innerHTML = "";

    const count = 16;
    for (let i = 0; i < count; i++) {
        const icon = document.createElement("span");
        icon.className = "ambient-icon";
        icon.textContent = iconSet[i % iconSet.length];

        const size = 26 + Math.random() * 30; // 26-56px
        const left = Math.random() * 100;
        const duration = 26 + Math.random() * 22; // 26-48s
        const delay = -Math.random() * duration; // stagger start positions

        icon.style.left = `${left}vw`;
        icon.style.fontSize = `${size}px`;
        icon.style.animationDuration = `${duration}s`;
        icon.style.animationDelay = `${delay}s`;

        layer.appendChild(icon);
    }
}

function switchSection(section) {
    currentSection = section;
    sectionTitle.textContent = SECTION_LABELS[section];
    setAmbientIcons(section);

    sidebarNavButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === section);
    });

    const isInstalled = section === "installed";
    installedTopbar.style.display = isInstalled ? "" : "none";
    installedBlurb.style.display = isInstalled ? "" : "none";
    libraryContainer.style.display = isInstalled ? "" : "none";
    introScreen.classList.toggle("active", isInstalled && allGames.length === 0);

    theatreTopbar.style.display = section === "theatre" ? "" : "none";

    freeGamesContainer.classList.toggle("active", section === "free-games");
    applicationsContainer.classList.toggle("active", section === "applications");
    theatreContainer.classList.toggle("active", section === "theatre");
    document.getElementById("newContainer").classList.toggle("active", section === "new");

    if (section === "free-games" && !freeGamesLoaded) {
        freeGamesLoaded = true;
        loadFreeGames();
    }

    if (section === "theatre") {
        loadMyShows();
        loadRecentEpisodes();
        if (!moviesLoaded) {
            moviesLoaded = true;
            loadMovies();
        }
    }

    if (section === "new") {
        loadNewSection();
    }
}

sectionOptions.forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

sidebarNavButtons.forEach((btn) => {
    btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

// --- Free Games (Epic + Steam) --------------------------------------------

// Collapses a grid to 2 rows with a "See more" toggle, if it has more than
// that — used for every browsable grid (Installed categories, Free Games,
// My Shows, Movies) so long lists don't dominate the screen by default.
function attachSeeMore(grid, rowsVisible = 2) {
    const next = grid.nextElementSibling;
    if (next && next.classList.contains("see-more-btn")) {
        next.remove();
    }

    grid.classList.remove("grid-collapsed");
    grid.style.maxHeight = "";

    requestAnimationFrame(() => {
        const cards = Array.from(grid.children);
        if (cards.length === 0) return;

        const tops = [...new Set(cards.map((c) => c.offsetTop))].sort((a, b) => a - b);
        if (tops.length <= rowsVisible) return;

        const maxHeight = tops[rowsVisible] - tops[0];

        grid.classList.add("grid-collapsed");
        grid.style.maxHeight = `${maxHeight}px`;

        const btn = document.createElement("button");
        btn.className = "see-more-btn";
        btn.textContent = "▾ See more";

        btn.addEventListener("click", () => {
            const isCollapsed = grid.classList.toggle("grid-collapsed");
            grid.style.maxHeight = isCollapsed ? `${maxHeight}px` : "";
            btn.textContent = isCollapsed ? "▾ See more" : "▴ See less";
        });

        grid.insertAdjacentElement("afterend", btn);
    });
}

function buildFreeGameCard(game) {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
        <div class="cover-wrap">
            <img class="cover-img" src="${game.image || "covers/default.jpg"}" alt="${game.name}">
            <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
            <button class="enlargeBtn" title="Watch larger">⛶</button>
        </div>
        <div class="game-info">
            <h3>${game.name}</h3>
            <p class="game-desc">${game.description || `Free on ${game.source}.`}</p>
            <div class="card-footer">
                <button class="launchBtn getGameBtn">🔗 Get It Free (${game.source})</button>
            </div>
        </div>
    `;

    card.querySelector(".getGameBtn").addEventListener("click", () => {
        ipcRenderer.invoke("open-external", game.url);
    });

    card.querySelector(".soundToggle").addEventListener("click", (event) => {
        event.stopPropagation();
        soundEnabled = !soundEnabled;
        updateAllSoundToggles();
        applySoundToAllFrames();
    });

    const coverWrap = card.querySelector(".cover-wrap");
    let hoverTimer = null;
    let trailerId;

    async function fetchTrailerOnce() {
        if (trailerId === undefined) {
            trailerId = await ipcRenderer.invoke("fetch-trailer", game.name, "game", game.description);
        }
        return trailerId;
    }

    card.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(async () => {
            const id = await fetchTrailerOnce();
            if (!id || !card.matches(":hover") || coverWrap.querySelector(".trailer-frame")) return;

            const iframe = document.createElement("iframe");
            iframe.className = "trailer-frame";
            iframe.src =
                `https://www.youtube.com/embed/${id}` +
                `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${id}` +
                `&modestbranding=1&rel=0`;
            iframe.allow = "autoplay; encrypted-media";
            iframe.frameBorder = "0";
            coverWrap.appendChild(iframe);

            setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
        }, 350);
    });

    card.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        const frame = coverWrap.querySelector(".trailer-frame");
        if (frame) frame.remove();
    });

    card.querySelector(".enlargeBtn").addEventListener("click", async (event) => {
        event.stopPropagation();
        const id = await fetchTrailerOnce();
        if (id) openTheaterMode(id);
    });

    return card;
}

let freeGamesCache = [];

const freeGamesSearchInput = document.getElementById("freeGamesSearchInput");
const freeGamesCategorySelect = document.getElementById("freeGamesCategorySelect");

freeGamesSearchInput.addEventListener("input", renderFreeGames);
freeGamesCategorySelect.addEventListener("change", () => {
    selectedPlatform = null;
    renderFreeGames();
});

let selectedPlatform = null; // null = show all platforms; otherwise show only this one

const PLATFORM_BADGES = {
    "Steam": { icon: "🟦", label: "STEAM" },
    "Epic Games": { icon: "⬛", label: "EPIC GAMES" }
};

function renderFreeGames() {
    const newRow = document.getElementById("freeGamesNewRow");
    const restRow = document.getElementById("freeGamesRestRow");

    const searchTerm = freeGamesSearchInput.value.trim().toLowerCase();
    const categoryFilter = freeGamesCategorySelect.value;

    const filtered = freeGamesCache.filter((g) => {
        if (searchTerm && !g.name.toLowerCase().includes(searchTerm)) return false;
        if (categoryFilter !== "all") {
            const cat = (g.tags && g.tags[0]) || g.source;
            if (cat !== categoryFilter) return false;
        }
        return true;
    });

    newRow.innerHTML = "";
    restRow.innerHTML = "";

    if (filtered.length === 0) {
        restRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;text-align:center;">No free games match your search or filter.</p>`;
        return;
    }

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newlyAdded = filtered.filter((g) => (g.firstSeenAt || 0) > oneWeekAgo);
    const rest = filtered.filter((g) => (g.firstSeenAt || 0) <= oneWeekAgo);

    if (newlyAdded.length > 0) {
        const section = document.createElement("div");
        section.className = "category-section";
        const heading = document.createElement("h2");
        heading.textContent = "🆕 Newly Added";
        section.appendChild(heading);
        const grid = document.createElement("div");
        grid.className = "games-grid browse-grid";
        newlyAdded.forEach((g) => grid.appendChild(buildFreeGameCard(g)));
        section.appendChild(grid);
        newRow.appendChild(section);
        attachSeeMore(grid);
    }

    // "All Categories" divides the list by PLATFORM instead, each with a
    // clickable badge — click one to show only that platform (pinned to
    // the top), click it again (or pick "all") to see everything again.
    if (categoryFilter === "all") {
        const byPlatform = {};
        rest.forEach((g) => {
            if (!byPlatform[g.source]) byPlatform[g.source] = [];
            byPlatform[g.source].push(g);
        });

        let platformNames = Object.keys(byPlatform).sort();

        if (selectedPlatform && byPlatform[selectedPlatform]) {
            platformNames = [selectedPlatform, ...platformNames.filter((p) => p !== selectedPlatform)];
        }

        platformNames.forEach((platformName) => {
            if (selectedPlatform && platformName !== selectedPlatform) return;

            const items = byPlatform[platformName];
            const badge = PLATFORM_BADGES[platformName] || { icon: "🎁", label: platformName.toUpperCase() };

            const section = document.createElement("div");
            section.className = "category-section";

            const badgeWrap = document.createElement("div");
            badgeWrap.className = "platform-badge-wrap";

            const badgeEl = document.createElement("button");
            badgeEl.className = "platform-badge" + (selectedPlatform === platformName ? " active" : "");
            badgeEl.innerHTML = `<span class="platform-icon">${badge.icon}</span><span class="platform-name">${badge.label}</span> <span class="platform-count">(${items.length})</span>`;
            badgeEl.title = selectedPlatform === platformName
                ? "Click to show all platforms again"
                : `Click to show only ${badge.label}`;

            badgeEl.addEventListener("click", () => {
                selectedPlatform = selectedPlatform === platformName ? null : platformName;
                renderFreeGames();
            });

            badgeWrap.appendChild(badgeEl);
            section.appendChild(badgeWrap);

            const grid = document.createElement("div");
            grid.className = "games-grid browse-grid";
            items.forEach((g) => grid.appendChild(buildFreeGameCard(g)));
            section.appendChild(grid);
            restRow.appendChild(section);
            attachSeeMore(grid);
        });

        return;
    }

    // A specific genre is selected — just show the flat filtered list,
    // no platform grouping.
    const section = document.createElement("div");
    section.className = "category-section";
    const heading = document.createElement("h2");
    heading.textContent = `🎁 ${categoryFilter} (${rest.length})`;
    section.appendChild(heading);
    const grid = document.createElement("div");
    grid.className = "games-grid browse-grid";
    rest.forEach((g) => grid.appendChild(buildFreeGameCard(g)));
    section.appendChild(grid);
    restRow.appendChild(section);
    attachSeeMore(grid);
}

async function loadFreeGames() {
    const newRow = document.getElementById("freeGamesNewRow");
    newRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading free games (checking Steam and Epic, this can take a moment)...</p>`;

    freeGamesCache = await ipcRenderer.invoke("get-free-games");

    if (!freeGamesCache || freeGamesCache.length === 0) {
        newRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No free games found right now.</p>`;
        return;
    }

    const categories = new Set();
    freeGamesCache.forEach((g) => categories.add((g.tags && g.tags[0]) || g.source));

    freeGamesCategorySelect.innerHTML =
        '<option value="all">All Categories</option>' +
        Array.from(categories).sort()
            .map((c) => `<option value="${c}">${c}</option>`)
            .join("");

    renderFreeGames();
}

// --- TV show tracking (TVMaze — air-date metadata only) -------------------

const showSearchInput = document.getElementById("showSearchInput");
const showSearchBtn = document.getElementById("showSearchBtn");
const showSearchResults = document.getElementById("showSearchResults");
const myShowsGrid = document.getElementById("myShowsGrid");
const recentEpisodesRow = document.getElementById("recentEpisodesRow");

async function searchShows() {
    const query = showSearchInput.value.trim();
    if (!query) return;

    const results = await ipcRenderer.invoke("search-tv-shows", query);

    showSearchResults.innerHTML = "";

    results.forEach((show) => {
        const chip = document.createElement("div");
        chip.className = "show-result-chip";
        chip.innerHTML = `
            ${show.image ? `<img src="${show.image}" alt="${show.name}">` : ""}
            <span>${show.name}${show.premiered ? ` (${show.premiered.slice(0, 4)})` : ""}</span>
            <button>+ Track</button>
        `;
        chip.querySelector("button").addEventListener("click", async () => {
            await ipcRenderer.invoke("add-to-watchlist", show);
            showSearchResults.innerHTML = "";
            showSearchInput.value = "";
            loadMyShows();
        });
        showSearchResults.appendChild(chip);
    });
}

showSearchBtn.addEventListener("click", searchShows);
showSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchShows();
});

function buildShowCard(show) {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
        <button class="removeShowBtn" title="Stop tracking">✕</button>
        <div class="cover-wrap">
            <img class="cover-img" src="${show.image || "covers/default.jpg"}" alt="${show.name}">
            <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
            <button class="enlargeBtn" title="Watch larger">⛶</button>
        </div>
        <div class="game-info">
            <h3>${show.name}</h3>
            <p class="game-desc">${show.description || "Loading description..."}</p>
        </div>
    `;

    card.querySelector(".removeShowBtn").addEventListener("click", async () => {
        await ipcRenderer.invoke("remove-from-watchlist", show.id);
        loadMyShows();
    });

    card.querySelector(".soundToggle").addEventListener("click", (event) => {
        event.stopPropagation();
        soundEnabled = !soundEnabled;
        updateAllSoundToggles();
        applySoundToAllFrames();
    });

    const descEl = card.querySelector(".game-desc");
    let descHoverTimer = null;

    descEl.addEventListener("mouseenter", () => {
        clearTimeout(descHoverTimer);
        descHoverTimer = setTimeout(() => {
            openDescModal(show.name, show.description || "No description available.", descEl);
        }, 1000);
    });

    descEl.addEventListener("mouseleave", () => {
        clearTimeout(descHoverTimer);
        closeDescModal();
    });

    if (!show.description) {
        ipcRenderer.invoke("fetch-description", show.name).then(async (description) => {
            const finalText = description || "No description available.";
            show.description = finalText;
            descEl.textContent = finalText;
            if (description) {
                await ipcRenderer.invoke("update-watchlist-item", { id: show.id, description });
            }
        });
    }

    const coverWrap = card.querySelector(".cover-wrap");
    let hoverTimer = null;

    async function fetchShowTrailerOnce() {
        if (show.trailerId === undefined) {
            show.trailerId = await ipcRenderer.invoke("fetch-trailer", show.name, "show", show.description);
            if (show.trailerId) {
                await ipcRenderer.invoke("update-watchlist-item", { id: show.id, trailerId: show.trailerId });
            }
        }
        return show.trailerId;
    }

    card.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(async () => {
            const trailerId = await fetchShowTrailerOnce();

            if (!trailerId || !card.matches(":hover") || coverWrap.querySelector(".trailer-frame")) return;

            const iframe = document.createElement("iframe");
            iframe.className = "trailer-frame";
            iframe.src =
                `https://www.youtube.com/embed/${trailerId}` +
                `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${trailerId}` +
                `&modestbranding=1&rel=0`;
            iframe.allow = "autoplay; encrypted-media";
            iframe.frameBorder = "0";
            coverWrap.appendChild(iframe);

            setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
        }, 350);
    });

    card.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        const frame = coverWrap.querySelector(".trailer-frame");
        if (frame) frame.remove();
    });

    card.querySelector(".enlargeBtn").addEventListener("click", async (event) => {
        event.stopPropagation();
        const trailerId = await fetchShowTrailerOnce();
        if (trailerId) openTheaterMode(trailerId);
    });

    return card;
}

let myShowsCache = [];
const myShowsFilterInput = document.getElementById("myShowsFilterInput");

function renderMyShows() {
    const filterTerm = myShowsFilterInput.value.trim().toLowerCase();
    const filtered = myShowsCache.filter((s) => s.name.toLowerCase().includes(filterTerm));

    myShowsGrid.innerHTML = "";

    if (filtered.length === 0) {
        myShowsGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No tracked shows match that filter.</p>`;
        return;
    }

    filtered.forEach((show) => myShowsGrid.appendChild(buildShowCard(show)));
    attachSeeMore(myShowsGrid);
}

myShowsFilterInput.addEventListener("input", renderMyShows);

async function loadMyShows() {
    myShowsCache = await ipcRenderer.invoke("get-watchlist");
    renderMyShows();
}

let recentEpisodesCache = [];
const recentEpisodesFilterInput = document.getElementById("recentEpisodesFilterInput");

function renderRecentEpisodes() {
    const filterTerm = recentEpisodesFilterInput.value.trim().toLowerCase();
    const filtered = recentEpisodesCache.filter((ep) => ep.showName.toLowerCase().includes(filterTerm));

    recentEpisodesRow.innerHTML = "";

    filtered.forEach((ep) => {
        const card = document.createElement("div");
        card.className = "recent-episode-card";
        card.innerHTML = `
            <img src="${ep.showImage || "covers/default.jpg"}" alt="${ep.showName}">
            <div class="recent-episode-info">
                <h4>${ep.showName}</h4>
                <p>S${ep.season}E${ep.number}${ep.episodeName ? ` — ${ep.episodeName}` : ""}</p>
                <p class="episode-airdate">📅 Released ${ep.airdate || "unknown date"}</p>
                <button class="whereToWatchBtn">📺 Where to Watch</button>
            </div>
        `;
        card.querySelector(".whereToWatchBtn").addEventListener("click", () => {
            const query = encodeURIComponent(ep.showName);
            ipcRenderer.invoke("open-external", `https://www.justwatch.com/us/search?q=${query}`);
        });
        recentEpisodesRow.appendChild(card);
    });
}

recentEpisodesFilterInput.addEventListener("input", renderRecentEpisodes);

async function loadRecentEpisodes() {
    recentEpisodesCache = await ipcRenderer.invoke("get-latest-episodes");
    renderRecentEpisodes();
}

// --- Movies in theaters (TMDB) ---------------------------------------------

// Curated list of major cities per country — not individually verified to
// have a theater, just a reasonable approximation of where multiplexes
// typically exist, per the user's choice over setting up Google Places API.
const CITIES_BY_COUNTRY = {
    US: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "Austin", "San Francisco", "Seattle", "Denver", "Boston", "Miami"],
    GB: ["London", "Manchester", "Birmingham", "Leeds", "Glasgow", "Liverpool", "Bristol", "Edinburgh", "Sheffield", "Newcastle"],
    PT: ["Lisbon", "Porto", "Braga", "Coimbra", "Faro", "Setúbal", "Aveiro", "Funchal"],
    CA: ["Toronto", "Montreal", "Vancouver", "Calgary", "Ottawa", "Edmonton", "Winnipeg", "Quebec City"],
    AU: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Newcastle"],
    DE: ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig"],
    FR: ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Bordeaux"],
    ES: ["Madrid", "Barcelona", "Valencia", "Seville", "Zaragoza", "Málaga", "Bilbao"],
    BR: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza", "Belo Horizonte", "Curitiba", "Recife"]
};

// Localizes the ticket search to the actual region selected, instead of
// always hitting google.com regardless of country.
const GOOGLE_DOMAIN_BY_COUNTRY = {
    US: "com", GB: "co.uk", PT: "pt", CA: "ca", AU: "com.au",
    DE: "de", FR: "fr", ES: "es", BR: "com.br"
};

const COUNTRY_NAMES = {
    US: "United States", GB: "United Kingdom", PT: "Portugal", CA: "Canada",
    AU: "Australia", DE: "Germany", FR: "France", ES: "Spain", BR: "Brazil"
};

const movieCountrySelect = document.getElementById("movieCountrySelect");
const movieCitySelect = document.getElementById("movieCitySelect");
const moviesGrid = document.getElementById("moviesGrid");

function populateCitySelect(countryCode, preferredCity) {
    const cities = CITIES_BY_COUNTRY[countryCode] || [];
    movieCitySelect.innerHTML = cities.map((c) => `<option value="${c}">${c}</option>`).join("");

    if (preferredCity && cities.includes(preferredCity)) {
        movieCitySelect.value = preferredCity;
    }
}

movieCountrySelect.addEventListener("change", () => {
    saveSetting("movieCountry", movieCountrySelect.value);
    populateCitySelect(movieCountrySelect.value, null);
    saveSetting("movieCity", movieCitySelect.value);
    loadMovies();
});

movieCitySelect.addEventListener("change", () => {
    saveSetting("movieCity", movieCitySelect.value);
});

// --- "Theater mode" large video popup (not fullscreen) ---------------------

const theaterModal = document.getElementById("theaterModal");
const theaterVideoWrap = document.getElementById("theaterVideoWrap");
const theaterCloseBtn = document.getElementById("theaterCloseBtn");
const theaterYoutubeBtn = document.getElementById("theaterYoutubeBtn");

let theaterVideoId = null;

function openTheaterMode(trailerId) {
    theaterVideoId = trailerId;
    theaterVideoWrap.innerHTML = `
        <iframe
            src="https://www.youtube.com/embed/${trailerId}?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=1&rel=0&modestbranding=1"
            allow="autoplay; encrypted-media"
            allowfullscreen>
        </iframe>
    `;
    theaterModal.classList.add("active");
}

function closeTheaterMode() {
    theaterModal.classList.remove("active");
    theaterVideoWrap.innerHTML = "";
    theaterVideoId = null;
}

theaterCloseBtn.addEventListener("click", closeTheaterMode);

theaterModal.addEventListener("click", (event) => {
    if (event.target === theaterModal) closeTheaterMode();
});

theaterYoutubeBtn.addEventListener("click", () => {
    if (theaterVideoId) {
        ipcRenderer.invoke("open-external", `https://www.youtube.com/watch?v=${theaterVideoId}`);
    }
});

let moviesCache = [];

function buildMovieCard(movie, showReleaseDate) {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
        <div class="cover-wrap">
            <img class="cover-img" src="${movie.poster || "covers/default.jpg"}" alt="${movie.title}">
            <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
            <button class="enlargeBtn" title="Watch larger">⛶</button>
        </div>
        <div class="game-info">
            <h3>${movie.title}</h3>
            ${showReleaseDate && movie.releaseDate ? `<p class="game-playtime">📅 Releases ${movie.releaseDate}</p>` : ""}
            <p class="game-desc">${movie.description || "No description available."}</p>
            <div class="movie-card-actions">
                <button class="launchBtn ticketsBtn">🎟️ Find Tickets & Showtimes</button>
                <button class="youtubeLinkBtn" title="Watch on YouTube">▶</button>
            </div>
        </div>
    `;

    const coverWrap = card.querySelector(".cover-wrap");
    let hoverTimer = null;
    let movieTrailerId;

    async function fetchTrailerOnce() {
        if (movieTrailerId === undefined) {
            movieTrailerId = await ipcRenderer.invoke("get-movie-trailer", movie.id);
        }
        return movieTrailerId;
    }

    card.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(async () => {
            const trailerId = await fetchTrailerOnce();
            if (!trailerId || !card.matches(":hover") || coverWrap.querySelector(".trailer-frame")) return;

            const iframe = document.createElement("iframe");
            iframe.className = "trailer-frame";
            iframe.src =
                `https://www.youtube.com/embed/${trailerId}` +
                `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${trailerId}` +
                `&modestbranding=1&rel=0`;
            iframe.allow = "autoplay; encrypted-media";
            iframe.frameBorder = "0";
            coverWrap.appendChild(iframe);

            setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
        }, 350);
    });

    card.addEventListener("mouseleave", () => {
        clearTimeout(hoverTimer);
        const frame = coverWrap.querySelector(".trailer-frame");
        if (frame) frame.remove();
    });

    card.querySelector(".soundToggle").addEventListener("click", (event) => {
        event.stopPropagation();
        soundEnabled = !soundEnabled;
        updateAllSoundToggles();
        applySoundToAllFrames();
    });

    card.querySelector(".enlargeBtn").addEventListener("click", async (event) => {
        event.stopPropagation();
        const trailerId = await fetchTrailerOnce();
        if (trailerId) openTheaterMode(trailerId);
    });

    card.querySelector(".youtubeLinkBtn").addEventListener("click", async () => {
        const trailerId = await fetchTrailerOnce();
        if (trailerId) {
            ipcRenderer.invoke("open-external", `https://www.youtube.com/watch?v=${trailerId}`);
        }
    });

    const descEl = card.querySelector(".game-desc");
    let descHoverTimer = null;

    descEl.addEventListener("mouseenter", () => {
        clearTimeout(descHoverTimer);
        descHoverTimer = setTimeout(() => {
            openDescModal(movie.title, movie.description || "No description available.", descEl);
        }, 1000);
    });

    descEl.addEventListener("mouseleave", () => {
        clearTimeout(descHoverTimer);
        closeDescModal();
    });

    card.querySelector(".ticketsBtn").addEventListener("click", () => {
        const countryCode = movieCountrySelect.value || "US";
        const city = movieCitySelect.value;
        const countryName = COUNTRY_NAMES[countryCode] || "";
        const domain = GOOGLE_DOMAIN_BY_COUNTRY[countryCode] || "com";

        const queryParts = [movie.title, "showtimes", "tickets"];
        if (city) queryParts.push(city);
        queryParts.push(countryName);

        const query = encodeURIComponent(queryParts.filter(Boolean).join(" "));
        ipcRenderer.invoke("open-external", `https://www.google.${domain}/search?q=${query}`);
    });

    return card;
}

async function loadMovies() {
    moviesGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const movies = await ipcRenderer.invoke("get-now-playing-movies", movieCountrySelect.value);
    moviesCache = movies || [];

    if (!movies || movies.length === 0) {
        moviesGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    moviesGrid.innerHTML = "";
    movies.forEach((movie) => moviesGrid.appendChild(buildMovieCard(movie, false)));
    attachSeeMore(moviesGrid);
}

// --- "NEW" section: upcoming movies, new series, upcoming games -----------

let newSectionLoaded = false;

async function loadUpcomingMovies() {
    const grid = document.getElementById("upcomingMoviesGrid");
    grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const movies = await ipcRenderer.invoke("get-upcoming-movies", settings.movieCountry || "US");

    if (!movies || movies.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    grid.innerHTML = "";
    movies.forEach((movie) => grid.appendChild(buildMovieCard(movie, true)));
    attachSeeMore(grid);
}

async function loadNewShows() {
    const grid = document.getElementById("newShowsGrid");
    grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const shows = await ipcRenderer.invoke("get-new-tv-shows");

    if (!shows || shows.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    grid.innerHTML = "";

    shows.forEach((show) => {
        const card = document.createElement("div");
        card.className = "game-card";
        card.innerHTML = `
            <div class="cover-wrap">
                <img class="cover-img" src="${show.image || "covers/default.jpg"}" alt="${show.name}">
                <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
                <button class="enlargeBtn" title="Watch larger">⛶</button>
            </div>
            <div class="game-info">
                <h3>${show.name}</h3>
                <p class="game-playtime">📅 First aired ${show.firstAirDate || "unknown"}</p>
                <p class="game-desc">${show.description || "No description available."}</p>
                <div class="card-footer">
                    <button class="launchBtn addToShowsBtn">➕ Add to My Shows</button>
                </div>
            </div>
        `;

        const coverWrap = card.querySelector(".cover-wrap");
        let hoverTimer = null;
        let newShowTrailerId;

        async function fetchNewShowTrailerOnce() {
            if (newShowTrailerId === undefined) {
                newShowTrailerId = await ipcRenderer.invoke("get-tv-show-trailer", show.id);
            }
            return newShowTrailerId;
        }

        card.addEventListener("mouseenter", () => {
            hoverTimer = setTimeout(async () => {
                const trailerId = await fetchNewShowTrailerOnce();
                if (!trailerId || !card.matches(":hover") || coverWrap.querySelector(".trailer-frame")) return;

                const iframe = document.createElement("iframe");
                iframe.className = "trailer-frame";
                iframe.src =
                    `https://www.youtube.com/embed/${trailerId}` +
                    `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${trailerId}` +
                    `&modestbranding=1&rel=0`;
                iframe.allow = "autoplay; encrypted-media";
                iframe.frameBorder = "0";
                coverWrap.appendChild(iframe);
                setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
            }, 350);
        });

        card.addEventListener("mouseleave", () => {
            clearTimeout(hoverTimer);
            const frame = coverWrap.querySelector(".trailer-frame");
            if (frame) frame.remove();
        });

        card.querySelector(".enlargeBtn").addEventListener("click", async (event) => {
            event.stopPropagation();
            const trailerId = await fetchNewShowTrailerOnce();
            if (trailerId) openTheaterMode(trailerId);
        });

        card.querySelector(".soundToggle").addEventListener("click", (event) => {
            event.stopPropagation();
            soundEnabled = !soundEnabled;
            updateAllSoundToggles();
            applySoundToAllFrames();
        });

        // My Shows tracking runs on TVMaze IDs, but this feed comes from
        // TMDB — resolve the matching TVMaze entry by name before adding.
        card.querySelector(".addToShowsBtn").addEventListener("click", async (event) => {
            const results = await ipcRenderer.invoke("search-tv-shows", show.name);

            if (!results || results.length === 0) {
                alert(`Couldn't find "${show.name}" in the TV tracking database yet.`);
                return;
            }

            await ipcRenderer.invoke("add-to-watchlist", results[0]);
            event.target.textContent = "✅ Added";
            event.target.disabled = true;
        });

        grid.appendChild(card);
    });

    attachSeeMore(grid);
}

async function loadUpcomingGames() {
    const grid = document.getElementById("upcomingGamesGrid");
    grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const games = await ipcRenderer.invoke("get-upcoming-games");

    if (!games || games.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results right now.</p>`;
        return;
    }

    grid.innerHTML = "";

    games.forEach((game) => {
        const card = document.createElement("div");
        card.className = "game-card";
        card.innerHTML = `
            <div class="cover-wrap">
                <img class="cover-img" src="${game.image || "covers/default.jpg"}" alt="${game.name}">
                <button class="soundToggle" title="Toggle trailer sound">${soundEnabled ? "🔊" : "🔇"}</button>
                <button class="enlargeBtn" title="Watch larger">⛶</button>
            </div>
            <div class="game-info">
                <h3>${game.name}</h3>
                ${game.releaseDate ? `<p class="game-playtime">📅 Releases ${game.releaseDate}</p>` : ""}
                <div class="card-footer">
                    <button class="launchBtn buyGameBtn">🛒 Buy</button>
                </div>
            </div>
        `;

        const coverWrap = card.querySelector(".cover-wrap");
        let hoverTimer = null;
        let upcomingTrailerId;

        async function fetchUpcomingTrailerOnce() {
            if (upcomingTrailerId === undefined) {
                upcomingTrailerId = await ipcRenderer.invoke("fetch-trailer", game.name, "game", game.description);
            }
            return upcomingTrailerId;
        }

        card.addEventListener("mouseenter", () => {
            hoverTimer = setTimeout(async () => {
                const trailerId = await fetchUpcomingTrailerOnce();
                if (!trailerId || !card.matches(":hover") || coverWrap.querySelector(".trailer-frame")) return;

                const iframe = document.createElement("iframe");
                iframe.className = "trailer-frame";
                iframe.src =
                    `https://www.youtube.com/embed/${trailerId}` +
                    `?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=0&loop=1&playlist=${trailerId}` +
                    `&modestbranding=1&rel=0`;
                iframe.allow = "autoplay; encrypted-media";
                iframe.frameBorder = "0";
                coverWrap.appendChild(iframe);
                setTimeout(() => postPlayerCommand(iframe, "setVolume", [settings.trailerVolume]), 1000);
            }, 350);
        });

        card.addEventListener("mouseleave", () => {
            clearTimeout(hoverTimer);
            const frame = coverWrap.querySelector(".trailer-frame");
            if (frame) frame.remove();
        });

        card.querySelector(".enlargeBtn").addEventListener("click", async (event) => {
            event.stopPropagation();
            const trailerId = await fetchUpcomingTrailerOnce();
            if (trailerId) openTheaterMode(trailerId);
        });

        card.querySelector(".soundToggle").addEventListener("click", (event) => {
            event.stopPropagation();
            soundEnabled = !soundEnabled;
            updateAllSoundToggles();
            applySoundToAllFrames();
        });

        card.querySelector(".buyGameBtn").addEventListener("click", () => {
            ipcRenderer.invoke("open-external", game.url);
        });

        grid.appendChild(card);
    });

    attachSeeMore(grid);
}

async function loadNewSection() {
    if (newSectionLoaded) return;
    newSectionLoaded = true;
    loadUpcomingMovies();
    loadNewShows();
    loadUpcomingGames();
}

// Shows/hides the 3D diamond-assembly overlay already present in the HTML
// by default — if the setting is off, it's removed immediately instead of
// playing out.
function playStartupAnimation() {
    const overlay = document.getElementById("startupOverlay");
    if (!overlay) return;

    if (settings.startupAnimation === false) {
        overlay.remove();
        return;
    }

    // Let the quad assembly (~0.9s) and the glow pulse (starts at 0.9s,
    // runs 1.6s) finish, then fade the whole overlay out.
    setTimeout(() => {
        overlay.classList.add("startup-hidden");
        setTimeout(() => overlay.remove(), 550);
    }, 2100);
}

// --- First-launch username ------------------------------------------------

async function maybeShowUsernamePopup() {
    if (settings.username) return;

    const modal = document.getElementById("usernameModal");
    const input = document.getElementById("usernameInput");
    const errorEl = document.getElementById("usernameError");
    const submitBtn = document.getElementById("usernameSubmitBtn");

    modal.classList.add("active");
    input.focus();

    async function attemptSubmit() {
        const value = input.value.trim();

        if (!/^[a-zA-Z0-9_]{3,20}$/.test(value)) {
            errorEl.textContent = "3–20 characters: letters, numbers, and underscores only.";
            return;
        }

        submitBtn.disabled = true;
        errorEl.textContent = "";

        const deviceId = await ipcRenderer.invoke("get-device-id");
        const check = await ipcRenderer.invoke("check-username-available", value);

        if (check.error) {
            errorEl.textContent = check.error;
            submitBtn.disabled = false;
            return;
        }

        if (!check.available) {
            errorEl.textContent = "That username is already taken — try another.";
            submitBtn.disabled = false;
            return;
        }

        const result = await ipcRenderer.invoke("register-username", { username: value, deviceId });

        if (!result.success) {
            errorEl.textContent = result.error || "Something went wrong — try again.";
            submitBtn.disabled = false;
            return;
        }

        saveSetting("username", value);
        settings.username = value;
        modal.classList.remove("active");
    }

    submitBtn.addEventListener("click", attemptSubmit);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") attemptSubmit();
    });
}

async function init() {
    initFactTicker();
    buildWheelRim();
    await loadSettings();
    playStartupAnimation();
    maybeShowUsernamePopup();
    await loadGames();
    await checkForUpdatePopup();
    playStartupChime();
    checkForNewGames();
    loadRecentEpisodes();

    // Keep "Recently Released" fresh without needing a restart
    setInterval(loadRecentEpisodes, 10 * 60 * 1000);

    // Start on whichever section the user picked in settings (defaults to New)
    switchSection(settings.startupSection || "new");
}

init();
