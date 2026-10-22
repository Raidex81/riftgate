// Riftgate — new suggestions, for admins. While an admin is signed in, the
// engine looks for suggestions made since they last opened Suggestions
// (engine/suggestions.js); this keeps the count the Suggestions button shows
// (it blinks while there are new ones), shows a note in the window when new
// ones arrive, and tells the engine when they've been seen.

import { call, on } from "./api.js";
import * as account from "./account.js";
import * as admin from "./admin.js";

let count = 0;
let watching = null;
const listeners = new Set();
export const unseen = () => count;
export function onCount(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const set = (n) => { count = Math.max(0, n | 0); listeners.forEach((fn) => { try { fn(count); } catch (e) { console.error(e); } }); };

async function follow(st) {
    const role = st && st.signedIn ? await admin.roleOf(st.username).catch(() => null) : null;
    const who = role ? st.username : null;
    if (who === watching) return;
    watching = who;
    const r = await call("r2-suggestions-watch", who).catch(() => null);
    set(who && r ? r.count : 0);
}

// note: (latest) => void, for the window's own message about new ones
export function start({ note } = {}) {
    on("r2-suggestions-new", (d) => {
        if (!watching || !d) return;
        set(d.count);
        if (d.told && note) note(d);
    });
    account.ready().then(() => follow(account.current()));
    account.onChange((st) => follow(st));
}

// the admin is looking at Suggestions now
export async function seen() {
    if (!watching) return;
    set(0);
    await call("r2-suggestions-seen").catch(() => {});
}
