
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
        await window.riftgate.invoke(
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
    window.riftgate.writeText(currentModalPath);
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

    await window.riftgate.invoke(
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

    const description = await window.riftgate.invoke("fetch-description", searchName);
    if (description) {
        notesModalGame.description = description;
        updates.description = description;
    }

    if (!notesModalGame.image || notesModalGame.image === "covers/default.jpg") {
        const cover = await window.riftgate.invoke("fetch-online-cover", searchName);
        if (cover) {
            notesModalGame.image = cover;
            updates.image = cover;
        }
    }

    await window.riftgate.invoke("update-game", updates);

    await window.riftgate.invoke(
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

    await window.riftgate.invoke(
        "update-game",
        { path: notesModalGame.path, trailerId: videoId }
    );

    await window.riftgate.invoke(
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
// Free Games and every Reading Room tab share the slot-reel presentation
// (see buildSlotReel/spinSlotReel below) instead of the pie wheel — kept
// as its own flag, set once per modal open, so spin() and openWheelModal()
// can't disagree about which one is actually on screen.
let wheelUsesSlotReel = false;

function wheelItemName(item) {
    if (wheelMode === "movie") return item.title;
    if (wheelMode === "readinglibrary" || wheelMode === "readingdiscover" || wheelMode === "readingbuy") return item.title;
    return item.name;
}

function wheelItemImage(item) {
    if (wheelMode === "movie") return item.poster || "covers/default.jpg";
    if (wheelMode === "readinglibrary" || wheelMode === "readingdiscover" || wheelMode === "readingbuy") return item.cover || "covers/no-cover-book.jpg";
    return item.image || "covers/default.jpg";
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

    if (wheelUsesSlotReel) {
        spinSlotReel();
        return;
    }

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

// Free Games can have far too many entries with names too long to fit on
// a pie-wheel wedge, so this uses a slot-machine-style reel of cover
// images instead — sidesteps the text-fitting problem entirely since the
// winning name is only shown afterward, in the roomy result area.
function buildSlotReel() {
    const track = document.getElementById("slotReelTrack");
    track.innerHTML = "";
    track.style.transition = "none";
    track.style.transform = "translateX(0)";
}

function spinSlotReel() {
    const track = document.getElementById("slotReelTrack");
    const windowEl = document.querySelector(".slot-reel-window");

    // Pre-selecting a random sample of 20 first (different every spin)
    // keeps the reel strip a fixed, small size regardless of how big the
    // real pool is — spinning through the full Free Games list or all
    // 100 downloaded books meant building 500-600 image elements before
    // the animation could even start, which is what made it feel like
    // nothing was happening for the first few seconds.
    const spinPool = wheelGames.length > 20
        ? [...wheelGames].sort(() => Math.random() - 0.5).slice(0, 20)
        : wheelGames;

    const winnerIndex = Math.floor(Math.random() * spinPool.length);
    wheelWinner = spinPool[winnerIndex];

    const REPEATS = 6;
    const strip = [];
    for (let r = 0; r < REPEATS; r++) {
        spinPool.forEach((g) => strip.push(g));
    }

    // Leave one buffer item after the winner so the reel doesn't visually
    // run out of items while still decelerating.
    const landingSlot = strip.length - 2;
    strip[landingSlot] = wheelWinner;

    track.innerHTML = "";
    track.style.transition = "none";
    track.style.transform = "translateX(0)";

    const itemEls = strip.map((g) => {
        const el = document.createElement("div");
        el.className = "slot-reel-item";
        const img = document.createElement("img");
        img.src = wheelItemImage(g);
        el.appendChild(img);
        track.appendChild(el);
        return el;
    });

    // Force a reflow so the reset above is actually painted before the
    // transition starts below — without this, the browser can merge the
    // reset and the jump into one frame, which is what made the spin
    // look like it "glitched" straight to a fast blur instead of easing
    // into it smoothly.
    void track.offsetWidth;

    // Measure the ACTUAL rendered position of the landing item rather
    // than assuming a fixed pixel width per item — this is what
    // guarantees the marker always lines up with the real winner exactly,
    // regardless of any rounding or box-model subtlety.
    const landingEl = itemEls[landingSlot];
    const landingCenter = landingEl.offsetLeft + landingEl.offsetWidth / 2;
    const windowWidth = windowEl.offsetWidth;
    const targetX = (windowWidth / 2) - landingCenter;

    requestAnimationFrame(() => {
        // An even ease-in-out: the previous curve (.17,.67,.24,1) reached
        // ~90% of the total distance within the first third of the
        // duration, so the reel effectively sat still for the remaining
        // two-thirds before the reveal — it read as "stuck" rather than
        // spinning. This curve spends the first half of the duration
        // visibly accelerating (a real, if gentle, spin from the very
        // start) and the second half decelerating into the landing spot,
        // matching how the pointer-wheel and a real slot reel both feel.
        track.style.transition = "transform 5.5s cubic-bezier(.45,0,.55,1)";
        track.style.transform = `translateX(${targetX}px)`;
    });

    setTimeout(() => {
        wheelResultImg.src = wheelItemImage(wheelWinner);
        wheelResultName.textContent = wheelItemName(wheelWinner);
        if (wheelMode === "readinglibrary") {
            wheelPlayBtn.textContent = "📖 Open";
        } else if (wheelMode === "readingdiscover") {
            wheelPlayBtn.textContent = "⬇️ Download";
        } else if (wheelMode === "readingbuy") {
            wheelPlayBtn.textContent = "🛒 Buy";
        } else {
            wheelPlayBtn.textContent = "🎁 Get It Free";
        }
        wheelResult.classList.add("active");
    }, 5600);
}

function openWheelModal() {
    const wheelPieWrap = document.getElementById("wheelPieWrap");
    const slotReelWrap = document.getElementById("slotReelWrap");
    const wheelTitle = document.getElementById("wheelTitle");

    if (currentSection === "theatre") {
        wheelMode = "movie";
        wheelGames = moviesCache;
        wheelTitle.textContent = "Movie Night?";

        if (wheelGames.length < 2) {
            alert("No movies loaded yet — open In Theaters first, or add at least 2 games to spin for a game instead.");
            return;
        }
    } else if (currentSection === "free-games") {
        wheelMode = "freegames";
        wheelGames = freeGamesCache;
        wheelTitle.textContent = "Free Game Time?";

        if (wheelGames.length < 2) {
            alert("Free games haven't loaded yet — give it a moment and try again.");
            return;
        }
    } else if (currentSection === "reading-room" && activeReadingRoomTab === "library") {
        wheelMode = "readinglibrary";
        wheelGames = ebooksCache;
        wheelTitle.textContent = "Pick Something to Read?";

        if (wheelGames.length < 2) {
            alert("Add at least 2 books to your library to spin the wheel!");
            return;
        }
    } else if (currentSection === "reading-room" && activeReadingRoomTab === "discover") {
        wheelMode = "readingdiscover";
        const combined = [
            ...discoveryBooksCache.recommended,
            ...discoveryBooksCache.popular,
            ...discoveryBooksCache.topDownloaded
        ];
        const seen = new Set();
        wheelGames = combined.filter((b) => {
            if (seen.has(b.id)) return false;
            seen.add(b.id);
            return true;
        });
        wheelTitle.textContent = "Discover a New Book?";

        if (wheelGames.length < 2) {
            alert("Free eBooks haven't loaded yet — give it a moment and try again.");
            return;
        }
    } else if (currentSection === "reading-room" && activeReadingRoomTab === "buyfree") {
        wheelMode = "readingbuy";
        const combinedBuy = [
            ...buyFreeBooksCache.popular,
            ...buyFreeBooksCache.mostSold,
            ...buyFreeBooksCache.newReleases
        ];
        const seenBuy = new Set();
        wheelGames = combinedBuy.filter((b) => {
            if (seenBuy.has(b.id)) return false;
            seenBuy.add(b.id);
            return true;
        });
        wheelTitle.textContent = "Find Something to Buy?";

        if (wheelGames.length < 2) {
            alert("Buy Books hasn't loaded yet — give it a moment and try again.");
            return;
        }
    } else {
        wheelMode = "game";
        wheelGames = allGames.filter((g) => (g.category || "game") === "game");
        wheelTitle.textContent = "Feeling lucky?";

        if (wheelGames.length < 2) {
            alert("Add at least 2 games to spin the wheel!");
            return;
        }
    }

    wheelUsesSlotReel = wheelMode === "freegames" || wheelMode === "readinglibrary" || wheelMode === "readingdiscover" || wheelMode === "readingbuy";
    wheelPieWrap.style.display = wheelUsesSlotReel ? "none" : "";
    slotReelWrap.style.display = wheelUsesSlotReel ? "block" : "none";

    wheelSpinCount = 0;
    wheelMessage.textContent = "";
    wheelResult.classList.remove("active");

    if (wheelUsesSlotReel) {
        buildSlotReel();
    } else {
        buildWheel(wheelGames);
    }

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
        window.riftgate.invoke("open-external", `https://www.google.${domain}/search?q=${query}`);
    } else if (wheelMode === "freegames") {
        window.riftgate.invoke("open-external", wheelWinner.url);
    } else if (wheelMode === "readinglibrary") {
        const result = await window.riftgate.invoke("launch-ebook", wheelWinner.path);
        if (result.success) {
            await window.riftgate.invoke("mark-ebook-opened", wheelWinner.path);
            const cached = ebooksCache.find((b) => b.path === wheelWinner.path);
            if (cached) cached.lastOpenedAt = Date.now();
            renderRecentlyOpenedRow();
        }
    } else if (wheelMode === "readingdiscover") {
        if (!wheelWinner.downloadUrl) {
            alert("No EPUB download is available for this book.");
        } else {
            const result = await window.riftgate.invoke("download-free-ebook", wheelWinner);
            if (result.success) {
                ebooksCache.push({
                    path: result.path,
                    title: result.title,
                    author: result.author,
                    cover: result.cover,
                    format: "epub",
                    addedAt: Date.now(),
                    lastOpenedAt: null
                });
                if (activeReadingRoomTab === "library") renderReadingRoom();
            } else if (!result.duplicate) {
                alert(result.error || "Download failed.");
            }
        }
    } else if (wheelMode === "readingbuy") {
        const link = wheelWinner.buyLink || wheelWinner.infoLink;
        if (link) {
            window.riftgate.invoke("open-external", link);
        } else {
            alert("No link available for this book.");
        }
    } else {
        await window.riftgate.invoke("launch-app", wheelWinner.path);
    }

    closeWheelModal();
});

// --- Changelog / what's new ------------------------------------------------

const CHANGELOG = {
    "1.1.6": [
        "Fixed: Vault access via admin status now requires actually being logged in as admin in the current session — logging out immediately revokes it, instead of access persisting permanently based on admin-table membership alone",
        "Fixed: closed a gap where a non-allowlisted user could get Vault access without ever actively logging in as admin"
    ],
    "1.1.5": [
        "Fixed: only existing super-admins can now promote someone to super-admin or demote one back down — regular admins keep full control over everything else",
        "Fixed: The Vault correctly recognizes admins now (a backend fix that hadn't actually taken effect until now)"
    ],
    "1.1.4": [
        "Fixed: regular admins now get full admin capabilities (Manage Users, Vault access) instead of being limited to super-admins only",
        "Fixed: the owner account is now properly protected from being removed or demoted by any other admin",
        "Fixed: usernames can no longer end in \"_Adm\", \"_Root\", or similar — prevents impersonating an admin",
        "Various backend fixes to the admin permission system"
    ],
    "1.1.3": [
        "New: The Vault — a private, invite-only section for sharing files with people you trust, with automatic expiration (1-4 hours) so nothing lingers",
        "New: WeTransfer Links inside The Vault, for anything over the 50MB file cap — post a link with a note about what's in it, stays listed for 7 days",
        "New: admins automatically get Vault access, no manual allowlisting needed",
        "New: admin-only Clean Now button to immediately clear everything in The Vault",
        "Fixed: several trailer, cover, and description issues across movies, shows, and books",
        "Various smaller fixes and polish"
    ],
    "1.1.2": [
        "New: Buy Books — a third Reading Room tab for current/mainstream books with purchase links, plus Most Popular, Best Seller, and New Releases lists",
        "New: Applications section now has real content — recommended free eBook readers and a ranked Top 5 (free and paid)",
        "New: manually add or change a book's cover on any book, anywhere in Reading Room",
        "New: Surprise Me now covers all three Reading Room tabs, including Buy Books",
        "Fixed: many book covers and descriptions that were missing or failing to load, across My Library, Discover Online, and Buy Books",
        "Fixed: several trailers across the app (games, movies, shows) that could get silently stuck after a single failed attempt",
        "Fixed: My Shows trailers no longer risk pulling a game's trailer instead of the actual show's",
        "Fixed: Portuguese and other regional movies missing posters/descriptions in In Theaters and New",
        "Fixed: an app (like Discord) updating itself no longer gets mistaken for being uninstalled",
        "Fixed: several sections no longer start empty while waiting on the network — they now show the last known results instantly and refresh quietly in the background",
        "Fixed: items without a cover now consistently sort to the end of every list instead of appearing scattered throughout",
        "Improved: auto-update checks are more reliable, with proper retries instead of a single silent attempt",
        "Various smaller fixes and polish"
    ],
    "1.1.0": [
        "New: Reading Room — a full eBook section with your own personal library and a Discover Online tab pulling free public-domain books",
        "New: drag-and-drop or drop books straight into a dedicated Reading Room folder, even while Riftgate is closed — everything's picked up automatically",
        "New: Favorites and Recently Opened rows for your library, both searchable from one bar at the top",
        "New: Send to Device — copy any book straight to a connected Kindle, phone, tablet, or other drive",
        "New: a Surprise Me wheel for Reading Room too, working across both your library and Discover Online",
        "Fixed: book covers now load correctly, with automatic repair for anything added before this fix",
        "Various smaller fixes and polish"
    ],
    "1.0.0": [
        "Riftgate's version numbering has been reset to better reflect the project's actual stage — starting fresh from here",
        "New: Reading Room — a personal eBook library for EPUB and PDF files, with real titles/authors/covers pulled from the files themselves",
        "Various smaller fixes and polish"
    ]
};

// Full, unabridged technical changelog — only ever shown when logged in
// as admin, since it includes internal/backend details and the admin
// system itself, which regular users never need to see.
const FULL_CHANGELOG = {
    "1.0.0": [
        "Version numbering reset from 1.20.2 to 1.0.0 — going forward, the middle digit bumps for major feature drops, the last digit for small fixes/patches",
        "New: Reading Room section — EPUB/PDF library with drag-and-drop or file-picker add, duplicate protection (case-insensitive path matching), missing-file detection",
        "EPUB metadata extraction via adm-zip (new dependency) — reads container.xml → OPF → dc:title/dc:creator/cover image directly from the file",
        "PDF metadata: lightweight regex-based /Title scan (no full PDF parser), degrades safely to filename fallback",
        "Books open via the OS's default EPUB/PDF handler — matches Riftgate's existing launcher philosophy rather than an in-app reader",
        "Reading Room added to sidebar nav, top pill dropdown, and Startup Section setting, positioned between Theatre and Applications"
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
    let html = Object.entries(CHANGELOG)
        .map(([version, items]) => `
            <div class="changelog-version">v${version}</div>
            <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
        `)
        .join("");

    // Only shown to admins — the full unabridged list, including
    // internal/technical details and the admin system itself, which
    // regular users never need to see.
    if (isAdminMode) {
        const fullHtml = Object.entries(FULL_CHANGELOG)
            .map(([version, items]) => `
                <div class="changelog-version">v${version}</div>
                <ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>
            `)
            .join("");

        html += `
            <div class="changelog-version" style="margin-top:20px;border-top:1px solid var(--border-color);padding-top:16px;">
                🔒 Full Technical Changelog (Admin Only)
            </div>
            ${fullHtml}
        `;
    }

    changelogBody.innerHTML = html;
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
    window.riftgate.invoke("window-close");
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

window.riftgate.on("update-available", (info) => {
    manualUpdateCheckInProgress = false;
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

window.riftgate.on("update-download-progress", (percent) => {
    updateProgressFill.style.width = `${percent}%`;
    updateProgressLabel.textContent = `Downloading update... ${percent}%`;
});

window.riftgate.on("update-downloaded", () => {
    updateProgressLabel.textContent = "Update downloaded — restarting to install...";
    setTimeout(() => {
        window.riftgate.invoke("quit-and-install-update");
    }, 1200);
});

// Whether the CURRENT check was triggered manually (via the sidebar
// button) — only manual checks show a result either way; the silent
// automatic startup check stays silent unless it actually finds
// something, exactly as before.
let manualUpdateCheckInProgress = false;

window.riftgate.on("update-not-available", () => {
    if (manualUpdateCheckInProgress) {
        alert("You're already on the latest version of Riftgate.");
        manualUpdateCheckInProgress = false;
    }
});

window.riftgate.on("update-error", (message) => {
    console.error("[updater]", message);
    updateModal.classList.remove("active");
    if (manualUpdateCheckInProgress) {
        alert(`Couldn't check for updates: ${message}`);
        manualUpdateCheckInProgress = false;
    }
});

// Tells main.js the renderer has actually finished loading and
// registered its update listeners — a fixed timeout guessing when this
// would be "probably" done is exactly the kind of thing that works
// reliably on a fast machine and silently fails on a slower one, since
// Electron's IPC doesn't queue messages sent before anything is
// listening; if the "update-available" event fired even slightly too
// early, the notification would just be lost with no trace at all.
window.riftgate.send("renderer-ready-for-updates");

const checkUpdateBtn = document.getElementById("checkUpdateBtn");
checkUpdateBtn.addEventListener("click", () => {
    manualUpdateCheckInProgress = true;
    checkUpdateBtn.disabled = true;
    checkUpdateBtn.textContent = "🔄 Checking...";
    window.riftgate.invoke("check-for-updates").finally(() => {
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.textContent = "🔄 Check for Updates";
    });
});

updateNowBtn.addEventListener("click", () => {
    updateModalActions.style.display = "none";
    updateProgressWrap.style.display = "block";
    updateProgressFill.style.width = "0%";
    updateProgressLabel.textContent = "Downloading update...";
    window.riftgate.invoke("start-update-download");
});

updateLaterBtn.addEventListener("click", () => {
    // No dismissal is remembered on purpose — this will show again on the
    // next restart until the user actually updates, as required.
    updateModal.classList.remove("active");
});

async function checkForUpdatePopup() {
    appVersion = await window.riftgate.invoke("get-app-version");
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
        await window.riftgate.invoke("dismiss-import", currentImport.path);
    }
    showNextImportPrompt();
});

importYesBtn.addEventListener("click", async () => {
    if (!currentImport) return;

    const gameName = currentImport.name;
    const override = await window.riftgate.invoke("get-override", gameName);

    let cover = override && override.image ? override.image : null;

    if (!cover) {
        cover = await window.riftgate.invoke("find-cover", gameName);

        if (cover === "covers/default.jpg") {
            cover = await window.riftgate.invoke("fetch-online-cover", gameName);
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

    await window.riftgate.invoke("save-game", game);

    allGames.push(game);
    renderLibrary();

    showNextImportPrompt();
});

async function checkForNewGames() {
    const found = await window.riftgate.invoke("scan-new-games");
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
    window.riftgate.invoke("set-app-icon", themeName);
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
    window.riftgate.invoke("set-launch-at-startup", toggleLaunchAtStartup.checked);
});

toggleRunInBackground.addEventListener("change", () => {
    saveSetting("runInBackground", toggleRunInBackground.checked);
    window.riftgate.invoke("set-run-in-background", toggleRunInBackground.checked);
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
    settings = await window.riftgate.invoke("load-settings");

    if (Array.isArray(settings.categoryOrder) && settings.categoryOrder.length === CATEGORY_ORDER.length) {
        CATEGORY_ORDER = settings.categoryOrder;
    }

    applySettingsToUI();
}

async function saveSetting(key, value) {
    settings[key] = value;
    await window.riftgate.invoke("save-settings", { [key]: value });
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

winMinBtn.addEventListener("click", () => window.riftgate.invoke("window-minimize"));
winCloseBtn.addEventListener("click", () => window.riftgate.invoke("window-close"));

winMaxBtn.addEventListener("click", async () => {
    const isMaximized = await window.riftgate.invoke("window-maximize-toggle");
    winMaxBtn.textContent = isMaximized ? "❐" : "▢";
});

window.riftgate.on("maximize-changed", (isMaximized) => {
    winMaxBtn.textContent = isMaximized ? "❐" : "▢";
});

// Fullscreen is live window state, not a saved preference — talk to the
// main process directly rather than going through settings.json.
toggleFullscreen.addEventListener("change", () => {
    window.riftgate.invoke("toggle-fullscreen");
});

// Keep the checkbox in sync no matter how fullscreen was toggled (this
// button, F11, or the OS's own window controls).
window.riftgate.on("fullscreen-changed", (isFullscreen) => {
    toggleFullscreen.checked = isFullscreen;
    document.body.classList.toggle("is-fullscreen", isFullscreen);
});

refreshMetadataBtn.addEventListener("click", async () => {
    refreshMetadataBtn.textContent = "🔄 Refreshing...";
    allGames = await window.riftgate.invoke("refresh-metadata");
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

    // A quick rising energy sweep right at the start, like the gem
    // gathering light before its pieces snap into place.
    const whoosh = ctx.createOscillator();
    const whooshGain = ctx.createGain();
    const whooshFilter = ctx.createBiquadFilter();

    whoosh.type = "sawtooth";
    whooshFilter.type = "bandpass";
    whooshFilter.Q.value = 0.8;
    whooshFilter.frequency.setValueAtTime(200, now);
    whooshFilter.frequency.exponentialRampToValueAtTime(2200, now + 0.22);

    whoosh.frequency.setValueAtTime(80, now);
    whoosh.frequency.exponentialRampToValueAtTime(500, now + 0.22);

    whooshGain.gain.setValueAtTime(0, now);
    whooshGain.gain.linearRampToValueAtTime(0.05, now + 0.05);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    whoosh.connect(whooshFilter).connect(whooshGain).connect(ctx.destination);
    whoosh.start(now);
    whoosh.stop(now + 0.26);

    // Six quick, percussive "pieces snapping together" ticks — one per
    // facet — timed to land roughly as each one assembles, alternating
    // timbre slightly so it doesn't feel like the same sound repeating.
    const clicks = [
        { freq: 1100, start: 0.05, type: "triangle" },
        { freq: 1300, start: 0.17, type: "square" },
        { freq: 1500, start: 0.29, type: "triangle" },
        { freq: 1350, start: 0.41, type: "square" },
        { freq: 1600, start: 0.53, type: "triangle" },
        { freq: 1800, start: 0.65, type: "square" }
    ];

    clicks.forEach((c) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = c.type;
        osc.frequency.value = c.freq;

        gain.gain.setValueAtTime(0, now + c.start);
        gain.gain.linearRampToValueAtTime(0.11, now + c.start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + c.start + 0.09);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now + c.start);
        osc.stop(now + c.start + 0.12);
    });

    // Fuller resolving chord once the gem is fully formed — added a fifth
    // note and a low sub-thump underneath for more weight than a plain
    // three-note arpeggio.
    const subThump = ctx.createOscillator();
    const subGain = ctx.createGain();
    subThump.type = "sine";
    subThump.frequency.setValueAtTime(110, now + 0.75);
    subThump.frequency.exponentialRampToValueAtTime(55, now + 1.0);
    subGain.gain.setValueAtTime(0, now + 0.75);
    subGain.gain.linearRampToValueAtTime(0.18, now + 0.78);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    subThump.connect(subGain).connect(ctx.destination);
    subThump.start(now + 0.75);
    subThump.stop(now + 1.15);

    const notes = [
        { freq: 440.00, start: 0.75, dur: 0.30 },
        { freq: 659.25, start: 0.85, dur: 0.42 },
        { freq: 880.00, start: 0.95, dur: 0.55 },
        { freq: 1108.73, start: 1.05, dur: 0.6 }
    ];

    notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = n.freq;

        gain.gain.setValueAtTime(0, now + n.start);
        gain.gain.linearRampToValueAtTime(0.15, now + n.start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.dur);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now + n.start);
        osc.stop(now + n.start + n.dur + 0.05);
    });

    // A brief high sparkle timed with the gem's glossy highlight fading
    // in, like light catching a facet.
    [2637, 3520].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = 0.85 + i * 0.06;

        osc.type = "sine";
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(0.05, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.35);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + 0.4);
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
        gamesInCategory = sortNoCoverLast(gamesInCategory, "image");

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

// Pushes items with no cover image to the end of a list, everywhere
// covers are shown — Installed/Free Games, all three book sections,
// movies, and TV shows. Uses a stable sort, so items that already have
// (or already lack) a cover keep their original relative order; only
// the no-cover ones move to the bottom as a group. Some item types
// store an explicit placeholder path rather than leaving the field
// empty (games use "covers/default.jpg"), so those count as "no cover"
// too, not just a missing/falsy value.
const NO_COVER_PLACEHOLDER_PATHS = new Set(["covers/default.jpg", "covers/no-cover-book.jpg"]);

function sortNoCoverLast(items, coverField) {
    return [...items].sort((a, b) => {
        const aVal = a && a[coverField];
        const bVal = b && b[coverField];
        const aHas = !!aVal && !NO_COVER_PLACEHOLDER_PATHS.has(aVal);
        const bHas = !!bVal && !NO_COVER_PLACEHOLDER_PATHS.has(bVal);
        if (aHas === bHas) return 0;
        return aHas ? -1 : 1;
    });
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
                await window.riftgate.invoke("force-stop-tracking", game.path);
                launchBtn.textContent = "Launch";
                launchBtn.classList.remove("running");
            }
            return;
        }

        const result = await window.riftgate.invoke("launch-app", game.path);

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

            await window.riftgate.invoke(
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

            await window.riftgate.invoke(
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

                await window.riftgate.invoke(
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
            if (trailerId === undefined || trailerId === null) {
                trailerId = await window.riftgate.invoke("fetch-trailer", game.searchName || game.name, game.category || "game", game.description);
                game.trailerId = trailerId;
                if (trailerId) {
                    await window.riftgate.invoke("update-game", { path: game.path, trailerId });
                }
            }
            if (trailerId) {
                openTheaterMode(trailerId);
            } else {
                alert("No trailer could be found for this title.");
            }
        });

    const manualCoverBtn = card.querySelector(".manualCoverBtn");

    if (manualCoverBtn) {
        manualCoverBtn.addEventListener("click", async (event) => {
            event.stopPropagation();

            const newCover = await window.riftgate.invoke("select-cover-image", game.name);

            if (!newCover) return;

            game.image = newCover;

            await window.riftgate.invoke(
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

    const description = await window.riftgate.invoke("get-exe-description", exePath);

    if (description && description.length > 1 && description.toLowerCase() !== fallbackName.toLowerCase()) {
        return description;
    }

    return fallbackName;
}

async function addGameFromExternalFile(filePath, category) {

    const resolvedPath = await window.riftgate.invoke("resolve-shortcut", filePath);

    // Case-insensitive, since Windows paths are case-insensitive at the OS
    // level even though a plain string comparison isn't — this is what
    // makes "impossible to have repeated apps" actually hold up, not just
    // for exact-case matches.
    if (allGames.some((g) => g.path.toLowerCase() === resolvedPath.toLowerCase())) return;

    const rawName = resolvedPath
        .split("\\")
        .pop()
        .replace(/\.(exe|lnk)$/i, "");

    const gameName = await resolveRealName(resolvedPath, rawName);

    const override = await window.riftgate.invoke("get-override", gameName);

    let cover = override && override.image ? override.image : null;

    if (!cover) {
        cover = await window.riftgate.invoke("find-cover", gameName);

        if (cover === "covers/default.jpg") {
            cover = await window.riftgate.invoke("fetch-online-cover", gameName);
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

    await window.riftgate.invoke("save-game", game);

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

    if (trailerId === undefined || trailerId === null) {
        trailerId = await window.riftgate.invoke("fetch-trailer", game.searchName || game.name, game.category || "game", game.description);
        game.trailerId = trailerId;

        if (trailerId) {
            await window.riftgate.invoke(
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
    window.riftgate.invoke("open-external", `https://www.google.com/search?q=${query}`);
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
        await window.riftgate.invoke(
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
        await window.riftgate.invoke(
            "update-game",
            { path: game.path, description }
        );
    }
}

// When a launched process exits, flip its card's button back to "Launch"
// and refresh its playtime total (and check for a milestone).
window.riftgate.on("app-exited", (payload) => {
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
        await window.riftgate.invoke(
            "load-games"
        );

    renderLibrary();
}

addBtn.addEventListener(
    "click",
    async () => {

        const exePath =
            await window.riftgate.invoke(
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

        const override = await window.riftgate.invoke("get-override", gameName);

        let cover = override && override.image ? override.image : null;

        if (!cover) {
            cover = await window.riftgate.invoke(
                "find-cover",
                gameName
            );

            // No local match found, try fetching one online (SteamGridDB)
            if (cover === "covers/default.jpg") {
                cover = await window.riftgate.invoke(
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

        await window.riftgate.invoke(
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

const BOOK_FACTS = [
    "Project Gutenberg, launched in 1971, was the very first digital library and predates the World Wide Web by two decades.",
    "The world's oldest known library, the Library of Ashurbanipal, held thousands of clay tablets in ancient Nineveh over 2,600 years ago.",
    "The Guinness World Record for best-selling book series belongs to a certain boy wizard, with over 600 million copies sold.",
    "\"Nanowrimo\" (National Novel Writing Month) challenges writers to draft an entire 50,000-word novel in just 30 days each November.",
    "The word \"paperback\" wasn't common until the 1930s, when affordable softcover editions made books accessible to a much wider audience.",
    "The Bodleian Library at Oxford has a historic agreement entitling it to a free copy of every book published in the UK.",
    "Agatha Christie is the best-selling novelist of all time, with an estimated 2 billion copies of her books sold worldwide.",
    "The longest novel ever published, Marcel Proust's \"In Search of Lost Time,\" is estimated at around 1.2 million words.",
    "The first known author in history whose name we still know is Enheduanna, a Sumerian priestess who wrote around 2285 BCE.",
    "E-books actually predate the modern internet — Michael Hart founded Project Gutenberg by typing out the Declaration of Independence in 1971.",
    "The Codex Sinaiticus, one of the oldest surviving Bibles, was handwritten in the 4th century and is now split across four institutions.",
    "\"Don Quixote,\" published in 1605, is widely regarded as the first modern novel and remains one of the best-selling books ever written.",
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

    let sectionKey, facts, icon;
    if (currentSection === "theatre") {
        sectionKey = "theatre";
        facts = MOVIE_FACTS;
        icon = "🎬";
    } else if (currentSection === "reading-room") {
        sectionKey = "reading-room";
        facts = BOOK_FACTS;
        icon = "📖";
    } else {
        sectionKey = "games";
        facts = GAMING_FACTS;
        icon = "🎮";
    }

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
const sharedFolderContainer = document.getElementById("sharedFolderContainer");
const theatreContainer = document.getElementById("theatreContainer");
const readingRoomTopbar = document.getElementById("readingRoomTopbar");
const readingRoomBlurb = document.getElementById("readingRoomBlurb");
const readingRoomContainer = document.getElementById("readingRoomContainer");
const readingRoomSortSelect = document.getElementById("readingRoomSortSelect");
const readingRoomSearchInput = document.getElementById("readingRoomSearchInput");
const addEbookBtn = document.getElementById("addEbookBtn");
const openDropzoneBtn = document.getElementById("openDropzoneBtn");
const readingRoomTabLibrary = document.getElementById("readingRoomTabLibrary");
const readingRoomTabDiscover = document.getElementById("readingRoomTabDiscover");
const readingRoomTabBuyFree = document.getElementById("readingRoomTabBuyFree");
const discoveryHeading = document.getElementById("discoverIntroSection");
const discoverySectionsWrap = [
    discoveryHeading,
    document.getElementById("recommendedEbooksGrid").closest(".category-section"),
    document.getElementById("popularEbooksGrid").closest(".category-section"),
    document.getElementById("topDownloadedEbooksGrid").closest(".category-section")
];
const buyFreeSearchBar = document.getElementById("buyFreeSearchBar");
const buyFreeSearchInput = document.getElementById("buyFreeSearchInput");
const buyFreeSectionsWrap = [
    document.getElementById("buyFreeIntroSection"),
    document.getElementById("mostPopularBooksSection"),
    document.getElementById("mostSoldBooksSection"),
    document.getElementById("newReleasesBooksSection")
];

let activeReadingRoomTab = "buyfree"; // corrected from settings on first entry to the section
let readingRoomTabInitializedFromSettings = false;

function showReadingRoomTab(tab) {
    activeReadingRoomTab = tab;
    saveSetting("lastReadingRoomTab", tab);

    const isLibrary = tab === "library";
    const isDiscover = tab === "discover";
    const isBuyFree = tab === "buyfree";

    readingRoomTabLibrary.classList.toggle("active", isLibrary);
    readingRoomTabDiscover.classList.toggle("active", isDiscover);
    readingRoomTabBuyFree.classList.toggle("active", isBuyFree);

    readingRoomTopbar.style.display = isLibrary ? "" : "none";
    readingRoomBlurb.style.display = isLibrary ? "" : "none";
    readingRoomContainer.style.display = isLibrary ? "" : "none";

    document.querySelector(".reading-room-search-bar:not(#buyFreeSearchBar)").style.display = isBuyFree ? "none" : "";
    buyFreeSearchBar.style.display = isBuyFree ? "" : "none";

    discoverySectionsWrap.forEach((el) => {
        if (el) el.style.display = isDiscover ? "" : "none";
    });

    buyFreeSectionsWrap.forEach((el) => {
        if (el) el.style.display = isBuyFree ? "" : "none";
    });

    renderRecentlyOpenedRow();
    renderFavoritesRow();

    if (isDiscover) {
        loadEbookDiscovery();
        // Free Finds is populated from Buy Books' results — make sure
        // that data exists even if the user goes straight to Discover
        // Online without ever visiting Buy Books first.
        loadBuyFreeBooks();
        renderFreeFindsSection();
    }
    if (isBuyFree) loadBuyFreeBooks();
}

readingRoomTabLibrary.addEventListener("click", () => showReadingRoomTab("library"));
readingRoomTabDiscover.addEventListener("click", () => showReadingRoomTab("discover"));
readingRoomTabBuyFree.addEventListener("click", () => showReadingRoomTab("buyfree"));

openDropzoneBtn.addEventListener("click", () => {
    window.riftgate.invoke("open-dropzone-folder");
});

document.getElementById("openDescLogBtn").addEventListener("click", () => {
    window.riftgate.invoke("open-description-diagnostic-log");
});



let readingRoomLoaded = false;
let ebooksCache = [];
let discoveryBooksCache = { recommended: [], popular: [], topDownloaded: [] };
let buyFreeBooksCache = { popular: [], mostSold: [], newReleases: [] };
let buyFreeBooksLoaded = false;
let buyFreeBooksLoadInProgress = false;

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
    "reading-room": "📖 Reading Room",
    new: "🆕 New",
    "shared-folder": "🔮 The Vault"
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
    apps: ["🧰", "🖥️", "📱", "💾", "🗂️", "⚙️"],
    books: ["📚", "📖", "🔖", "✒️", "📜", "🕯️"]
};

function setAmbientIcons(section) {
    const layer = document.getElementById("ambientIconsLayer");
    if (!layer) return;

    let iconSet;
    if (section === "theatre") {
        iconSet = AMBIENT_ICON_SETS.cinema;
    } else if (section === "applications") {
        iconSet = AMBIENT_ICON_SETS.apps;
    } else if (section === "reading-room") {
        iconSet = AMBIENT_ICON_SETS.books;
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
    showNextFact();

    // Surprise Me doesn't have a meaningful pool to pick from in the New
    // section (it's a mixed feed of upcoming/new items, not a personal
    // library or a browsable list to spin against), and The Vault isn't
    // a browsable list of things to launch/read/watch at all.
    surpriseBtn.style.display = (section === "new" || section === "shared-folder") ? "none" : "";

    sidebarNavButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.section === section);
    });

    const isInstalled = section === "installed";
    installedTopbar.style.display = isInstalled ? "" : "none";
    installedBlurb.style.display = isInstalled ? "" : "none";
    libraryContainer.style.display = isInstalled ? "" : "none";
    introScreen.classList.toggle("active", isInstalled && allGames.length === 0);

    theatreTopbar.style.display = section === "theatre" ? "" : "none";

    const isReadingRoom = section === "reading-room";
    document.querySelector(".reading-room-tabs").style.display = isReadingRoom ? "" : "none";

    if (isReadingRoom) {
        if (!readingRoomTabInitializedFromSettings) {
            readingRoomTabInitializedFromSettings = true;
            activeReadingRoomTab = settings.lastReadingRoomTab || "buyfree";
        }
        showReadingRoomTab(activeReadingRoomTab);
    } else {
        readingRoomTopbar.style.display = "none";
        readingRoomBlurb.style.display = "none";
        readingRoomContainer.style.display = "none";
        document.getElementById("recentlyOpenedSection").style.display = "none";
        document.getElementById("favoritesSection").style.display = "none";
        document.getElementById("freeFindsSection").style.display = "none";
        document.getElementById("buyBooksSearchResultsSection").style.display = "none";
        buyFreeSearchBar.style.display = "none";
        buyFreeSectionsWrap.forEach((el) => {
            if (el) el.style.display = "none";
        });
        discoverySectionsWrap.forEach((el) => {
            if (el) el.style.display = "none";
        });
    }

    freeGamesContainer.classList.toggle("active", section === "free-games");
    applicationsContainer.classList.toggle("active", section === "applications");
    sharedFolderContainer.classList.toggle("active", section === "shared-folder");
    theatreContainer.classList.toggle("active", section === "theatre");
    document.getElementById("newContainer").classList.toggle("active", section === "new");

    if (section === "shared-folder") loadSharedFolder();

    if (section === "free-games" && !freeGamesLoaded) {
        freeGamesLoaded = true;
        loadFreeGames();
    }

    if (section === "reading-room" && !readingRoomLoaded) {
        readingRoomLoaded = true;
        loadReadingRoom();
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
function attachSeeMore(grid, rowsVisible = 2, expandedRowsCap = null) {
    const next = grid.nextElementSibling;
    if (next && next.classList.contains("see-more-btn")) {
        next.remove();
    }

    grid.classList.remove("grid-collapsed");
    grid.style.maxHeight = "";
    grid.style.overflowY = "";

    requestAnimationFrame(() => {
        const cards = Array.from(grid.children);
        if (cards.length === 0) return;

        const tops = [...new Set(cards.map((c) => c.offsetTop))].sort((a, b) => a - b);
        if (tops.length <= rowsVisible) return;

        const collapsedHeight = tops[rowsVisible] - tops[0];

        // When expanded, optionally cap the height to a fixed number of
        // rows with its own internal scrollbar, instead of growing
        // without limit — a platform with many games could otherwise
        // push the fold/unfold button far down the page, out of easy
        // reach once expanded.
        let expandedHeight = null;
        if (expandedRowsCap && tops.length > expandedRowsCap) {
            expandedHeight = tops[expandedRowsCap] - tops[0];
        }

        grid.classList.add("grid-collapsed");
        grid.style.maxHeight = `${collapsedHeight}px`;

        const btn = document.createElement("button");
        btn.className = "see-more-btn";
        btn.textContent = "▾ See more";

        btn.addEventListener("click", () => {
            const isCollapsed = grid.classList.toggle("grid-collapsed");
            if (isCollapsed) {
                grid.style.maxHeight = `${collapsedHeight}px`;
                grid.style.overflowY = "";
            } else if (expandedHeight) {
                grid.style.maxHeight = `${expandedHeight}px`;
                grid.style.overflowY = "auto";
            } else {
                grid.style.maxHeight = "";
                grid.style.overflowY = "";
            }
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
            <div class="card-footer">
                <button class="launchBtn getGameBtn">🔗 Get It Free (${game.source})</button>
            </div>
        </div>
    `;

    const getGameBtn = card.querySelector(".getGameBtn");

    getGameBtn.addEventListener("click", () => {
        window.riftgate.invoke("open-external", game.url);
    });

    // Description only appears as a hover tooltip on this button, rather
    // than always taking up space on the card — matches the pattern used
    // for movie descriptions elsewhere in the app.
    let descHoverTimer = null;

    getGameBtn.addEventListener("mouseenter", () => {
        clearTimeout(descHoverTimer);
        descHoverTimer = setTimeout(() => {
            openDescModal(game.name, game.description || `Free on ${game.source}.`, getGameBtn);
        }, 350);
    });

    getGameBtn.addEventListener("mouseleave", () => {
        clearTimeout(descHoverTimer);
        closeDescModal();
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
        if (trailerId === undefined || trailerId === null) {
            trailerId = await window.riftgate.invoke("fetch-trailer", game.name, "game", game.description, game.id);
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
const freeGamesPlatformSelect = document.getElementById("freeGamesPlatformSelect");
const freeGamesCategorySelect = document.getElementById("freeGamesCategorySelect");

freeGamesSearchInput.addEventListener("input", renderFreeGames);

freeGamesPlatformSelect.addEventListener("change", () => {
    updateFreeGamesGenreOptions();
    renderFreeGames();
});

freeGamesCategorySelect.addEventListener("change", renderFreeGames);

// Platform display names, used only for the plain section heading text —
// selection itself now happens through the platform dropdown, not a
// clickable badge.
const PLATFORM_LABELS = {
    "Steam": "STEAM",
    "Epic Games": "EPIC GAMES",
    "GOG": "GOG"
};

// The genre dropdown's options depend on which platform is currently
// selected — e.g. picking "Steam" should only offer genres that actually
// exist among Steam's free games, not Epic's or GOG's.
function updateFreeGamesGenreOptions() {
    const platformFilter = freeGamesPlatformSelect.value;
    const previousSelection = freeGamesCategorySelect.value;

    const relevant = platformFilter === "all"
        ? freeGamesCache
        : freeGamesCache.filter((g) => g.source === platformFilter);

    const genres = new Set();
    relevant.forEach((g) => genres.add((g.tags && g.tags[0]) || g.source));

    freeGamesCategorySelect.innerHTML =
        '<option value="all">All Genres</option>' +
        Array.from(genres).sort()
            .map((c) => `<option value="${c}">${c}</option>`)
            .join("");

    if (Array.from(freeGamesCategorySelect.options).some((o) => o.value === previousSelection)) {
        freeGamesCategorySelect.value = previousSelection;
    }
}

function renderFreeGames() {
    const newRow = document.getElementById("freeGamesNewRow");
    const restRow = document.getElementById("freeGamesRestRow");
    const browseHeading = document.getElementById("freeGamesBrowseHeading");

    const searchTerm = freeGamesSearchInput.value.trim().toLowerCase();
    const platformFilter = freeGamesPlatformSelect.value;
    const categoryFilter = freeGamesCategorySelect.value;

    const filtered = freeGamesCache.filter((g) => {
        if (searchTerm && !g.name.toLowerCase().includes(searchTerm)) return false;
        if (platformFilter !== "all" && g.source !== platformFilter) return false;
        if (categoryFilter !== "all") {
            const cat = (g.tags && g.tags[0]) || g.source;
            if (cat !== categoryFilter) return false;
        }
        return true;
    });

    newRow.innerHTML = "";
    restRow.innerHTML = "";
    browseHeading.style.display = "none";

    if (filtered.length === 0) {
        restRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;text-align:center;">No free games match your search or filter.</p>`;
        return;
    }

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newlyAdded = sortNoCoverLast(filtered.filter((g) => (g.firstSeenAt || 0) > oneWeekAgo), "image");
    const rest = sortNoCoverLast(filtered.filter((g) => (g.firstSeenAt || 0) <= oneWeekAgo), "image");

    // Only needed when BOTH zones have something to show — otherwise
    // there's only one list on screen and no ambiguity to clear up.
    browseHeading.style.display = (newlyAdded.length > 0 && rest.length > 0) ? "" : "none";

    if (newlyAdded.length > 0) {
        // Split by platform here too, same as the main list below — a
        // single mixed grid would look like everything shares one
        // collapsing bar instead of each platform having its own.
        const newlyAddedByPlatform = {};
        newlyAdded.forEach((g) => {
            if (!newlyAddedByPlatform[g.source]) newlyAddedByPlatform[g.source] = [];
            newlyAddedByPlatform[g.source].push(g);
        });

        const newlyAddedPlatformNames = Object.keys(newlyAddedByPlatform).sort(
            (a, b) => newlyAddedByPlatform[a].length - newlyAddedByPlatform[b].length
        );

        newlyAddedPlatformNames.forEach((platformName) => {
            const items = newlyAddedByPlatform[platformName];
            const label = PLATFORM_LABELS[platformName] || platformName.toUpperCase();

            const section = document.createElement("div");
            section.className = "category-section";
            const heading = document.createElement("h2");
            heading.textContent = `🆕 ${label} — Newly Added (${items.length})`;
            section.appendChild(heading);
            const grid = document.createElement("div");
            grid.className = "games-grid browse-grid";
            items.forEach((g) => grid.appendChild(buildFreeGameCard(g)));
            section.appendChild(grid);
            newRow.appendChild(section);
            attachSeeMore(grid, 2, 4);
        });
    }

    // The list is always divided by platform, with a plain heading naming
    // it above each group — this is a separate, independent grouping from
    // the two filter dropdowns above (platform and genre), which just
    // narrow which games appear in each group rather than replacing this
    // separation with a flat list.
    const byPlatform = {};
    rest.forEach((g) => {
        if (!byPlatform[g.source]) byPlatform[g.source] = [];
        byPlatform[g.source].push(g);
    });

    // Platforms with fewer games are shown first — quick to scan, and the
    // biggest list (usually Steam) ends up last.
    const platformNames = Object.keys(byPlatform).sort(
        (a, b) => byPlatform[a].length - byPlatform[b].length
    );

    platformNames.forEach((platformName) => {
        const items = byPlatform[platformName];
        const label = PLATFORM_LABELS[platformName] || platformName.toUpperCase();

        const section = document.createElement("div");
        section.className = "category-section";

        const heading = document.createElement("h2");
        heading.textContent = `${label} (${items.length})`;
        section.appendChild(heading);

        const grid = document.createElement("div");
        grid.className = "games-grid browse-grid";
        items.forEach((g) => grid.appendChild(buildFreeGameCard(g)));
        section.appendChild(grid);
        restRow.appendChild(section);
        attachSeeMore(grid, 2, 4);
    });
}

// --- Reading Room (eBook library) ------------------------------------------

function buildEbookCard(book) {
    const card = document.createElement("div");
    card.className = "game-card";

    const cover = document.createElement("img");
    cover.className = "cover";
    cover.onerror = () => { cover.onerror = null; cover.src = "covers/no-cover-book.jpg"; };
    cover.src = book.cover || "covers/no-cover-book.jpg";
    cover.alt = book.title;
    cover.style.cursor = "pointer";
    cover.addEventListener("mouseenter", () => {
        openDescModal(book.title, book.description || "No description available for this book.", cover);
    });
    cover.addEventListener("mouseleave", closeDescModal);
    card.appendChild(cover);

    const manualCoverBtn = document.createElement("button");
    manualCoverBtn.className = "manualCoverBtn";
    manualCoverBtn.title = book.cover ? "Change cover image" : "Choose a cover image";
    manualCoverBtn.textContent = book.cover ? "\ud83d\uddbc\ufe0f Change cover" : "\ud83d\uddbc\ufe0f Add cover";
    manualCoverBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const newCover = await window.riftgate.invoke("select-ebook-cover-image");
        if (!newCover) return;

        book.cover = newCover;
        await window.riftgate.invoke("update-ebook-cover", { ebookPath: book.path, newCover });

        const cached = ebooksCache.find((b) => b.path === book.path);
        if (cached) cached.cover = newCover;

        renderReadingRoom();
        renderRecentlyOpenedRow();
        renderFavoritesRow();
    });
    card.appendChild(manualCoverBtn);

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const title = document.createElement("div");
    title.className = "game-title";
    title.textContent = book.title;
    overlay.appendChild(title);

    if (book.author) {
        const author = document.createElement("div");
        author.className = "game-meta";
        author.textContent = book.author;
        overlay.appendChild(author);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "launchBtn";
    openBtn.textContent = "📖 Open";
    openBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const result = await window.riftgate.invoke("launch-ebook", book.path);
        if (!result.success) {
            alert(`Couldn't open this file: ${result.error}`);
            return;
        }
        await window.riftgate.invoke("mark-ebook-opened", book.path);
        const cached = ebooksCache.find((b) => b.path === book.path);
        if (cached) cached.lastOpenedAt = Date.now();
        renderRecentlyOpenedRow();
    });
    actions.appendChild(openBtn);

    const favoriteBtn = document.createElement("button");
    favoriteBtn.className = "favoriteBtn";
    favoriteBtn.textContent = book.favorite ? "★" : "☆";
    favoriteBtn.title = book.favorite ? "Remove from Favorites" : "Add to Favorites";
    favoriteBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const result = await window.riftgate.invoke("toggle-ebook-favorite", book.path);
        if (result.success) {
            const cached = ebooksCache.find((b) => b.path === book.path);
            if (cached) cached.favorite = result.favorite;
            favoriteBtn.textContent = result.favorite ? "★" : "☆";
            favoriteBtn.title = result.favorite ? "Remove from Favorites" : "Add to Favorites";
            renderFavoritesRow();
        }
    });
    card.appendChild(favoriteBtn);

    const sendToDeviceBtn = document.createElement("button");
    sendToDeviceBtn.className = "launchBtn";
    sendToDeviceBtn.textContent = "📲 Send to Device";
    sendToDeviceBtn.title = "Copy this book to a connected Kindle, phone, tablet, or other device";
    sendToDeviceBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        sendToDeviceBtn.disabled = true;
        const result = await window.riftgate.invoke("send-ebook-to-device", book.path);
        sendToDeviceBtn.disabled = false;

        if (result.canceled) return;

        if (!result.success) {
            alert(result.error || "Couldn't send this book to your device.");
            return;
        }

        alert(`Sent to:\n${result.path}`);
    });
    actions.appendChild(sendToDeviceBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "removeBtn";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove from Reading Room";
    removeBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const confirmed = !settings.confirmBeforeRemove || confirm(`Delete "${book.title}" permanently? This removes the actual file from your Reading Room folder, not just the list.`);
        if (!confirmed) return;
        await window.riftgate.invoke("remove-ebook", book.path);
        ebooksCache = ebooksCache.filter((b) => b.path !== book.path);
        renderReadingRoom();
        renderRecentlyOpenedRow();
        renderFavoritesRow();
    });
    actions.appendChild(removeBtn);

    overlay.appendChild(actions);
    card.appendChild(overlay);

    card.addEventListener("dblclick", () => openBtn.click());

    return card;
}

function renderReadingRoom() {
    const searchTerm = readingRoomSearchInput.value.trim().toLowerCase();
    const sortBy = readingRoomSortSelect.value;

    let filtered = ebooksCache.filter((b) =>
        !searchTerm ||
        b.title.toLowerCase().includes(searchTerm) ||
        (b.author && b.author.toLowerCase().includes(searchTerm))
    );

    filtered = [...filtered].sort((a, b) => {
        if (sortBy === "author") return (a.author || "").localeCompare(b.author || "");
        if (sortBy === "recent-added") return (b.addedAt || 0) - (a.addedAt || 0);
        return a.title.localeCompare(b.title);
    });
    filtered = sortNoCoverLast(filtered, "cover");

    readingRoomContainer.innerHTML = "";

    if (filtered.length === 0) {
        readingRoomContainer.innerHTML = ebooksCache.length === 0
            ? `<p style="color:var(--text-muted);font-size:13px;text-align:center;grid-column:1/-1;">Your Reading Room is empty — drag an EPUB or PDF in, or click + to browse for one.</p>`
            : `<p style="color:var(--text-muted);font-size:13px;text-align:center;grid-column:1/-1;">No books match your search.</p>`;
        return;
    }

    filtered.forEach((book) => readingRoomContainer.appendChild(buildEbookCard(book)));
}

async function loadReadingRoom() {
    ebooksCache = await window.riftgate.invoke("get-ebooks");
    renderReadingRoom();
    renderRecentlyOpenedRow();
    renderFavoritesRow();
}

// --- Free eBooks discovery (Project Gutenberg) -----------------------------

const recommendedEbooksGrid = document.getElementById("recommendedEbooksGrid");
const popularEbooksGrid = document.getElementById("popularEbooksGrid");
const topDownloadedEbooksGrid = document.getElementById("topDownloadedEbooksGrid");

let ebookDiscoveryLoaded = false;

function buildDiscoveryEbookCard(book) {
    const card = document.createElement("div");
    card.className = "game-card";

    const cover = document.createElement("img");
    cover.className = "cover";
    cover.onerror = () => { cover.onerror = null; cover.src = "covers/no-cover-book.jpg"; };
    cover.src = book.cover || "covers/no-cover-book.jpg";
    cover.alt = book.title;
    cover.style.cursor = "pointer";
    cover.addEventListener("mouseenter", () => {
        openDescModal(book.title, book.summary || "No description available for this book.", cover);
    });
    cover.addEventListener("mouseleave", closeDescModal);
    card.appendChild(cover);

    const manualCoverBtn = document.createElement("button");
    manualCoverBtn.className = "manualCoverBtn";
    manualCoverBtn.title = book.cover ? "Change cover image" : "Choose a cover image";
    manualCoverBtn.textContent = book.cover ? "\ud83d\uddbc\ufe0f Change cover" : "\ud83d\uddbc\ufe0f Add cover";
    manualCoverBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const newCover = await window.riftgate.invoke("select-ebook-cover-image");
        if (!newCover) return;

        // Not in the library yet, so nothing to persist here — just
        // update this card and the underlying book object directly, so
        // the custom cover carries over automatically if this book is
        // downloaded/added later.
        book.cover = newCover;
        cover.src = newCover;
        manualCoverBtn.textContent = "\ud83d\uddbc\ufe0f Change cover";
        manualCoverBtn.title = "Change cover image";
    });
    card.appendChild(manualCoverBtn);

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const title = document.createElement("div");
    title.className = "game-title";
    title.textContent = book.title;
    overlay.appendChild(title);

    const author = document.createElement("div");
    author.className = "game-meta";
    author.textContent = book.author;
    overlay.appendChild(author);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "launchBtn";
    downloadBtn.textContent = "⬇️ Download";
    downloadBtn.addEventListener("click", async (event) => {
        event.stopPropagation();

        if (!book.downloadUrl) {
            alert("No EPUB download is available for this book.");
            return;
        }

        downloadBtn.disabled = true;
        downloadBtn.textContent = "Downloading...";

        const result = await window.riftgate.invoke("download-free-ebook", book);

        if (result.success) {
            downloadBtn.textContent = "✓ Added to Library";
            ebooksCache.push({
                path: result.path,
                title: result.title,
                author: result.author,
                cover: result.cover,
                format: "epub",
                addedAt: Date.now()
            });
            renderReadingRoom();
        } else if (result.duplicate) {
            downloadBtn.textContent = "Already Downloaded";
        } else {
            downloadBtn.textContent = "⬇️ Download";
            downloadBtn.disabled = false;
            alert(result.error || "Download failed.");
        }
    });
    actions.appendChild(downloadBtn);

    overlay.appendChild(actions);
    card.appendChild(overlay);

    return card;
}

function renderEbookDiscoveryGrid(grid, books, errorMessage) {
    grid.innerHTML = "";
    if (books.length === 0) {
        const detail = errorMessage ? ` (${errorMessage})` : "";
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;grid-column:1/-1;">Couldn't load this right now${detail} — check your connection and reopen Reading Room.</p>`;
        return;
    }
    sortNoCoverLast(books, "cover").forEach((book) => grid.appendChild(buildDiscoveryEbookCard(book)));
}

async function loadEbookDiscovery() {
    if (ebookDiscoveryLoaded) return;

    // Show whatever was last successfully fetched immediately, with no
    // network wait — the section is never empty just because a fresh
    // fetch hasn't finished yet.
    const [cachedRecommended, cachedPopular, cachedTopDownloaded] = await Promise.all([
        window.riftgate.invoke("get-cached-recommended-ebooks"),
        window.riftgate.invoke("get-cached-popular-ebooks"),
        window.riftgate.invoke("get-cached-top-downloaded-ebooks")
    ]);

    if (cachedRecommended.length || cachedPopular.length || cachedTopDownloaded.length) {
        renderEbookDiscoveryGrid(recommendedEbooksGrid, cachedRecommended);
        renderEbookDiscoveryGrid(popularEbooksGrid, cachedPopular);
        renderEbookDiscoveryGrid(topDownloadedEbooksGrid, cachedTopDownloaded);
        attachSeeMore(recommendedEbooksGrid, 3, 4);
        attachSeeMore(popularEbooksGrid, 3, 4);
        attachSeeMore(topDownloadedEbooksGrid, 3, 4);
        discoveryBooksCache = { recommended: cachedRecommended, popular: cachedPopular, topDownloaded: cachedTopDownloaded };
    }

    // Then refresh in the background — only actually replaces what's on
    // screen once new data genuinely arrives, so a failed refresh just
    // silently keeps the (still-valid) cached view showing instead of
    // ever blanking out or showing an error over real content.
    const [recommended, popular, topDownloaded] = await Promise.all([
        window.riftgate.invoke("get-recommended-ebooks"),
        window.riftgate.invoke("get-popular-ebooks"),
        window.riftgate.invoke("get-top-downloaded-ebooks")
    ]);

    if (recommended.success && popular.success && topDownloaded.success) {
        ebookDiscoveryLoaded = true;
    }

    if (recommended.success) renderEbookDiscoveryGrid(recommendedEbooksGrid, recommended.books, recommended.error);
    if (popular.success) renderEbookDiscoveryGrid(popularEbooksGrid, popular.books, popular.error);
    if (topDownloaded.success) renderEbookDiscoveryGrid(topDownloadedEbooksGrid, topDownloaded.books, topDownloaded.error);

    // If NOTHING was cached and the live fetch also failed, there's
    // genuinely nothing to show yet — surface that clearly rather than
    // leaving the section looking broken with no explanation.
    if (!cachedRecommended.length && !recommended.success) {
        renderEbookDiscoveryGrid(recommendedEbooksGrid, [], recommended.error);
    }
    if (!cachedPopular.length && !popular.success) {
        renderEbookDiscoveryGrid(popularEbooksGrid, [], popular.error);
    }
    if (!cachedTopDownloaded.length && !topDownloaded.success) {
        renderEbookDiscoveryGrid(topDownloadedEbooksGrid, [], topDownloaded.error);
    }

    attachSeeMore(recommendedEbooksGrid, 3, 4);
    attachSeeMore(popularEbooksGrid, 3, 4);
    attachSeeMore(topDownloadedEbooksGrid, 3, 4);

    discoveryBooksCache = {
        recommended: recommended.success ? recommended.books : cachedRecommended,
        popular: popular.success ? popular.books : cachedPopular,
        topDownloaded: topDownloaded.success ? topDownloaded.books : cachedTopDownloaded
    };
}

function buildBuyFreeBookCard(book) {
    const card = document.createElement("div");
    card.className = "game-card";

    const cover = document.createElement("img");
    cover.className = "cover";
    cover.onerror = () => { cover.onerror = null; cover.src = "covers/no-cover-book.jpg"; };
    cover.src = book.cover || "covers/no-cover-book.jpg";
    cover.alt = book.title;
    cover.style.cursor = "pointer";
    cover.addEventListener("mouseenter", async () => {
        if (book.description === null && book.workKey) {
            openDescModal(book.title, "Loading description...", cover);
            const desc = await window.riftgate.invoke("get-openlibrary-description", book.workKey);
            book.description = desc || undefined;
            // Only update the modal if still hovering this same cover —
            // avoids an in-flight fetch overwriting whatever's showing
            // after the user has already moved on to another book.
            if (cover.matches(":hover")) {
                openDescModal(book.title, book.description || "No description available for this book.", cover);
            }
            return;
        }
        openDescModal(book.title, book.description || "No description available for this book.", cover);
    });
    cover.addEventListener("mouseleave", closeDescModal);
    card.appendChild(cover);

    const manualCoverBtn = document.createElement("button");
    manualCoverBtn.className = "manualCoverBtn";
    manualCoverBtn.title = book.cover ? "Change cover image" : "Choose a cover image";
    manualCoverBtn.textContent = book.cover ? "\ud83d\uddbc\ufe0f Change cover" : "\ud83d\uddbc\ufe0f Add cover";
    manualCoverBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const newCover = await window.riftgate.invoke("select-ebook-cover-image");
        if (!newCover) return;

        // Not in the library yet, so nothing to persist here — just
        // update this card and the underlying book object directly.
        book.cover = newCover;
        cover.src = newCover;
        manualCoverBtn.textContent = "\ud83d\uddbc\ufe0f Change cover";
        manualCoverBtn.title = "Change cover image";
    });
    card.appendChild(manualCoverBtn);

    const overlay = document.createElement("div");
    overlay.className = "card-overlay";

    const title = document.createElement("div");
    title.className = "game-title";
    title.textContent = book.title;
    overlay.appendChild(title);

    const author = document.createElement("div");
    author.className = "game-meta";
    author.textContent = book.isFree ? `${book.author} · Free` : `${book.author}${book.price ? ` · ${book.price}` : ""}`;
    overlay.appendChild(author);

    // Only a fraction of Open Library's catalog actually has readable
    // content attached — most results are metadata-only listings. This
    // makes that distinction visible at a glance instead of the user
    // finding out only after clicking through.
    if (book.accessLevel) {
        const accessBadge = document.createElement("div");
        accessBadge.className = "game-meta";
        accessBadge.style.fontSize = "10px";
        if (book.accessLevel === "public") {
            accessBadge.textContent = "✅ Free to read here";
            accessBadge.style.color = "#4ade80";
        } else if (book.accessLevel === "borrowable") {
            accessBadge.textContent = "📚 Borrowable";
            accessBadge.style.color = "#60a5fa";
        } else if (book.accessLevel === "printdisabled") {
            accessBadge.textContent = "♿ Restricted access";
            accessBadge.style.color = "var(--text-muted)";
        } else {
            accessBadge.textContent = "📋 Catalog listing only";
            accessBadge.style.color = "var(--text-muted)";
        }
        overlay.appendChild(accessBadge);
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const actionBtn = document.createElement("button");
    actionBtn.className = "launchBtn";
    if (book.isFree) {
        actionBtn.textContent = "📖 View Free";
    } else {
        actionBtn.textContent = "🛒 Buy";
    }
    actionBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const link = book.buyLink || book.infoLink;
        if (link) {
            window.riftgate.invoke("open-external", link);
        } else {
            alert("No link available for this book.");
        }
    });
    actions.appendChild(actionBtn);

    overlay.appendChild(actions);
    card.appendChild(overlay);

    return card;
}

function renderBuyFreeGrid(grid, books, errorMessage) {
    grid.innerHTML = "";
    if (books.length === 0) {
        const detail = errorMessage ? ` (${errorMessage})` : "";
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;grid-column:1/-1;">Couldn't load this right now${detail} — check your connection and reopen Reading Room.</p>`;
        return;
    }
    sortNoCoverLast(books, "cover").forEach((book) => grid.appendChild(buildBuyFreeBookCard(book)));
}

let freeFindsCache = [];

function renderFreeFindsSection() {
    const section = document.getElementById("freeFindsSection");
    const grid = document.getElementById("freeFindsGrid");

    if (freeFindsCache.length === 0) {
        section.style.display = "none";
        return;
    }

    section.style.display = activeReadingRoomTab === "discover" ? "" : "none";
    grid.innerHTML = "";
    sortNoCoverLast(freeFindsCache, "cover").forEach((book) => grid.appendChild(buildBuyFreeBookCard(book)));
}

async function loadBuyFreeBooks() {
    if (buyFreeBooksLoaded || buyFreeBooksLoadInProgress) return;
    buyFreeBooksLoadInProgress = true;

    const popularGrid = document.getElementById("mostPopularBooksGrid");
    const mostSoldGrid = document.getElementById("mostSoldBooksGrid");
    const newReleasesGrid = document.getElementById("newReleasesBooksGrid");

    // Free results belong in Discover Online instead, at the top —
    // Buy Books is specifically for things you'd actually purchase.
    const seenFreeIds = new Set();
    const splitFree = (books) => {
        const paid = [];
        (books || []).forEach((b) => {
            if (b.isFree) {
                if (!seenFreeIds.has(b.id)) {
                    seenFreeIds.add(b.id);
                    freeFindsCache.push(b);
                }
            } else {
                paid.push(b);
            }
        });
        return paid;
    };

    // Show whatever was last successfully fetched immediately, with no
    // network wait, exactly like Discover Online.
    const [cachedPopular, cachedMostSold, cachedNewReleases] = await Promise.all([
        window.riftgate.invoke("get-cached-openlibrary-popular"),
        window.riftgate.invoke("get-cached-openlibrary-most-sold"),
        window.riftgate.invoke("get-cached-openlibrary-new-releases")
    ]);

    if (cachedPopular.length || cachedMostSold.length || cachedNewReleases.length) {
        const cachedPopularPaid = splitFree(cachedPopular).slice(0, 20);
        const cachedMostSoldPaid = splitFree(cachedMostSold).slice(0, 20);
        const cachedNewReleasesPaid = splitFree(cachedNewReleases);

        renderBuyFreeGrid(popularGrid, cachedPopularPaid);
        renderBuyFreeGrid(mostSoldGrid, cachedMostSoldPaid);
        renderBuyFreeGrid(newReleasesGrid, cachedNewReleasesPaid);
        attachSeeMore(newReleasesGrid, 5);

        buyFreeBooksCache = { popular: cachedPopularPaid, mostSold: cachedMostSoldPaid, newReleases: cachedNewReleasesPaid };
        renderFreeFindsSection();
    }

    // Then refresh in the background — only replaces what's on screen
    // once new data genuinely arrives.
    const [popular, mostSold, newReleases] = await Promise.all([
        window.riftgate.invoke("get-openlibrary-popular"),
        window.riftgate.invoke("get-openlibrary-most-sold"),
        window.riftgate.invoke("get-openlibrary-new-releases")
    ]);

    if (popular.success && mostSold.success && newReleases.success) {
        buyFreeBooksLoaded = true;
    }

    const popularPaid = popular.success ? splitFree(popular.books).slice(0, 20) : null;
    const mostSoldPaid = mostSold.success ? splitFree(mostSold.books).slice(0, 20) : null;
    const newReleasesPaid = newReleases.success ? splitFree(newReleases.books) : null;

    if (popularPaid) renderBuyFreeGrid(popularGrid, popularPaid, popular.error);
    else if (!cachedPopular.length) renderBuyFreeGrid(popularGrid, [], popular.error);

    if (mostSoldPaid) renderBuyFreeGrid(mostSoldGrid, mostSoldPaid, mostSold.error);
    else if (!cachedMostSold.length) renderBuyFreeGrid(mostSoldGrid, [], mostSold.error);

    if (newReleasesPaid) renderBuyFreeGrid(newReleasesGrid, newReleasesPaid, newReleases.error);
    else if (!cachedNewReleases.length) renderBuyFreeGrid(newReleasesGrid, [], newReleases.error);

    attachSeeMore(newReleasesGrid, 5);

    buyFreeBooksCache = {
        popular: popularPaid || buyFreeBooksCache.popular,
        mostSold: mostSoldPaid || buyFreeBooksCache.mostSold,
        newReleases: newReleasesPaid || buyFreeBooksCache.newReleases
    };

    renderFreeFindsSection();
    buyFreeBooksLoadInProgress = false;
}

let buyFreeSearchDebounce = null;

buyFreeSearchInput.addEventListener("input", () => {
    clearTimeout(buyFreeSearchDebounce);

    const term = buyFreeSearchInput.value.trim();
    const resultsSection = document.getElementById("buyBooksSearchResultsSection");
    const resultsHeading = document.getElementById("buyBooksSearchResultsHeading");
    const resultsGrid = document.getElementById("buyBooksSearchResultsGrid");
    const popularSection = document.getElementById("mostPopularBooksSection");
    const mostSoldSection = document.getElementById("mostSoldBooksSection");
    const newReleasesSection = document.getElementById("newReleasesBooksSection");

    if (!term) {
        resultsSection.style.display = "none";
        resultsGrid.innerHTML = "";
        popularSection.style.display = "";
        mostSoldSection.style.display = "";
        newReleasesSection.style.display = "";
        return;
    }

    // Search covers the whole catalog, not just what's already loaded —
    // shown in its own dedicated section so it never gets confused with
    // (or overwrites) Most Popular/Best Seller/New Releases, which stay
    // hidden while a search is active.
    popularSection.style.display = "none";
    mostSoldSection.style.display = "none";
    newReleasesSection.style.display = "none";

    resultsSection.style.display = "";
    resultsHeading.textContent = `🔍 Searching for "${term}"...`;
    resultsGrid.innerHTML = "";

    buyFreeSearchDebounce = setTimeout(async () => {
        const result = await window.riftgate.invoke("search-openlibrary-books", term);
        resultsHeading.textContent = `🔍 Results for "${term}"`;
        renderBuyFreeGrid(resultsGrid, result.success ? result.books : [], result.error);
        attachSeeMore(resultsGrid, 3, 4);
    }, 500);
});

let discoverySearchDebounce = null;

function filterDiscoveryBySearch() {
    clearTimeout(discoverySearchDebounce);

    const term = readingRoomSearchInput.value.trim();
    const recommendedHeading = recommendedEbooksGrid.closest(".category-section").querySelector("h2");
    const popularSection = popularEbooksGrid.closest(".category-section");
    const topDownloadedSection = topDownloadedEbooksGrid.closest(".category-section");

    if (!term) {
        recommendedHeading.textContent = "⭐ Recommended Books";
        popularSection.style.display = "";
        topDownloadedSection.style.display = "";
        renderEbookDiscoveryGrid(recommendedEbooksGrid, discoveryBooksCache.recommended);
        renderEbookDiscoveryGrid(popularEbooksGrid, discoveryBooksCache.popular);
        renderEbookDiscoveryGrid(topDownloadedEbooksGrid, discoveryBooksCache.topDownloaded);
        attachSeeMore(recommendedEbooksGrid, 3, 4);
        attachSeeMore(popularEbooksGrid, 3, 4);
        attachSeeMore(topDownloadedEbooksGrid, 3, 4);
        return;
    }

    // A real search against Gutenberg's whole catalog, not just the
    // small set of books already loaded on screen — debounced so it
    // only fires once typing pauses, not on every keystroke.
    recommendedHeading.textContent = `🔍 Searching for "${term}"...`;
    popularSection.style.display = "none";
    topDownloadedSection.style.display = "none";
    recommendedEbooksGrid.innerHTML = "";

    discoverySearchDebounce = setTimeout(async () => {
        const result = await window.riftgate.invoke("search-gutenberg-books", term);
        recommendedHeading.textContent = `🔍 Results for "${term}"`;
        renderEbookDiscoveryGrid(recommendedEbooksGrid, result.success ? result.books : [], result.error);
        attachSeeMore(recommendedEbooksGrid, 3, 4);
    }, 500);
}

// --- Recently Opened carousel ------------------------------------------

function renderRecentlyOpenedRow() {
    const row = document.getElementById("recentlyOpenedRow");
    const section = document.getElementById("recentlyOpenedSection");

    // Library-only — never shown on Discover Online or outside Reading
    // Room, and only ever built from the user's own library, never
    // discovery/online books.
    if (currentSection !== "reading-room" || activeReadingRoomTab !== "library") {
        section.style.display = "none";
        return;
    }

    const recent = ebooksCache
        .filter((b) => b.lastOpenedAt)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, 20);

    if (recent.length === 0) {
        section.style.display = "none";
        return;
    }

    section.style.display = "";
    row.innerHTML = "";
    recent.forEach((book) => row.appendChild(buildEbookCard(book)));
}

function renderFavoritesRow() {
    const row = document.getElementById("favoritesRow");
    const section = document.getElementById("favoritesSection");

    // Same rule as Recently Opened — Library-only.
    if (currentSection !== "reading-room" || activeReadingRoomTab !== "library") {
        section.style.display = "none";
        return;
    }

    const favorites = ebooksCache.filter((b) => b.favorite);

    if (favorites.length === 0) {
        section.style.display = "none";
        return;
    }

    section.style.display = "";
    row.innerHTML = "";
    favorites.forEach((book) => row.appendChild(buildEbookCard(book)));
}

document.getElementById("favoritesLeftArrow").addEventListener("click", () => {
    document.getElementById("favoritesRow").scrollBy({ left: -600, behavior: "smooth" });
});

document.getElementById("favoritesRightArrow").addEventListener("click", () => {
    document.getElementById("favoritesRow").scrollBy({ left: 600, behavior: "smooth" });
});

document.getElementById("recentlyOpenedLeftArrow").addEventListener("click", () => {
    document.getElementById("recentlyOpenedRow").scrollBy({ left: -600, behavior: "smooth" });
});

document.getElementById("mostPopularLeftArrow").addEventListener("click", () => {
    document.getElementById("mostPopularBooksGrid").scrollBy({ left: -600, behavior: "smooth" });
});

document.getElementById("mostPopularRightArrow").addEventListener("click", () => {
    document.getElementById("mostPopularBooksGrid").scrollBy({ left: 600, behavior: "smooth" });
});

document.getElementById("mostSoldLeftArrow").addEventListener("click", () => {
    document.getElementById("mostSoldBooksGrid").scrollBy({ left: -600, behavior: "smooth" });
});

document.getElementById("mostSoldRightArrow").addEventListener("click", () => {
    document.getElementById("mostSoldBooksGrid").scrollBy({ left: 600, behavior: "smooth" });
});

document.getElementById("recentlyOpenedRightArrow").addEventListener("click", () => {
    document.getElementById("recentlyOpenedRow").scrollBy({ left: 600, behavior: "smooth" });
});

// Anything dropped into the watched folder while the app is running gets
// added automatically — same underlying add-flow as drag-and-drop.
window.riftgate.on("dropzone-file-detected", async (filePath) => {
    await addEbookFromPath(filePath);
});

async function addEbookFromPath(originalPath) {
    const ext = originalPath.toLowerCase().split(".").pop();
    if (ext !== "epub" && ext !== "pdf") return;

    // My Library is backed by the dropzone folder — copy the file in
    // first (a no-op if it's already there), then track the copy.
    const copyResult = await window.riftgate.invoke("add-ebook-to-library", originalPath);
    if (!copyResult.success) {
        alert(copyResult.error || "Couldn't add this file.");
        return;
    }
    const filePath = copyResult.path;

    const meta = await window.riftgate.invoke("get-ebook-metadata", filePath);
    const fallbackTitle = filePath
        .split("\\").pop()
        .split("/").pop()
        .replace(/\.(epub|pdf)$/i, "")
        .replace(/[._]/g, " ")
        .trim();

    const book = {
        path: filePath,
        title: meta.title || fallbackTitle,
        author: meta.author || null,
        description: meta.description || null,
        cover: meta.coverPath || null,
        format: ext
    };

    const result = await window.riftgate.invoke("save-ebook", book);
    if (result.success) {
        ebooksCache.push({ ...book, addedAt: Date.now(), lastOpenedAt: null });
        renderReadingRoom();
    }
}

// Catches anything manually copied into the dropzone folder via Explorer
// while Riftgate wasn't running — the live watcher alone only sees
// changes that happen while the app is open.
async function scanDropzoneOnStartup() {
    const untrackedPaths = await window.riftgate.invoke("scan-dropzone-folder");
    for (const filePath of untrackedPaths) {
        await addEbookFromPath(filePath);
    }
}

addEbookBtn.addEventListener("click", async () => {
    const filePaths = await window.riftgate.invoke("select-ebook-file");
    for (const filePath of filePaths) {
        await addEbookFromPath(filePath);
    }
});

readingRoomSearchInput.addEventListener("input", () => {
    if (activeReadingRoomTab === "library") {
        renderReadingRoom();
    } else {
        filterDiscoveryBySearch();
    }
});
readingRoomSortSelect.addEventListener("change", renderReadingRoom);

readingRoomContainer.addEventListener("dragover", (event) => {
    event.preventDefault();
    readingRoomContainer.classList.add("drag-hover");
});

readingRoomContainer.addEventListener("dragleave", () => {
    readingRoomContainer.classList.remove("drag-hover");
});

readingRoomContainer.addEventListener("drop", async (event) => {
    event.preventDefault();
    readingRoomContainer.classList.remove("drag-hover");

    for (const file of event.dataTransfer.files) {
        await addEbookFromPath(file.path);
    }
});

async function checkForMissingEbooks() {
    const missing = await window.riftgate.invoke("check-missing-ebooks");
    if (!missing || missing.length === 0) return;

    const modal = document.getElementById("missingGamesModal");
    const list = document.getElementById("missingGamesList");
    const closeBtn = document.getElementById("missingGamesCloseBtn");

    list.innerHTML = "";

    missing.forEach((item) => {
        const row = document.createElement("div");
        row.className = "suggestion-item";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const label = document.createElement("span");
        label.textContent = `📖 ${item.name}`;
        row.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "🗑️ Remove";
        removeBtn.className = "detection-remove-btn";
        removeBtn.addEventListener("click", async () => {
            await window.riftgate.invoke("remove-ebook", item.path);
            ebooksCache = ebooksCache.filter((b) => b.path !== item.path);
            renderReadingRoom();
            row.remove();
            if (list.children.length === 0) modal.classList.remove("active");
        });
        row.appendChild(removeBtn);

        list.appendChild(row);
    });

    closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
    }, { once: true });

    modal.classList.add("active");
}

async function loadFreeGames(silent) {
    const newRow = document.getElementById("freeGamesNewRow");

    // Show whatever was last successfully fetched immediately, with no
    // network wait — same "instant on launch, refresh quietly after"
    // pattern used for the book sections. Only relevant on the very
    // first load (silent background refreshes already have real data
    // showing, so there's nothing to pre-fill).
    if (!silent && (!freeGamesCache || freeGamesCache.length === 0)) {
        const cached = await window.riftgate.invoke("get-cached-free-games");
        if (cached && cached.length > 0) {
            freeGamesCache = cached;
            updateFreeGamesGenreOptions();
            renderFreeGames();
        } else {
            newRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading free games (checking Steam, Epic, and GOG, this can take a moment)...</p>`;
        }
    }

    const fresh = await window.riftgate.invoke("get-free-games");

    if (!fresh || fresh.length === 0) {
        // Only show "nothing found" if there's no cached content already
        // on screen — a failed refresh should never blank out real,
        // still-valid content that's already showing.
        if ((!freeGamesCache || freeGamesCache.length === 0) && !silent) {
            newRow.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No free games found right now.</p>`;
        }
        return;
    }

    // A background refresh shouldn't reset whatever the user currently has
    // selected — updateFreeGamesGenreOptions already preserves the genre
    // choice if it still exists, and the platform dropdown isn't rebuilt
    // at all (its options are fixed), so it's untouched by a refresh.
    freeGamesCache = fresh;
    updateFreeGamesGenreOptions();
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

    const results = await window.riftgate.invoke("search-tv-shows", query);

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
            await window.riftgate.invoke("add-to-watchlist", show);
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
        await window.riftgate.invoke("remove-from-watchlist", show.id);
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
        window.riftgate.invoke("fetch-description", show.name).then(async (description) => {
            const finalText = description || "No description available.";
            show.description = finalText;
            descEl.textContent = finalText;
            if (description) {
                await window.riftgate.invoke("update-watchlist-item", { id: show.id, description });
            }
        });
    }

    const coverWrap = card.querySelector(".cover-wrap");
    let hoverTimer = null;

    async function fetchShowTrailerOnce() {
        if (show.trailerId === undefined || show.trailerId === null) {
            // TMDB's own TV database first — a real, ID-based lookup
            // instead of a fuzzy text search, so a show sharing a name
            // with (or based on) a game doesn't risk pulling back that
            // game's trailer instead.
            show.trailerId = await window.riftgate.invoke("get-show-trailer", show.name);
            if (!show.trailerId) {
                show.trailerId = await window.riftgate.invoke("fetch-trailer", show.name, "show", show.description);
            }
            if (show.trailerId) {
                await window.riftgate.invoke("update-watchlist-item", { id: show.id, trailerId: show.trailerId });
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
        if (trailerId) {
            openTheaterMode(trailerId);
        } else {
            alert("No trailer could be found for this title.");
        }
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

    sortNoCoverLast(filtered, "image").forEach((show) => myShowsGrid.appendChild(buildShowCard(show)));
    attachSeeMore(myShowsGrid);
}

myShowsFilterInput.addEventListener("input", renderMyShows);

async function loadMyShows() {
    myShowsCache = await window.riftgate.invoke("get-watchlist");
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
            window.riftgate.invoke("open-external", `https://www.justwatch.com/us/search?q=${query}`);
        });
        recentEpisodesRow.appendChild(card);
    });
}

recentEpisodesFilterInput.addEventListener("input", renderRecentEpisodes);

async function loadRecentEpisodes() {
    recentEpisodesCache = await window.riftgate.invoke("get-latest-episodes");
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
        window.riftgate.invoke("open-external", `https://www.youtube.com/watch?v=${theaterVideoId}`);
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
        if (movieTrailerId === undefined || movieTrailerId === null) {
            movieTrailerId = await window.riftgate.invoke("get-movie-trailer", movie.id);
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
        if (trailerId) {
            openTheaterMode(trailerId);
        } else {
            alert("No trailer could be found for this title.");
        }
    });

    card.querySelector(".youtubeLinkBtn").addEventListener("click", async () => {
        const trailerId = await fetchTrailerOnce();
        if (trailerId) {
            window.riftgate.invoke("open-external", `https://www.youtube.com/watch?v=${trailerId}`);
        } else {
            alert("No trailer could be found for this title.");
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
        window.riftgate.invoke("open-external", `https://www.google.${domain}/search?q=${query}`);
    });

    return card;
}

const moviesFilterInput = document.getElementById("moviesFilterInput");

function renderMovies() {
    const filterTerm = moviesFilterInput.value.trim().toLowerCase();
    const filtered = filterTerm
        ? moviesCache.filter((m) => m.title.toLowerCase().includes(filterTerm))
        : moviesCache;

    moviesGrid.innerHTML = "";

    if (filtered.length === 0) {
        moviesGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No movies match your filter.</p>`;
        return;
    }

    sortNoCoverLast(filtered, "poster").forEach((movie) => moviesGrid.appendChild(buildMovieCard(movie, false)));
    attachSeeMore(moviesGrid);
}

moviesFilterInput.addEventListener("input", renderMovies);

async function loadMovies() {
    moviesGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const movies = await window.riftgate.invoke("get-now-playing-movies", movieCountrySelect.value);
    moviesCache = movies || [];

    if (!movies || movies.length === 0) {
        moviesGrid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    renderMovies();
}

// --- "NEW" section: upcoming movies, new series, upcoming games -----------

let newSectionLoaded = false;

async function loadUpcomingMovies() {
    const grid = document.getElementById("upcomingMoviesGrid");
    grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const movies = await window.riftgate.invoke("get-upcoming-movies", settings.movieCountry || "US");

    if (!movies || movies.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    grid.innerHTML = "";
    sortNoCoverLast(movies, "poster").forEach((movie) => grid.appendChild(buildMovieCard(movie, true)));
    attachSeeMore(grid);
}

async function loadNewShows() {
    const grid = document.getElementById("newShowsGrid");
    grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">Loading...</p>`;

    const shows = await window.riftgate.invoke("get-new-tv-shows");

    if (!shows || shows.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results — a TMDB API key may be needed in main.js.</p>`;
        return;
    }

    grid.innerHTML = "";

    sortNoCoverLast(shows, "image").forEach((show) => {
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
            if (newShowTrailerId === undefined || newShowTrailerId === null) {
                newShowTrailerId = await window.riftgate.invoke("get-tv-show-trailer", show.id);
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
            if (trailerId) {
                openTheaterMode(trailerId);
            } else {
                alert("No trailer could be found for this title.");
            }
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
            const results = await window.riftgate.invoke("search-tv-shows", show.name);

            if (!results || results.length === 0) {
                alert(`Couldn't find "${show.name}" in the TV tracking database yet.`);
                return;
            }

            await window.riftgate.invoke("add-to-watchlist", results[0]);
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

    const games = await window.riftgate.invoke("get-upcoming-games");

    if (!games || games.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">No results right now.</p>`;
        return;
    }

    grid.innerHTML = "";

    sortNoCoverLast(games, "image").forEach((game) => {
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
                    <button class="launchBtn buyGameBtn">🔎 More Info</button>
                </div>
            </div>
        `;

        const coverWrap = card.querySelector(".cover-wrap");
        let hoverTimer = null;
        let upcomingTrailerId;

        async function fetchUpcomingTrailerOnce() {
            if (upcomingTrailerId === undefined || upcomingTrailerId === null) {
                upcomingTrailerId = await window.riftgate.invoke("fetch-trailer", game.name, "game", game.description, game.id);
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
            if (trailerId) {
                openTheaterMode(trailerId);
            } else {
                alert("No trailer could be found for this title.");
            }
        });

        card.querySelector(".soundToggle").addEventListener("click", (event) => {
            event.stopPropagation();
            soundEnabled = !soundEnabled;
            updateAllSoundToggles();
            applySoundToAllFrames();
        });

        card.querySelector(".buyGameBtn").addEventListener("click", () => {
            window.riftgate.invoke("open-external", game.url);
        });

        grid.appendChild(card);
    });

    attachSeeMore(grid);
}

async function loadNewSection() {
    if (newSectionLoaded) return;
    newSectionLoaded = true;
    loadUpcomingGames();
    loadUpcomingMovies();
    loadNewShows();
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

    // Let the facet assembly (~0.9s) and the glow pulse (starts at 0.9s,
    // runs 1.6s) finish, then fade the whole overlay out.
    setTimeout(() => {
        overlay.classList.add("startup-hidden");
        setTimeout(() => overlay.remove(), 550);
    }, 2100);
}

// --- First-launch username ------------------------------------------------

async function maybeShowUsernamePopup() {
    if (settings.username) {
        await tryRestoreSession();
        return;
    }

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

        const deviceId = await window.riftgate.invoke("get-device-id");
        const check = await window.riftgate.invoke("check-username-available", value);

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

        const result = await window.riftgate.invoke("register-username", { username: value, deviceId });

        if (!result.success) {
            errorEl.textContent = result.error || "Something went wrong — try again.";
            submitBtn.disabled = false;
            return;
        }

        saveSetting("username", value);
        settings.username = value;
        modal.classList.remove("active");
        // Brand-new account — choose a password right away so this
        // username can never be used by someone who's only guessed or
        // typed in the name, not proven they own it.
        openVaultSetPasswordModal();
    }

    submitBtn.addEventListener("click", attemptSubmit);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") attemptSubmit();
    });
}

// Called on every subsequent launch for a username that's already set —
// first-time password setup used to be the last new-user step and never
// ran again after that, so a returning account either still needs to set
// its one password (accounts created before this system existed) or
// needs to prove it with a login, every time the app opens.
async function ensureLoggedIn() {
    const needsSetup = await window.riftgate.invoke("login-needs-password-setup", settings.username);
    if (!needsSetup.success) {
        // Couldn't reach the server — don't lock someone out of the
        // whole app over a network hiccup; admin/Vault actions will
        // simply fail their own checks until this succeeds.
        return;
    }

    if (needsSetup.needsSetup) {
        // A returning username with no password set only happens after an
        // admin/super-admin reset it (a genuinely brand-new account goes
        // straight from choosing a username into its own set-password
        // step, never through here) — so this is the reset flow.
        openVaultSetPasswordModal("reset");
    } else {
        openVaultLoginModal();
    }
}

// Runs once per launch for a returning username, before falling back to a
// password prompt — the whole point of the persistent-session system is
// that closing and reopening the app doesn't ask for a password again,
// only an explicit Log Out (or a password reset by an admin) does.
async function tryRestoreSession() {
    const saved = await window.riftgate.invoke("load-login-session");

    if (saved && saved.username === settings.username) {
        const verify = await window.riftgate.invoke("verify-login", { username: saved.username, password: saved.password });
        if (verify.success && verify.valid) {
            await completeLogin(saved.password);
            return;
        }
        // The saved password no longer works — most likely an admin reset
        // it while the app was closed. Drop the stale session and fall
        // through to a normal login/setup prompt below.
        await window.riftgate.invoke("clear-login-session");
    }

    await ensureLoggedIn();
}

// Logs the current user out: clears every cached credential and the
// persisted session, then immediately prompts to log back in (this app
// has no "browse while logged out" mode — Log Out is really "switch who's
// logged in").
async function performLogout() {
    adminPasswordCache = null;
    vaultPasswordCache = null;
    vaultUnlockedThisSession = false;
    isAdminMode = false;
    isSuperAdmin = false;
    isLoggedIn = false;

    await window.riftgate.invoke("clear-login-session");
    updateAdminUiVisibility();
    await ensureLoggedIn();
}

// Every 5 minutes, a logged-in session quietly re-checks that its password
// hasn't been reset out from under it by an admin — closing and reopening
// the app already catches this (see tryRestoreSession), but without this
// an account reset while its app stays open would keep working, silently,
// until the next restart.
setInterval(async () => {
    if (!isLoggedIn) return;

    const needsSetup = await window.riftgate.invoke("login-needs-password-setup", settings.username);
    if (needsSetup.success && needsSetup.needsSetup) {
        adminPasswordCache = null;
        vaultPasswordCache = null;
        vaultUnlockedThisSession = false;
        isAdminMode = false;
        isSuperAdmin = false;
        isLoggedIn = false;

        await window.riftgate.invoke("clear-login-session");
        updateAdminUiVisibility();
        openVaultSetPasswordModal("reset");
    }
}, 5 * 60 * 1000);

// --- Suggestions -----------------------------------------------------------

const suggestBtn = document.getElementById("suggestBtn");
const suggestionsModal = document.getElementById("suggestionsModal");
const suggestionInput = document.getElementById("suggestionInput");
const suggestionError = document.getElementById("suggestionError");
const suggestionSubmitBtn = document.getElementById("suggestionSubmitBtn");
const suggestionsList = document.getElementById("suggestionsList");
const suggestionsCloseBtn = document.getElementById("suggestionsCloseBtn");
const exportSuggestionsBtn = document.getElementById("exportSuggestionsBtn");
const reviewSuggestionsBtn = document.getElementById("reviewSuggestionsBtn");
const reviewSuggestionsModal = document.getElementById("reviewSuggestionsModal");
const reviewSuggestionsList = document.getElementById("reviewSuggestionsList");
const reviewSuggestionsCloseBtn = document.getElementById("reviewSuggestionsCloseBtn");

exportSuggestionsBtn.addEventListener("click", async () => {
    exportSuggestionsBtn.disabled = true;
    const result = await window.riftgate.invoke("export-suggestions-txt", {
        username: settings.username,
        password: adminPasswordCache
    });
    exportSuggestionsBtn.disabled = false;

    if (result.canceled) return;

    if (!result.success) {
        alert(result.error || "Couldn't export suggestions.");
        return;
    }

    alert(`Exported to:\n${result.path}`);
});


// Session-only admin state — never written to settings.json or anywhere
// on disk, so it's cleared automatically on every restart and can't be
// read by inspecting saved files.
let isAdminMode = false;
let isLoggedIn = false;
let adminPasswordCache = null;

// Same "memory-only, cleared on restart" treatment as adminPasswordCache
// above — being on the Vault allowlist by username alone used to be
// enough to get in; this tracks whether the current session has also
// proven the matching Vault password, the same way isAdminMode tracks a
// verified admin login.
let vaultPasswordCache = null;
let vaultUnlockedThisSession = false;

const THANK_YOU_MESSAGE = "Thank you for your suggestion! We truly appreciate you taking the time to share your ideas with us — feedback like yours is what helps shape the future of Riftgate. Our team will review it carefully and consider how it might fit into an upcoming update. We're grateful to have you as part of the Riftgate community.";

function timeAgo(isoString) {
    const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function usernameLabel(username) {
    if (!username) return { name: "Anonymous", badge: "" };

    const entry = adminListCache.find((a) => a.username === username);
    if (!entry) return { name: username, badge: "" };

    const suffixed = entry.is_super_admin ? `${username}_Root` : `${username}_Adm`;
    const badge = entry.is_super_admin
        ? ` <span class="admin-badge">👑 Super-Admin</span>`
        : ` <span class="admin-badge">🛡️ Admin</span>`;
    return { name: suffixed, badge };
}

// A treated suggestion (applied or rejected) stays visible with its
// outcome for a day, then drops out of the list — this is that cutoff.
const TREATED_SUGGESTION_VISIBLE_MS = 24 * 60 * 60 * 1000;

function isRecentlyTreated(s) {
    if (!s.resolved_at) return true; // no resolution timestamp yet — don't hide it
    return Date.now() - new Date(s.resolved_at).getTime() < TREATED_SUGGESTION_VISIBLE_MS;
}

function suggestionStatusBadge(s) {
    if (s.status === "applied") return `<span style="color:#4ade80;font-weight:600;">· ✅ Applied</span>`;
    if (s.status === "rejected") return `<span style="color:#ff8f8f;font-weight:600;">· ❌ Refused</span>`;
    return "";
}

async function loadSuggestionsList() {
    suggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">Loading...</p>`;

    exportSuggestionsBtn.style.display = isAdminMode ? "" : "none";
    reviewSuggestionsBtn.style.display = isSuperAdmin ? "" : "none";

    const [result, adminsResult] = await Promise.all([
        window.riftgate.invoke("get-suggestions"),
        window.riftgate.invoke("get-admin-list-detailed")
    ]);

    adminListCache = adminsResult.success ? adminsResult.admins : [];

    if (!result.success) {
        suggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">${result.error}</p>`;
        return;
    }

    // Suggestions that were applied/rejected more than a day ago drop out
    // of the general list entirely — see isRecentlyTreated above.
    const visibleSuggestions = result.suggestions.filter(isRecentlyTreated);

    if (visibleSuggestions.length === 0) {
        suggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">No suggestions yet — be the first!</p>`;
        return;
    }

    suggestionsList.innerHTML = "";

    // Backend returns newest-first (needed so the 200-item limit keeps
    // the most RECENT ones) — reversed here so the list reads oldest to
    // newest, like a conversation, with the newest at the bottom.
    const orderedSuggestions = [...visibleSuggestions].reverse();

    orderedSuggestions.forEach((s) => {
        const { name, badge } = usernameLabel(s.username);

        const item = document.createElement("div");
        item.className = "suggestion-item";
        item.innerHTML = `
            <div class="suggestion-meta">${name}${badge} · ${timeAgo(s.created_at)} ${suggestionStatusBadge(s)}</div>
            <div class="suggestion-text"></div>
            <div class="suggestion-replies"></div>
            <div class="suggestion-reply-form" style="display:none;">
                <textarea class="reply-input" placeholder="Write a reply..." rows="2"></textarea>
                <div class="suggestion-admin-actions">
                    <button class="reply-submit-btn">Send Reply</button>
                    <button class="reply-cancel-btn">Cancel</button>
                </div>
            </div>
        `;

        item.querySelector(".suggestion-text").textContent = s.suggestion_text;

        const repliesWrap = item.querySelector(".suggestion-replies");
        (s.suggestion_replies || []).forEach((reply) => {
            const replyEl = document.createElement("div");
            replyEl.className = "suggestion-reply";
            replyEl.innerHTML = `
                <div class="suggestion-meta">🛡️ Riftgate Team · ${timeAgo(reply.created_at)}</div>
                <div class="suggestion-text"></div>
            `;
            replyEl.querySelector(".suggestion-text").textContent = reply.reply_text;

            if (isAdminMode) {
                const delBtn = document.createElement("button");
                delBtn.className = "suggestion-delete-btn";
                delBtn.textContent = "🗑️";
                delBtn.title = "Delete this reply";
                delBtn.addEventListener("click", async () => {
                    const res = await window.riftgate.invoke("delete-reply", { username: settings.username, password: adminPasswordCache, id: reply.id });
                    if (res.success && res.deleted) loadSuggestionsList();
                });
                replyEl.appendChild(delBtn);
            }

            repliesWrap.appendChild(replyEl);
        });

        if (isAdminMode) {
            const adminActions = document.createElement("div");
            adminActions.className = "suggestion-admin-actions";

            const replyBtn = document.createElement("button");
            replyBtn.textContent = "💬 Reply";
            replyBtn.addEventListener("click", () => {
                item.querySelector(".suggestion-reply-form").style.display = "block";
            });

            const thankBtn = document.createElement("button");
            thankBtn.textContent = "✅ Thank You";
            thankBtn.addEventListener("click", async () => {
                thankBtn.disabled = true;
                const res = await window.riftgate.invoke("add-admin-reply", {
                    username: settings.username,
                    password: adminPasswordCache,
                    suggestionId: s.id,
                    text: THANK_YOU_MESSAGE
                });
                if (res.success && res.added) {
                    loadSuggestionsList();
                } else {
                    thankBtn.disabled = false;
                }
            });

            const deleteBtn = document.createElement("button");
            deleteBtn.className = "suggestion-delete-btn";
            deleteBtn.textContent = "🗑️ Delete";
            deleteBtn.addEventListener("click", async () => {
                const res = await window.riftgate.invoke("delete-suggestion", { username: settings.username, password: adminPasswordCache, id: s.id });
                if (res.success && res.deleted) loadSuggestionsList();
            });

            adminActions.appendChild(replyBtn);
            adminActions.appendChild(thankBtn);
            adminActions.appendChild(deleteBtn);
            item.appendChild(adminActions);

            const replyForm = item.querySelector(".suggestion-reply-form");
            const replyInput = replyForm.querySelector(".reply-input");
            replyForm.querySelector(".reply-submit-btn").addEventListener("click", async () => {
                const text = replyInput.value.trim();
                if (text.length < 2) return;
                const res = await window.riftgate.invoke("add-admin-reply", {
                    username: settings.username,
                    password: adminPasswordCache,
                    suggestionId: s.id,
                    text
                });
                if (res.success && res.added) loadSuggestionsList();
            });
            replyForm.querySelector(".reply-cancel-btn").addEventListener("click", () => {
                replyForm.style.display = "none";
                replyInput.value = "";
            });
        }

        suggestionsList.appendChild(item);
    });

    // Newest suggestion is now at the bottom — scroll there so it's the
    // first thing visible when the popup opens, instead of the oldest.
    suggestionsList.scrollTop = suggestionsList.scrollHeight;
}

// --- Super-admin review: approve/reject for automatic code fixes -----
//
// Applying doesn't touch any code itself — it just records approval.
// A separate scheduled check-in (not this app) reads approved
// suggestions and makes the actual edit in the Riftgate folder, then
// records that it's done. This popup only ever shows untreated ("new")
// suggestions — once acted on, one drops out of here immediately,
// though it keeps showing in the main list (marked Applied/Refused) for
// the next 24 hours.

const SUGGESTION_APPLIED_REPLY = "Thanks for reporting this! We've reviewed it and confirmed it's a real issue — a fix has been approved and will be included in an upcoming update. We appreciate you taking the time to help improve Riftgate.";
const SUGGESTION_REJECTED_REPLY = "Thanks for taking the time to share this. After review, we've decided not to make this change right now, but we appreciate the feedback and will keep it in mind going forward.";

// How long a completed ("Applied") suggestion keeps showing in the
// Review New popup specifically, before it drops off there — separate
// from (and much shorter than) the 24 hours it stays visible with its
// badge in the regular Suggestions list.
const REVIEW_APPLIED_VISIBLE_MS = 60 * 60 * 1000;

async function loadReviewSuggestionsList() {
    reviewSuggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">Loading...</p>`;

    const result = await window.riftgate.invoke("get-suggestions");
    if (!result.success) {
        reviewSuggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">${result.error}</p>`;
        return;
    }

    // Rejected suggestions leave this list the moment they're rejected
    // (status flips away from "new" immediately, so the filter below
    // already excludes them on the very next load — no extra handling
    // needed). An approved one stays here through "Processing" and then
    // "Applied", only disappearing once it's been Applied for over an
    // hour.
    const visibleSuggestions = result.suggestions.filter((s) => {
        const status = s.status || "new";
        if (status === "new") return true;
        if (status !== "applied") return false; // rejected — gone immediately
        if (!s.code_change_done) return true; // still Processing
        if (!s.fix_applied_at) return true; // done, but no timestamp somehow — don't hide it incorrectly
        return Date.now() - new Date(s.fix_applied_at).getTime() < REVIEW_APPLIED_VISIBLE_MS;
    }).reverse();

    if (visibleSuggestions.length === 0) {
        reviewSuggestionsList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">Nothing new to review.</p>`;
        return;
    }

    reviewSuggestionsList.innerHTML = "";

    visibleSuggestions.forEach((s) => {
        const { name, badge } = usernameLabel(s.username);
        const status = s.status || "new";

        const item = document.createElement("div");
        item.className = "suggestion-item";
        item.innerHTML = `
            <div class="suggestion-meta">${name}${badge} · ${timeAgo(s.created_at)}</div>
            <div class="suggestion-text"></div>
        `;
        item.querySelector(".suggestion-text").textContent = s.suggestion_text;

        if (status === "applied") {
            const label = document.createElement("div");
            label.className = "suggestion-admin-actions";
            label.innerHTML = s.code_change_done
                ? `<span style="color:#4ade80;font-weight:600;">✅ Applied</span>`
                : `<span style="color:#facc15;font-weight:600;">⏳ Processing</span>`;
            item.appendChild(label);
            reviewSuggestionsList.appendChild(item);
            return;
        }

        const actions = document.createElement("div");
        actions.className = "suggestion-admin-actions";

        const applyBtn = document.createElement("button");
        applyBtn.textContent = "✅ Apply";
        applyBtn.addEventListener("click", async () => {
            applyBtn.disabled = true;
            rejectBtn.disabled = true;
            const res = await window.riftgate.invoke("apply-suggestion", { username: settings.username, password: adminPasswordCache, id: s.id });
            if (res.success && res.applied) {
                await window.riftgate.invoke("add-admin-reply", {
                    username: settings.username,
                    password: adminPasswordCache,
                    suggestionId: s.id,
                    text: SUGGESTION_APPLIED_REPLY
                });
                loadReviewSuggestionsList();
                if (suggestionsModal.classList.contains("active")) loadSuggestionsList();
            } else {
                applyBtn.disabled = false;
                rejectBtn.disabled = false;
                alert(res.error || "Couldn't approve this suggestion — make sure you're logged in as a super-admin.");
            }
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "suggestion-delete-btn";
        rejectBtn.textContent = "❌ Reject";
        rejectBtn.addEventListener("click", async () => {
            applyBtn.disabled = true;
            rejectBtn.disabled = true;
            const res = await window.riftgate.invoke("reject-suggestion", { username: settings.username, password: adminPasswordCache, id: s.id });
            if (res.success && res.rejected) {
                await window.riftgate.invoke("add-admin-reply", {
                    username: settings.username,
                    password: adminPasswordCache,
                    suggestionId: s.id,
                    text: SUGGESTION_REJECTED_REPLY
                });
                loadReviewSuggestionsList();
                if (suggestionsModal.classList.contains("active")) loadSuggestionsList();
            } else {
                applyBtn.disabled = false;
                rejectBtn.disabled = false;
                alert(res.error || "Couldn't reject this suggestion.");
            }
        });

        actions.appendChild(applyBtn);
        actions.appendChild(rejectBtn);
        item.appendChild(actions);
        reviewSuggestionsList.appendChild(item);
    });
}

reviewSuggestionsBtn.addEventListener("click", () => {
    reviewSuggestionsModal.classList.add("active");
    loadReviewSuggestionsList();
});

reviewSuggestionsCloseBtn.addEventListener("click", () => {
    reviewSuggestionsModal.classList.remove("active");
});

suggestBtn.addEventListener("click", () => {
    suggestionsModal.classList.add("active");
    suggestionInput.value = "";
    suggestionError.textContent = "";
    loadSuggestionsList();
});

suggestionsCloseBtn.addEventListener("click", () => {
    suggestionsModal.classList.remove("active");
});

suggestionSubmitBtn.addEventListener("click", async () => {
    const text = suggestionInput.value.trim();

    if (text.length < 3) {
        suggestionError.textContent = "Please write a bit more detail.";
        return;
    }

    suggestionSubmitBtn.disabled = true;
    suggestionError.textContent = "";

    const result = await window.riftgate.invoke("submit-suggestion", {
        username: settings.username || null,
        text
    });

    suggestionSubmitBtn.disabled = false;

    if (!result.success) {
        suggestionError.textContent = result.error;
        return;
    }

    suggestionInput.value = "";
    loadSuggestionsList();
});

// --- Admin authentication ---------------------------------------------

const adminBtn = document.getElementById("adminBtn");
const manageUsersBtn = document.getElementById("manageUsersBtn");
const adminLoginModal = document.getElementById("adminLoginModal");
const adminPasswordInput = document.getElementById("adminPasswordInput");
const adminLoginError = document.getElementById("adminLoginError");
const adminLoginSubmitBtn = document.getElementById("adminLoginSubmitBtn");
const adminLoginCancelBtn = document.getElementById("adminLoginCancelBtn");
const adminSetPasswordModal = document.getElementById("adminSetPasswordModal");
const adminSetPasswordTitle = document.getElementById("adminSetPasswordTitle");
const adminSetPasswordDesc = document.getElementById("adminSetPasswordDesc");
const adminNewPasswordInput = document.getElementById("adminNewPasswordInput");
const adminConfirmPasswordInput = document.getElementById("adminConfirmPasswordInput");
const adminSetPasswordError = document.getElementById("adminSetPasswordError");
const adminSetPasswordSubmitBtn = document.getElementById("adminSetPasswordSubmitBtn");
const adminManageModal = document.getElementById("adminManageModal");
const adminSearchInput = document.getElementById("adminSearchInput");
const adminManageError = document.getElementById("adminManageError");
const adminList = document.getElementById("adminList");
const adminManageCloseBtn = document.getElementById("adminManageCloseBtn");

let isSuperAdmin = false;
let adminListCache = [];

// Suffix shown next to an admin's username wherever it appears — a
// regular admin's own display name ends in _Adm, a super-admin's in
// _Root, so the role is visible at a glance without needing a separate
// badge to look up.
function adminSuffixedName(username) {
    const entry = adminListCache.find((a) => a.username === username);
    if (!entry) return username;
    return entry.is_super_admin ? `${username}_Root` : `${username}_Adm`;
}

function updateAdminUiVisibility() {
    // This button is now a general Login/Logout control, visible to every
    // user (not just admins) — clicking it logs in when signed out, or
    // logs out when signed in. Admins keep a shield icon so their status
    // is still visible at a glance.
    adminBtn.style.display = "";
    adminBtn.classList.toggle("active", isAdminMode);
    adminBtn.textContent = isLoggedIn
        ? (isAdminMode ? "🛡️ Log Out" : "🔓 Log Out")
        : "🔑 Login";
    adminBtn.title = isLoggedIn ? "Log out" : "Log in";
    manageUsersBtn.style.display = isAdminMode ? "" : "none";

    // The Vault's admin-only buttons were only ever set inside
    // loadSharedFolder(), which only runs when switching into that
    // section — so becoming recognized as admin while already viewing
    // (or denied from) the Vault never updated them until navigating
    // away and back. This keeps them correctly in sync the moment admin
    // status actually changes, regardless of which section is active.
    const manageAllowlistBtnEl = document.getElementById("manageAllowlistBtn");
    const cleanVaultNowBtnEl = document.getElementById("cleanVaultNowBtn");
    if (manageAllowlistBtnEl) manageAllowlistBtnEl.style.display = isAdminMode ? "" : "none";
    if (cleanVaultNowBtnEl) cleanVaultNowBtnEl.style.display = isAdminMode ? "" : "none";

    if (currentSection === "shared-folder") {
        loadSharedFolder();
    }
}

// Runs once right after a successful login (see completeLogin below) —
// admin status is a plain membership check now, not a second password,
// since logging in already proved who this is.
async function enterAdminMode() {
    const detailed = await window.riftgate.invoke("get-admin-list-detailed");
    adminListCache = detailed.success ? detailed.admins : [];

    const myEntry = adminListCache.find((a) => a.username === settings.username);
    isSuperAdmin = !!(myEntry && myEntry.is_super_admin);
    isAdminMode = true;

    updateAdminUiVisibility();
    if (suggestionsModal.classList.contains("active")) loadSuggestionsList();
}

let allUsernamesCache = [];

function renderAdminList() {
    const filter = adminSearchInput.value.trim().toLowerCase();

    // Merge every registered username with whatever admin/role info
    // exists for them, so the same list can search ALL users, not just
    // current admins.
    const combined = allUsernamesCache
        .filter((username) => username.toLowerCase().includes(filter))
        .map((username) => {
            const adminEntry = adminListCache.find((a) => a.username === username);
            return {
                username,
                isAdmin: !!adminEntry,
                isSuperAdmin: !!(adminEntry && adminEntry.is_super_admin)
            };
        });

    adminList.innerHTML = "";

    if (combined.length === 0) {
        adminList.innerHTML = `<p style="color:var(--text-muted);font-size:12px;text-align:center;">No matching users.</p>`;
        return;
    }

    combined.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "suggestion-item";

        const topRow = document.createElement("div");
        topRow.style.display = "flex";
        topRow.style.justifyContent = "space-between";
        topRow.style.alignItems = "center";
        topRow.style.marginBottom = "8px";

        const label = document.createElement("span");
        if (entry.isSuperAdmin) {
            label.textContent = `👑 ${entry.username}_Root`;
        } else if (entry.isAdmin) {
            label.textContent = `🛡️ ${entry.username}_Adm`;
        } else {
            label.textContent = entry.username;
        }
        topRow.appendChild(label);
        item.appendChild(topRow);

        const actions = document.createElement("div");
        actions.className = "suggestion-admin-actions";

        const isSelf = entry.username === settings.username;

        if (!entry.isAdmin) {
            const makeAdminBtn = document.createElement("button");
            makeAdminBtn.textContent = "➕ Make Admin";
            makeAdminBtn.addEventListener("click", async () => {
                const res = await window.riftgate.invoke("super-add-admin", {
                    superUsername: settings.username,
                    superPassword: adminPasswordCache,
                    newUsername: entry.username,
                    makeSuper: false
                });
                if (res.success && res.added) {
                    loadAdminList();
                } else {
                    adminManageError.textContent = "Couldn't add — try again.";
                }
            });
            actions.appendChild(makeAdminBtn);

            if (isSuperAdmin) {
                const makeSuperBtn = document.createElement("button");
                makeSuperBtn.textContent = "👑 Make Super-Admin";
                makeSuperBtn.addEventListener("click", async () => {
                    const res = await window.riftgate.invoke("super-add-admin", {
                        superUsername: settings.username,
                        superPassword: adminPasswordCache,
                        newUsername: entry.username,
                        makeSuper: true
                    });
                    if (res.success && res.added) {
                        loadAdminList();
                    } else {
                        adminManageError.textContent = "Couldn't add — try again.";
                    }
                });
                actions.appendChild(makeSuperBtn);
            }
        } else {
            const resetBtn = document.createElement("button");
            resetBtn.textContent = "🔑 Reset Password";
            resetBtn.addEventListener("click", async () => {
                const res = await window.riftgate.invoke("super-trigger-password-reset", {
                    superUsername: settings.username,
                    superPassword: adminPasswordCache,
                    targetUsername: entry.username
                });
                adminManageError.textContent = res.success && res.triggered
                    ? ""
                    : "Couldn't trigger reset — try again.";
                if (res.success && res.triggered) {
                    resetBtn.textContent = "Reset queued ✓";
                    resetBtn.disabled = true;
                }
            });
            actions.appendChild(resetBtn);

            if (!isSelf && isSuperAdmin) {
                const roleBtn = document.createElement("button");
                roleBtn.textContent = entry.isSuperAdmin ? "⬇️ Demote to Admin" : "⬆️ Promote to Super-Admin";
                roleBtn.addEventListener("click", async () => {
                    const res = await window.riftgate.invoke("super-set-role", {
                        superUsername: settings.username,
                        superPassword: adminPasswordCache,
                        targetUsername: entry.username,
                        makeSuper: !entry.isSuperAdmin
                    });
                    if (res.success && res.changed) {
                        loadAdminList();
                    } else {
                        adminManageError.textContent = "Couldn't change role — try again.";
                    }
                });
                actions.appendChild(roleBtn);
            }

            if (!isSelf) {
                const removeBtn = document.createElement("button");
                removeBtn.textContent = "🗑️ Remove Admin";
                removeBtn.className = "suggestion-delete-btn";
                removeBtn.addEventListener("click", async () => {
                    const res = await window.riftgate.invoke("super-remove-admin", {
                        superUsername: settings.username,
                        superPassword: adminPasswordCache,
                        targetUsername: entry.username
                    });
                    if (res.success && res.removed) {
                        loadAdminList();
                    } else {
                        adminManageError.textContent = "Couldn't remove — try again.";
                    }
                });
                actions.appendChild(removeBtn);
            }
        }

        item.appendChild(actions);
        adminList.appendChild(item);
    });
}

async function loadAdminList() {
    const [usersResult, adminsResult] = await Promise.all([
        window.riftgate.invoke("get-all-usernames"),
        window.riftgate.invoke("get-admin-list-detailed")
    ]);
    allUsernamesCache = usersResult.success ? usersResult.usernames : [];
    adminListCache = adminsResult.success ? adminsResult.admins : [];
    renderAdminList();
}

adminSearchInput.addEventListener("input", renderAdminList);

manageUsersBtn.addEventListener("click", () => {
    adminManageModal.classList.add("active");
    adminSearchInput.value = "";
    adminManageError.textContent = "";
    loadAdminList();
});

// Now a general Login/Logout control, visible to every user — not just
// admins — so anyone can sign in or switch accounts from the sidebar.
adminBtn.addEventListener("click", () => {
    if (isLoggedIn) {
        performLogout();
    } else {
        ensureLoggedIn();
    }
});

adminManageCloseBtn.addEventListener("click", () => {
    adminManageModal.classList.remove("active");
});

// --- Missing installed games/apps -----------------------------------------
window.riftgate.on("new-install-detected", (candidates) => {
    const modal = document.getElementById("newInstallModal");
    const list = document.getElementById("newInstallList");
    const closeBtn = document.getElementById("newInstallCloseBtn");

    list.innerHTML = "";

    candidates.forEach((candidate) => {
        const row = document.createElement("div");
        row.className = "suggestion-item";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const label = document.createElement("span");
        label.textContent = candidate.name;
        row.appendChild(label);

        const addBtn = document.createElement("button");
        addBtn.textContent = "➕ Add to Riftgate";
        addBtn.className = "detection-add-btn";
        addBtn.addEventListener("click", async () => {
            addBtn.disabled = true;
            addBtn.textContent = "Added ✓";
            await addGameFromExternalFile(candidate.path, "game");
            row.style.opacity = "0.5";
        });
        row.appendChild(addBtn);

        list.appendChild(row);
    });

    closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
    }, { once: true });

    modal.classList.add("active");
});

async function checkForMissingGames() {
    const missing = await window.riftgate.invoke("check-missing-games");
    if (!missing || missing.length === 0) return;

    const modal = document.getElementById("missingGamesModal");
    const list = document.getElementById("missingGamesList");
    const closeBtn = document.getElementById("missingGamesCloseBtn");

    list.innerHTML = "";

    missing.forEach((item) => {
        const row = document.createElement("div");
        row.className = "suggestion-item";
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";

        const label = document.createElement("span");
        label.textContent = item.name;
        row.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "🗑️ Remove";
        removeBtn.className = "detection-remove-btn";
        removeBtn.addEventListener("click", async () => {
            await window.riftgate.invoke("remove-game", item.path);
            allGames = allGames.filter((g) => g.path !== item.path);
            renderLibrary();
            row.remove();
            if (list.children.length === 0) modal.classList.remove("active");
        });
        row.appendChild(removeBtn);

        list.appendChild(row);
    });

    closeBtn.addEventListener("click", () => {
        modal.classList.remove("active");
    }, { once: true });

    modal.classList.add("active");
}

// --- Shared Folder ------------------------------------------------------

function formatSharedFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeUntilExpiry(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return { text: "Expired", soon: true };
    const mins = Math.round(ms / 60000);
    if (mins < 60) return { text: `Expires in ${mins}m`, soon: mins < 30 };
    return { text: `Expires in ${Math.round(mins / 60)}h`, soon: false };
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "avif", "heic", "tiff", "tif"]);

function isImageFile(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

const vaultImagePreview = document.getElementById("vaultImagePreview");
const vaultImagePreviewImg = document.getElementById("vaultImagePreviewImg");
let vaultPreviewUrlCache = {};

function positionVaultPreview(anchorEl) {
    vaultImagePreview.style.visibility = "hidden";
    vaultImagePreview.classList.add("active");

    const rect = anchorEl.getBoundingClientRect();
    const previewWidth = Math.min(400, window.innerWidth - 24);

    let left = rect.left;
    left = Math.max(12, Math.min(left, window.innerWidth - previewWidth - 12));
    vaultImagePreview.style.left = `${left}px`;
    vaultImagePreview.style.width = `${previewWidth}px`;

    let top = rect.bottom + 8;
    const naturalHeight = vaultImagePreview.getBoundingClientRect().height;
    if (top + naturalHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - naturalHeight - 8);
    }
    vaultImagePreview.style.top = `${top}px`;

    vaultImagePreview.style.visibility = "visible";
}

function closeVaultPreview() {
    vaultImagePreview.classList.remove("active");
}

async function showVaultImagePreview(file, anchorEl) {
    let url = vaultPreviewUrlCache[file.storage_path];

    if (!url) {
        const result = await window.riftgate.invoke("get-shared-file-preview-url", file.storage_path);
        if (!result.success) return;
        url = result.url;
        vaultPreviewUrlCache[file.storage_path] = url;
    }

    // The hover could have already ended by the time the URL comes
    // back — don't pop up a preview for something no longer hovered.
    if (!anchorEl.matches(":hover")) return;

    vaultImagePreviewImg.src = url;
    positionVaultPreview(anchorEl);
}

function buildSharedFileItem(file) {
    const item = document.createElement("div");
    item.className = "shared-file-item";

    const icon = document.createElement("div");
    icon.className = "shared-file-icon";
    icon.textContent = "📄";

    if (isImageFile(file.filename)) {
        icon.textContent = "🖼️";
        item.style.cursor = "pointer";
        item.addEventListener("mouseenter", () => showVaultImagePreview(file, item));
        item.addEventListener("mouseleave", closeVaultPreview);
    }

    item.appendChild(icon);

    const info = document.createElement("div");
    info.className = "shared-file-info";

    const title = document.createElement("h4");
    title.textContent = file.filename;
    info.appendChild(title);

    const expiry = timeUntilExpiry(file.expires_at);
    const meta = document.createElement("div");
    meta.className = "shared-file-meta";
    meta.innerHTML = `<span>👤 ${file.uploader_username}</span><span>💾 ${formatSharedFileSize(file.file_size)}</span>`;
    const expirySpan = document.createElement("span");
    expirySpan.textContent = expiry.text;
    if (expiry.soon) expirySpan.className = "expiring-soon";
    meta.appendChild(expirySpan);
    info.appendChild(meta);

    if (file.description) {
        const desc = document.createElement("p");
        desc.className = "shared-file-desc";
        desc.textContent = file.description;
        info.appendChild(desc);
    }

    item.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "shared-file-actions";

    const downloadBtn = document.createElement("button");
    downloadBtn.className = "shared-file-download-btn";
    downloadBtn.textContent = "⬇️ Download";
    downloadBtn.addEventListener("click", async () => {
        downloadBtn.disabled = true;
        const result = await window.riftgate.invoke("download-shared-file", { storagePath: file.storage_path, filename: file.filename });
        downloadBtn.disabled = false;
        if (!result.canceled && !result.success) {
            alert(result.error || "Download failed.");
        }
    });
    actions.appendChild(downloadBtn);

    const isOwner = file.uploader_username === settings.username;
    if (isOwner || isAdminMode) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "shared-file-delete-btn";
        deleteBtn.textContent = "✕";
        deleteBtn.title = "Remove this file";
        deleteBtn.addEventListener("click", async () => {
            if (!confirm(`Remove "${file.filename}"?`)) return;
            const result = await window.riftgate.invoke("delete-shared-file", {
                username: settings.username,
                fileId: file.id,
                storagePath: file.storage_path,
                adminPassword: isOwner ? null : adminPasswordCache,
                password: isOwner ? vaultPasswordCache : null
            });
            if (result) {
                renderSharedFiles();
            } else {
                alert("Couldn't remove this file.");
            }
        });
        actions.appendChild(deleteBtn);
    }

    item.appendChild(actions);
    return item;
}

async function renderSharedFiles() {
    const listEl = document.getElementById("sharedFilesList");
    const emptyEl = document.getElementById("sharedFilesEmptyState");

    const result = await window.riftgate.invoke("get-shared-files", { username: settings.username, password: vaultPasswordCache });

    if (!result.success || result.files.length === 0) {
        listEl.innerHTML = "";
        emptyEl.style.display = "";
        emptyEl.querySelector("p").textContent = result.success
            ? "Nothing's been shared yet — be the first."
            : (result.error || "Couldn't load shared files.");
        return;
    }

    emptyEl.style.display = "none";
    listEl.innerHTML = "";
    result.files.forEach((file) => listEl.appendChild(buildSharedFileItem(file)));
}

function daysUntilLinkExpiry(expiresAt) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return { text: "Expired", soon: true };
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days < 1) {
        const hours = Math.round(ms / (60 * 60 * 1000));
        return { text: `Expires in ${hours}h`, soon: true };
    }
    return { text: `Expires in ${days}d`, soon: days < 2 };
}

function buildSharedLinkItem(link) {
    const item = document.createElement("div");
    item.className = "shared-file-item";

    const icon = document.createElement("div");
    icon.className = "shared-file-icon";
    icon.textContent = "🔗";
    item.appendChild(icon);

    const info = document.createElement("div");
    info.className = "shared-file-info";

    const title = document.createElement("h4");
    title.textContent = link.description || "Shared link";
    info.appendChild(title);

    const expiry = daysUntilLinkExpiry(link.expires_at);
    const meta = document.createElement("div");
    meta.className = "shared-file-meta";
    meta.innerHTML = `<span>👤 ${link.poster_username}</span>`;
    const expirySpan = document.createElement("span");
    expirySpan.textContent = expiry.text;
    if (expiry.soon) expirySpan.className = "expiring-soon";
    meta.appendChild(expirySpan);
    info.appendChild(meta);

    item.appendChild(info);

    const actions = document.createElement("div");
    actions.className = "shared-file-actions";

    const openBtn = document.createElement("button");
    openBtn.className = "shared-file-download-btn";
    openBtn.textContent = "🌐 Open Link";
    openBtn.addEventListener("click", () => {
        window.riftgate.invoke("open-external", link.url);
    });
    actions.appendChild(openBtn);

    const isPoster = link.poster_username === settings.username;
    if (isPoster || isAdminMode) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "shared-file-delete-btn";
        deleteBtn.textContent = "✕";
        deleteBtn.title = "Remove this link";
        deleteBtn.addEventListener("click", async () => {
            if (!confirm("Remove this link?")) return;
            const result = await window.riftgate.invoke("delete-shared-link", {
                username: settings.username,
                linkId: link.id,
                adminPassword: isPoster ? null : adminPasswordCache,
                password: isPoster ? vaultPasswordCache : null
            });
            if (result) {
                renderSharedLinks();
            } else {
                alert("Couldn't remove this link.");
            }
        });
        actions.appendChild(deleteBtn);
    }

    item.appendChild(actions);
    return item;
}

async function renderSharedLinks() {
    const listEl = document.getElementById("sharedLinksList");
    const emptyEl = document.getElementById("sharedLinksEmptyState");

    const result = await window.riftgate.invoke("get-shared-links", { username: settings.username, password: vaultPasswordCache });

    if (!result.success || result.links.length === 0) {
        listEl.innerHTML = "";
        emptyEl.style.display = "";
        emptyEl.querySelector("p").textContent = result.success
            ? "No links posted yet."
            : (result.error || "Couldn't load links.");
        return;
    }

    emptyEl.style.display = "none";
    listEl.innerHTML = "";
    result.links.forEach((link) => listEl.appendChild(buildSharedLinkItem(link)));
}

document.getElementById("openWetransferBtn").addEventListener("click", () => {
    window.riftgate.invoke("open-external", "https://wetransfer.com");
});

document.getElementById("postShareLinkBtn").addEventListener("click", () => {
    document.getElementById("postLinkModal").classList.add("active");
    document.getElementById("postLinkUrlInput").value = "";
    document.getElementById("postLinkDescription").value = "";
    document.getElementById("postLinkError").textContent = "";
});

document.getElementById("postLinkCancelBtn").addEventListener("click", () => {
    document.getElementById("postLinkModal").classList.remove("active");
});

document.getElementById("postLinkConfirmBtn").addEventListener("click", async () => {
    const confirmBtn = document.getElementById("postLinkConfirmBtn");
    const errorEl = document.getElementById("postLinkError");
    const url = document.getElementById("postLinkUrlInput").value.trim();
    const description = document.getElementById("postLinkDescription").value.trim();

    if (!url) {
        errorEl.textContent = "Paste a link first.";
        return;
    }

    confirmBtn.disabled = true;
    errorEl.textContent = "";

    const result = await window.riftgate.invoke("add-shared-link", {
        username: settings.username,
        password: vaultPasswordCache,
        url,
        description: description || null
    });

    confirmBtn.disabled = false;

    if (!result.success) {
        errorEl.textContent = result.error || "Couldn't post this link.";
        return;
    }

    document.getElementById("postLinkModal").classList.remove("active");
    renderSharedLinks();
});

async function loadSharedFolder() {
    const loadingEl = document.getElementById("sharedFolderLoading");
    const deniedEl = document.getElementById("sharedFolderDenied");
    const contentEl = document.getElementById("sharedFolderContent");

    loadingEl.style.display = "";
    deniedEl.style.display = "none";
    contentEl.style.display = "none";

    if (!settings.username) {
        loadingEl.style.display = "none";
        deniedEl.style.display = "";
        return;
    }

    // Logging in (see ensureLoggedIn/completeLogin) already proved this
    // is really that username, so access here is just a membership
    // check — on the allowlist, or an admin — with nothing further to
    // prove. Everyone else sees only the description below, no buttons,
    // no list.
    const isAllowlisted = await window.riftgate.invoke("check-allowlist-only", settings.username);
    const hasListAccess = isAllowlisted || isAdminMode;
    loadingEl.style.display = "none";

    if (!hasListAccess) {
        document.getElementById("sharedFolderMyUsername").textContent = settings.username;
        deniedEl.style.display = "";
        return;
    }

    await finishLoadingSharedFolder();
}

async function finishLoadingSharedFolder() {
    const contentEl = document.getElementById("sharedFolderContent");
    contentEl.style.display = "";
    document.getElementById("manageAllowlistBtn").style.display = isAdminMode ? "" : "none";
    document.getElementById("cleanVaultNowBtn").style.display = isAdminMode ? "" : "none";
    await renderSharedFiles();
    await renderSharedLinks();

    // Quietly clears anything that expired since the last check — no
    // need to wait for or react to the result here.
    window.riftgate.invoke("cleanup-expired-shared-files", { username: settings.username, password: vaultPasswordCache });
    window.riftgate.invoke("cleanup-expired-shared-links", { username: settings.username, password: vaultPasswordCache });
}

// --- Unified login (setup + sign-in) ---------------------------------
//
// One password per account, checked here once per launch. Whatever it
// unlocks (admin controls, Vault access) is then figured out
// automatically in completeLogin() below — nothing else in the app asks
// for a password again this session.

function openVaultLoginModal() {
    document.getElementById("vaultPasswordInput").value = "";
    document.getElementById("vaultLoginError").textContent = "";
    document.getElementById("vaultLoginModal").classList.add("active");
    document.getElementById("vaultPasswordInput").focus();
}

function closeVaultLoginModal() {
    document.getElementById("vaultLoginModal").classList.remove("active");
}

// Runs after any successful login or first-time password setup —
// figures out what this account can actually do, with no further
// prompts. Both admin status and Vault access are plain membership
// checks at this point, since the password just verified is the one
// proof either of them needs.
async function completeLogin(password) {
    adminPasswordCache = password;
    vaultPasswordCache = password;
    vaultUnlockedThisSession = true;
    isLoggedIn = true;

    // Persist so the next launch stays logged in without asking again —
    // only an explicit Log Out (or a server-side password reset) clears
    // this. Fire-and-forget: nothing here should block the login itself.
    window.riftgate.invoke("save-login-session", { username: settings.username, password });

    const adminCheck = await window.riftgate.invoke("admin-account-exists", settings.username);
    if (adminCheck.success && adminCheck.exists) {
        await enterAdminMode();
    } else {
        isAdminMode = false;
        isSuperAdmin = false;
        updateAdminUiVisibility();
    }
}

async function attemptVaultLogin() {
    const password = document.getElementById("vaultPasswordInput").value;
    const errorEl = document.getElementById("vaultLoginError");
    const submitBtn = document.getElementById("vaultLoginSubmitBtn");

    if (!password) {
        errorEl.textContent = "Enter your password.";
        return;
    }

    submitBtn.disabled = true;
    errorEl.textContent = "";
    const verify = await window.riftgate.invoke("verify-login", { username: settings.username, password });
    submitBtn.disabled = false;

    if (!verify.success) {
        errorEl.textContent = "Couldn't reach the server — try again.";
        return;
    }
    if (!verify.valid) {
        errorEl.textContent = "Incorrect password.";
        return;
    }

    closeVaultLoginModal();
    await completeLogin(password);
}

document.getElementById("vaultLoginSubmitBtn").addEventListener("click", attemptVaultLogin);
document.getElementById("vaultPasswordInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") attemptVaultLogin();
});

function openVaultSetPasswordModal(reason) {
    document.getElementById("vaultNewPasswordInput").value = "";
    document.getElementById("vaultConfirmPasswordInput").value = "";
    document.getElementById("vaultSetPasswordError").textContent = "";

    const descEl = document.getElementById("vaultSetPasswordDesc");
    if (descEl) {
        descEl.textContent = reason === "reset"
            ? "An admin reset your password — choose a new one to keep going. You'll stay logged in on this device until you log out."
            : "Choose a password for your Riftgate account. You'll stay logged in on this device until you log out — only you will know it.";
    }

    document.getElementById("vaultSetPasswordModal").classList.add("active");
}

document.getElementById("vaultSetPasswordSubmitBtn").addEventListener("click", async () => {
    const newPass = document.getElementById("vaultNewPasswordInput").value;
    const confirmPass = document.getElementById("vaultConfirmPasswordInput").value;
    const errorEl = document.getElementById("vaultSetPasswordError");
    const submitBtn = document.getElementById("vaultSetPasswordSubmitBtn");

    if (!newPass || newPass.length < 6) {
        errorEl.textContent = "Choose a password of at least 6 characters.";
        return;
    }
    if (newPass !== confirmPass) {
        errorEl.textContent = "Passwords don't match.";
        return;
    }

    submitBtn.disabled = true;
    errorEl.textContent = "";
    const result = await window.riftgate.invoke("set-own-login-password", { username: settings.username, newPassword: newPass });
    submitBtn.disabled = false;

    if (!result.success || !result.changed) {
        errorEl.textContent = result.error || "Couldn't set your password — try again.";
        return;
    }

    document.getElementById("vaultSetPasswordModal").classList.remove("active");
    await completeLogin(newPass);
});

// --- Shared Folder: upload flow ---

let selectedShareExpiryHours = 2;

document.querySelectorAll(".upload-expiry-option").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".upload-expiry-option").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selectedShareExpiryHours = parseInt(btn.dataset.hours, 10);
    });
});

document.getElementById("uploadSharedFileBtn").addEventListener("click", () => {
    document.getElementById("uploadShareModal").classList.add("active");
    document.getElementById("uploadShareDescription").value = "";
    document.getElementById("uploadShareError").textContent = "";
});

document.getElementById("uploadShareCancelBtn").addEventListener("click", () => {
    document.getElementById("uploadShareModal").classList.remove("active");
});

document.getElementById("uploadShareConfirmBtn").addEventListener("click", async () => {
    const confirmBtn = document.getElementById("uploadShareConfirmBtn");
    const errorEl = document.getElementById("uploadShareError");
    const description = document.getElementById("uploadShareDescription").value.trim();

    confirmBtn.disabled = true;
    errorEl.textContent = "";

    const result = await window.riftgate.invoke("upload-shared-file", {
        username: settings.username,
        password: vaultPasswordCache,
        description: description || null,
        expiresHours: selectedShareExpiryHours
    });

    confirmBtn.disabled = false;

    if (result.canceled) return;

    if (!result.success) {
        errorEl.textContent = result.error || "Upload failed.";
        return;
    }

    document.getElementById("uploadShareModal").classList.remove("active");
    renderSharedFiles();
});

// --- Shared Folder: admin allowlist panel ---

async function loadAllowlistPanel() {
    const listEl = document.getElementById("allowlistCurrentList");
    listEl.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">Loading...</p>`;

    const result = await window.riftgate.invoke("get-share-allowlist", {
        adminUsername: settings.username,
        adminPassword: adminPasswordCache
    });

    if (!result.success) {
        listEl.innerHTML = `<p style="color:#ff5f5f;font-size:12px;">${result.error || "Couldn't load the allowlist."}</p>`;
        return;
    }

    if (result.list.length === 0) {
        listEl.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">No one's on the allowlist yet.</p>`;
        return;
    }

    listEl.innerHTML = "";
    result.list.forEach((entry) => {
        const item = document.createElement("div");
        item.className = "allowlist-item";

        const name = document.createElement("span");
        name.textContent = entry.username;
        item.appendChild(name);

        const removeBtn = document.createElement("button");
        removeBtn.className = "allowlist-remove-btn";
        removeBtn.textContent = "Remove";
        removeBtn.addEventListener("click", async () => {
            if (!confirm(`Remove ${entry.username} from the allowlist?`)) return;
            const removeResult = await window.riftgate.invoke("remove-from-share-allowlist", {
                adminUsername: settings.username,
                adminPassword: adminPasswordCache,
                targetUsername: entry.username
            });
            if (removeResult.success) {
                loadAllowlistPanel();
            } else {
                alert(removeResult.error || "Couldn't remove this user.");
            }
        });
        item.appendChild(removeBtn);

        listEl.appendChild(item);
    });
}

function openAllowlistModal() {
    document.getElementById("allowlistModal").classList.add("active");
    document.getElementById("allowlistNewUsername").value = "";
    loadAllowlistPanel();
}

document.getElementById("manageAllowlistBtn").addEventListener("click", openAllowlistModal);

document.getElementById("cleanVaultNowBtn").addEventListener("click", async () => {
    if (!confirm("Immediately remove every file and link in The Vault, regardless of when they're set to expire? This can't be undone.")) return;

    const btn = document.getElementById("cleanVaultNowBtn");
    btn.disabled = true;

    const [filesResult, linksResult] = await Promise.all([
        window.riftgate.invoke("force-clean-shared-folder", {
            adminUsername: settings.username,
            adminPassword: adminPasswordCache
        }),
        window.riftgate.invoke("force-clean-shared-links", {
            adminUsername: settings.username,
            adminPassword: adminPasswordCache
        })
    ]);

    btn.disabled = false;

    if (filesResult.success) renderSharedFiles();
    if (linksResult.success) renderSharedLinks();

    if (!filesResult.success || !linksResult.success) {
        alert(filesResult.error || linksResult.error || "Couldn't fully clean The Vault.");
    }
});
document.getElementById("openAllowlistFromAdminBtn").addEventListener("click", openAllowlistModal);

document.getElementById("allowlistCloseBtn").addEventListener("click", () => {
    document.getElementById("allowlistModal").classList.remove("active");
});

document.getElementById("allowlistAddBtn").addEventListener("click", async () => {
    const input = document.getElementById("allowlistNewUsername");
    const username = input.value.trim();
    if (!username) return;

    const result = await window.riftgate.invoke("add-to-share-allowlist", {
        adminUsername: settings.username,
        adminPassword: adminPasswordCache,
        targetUsername: username
    });

    if (result.success) {
        input.value = "";
        loadAllowlistPanel();
    } else {
        alert(result.error || "Couldn't add this user.");
    }
});

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

    // Slight delay so this doesn't compete for attention with the
    // update/username popups that might also appear right at startup.
    setTimeout(checkForMissingGames, 3000);
    setTimeout(checkForMissingEbooks, 3500);
    setTimeout(scanDropzoneOnStartup, 4000);

    loadRecentEpisodes();

    // Keep "Recently Released" fresh without needing a restart
    setInterval(loadRecentEpisodes, 10 * 60 * 1000);

    // Keep Free Games fresh too — Epic rotates its free titles weekly and
    // Steam/GOG can add or remove one at any time, so this catches new
    // ones (and drops ones that stopped being free) without needing a
    // restart. Runs quietly in the background — no loading message, and
    // whatever filter the user has selected is preserved.
    setInterval(() => loadFreeGames(true), 30 * 60 * 1000);

    // Keeps expired shares from piling up even if no one opens the
    // Shared Folder section for a while — only runs if this install is
    // actually allowlisted, so it's a no-op for everyone else.
    setInterval(() => {
        if (settings.username) {
            window.riftgate.invoke("cleanup-expired-shared-files", { username: settings.username, password: vaultPasswordCache });
            window.riftgate.invoke("cleanup-expired-shared-links", { username: settings.username, password: vaultPasswordCache });
        }
    }, 15 * 60 * 1000);

    // Start on whichever section the user picked in settings (defaults to New)
    switchSection(settings.startupSection || "new");
}

init();
