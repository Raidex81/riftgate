// Riftgate — "Already watched" for episodes and films, kept exactly as in
// Riftgate 1.x (settings.seenEpisodes keyed "showId|season|number", so a
// newly aired episode starts out unwatched; settings.seenMovies keyed by
// the film's TMDB id), so what you marked there carries over.

import { settings, saveSettings } from "./api.js";
import * as journal from "./store.js";

// Books ("Already read") are Riftgate 2's own: kept in its store by the
// book's Journal key, so the same book is marked wherever it shows up.
let eps = {}, films = {}, books = {}, loaded = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function load() {
    if (!loaded) loaded = Promise.all([settings(), journal.load()]).then(([s]) => {
        eps = { ...(s.seenEpisodes || {}) }; films = { ...(s.seenMovies || {}) }; books = { ...(journal.pref("read:books", {}) || {}) };
    });
    return loaded;
}

function keyOf(item) {
    if (!item) return null;
    if (item.kind === "episode" && item.raw) return { kind: "ep", key: `${item.raw.showId}|${item.raw.season}|${item.raw.number}` };
    if (item.type === "film" && item.tmdbId != null) return { kind: "film", key: String(item.tmdbId) };
    if (item.type === "book" && item.key) return { kind: "book", key: item.key };
    return null;
}
// Films only once they're out (not "coming to cinemas")
const mapOf = (kind) => (kind === "ep" ? eps : kind === "book" ? books : films);
// Words for the seal: books are read, everything else watched
export const isBook = (item) => !!item && item.type === "book";
export function canMark(item) {
    const k = keyOf(item);
    if (!k) return false;
    if (k.kind === "film" && item.date && item.date > new Date().toISOString().slice(0, 10)) return false;
    return true;
}
export function isSeen(item) {
    const k = keyOf(item);
    return !!k && !!mapOf(k.kind)[k.key];
}
export async function toggle(item) {
    await load();
    const k = keyOf(item);
    if (!k) return false;
    const map = mapOf(k.kind);
    if (map[k.key]) delete map[k.key]; else map[k.key] = k.kind === "book" ? Date.now() : true;
    if (k.kind === "book") await journal.setPref("read:books", { ...books });
    else await saveSettings(k.kind === "ep" ? { seenEpisodes: { ...eps } } : { seenMovies: { ...films } });
    listeners.forEach((fn) => { try { fn(item); } catch (e) { console.error(e); } });
    return !!map[k.key];
}
// Unwatched first, keeping the original order otherwise
export const unwatchedFirst = (list) => list.map((x, i) => ({ x, i, s: isSeen(x) ? 1 : 0 })).sort((a, b) => a.s - b.s || a.i - b.i).map((o) => o.x);
