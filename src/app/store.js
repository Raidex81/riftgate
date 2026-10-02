// Riftgate 2 — the Journal: one place to track anything across all your
// worlds. Each entry is keyed by item (see items.js journalKey) and holds a
// status, a 1–5 gem rating, progress (0–100), a note, and a snapshot of the
// item (title, art, type) so the Journal can show it without re-fetching.
// Saved by the engine (r2-store-*), not browser storage, so it survives
// restarts and is included in backups of the data folder.

import { call } from "./api.js";

export const STATUSES = [
    { id: "progress",  label: { game: "Playing", film: "Watching", series: "Watching", anime: "Watching", book: "Reading", app: "Using" } },
    { id: "planned",   label: "Planned" },
    { id: "completed", label: "Completed" },
    { id: "hold",      label: "On hold" },
    { id: "dropped",   label: "Dropped" }
];

export function statusLabel(id, type) {
    const s = STATUSES.find((x) => x.id === id);
    if (!s) return "";
    return typeof s.label === "string" ? s.label : (s.label[type] || "In progress");
}

const state = { journal: {}, prefs: {} };
const listeners = new Set();
let loaded = null;

export function load() {
    if (!loaded) {
        loaded = call("r2-store-get").then((d) => {
            if (d) { state.journal = d.journal || {}; state.prefs = d.prefs || {}; }
            return state;
        });
    }
    return loaded;
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(key) { listeners.forEach((fn) => { try { fn(key); } catch (e) { console.error(e); } }); }

export function entry(key) { return state.journal[key] || null; }
export function entries() { return Object.entries(state.journal).map(([key, v]) => ({ key, ...v })); }

// Merge a change into an entry. An entry with no status, rating, progress,
// note or favourite left is removed entirely.
export async function update(key, patch, snapshot) {
    const prev = state.journal[key] || {};
    const next = { ...prev, ...patch };
    if (snapshot) next.item = snapshot;
    const empty = !next.status && !next.rating && !next.progress && !next.note && !next.favourite;
    if (empty) delete state.journal[key]; else state.journal[key] = { ...next, updatedAt: Date.now() };
    emit(key);
    const r = await call("r2-store-set", { section: "journal", key, value: empty ? null : next });
    return r && r.ok;
}

export function pref(name, fallback) {
    const v = state.prefs["pref:" + name];
    return v && "value" in v ? v.value : fallback;
}
export async function setPref(name, value) {
    state.prefs["pref:" + name] = { value };
    emit("pref:" + name);
    return call("r2-store-set", { section: "prefs", key: "pref:" + name, value: { value } });
}
