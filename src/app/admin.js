// Riftgate — admin status and the admin unlock.
// Whether the signed-in account is an admin comes from the server's admin
// list. Admin actions are checked by the server against the account's
// password on every call, as in Riftgate 1.x; Riftgate never stores that
// password, so it's asked once when an admin tool is first used and kept
// only in memory until the app closes or you lock it again.

import { h, icon } from "./dom.js";
import { call, cached } from "./api.js";
import * as account from "./account.js";

let unlocked = null; // { username, password } for this session only

const base = (n) => String(n || "").replace(/_(adm|root)$/i, "").toLowerCase();

export async function adminList() {
    const r = await cached("get-admin-list-detailed");
    return (r && r.success && Array.isArray(r.admins)) ? r.admins : [];
}
// -> null | { admin: true, root: bool }
export async function roleOf(username) {
    if (!username) return null;
    const list = await adminList();
    const e = list.find((a) => a.username === username) || list.find((a) => base(a.username) === base(username));
    return e ? { admin: true, root: !!e.is_super_admin } : null;
}
export async function myRole() { const s = account.current(); return s.signedIn ? roleOf(s.username) : null; }

export function lock() { unlocked = null; }
export const isUnlocked = () => !!unlocked;

// Resolves to { username, password } or null if cancelled
export function credentials() {
    if (unlocked) return Promise.resolve(unlocked);
    const username = account.current().username;
    if (!username) return Promise.resolve(null);
    return new Promise((resolve) => {
        const pass = h("input.input", { type: "password", autocomplete: "current-password", placeholder: "Your password", maxlength: 128 });
        const st = h("p.account-status", { role: "status" });
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("check"), "Unlock admin tools");
        const wrap = h("div.account-portal", { role: "dialog", "aria-modal": "true", "aria-label": "Unlock admin tools", onclick: (e) => { if (e.target === wrap) done(null); } },
            h("div.account-box", null,
                h("img.account-gem", { src: "assets/riftgate-gem-mark.png", alt: "" }),
                h("h2", null, "Admin tools"),
                h("p.muted", null, `Confirm it's you, ${username}. Your password stays in memory only until Riftgate closes; it's never saved.`),
                h("form.account-form", { onsubmit: async (e) => {
                    e.preventDefault();
                    go.disabled = true; st.textContent = "";
                    const r = await call("verify-login", { username, password: pass.value });
                    go.disabled = false;
                    if (!r || !r.success) { st.textContent = "Couldn't reach the server. Try again."; return; }
                    if (!r.valid) { st.textContent = "That password isn't right."; pass.select(); return; }
                    unlocked = { username, password: pass.value };
                    done(unlocked);
                } }, h("label.field", null, h("span", null, "Password"), pass), go, st)));
        const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
        document.addEventListener("keydown", onKey);
        function done(v) { wrap.remove(); document.removeEventListener("keydown", onKey); resolve(v); }
        document.body.appendChild(wrap);
        pass.focus();
    });
}

// Run an admin action; asks to unlock first, and once more if the server
// says the password no longer works.
export async function run(channel, payload) {
    let c = await credentials();
    if (!c) return null;
    let r = await call(channel, { ...payload, username: c.username, password: c.password });
    if (r && r.success === false && /authori/i.test(String(r.error || ""))) {
        unlocked = null;
        c = await credentials();
        if (!c) return null;
        r = await call(channel, { ...payload, username: c.username, password: c.password });
    }
    return r;
}

account.onChange((s) => { if (!s.signedIn || (unlocked && unlocked.username !== s.username)) unlocked = null; });
