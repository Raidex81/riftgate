// Riftgate 2 — your Riftgate account (the same one as in Riftgate).
// Optional: everything works signed out; signing in lets you share themes
// and puts your name on what you share. The engine keeps the session token;
// this side only knows your username.

import { call } from "./api.js";

let state = { signedIn: false, username: null, checked: false };
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const set = (s) => { state = { ...state, ...s, checked: true }; listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } }); };
export const current = () => state;

export async function restore() {
    const r = (await call("r2-account-restore")) || {};
    set({ signedIn: !!r.signedIn, username: r.signedIn ? r.username : null, offline: !!r.offline, expired: !!r.expired });
    return state;
}
async function done(r) {
    if (r && r.ok) set({ signedIn: true, username: r.username, offline: false });
    return r || { ok: false, error: "Something went wrong. Try again." };
}
export const signIn = (username, password) => call("r2-account-sign-in", { username, password }).then(done);
export const signUp = (username, password, dateOfBirth) => call("r2-account-sign-up", { username, password, dateOfBirth }).then(done);
export const setPassword = (username, password) => call("r2-account-set-password", { username, password }).then(done);
export async function signOut() { await call("r2-account-sign-out"); set({ signedIn: false, username: null }); }
export const requestReset = (username) => call("request-password-reset", { username });
export const confirmReset = (username, code, newPassword) => call("confirm-password-reset", { username, code, newPassword });
