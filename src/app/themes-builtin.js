// Riftgate 2 — built-in themes. Original palettes in the families that are
// popular on uiverse.io (glassmorphism, neumorphism, neon and retro,
// brutalism, soft gradients, CSS patterns), made for Riftgate.
// colors: bg (page), panel (rail, panels), card, hover, line, accent,
// accent2 (the gradient's second colour), text, muted.

const T = (id, name, tone, surface, pattern, font, colors, extra = {}) =>
    ({ id: `builtin:${id}`, builtin: true, name, author: "Riftgate", tone, surface, pattern, font, glow: 1, colors, ...extra });

export const BUILTIN_THEMES = [
    T("rift", "Rift", "dark", "gem", "none", "rift",
        { bg: "#07050d", panel: "#120b22", card: "#1a1030", hover: "#24173f", line: "#2e2150", accent: "#8b3dff", accent2: "#e03cff", text: "#ede6ff", muted: "#9a8fb8" },
        { blurb: "The original: violet energy, gem-cut frames." }),
    T("starfield", "Starfield", "dark", "gem", "stars", "rift",
        { bg: "#05060f", panel: "#0c0f22", card: "#121733", hover: "#1b2147", line: "#252c58", accent: "#6c7bff", accent2: "#b46cff", text: "#e8eaff", muted: "#8e93bf" },
        { blurb: "Deep space, a sky full of stars." }),
    T("deep-ocean", "Deep Ocean Glass", "dark", "glass", "aurora", "clean",
        { bg: "#03121f", panel: "#082036", card: "#0c2a45", hover: "#123758", line: "#1b4467", accent: "#2fb7ff", accent2: "#7a5cff", text: "#e3f4ff", muted: "#86a9c4" },
        { blurb: "Frosted glass over an underwater aurora." }),
    T("midnight-glass", "Midnight Glass", "dark", "glass", "stars", "clean",
        { bg: "#0a0d17", panel: "#121726", card: "#171d30", hover: "#20283f", line: "#2a3350", accent: "#8ab4ff", accent2: "#c58bff", text: "#eef2ff", muted: "#97a0bd" },
        { blurb: "Cool slate glass, soft lavender light." }),
    T("neon-arcade", "Neon Arcade", "dark", "neon", "grid", "mono",
        { bg: "#05020a", panel: "#0d0716", card: "#120a1e", hover: "#1c0f2e", line: "#2a1645", accent: "#ff2fd0", accent2: "#2fffe0", text: "#fbe9ff", muted: "#a58ab8" },
        { blurb: "Arcade cabinet glow, pink and cyan tubes." }),
    T("synthwave", "Synthwave Sunset", "dark", "neon", "horizon", "rift",
        { bg: "#12021f", panel: "#1b0630", card: "#230a3c", hover: "#2f1150", line: "#3f1a63", accent: "#ff7a00", accent2: "#ff2f9d", text: "#fff0f7", muted: "#c08fb5" },
        { blurb: "Outrun horizon at the end of the night." }),
    T("terminal", "Terminal", "dark", "brutal", "scanlines", "mono",
        { bg: "#030a05", panel: "#071209", card: "#0a180d", hover: "#102414", line: "#1c3a22", accent: "#2fe08a", accent2: "#c6ff3d", text: "#d6ffe4", muted: "#6fae84" },
        { blurb: "Green phosphor on black, scanlines included.", onAccent: "#031208" }),
    T("cyber-yellow", "Cyber Yellow", "dark", "brutal", "diagonal", "heavy",
        { bg: "#0b0b10", panel: "#131319", card: "#18181f", hover: "#22222b", line: "#33333f", accent: "#fcee0a", accent2: "#00f0ff", text: "#f6f6f6", muted: "#9d9da8" },
        { blurb: "Hazard yellow, hard edges, hard shadows.", onAccent: "#0b0b10" }),
    T("mono-noir", "Mono Noir", "dark", "brutal", "none", "clean",
        { bg: "#0a0a0a", panel: "#121212", card: "#171717", hover: "#202020", line: "#2c2c2c", accent: "#f2f2f2", accent2: "#9e9e9e", text: "#f2f2f2", muted: "#9a9a9a" },
        { blurb: "Black and white, nothing else.", onAccent: "#0a0a0a" }),
    T("ember", "Ember Forge", "dark", "gem", "diagonal", "rift",
        { bg: "#0d0605", panel: "#1a0d0a", card: "#22110d", hover: "#2e1712", line: "#3d2019", accent: "#ff5a36", accent2: "#ffb02e", text: "#fff0e8", muted: "#c09a8a" },
        { blurb: "Glowing coals and hammered steel." }),
    T("crimson-night", "Crimson Night", "dark", "gem", "aurora", "rift",
        { bg: "#0d0306", panel: "#1a070d", card: "#220a12", hover: "#2e0f19", line: "#3f1524", accent: "#ff2f62", accent2: "#ff2fd0", text: "#ffe9ef", muted: "#c28d9c" },
        { blurb: "Blood moon, velvet dark." }),
    T("forest-night", "Forest Night", "dark", "round", "dots", "clean",
        { bg: "#07120d", panel: "#0c1c14", card: "#11251b", hover: "#183224", line: "#22412f", accent: "#3ddc84", accent2: "#c6ff3d", text: "#e6fff0", muted: "#86b59a" },
        { blurb: "Fireflies over a quiet forest." }),
    T("royal-gold", "Royal Gold", "dark", "gem", "checker", "serif",
        { bg: "#0d0a05", panel: "#18130a", card: "#1f180d", hover: "#2a2112", line: "#3a2d18", accent: "#ffcc4d", accent2: "#ff8a00", text: "#fff6dd", muted: "#bba57a" },
        { blurb: "Gilded edges on a dark library table.", onAccent: "#1a1205" }),
    T("vaporwave", "Vaporwave", "dark", "round", "grid", "rift",
        { bg: "#1b0f2e", panel: "#24143d", card: "#2c1a4a", hover: "#38215c", line: "#4a2d78", accent: "#00f0ff", accent2: "#ff71ce", text: "#fdf0ff", muted: "#b49cd6" },
        { blurb: "Pastel neon from a 90s screensaver.", onAccent: "#140a24" }),
    T("coffee", "Coffee House", "dark", "soft", "none", "serif",
        { bg: "#1e1612", panel: "#241b16", card: "#2a201a", hover: "#33271f", line: "#43342a", accent: "#d4a373", accent2: "#e76f51", text: "#f6ebe1", muted: "#b39d8c" },
        { blurb: "Warm and soft, like the first cup.", onAccent: "#1e1612" }),
    T("charcoal-soft", "Charcoal Soft", "dark", "soft", "none", "clean",
        { bg: "#23262c", panel: "#262a31", card: "#2a2e36", hover: "#31363f", line: "#3a404b", accent: "#ff9f43", accent2: "#ff6b6b", text: "#eef1f5", muted: "#a2a9b5" },
        { blurb: "Neumorphic charcoal with a warm accent.", onAccent: "#1b1d22" }),
    T("soft-cloud", "Soft Cloud", "light", "soft", "none", "clean",
        { bg: "#e6ebf2", panel: "#e9eef5", card: "#edf1f7", hover: "#dde3ec", line: "#c9d1de", accent: "#5b6cff", accent2: "#9b5bff", text: "#262b3a", muted: "#6b7387" },
        { blurb: "Light neumorphism, pillowy and calm." }),
    T("arctic-glass", "Arctic Glass", "light", "glass", "waves", "clean",
        { bg: "#e4f2fb", panel: "#eef7fd", card: "#f5fbff", hover: "#d8ebf7", line: "#b9d7ea", accent: "#0084ff", accent2: "#00bfb3", text: "#0f2a3d", muted: "#5b7a90" },
        { blurb: "Ice-clear glass on a winter sky." }),
    T("paper", "Paper Brutal", "light", "brutal", "dots", "heavy",
        { bg: "#f4efe6", panel: "#fbf7f0", card: "#ffffff", hover: "#efe7d9", line: "#d9cfbf", accent: "#ff4d2e", accent2: "#1f6bff", text: "#111111", muted: "#5f5a52" },
        { blurb: "Ink on paper, loud and proud." }),
    T("sakura", "Sakura", "light", "round", "dots", "clean",
        { bg: "#fff3f7", panel: "#fff8fb", card: "#ffffff", hover: "#ffe6ef", line: "#f6cfdd", accent: "#e75480", accent2: "#9b59b6", text: "#3a1f2b", muted: "#8e6877" },
        { blurb: "Cherry blossom pinks, gentle and bright." })
];

export const SURFACES = [
    { id: "gem", label: "Gem", hint: "Cut corners, Riftgate's own" },
    { id: "glass", label: "Glass", hint: "Frosted, see-through panels" },
    { id: "soft", label: "Soft", hint: "Neumorphic, pressed from the page" },
    { id: "neon", label: "Neon", hint: "Glowing edges" },
    { id: "brutal", label: "Brutal", hint: "Thick outlines, hard shadows" },
    { id: "round", label: "Rounded", hint: "Friendly round corners" }
];
export const PATTERNS = ["none", "stars", "grid", "dots", "diagonal", "checker", "waves", "scanlines", "aurora", "horizon"];
export const FONTS = {
    rift: { label: "Rift (DIN)", body: '"Bahnschrift", "DIN Alternate", "Segoe UI Variable Text", system-ui, sans-serif', display: '"Bahnschrift Condensed", "Bahnschrift", "DIN Condensed", sans-serif' },
    clean: { label: "Clean", body: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', display: '"Segoe UI Variable Display", "Segoe UI Semibold", "Segoe UI", system-ui, sans-serif' },
    mono: { label: "Terminal", body: '"Cascadia Code", "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace', display: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
    serif: { label: "Classic", body: 'Georgia, Cambria, "Times New Roman", serif', display: 'Cambria, Georgia, "Times New Roman", serif' },
    heavy: { label: "Poster", body: '"Segoe UI", system-ui, sans-serif', display: '"Arial Black", "Segoe UI Black", "Segoe UI", sans-serif' },
    playful: { label: "Playful", body: '"Trebuchet MS", "Segoe UI", sans-serif', display: '"Trebuchet MS", "Segoe UI Semibold", sans-serif' }
};
