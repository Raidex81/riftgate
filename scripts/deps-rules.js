// The links between Riftgate's sections that are allowed, in one place.
// scripts/check-deps.js fails when code adds a link that isn't written here,
// so a new feature can't quietly start depending on another section: either
// it goes through a shared module (engine/core, src/app), or the link is
// added below on purpose, with the reason.

module.exports = {
    // ---- Engine (main process) ----------------------------------------------------
    // Layers, lowest first. A module may require its own layer's modules
    // only where marked, and anything in the layers below it.
    //   services/       talking to one outside API; knows nothing of Riftgate
    //   engine/core/    what every section shares: the data folder, settings,
    //                   the window, the account session
    //   engine/providers.js   outside sources: health, backing off, saved copies
    //   engine/*.js     one section each (alerts, account, themes…). Sections
    //                   never require each other: what one needs from another
    //                   is passed in by main.js when it registers them.
    //   main.js         the app's start, its window, and wiring sections together
    engineLayers: [
        { name: "services", match: /^services\//, mayRequire: ["services"] },
        { name: "core", match: /^engine\/core\//, mayRequire: ["services", "core"] },
        { name: "providers", match: /^engine\/providers\.js$/, mayRequire: ["services", "core"] },
        { name: "section", match: /^engine\/[^/]+\.js$/, mayRequire: ["services", "core", "providers"] },
        { name: "main", match: /^(main|preload)\.js$/, mayRequire: ["services", "core", "providers", "section"] },
    ],

    // ---- Interface (src/) ----------------------------------------------------------
    //   src/app/        logic and state shared by every section (no drawing)
    //   src/components/ shared pieces of interface (cards, rows, detail panel…)
    //   src/views/      one section each. Sections never import each other.
    //   src/app/main.js the entry point: it builds the frame and loads sections
    interfaceLayers: [
        { name: "app", match: /^src\/app\/(?!main\.js$)/, mayImport: ["app"] },
        { name: "components", match: /^src\/components\//, mayImport: ["app", "components"] },
        { name: "views", match: /^src\/views\//, mayImport: ["app", "components"] },
        { name: "entry", match: /^src\/app\/main\.js$/, mayImport: ["app", "components", "views"] },
    ],
    // Links outside those rules that exist on purpose
    interfaceExceptions: {
        "src/app/data.js -> src/components/palette.js": "every list registers with Ctrl K search as it loads",
        "src/app/library-tools.js -> src/components/toast.js": "drag-and-drop adding says what happened",
        "src/app/library-tools.js -> src/components/add-dialog.js": "a dropped file opens the Add dialog",
        "src/app/regions.js -> src/components/toast.js": "changing region says what changed",
    },

    // ---- Messages between modules that no import shows ----------------------------
    // Window events (CustomEvent) the interface fires and hears.
    windowEvents: {
        "r2-engine-outdated": "api.js → main.js: the engine is older than the interface (restart needed)",
        "r2-library-changed": "anything that changes the library → the Library section repaints",
        "r2-secret": "secrets.js → the Nexus rift: a secret was found",
        "r2-intro-opening": "intro.js → rift.js: the opening is revealing the app",
        "r2-retry": "sources.js → main.js: Try again draws the section again",
        "r2-sources-reset": "sources.js → data.js: Try again forgets this session's lists",
        "r2-sources-changed": "sources.js → the sources notice: which sources are failing",
    },
    // Storage keys used by more than one file
    sharedStorageKeys: {
        "r2-intro": "intro.js and Settings: the opening already played this session",
    },
    // IPC channels handled by the engine that the 2.x interface doesn't call
    // (kept from 1.x; preload.js still allows most of them). Listed so a new
    // unused handler stands out.
    unusedHandlersAllowed: 67,
};
