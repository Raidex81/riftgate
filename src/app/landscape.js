// Riftgate — wide pictures for the banner. Posters are tall and look lost
// (and cropped beyond recognition) in a wide banner, so the banner only uses
// landscape art: the item's backdrop when it has one, a Steam game's own
// library hero (or its store header), or SteamGridDB's wide "hero" banner,
// asked once per title. Each picture is checked to really load first.

import { call } from "./api.js";
import { coverSrc } from "./dom.js";

const STEAM = (id, f) => `https://cdn.akamai.steamstatic.com/steam/apps/${id}/${f}`;
const known = new Map();

function loads(url, minRatio = 1.6) {
    return new Promise((resolve) => {
        if (!url) return resolve(false);
        const img = new Image();
        const t = setTimeout(() => resolve(false), 8000);
        img.onload = () => { clearTimeout(t); resolve(img.naturalWidth / Math.max(1, img.naturalHeight) >= minRatio); };
        img.onerror = () => { clearTimeout(t); resolve(false); };
        img.src = coverSrc(url);
    });
}
export function steamIdOf(item) {
    const raw = item.raw || {};
    if (raw.steamAppId) return String(raw.steamAppId);
    const m = /store\.steampowered\.com\/app\/(\d+)/.exec(item.url || raw.url || "") || /steam\/apps\/(\d+)\//.exec(item.image || "");
    return m ? m[1] : null;
}

// Resolves to a wide picture's URL, or null when there's no good one
export function landscapeFor(item) {
    if (!item || !item.title) return Promise.resolve(null);
    const key = item.key || item.title;
    if (known.has(key)) return known.get(key);
    const p = (async () => {
        if (item.backdrop && item.backdrop !== item.image && await loads(item.backdrop, 1.3)) return item.backdrop;
        const sid = steamIdOf(item);
        if (sid) {
            for (const f of ["library_hero.jpg", "header.jpg"]) if (await loads(STEAM(sid, f))) return STEAM(sid, f);
        }
        if (item.type === "game" || item.kind === "free" || item.kind === "deal" || item.kind === "upcoming" || item.kind === "library") {
            const u = await call("r2-landscape-art", { title: item.title });
            if (u && await loads(u)) return u;
        }
        if (item.image && await loads(item.image)) return item.image; // the cover itself happens to be wide
        return null;
    })();
    known.set(key, p);
    return p;
}

// The first few candidates, in order, until one has a wide picture
export async function firstWithLandscape(list, tries = 5) {
    for (const item of list.slice(0, tries)) {
        const u = await landscapeFor(item);
        if (u) return { ...item, backdrop: u };
    }
    return null;
}
