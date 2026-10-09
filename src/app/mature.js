// Riftgate — what may show: the mature-content age gate and the items an
// admin removed from Riftgate.
//
// Same rules and the same server data as Riftgate 1.x, so both apps agree:
//   * mature titles (the engine's keyword check, plus anything an admin
//     marked as mature) show only to a signed-in adult who turned them on,
//     and to admins; everyone else, signed out included, doesn't see them;
//   * an adult is 18 or over from the date of birth on the account (no date
//     = treated as under 18, the safe default);
//   * removed items are hidden for everyone.
// Something you already track in your Journal is never hidden from you.
// This is a content filter from a self-declared date of birth, not ID-based
// age verification.

import { call } from "./api.js";
import * as account from "./account.js";
import * as journal from "./store.js";
import { myRole } from "./admin.js";

const ADULT_AGE = 18;
let overrides = new Set();   // "section:key", forced mature
let removed = new Set();     // "section:key", removed for everyone
let profile = { dateOfBirth: null, showMatureContent: false };
let role = null;
let loadedAt = 0;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export function ageFrom(dob) {
    if (!dob) return null;
    const d = new Date(`${String(dob).slice(0, 10)}T00:00:00`);
    if (isNaN(d)) return null;
    const t = new Date();
    let a = t.getFullYear() - d.getFullYear();
    if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
    return a;
}
export const isAdult = () => (ageFrom(profile.dateOfBirth) ?? 0) >= ADULT_AGE;
export const isAdmin = () => !!role;
export const state = () => ({ ...profile, adult: isAdult(), admin: isAdmin(), signedIn: account.current().signedIn });
// Admins can look at Riftgate as an adult or as someone under 18 would see it
let preview = null; // null | "adult" | "minor"
export const previewAs = () => preview;
export function setPreview(p) { preview = p === "adult" || p === "minor" ? p : null; repaint(); }
export function canSeeMature() {
    if (isAdmin() && preview) return preview === "adult"; // an adult who turned mature titles on
    return isAdmin() || (account.current().signedIn && isAdult() && profile.showMatureContent);
}

// The (section, key) Riftgate 1.x uses for an item, so overrides and removals
// made in either app apply in both. Items 1.x never had return null.
export function modKeys(it) {
    if (!it) return [];
    const r = it.raw || {};
    if (it.type === "film" && it.tmdbId != null) return [["movie", String(it.tmdbId)]];
    if ((it.type === "series" || it.type === "anime") && it.tmdbShowId != null) return [["show", String(it.tmdbShowId)]];
    if (it.type === "book") return [it.workKey, r.workKey, r.id].filter(Boolean).map((k) => ["book", String(k)]);
    if (it.kind === "free" && r.id != null) return [["freegame", String(r.id)]];
    if ((it.kind === "upcoming" || it.kind === "search") && it.type === "game" && r.id != null) return [["game", String(r.id)]];
    return [];
}
const has = (set, it) => modKeys(it).some(([s, k]) => set.has(`${s}:${k}`));
export const isMature = (it) => !!(it && (it.mature || has(overrides, it)));
export const isRemoved = (it) => has(removed, it);
export const markedMature = (it) => has(overrides, it);

// Should this item stay out of sight?
export function hidden(it) {
    if (!it || it.kind === "library" || it.kind === "ebook") return false;
    if (journal.entry(it.key)) return false;
    if (isRemoved(it)) return true;
    return isMature(it) && !canSeeMature();
}
export const visible = (list) => (Array.isArray(list) ? list.filter((x) => !hidden(x)) : list);

async function loadLists() {
    const [o, r] = await Promise.all([call("get-mature-overrides"), call("get-removed-items")]);
    if (o && o.success) overrides = new Set(o.overrides.map((x) => `${x.section}:${x.item_key}`));
    if (r && r.success) removed = new Set(r.removed.map((x) => `${x.section}:${x.item_key}`));
    loadedAt = Date.now();
}
async function loadProfile() {
    const s = account.current();
    role = s.signedIn ? await myRole() : null;
    if (!s.signedIn) { profile = { dateOfBirth: null, showMatureContent: false }; return; }
    const p = await call("get-account-profile", s.username);
    if (p && p.success) profile = { dateOfBirth: p.dateOfBirth || null, showMatureContent: !!p.showMatureContent };
}

// Hide (or bring back) cards already on screen when anything changes
function repaint() {
    document.querySelectorAll(".card").forEach((c) => { if (c._item) c.hidden = hidden(c._item); });
    emit();
}

let readyP = null;
export function start() {
    readyP = Promise.all([loadLists(), account.ready().then(loadProfile)]).then(repaint);
    account.onChange(() => loadProfile().then(repaint));
    // a new admin decision reaches you within half an hour, without polling
    window.addEventListener("focus", () => { if (Date.now() - loadedAt > 30 * 60e3) loadLists().then(repaint); });
    return readyP;
}
export const ready = () => readyP || Promise.resolve();

// ---- your own choices ----
export async function setShowMature(show) {
    const s = account.current();
    if (!s.signedIn || !isAdult()) return { success: false, error: "Only for adults signed in to their account." };
    const r = await call("set-show-mature-content", { username: s.username, show: !!show });
    if (r && r.success) { profile.showMatureContent = !!show; repaint(); }
    return r || { success: false };
}
export async function setDateOfBirth(dob) {
    const s = account.current();
    if (!s.signedIn) return { success: false };
    const r = await call("set-account-date-of-birth", { username: s.username, dateOfBirth: dob });
    if (r && r.success) { profile.dateOfBirth = dob; repaint(); }
    return r || { success: false };
}

// ---- admin decisions (the server re-checks the password on each) ----
export async function adminToggleMature(it, run) {
    const [k] = modKeys(it);
    if (!k) return null;
    const r = await run("admin-toggle-item-mature", { section: k[0], itemKey: k[1], itemName: it.title });
    if (r && r.success) { const id = `${k[0]}:${k[1]}`; if (r.isMature) overrides.add(id); else overrides.delete(id); repaint(); }
    return r;
}
export async function adminRemove(it, run) {
    const [k] = modKeys(it);
    if (!k) return null;
    const r = await run("admin-remove-item", { section: k[0], itemKey: k[1], itemName: it.title });
    if (r && r.success) { removed.add(`${k[0]}:${k[1]}`); repaint(); }
    return r;
}
export const lists = () => ({ overrides: [...overrides], removed: [...removed] });
export const refresh = () => loadLists().then(repaint);
