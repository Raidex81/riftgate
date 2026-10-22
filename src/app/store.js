// Riftgate — the Journal: one place to track anything across all your
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
    // when it was finished (kept even if its rating or note changes later): relics, Seals and Rift Rewind count by it
    if (patch.status === "completed" && prev.status !== "completed") next.completedAt = Date.now();
    if (patch.status && patch.status !== "completed") delete next.completedAt;
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

// Brings in many entries at once (imports from other sites): a new entry is
// added as it is; one you already have only gets what it's missing (your own
// status, rating, note and favourite always win). One save for all of them.
// list: [{ key, status, rating, progress, note, favourite, completedAt, at, item }]
export async function importEntries(list) {
    const out = {};
    let added = 0, updated = 0, already = 0;
    for (const x of list) {
        const prev = state.journal[x.key];
        if (!prev) {
            const next = { item: x.item };
            for (const f of ["status", "rating", "progress", "note", "favourite", "completedAt"]) if (x[f]) next[f] = x[f];
            if (!next.status && !next.rating && !next.favourite) continue;
            next.updatedAt = x.at || Date.now();
            out[x.key] = next; added++;
            continue;
        }
        const next = { ...prev };
        let changed = false;
        for (const f of ["status", "rating", "note", "favourite"]) if (x[f] && !prev[f]) { next[f] = x[f]; changed = true; }
        if (!prev.progress && x.progress && next.status === x.status) { next.progress = x.progress; changed = true; }
        if (next.status === "completed" && !prev.completedAt && x.completedAt) { next.completedAt = x.completedAt; changed = true; }
        if (!prev.item && x.item) { next.item = x.item; changed = true; }
        if (changed) { out[x.key] = next; updated++; } else already++;
    }
    const keys = Object.keys(out);
    if (keys.length) {
        const r = await call("r2-store-merge", { section: "journal", entries: out });
        if (!r || !r.ok) return { ok: false, error: (r && r.error) || "Your Journal couldn't be saved." };
        for (const k of keys) state.journal[k] = { ...out[k], updatedAt: out[k].updatedAt || Date.now() };
        emit("import");
    }
    return { ok: true, added, updated, already };
}
