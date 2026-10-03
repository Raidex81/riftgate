// Riftgate 2 — sign in / create account / forgot password, and the account
// chip in the rail. One Riftgate account for Riftgate and Riftgate 2.

import { h, icon, clear } from "../app/dom.js";
import * as account from "../app/account.js";
import { toast } from "./toast.js";

export function openAccount(mode = "in", { reason } = {}) {
    document.querySelector(".account-portal")?.remove();
    const box = h("div.account-box");
    const wrap = h("div.account-portal", { role: "dialog", "aria-modal": "true", "aria-label": "Your Riftgate account", onclick: (e) => { if (e.target === wrap) close(); } },
        box, h("button.icon-btn.today-close", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x")));
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", onKey);
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey); }
    document.body.appendChild(wrap);

    const field = (label, input, hint) => h("label.field", null, h("span", null, label), input, hint ? h("small.muted", null, hint) : null);
    const pw = (ph, auto) => h("input.input", { type: "password", placeholder: ph, autocomplete: auto, maxlength: 128 });
    const status = () => h("p.account-status", { role: "status" });
    const busy = (btn, on, label) => { btn.disabled = on; btn.lastChild.textContent = on ? "One moment…" : label; };
    const head = (title, sub) => [h("div.account-gem", null, icon("gem")), h("h2", null, title), sub ? h("p.muted", null, sub) : null];
    const tabs = (cur) => h("div.account-tabs", { role: "tablist" },
        h("button", { type: "button", role: "tab", "aria-selected": String(cur === "in"), onclick: () => signInView() }, "Sign in"),
        h("button", { type: "button", role: "tab", "aria-selected": String(cur === "up"), onclick: () => signUpView() }, "Create account"));

    function signInView(prefill = "") {
        const user = h("input.input", { type: "text", placeholder: "Username", autocomplete: "username", value: prefill, maxlength: 40 });
        const pass = pw("Password", "current-password");
        const st = status();
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("rift"), "Sign in");
        const form = h("form.account-form", { onsubmit: async (e) => {
            e.preventDefault(); st.textContent = ""; busy(go, true, "Sign in");
            const r = await account.signIn(user.value.trim(), pass.value);
            busy(go, false, "Sign in");
            if (r.needsSetup) return setupView(r.username);
            if (!r.ok) { st.textContent = r.error; pass.select(); return; }
            toast(`Welcome back, ${r.username}`); close();
        } },
            field("Username", user), field("Password", pass), go, st,
            h("button.link-btn", { type: "button", onclick: () => forgotView(user.value.trim()) }, "Forgot your password?"));
        clear(box).append(...head("Welcome back", reason || "Your Riftgate account works in both Riftgate apps."), tabs("in"), form);
        (prefill ? pass : user).focus();
    }

    function signUpView() {
        const user = h("input.input", { type: "text", placeholder: "Pick a username", autocomplete: "username", maxlength: 24 });
        const pass = pw("At least 8 characters", "new-password");
        const pass2 = pw("Type it again", "new-password");
        const dob = h("input.input", { type: "date", max: new Date().toISOString().slice(0, 10) });
        const meter = h("div.pw-meter", null, h("i"));
        pass.addEventListener("input", () => {
            const v = pass.value; let s = 0;
            if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^\w]/.test(v)) s++;
            meter.dataset.s = String(Math.min(4, s));
        });
        const st = status();
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("sparkles"), "Create my account");
        const form = h("form.account-form", { onsubmit: async (e) => {
            e.preventDefault(); st.textContent = "";
            if (pass.value !== pass2.value) { st.textContent = "The two passwords don't match."; return; }
            busy(go, true, "Create my account");
            const r = await account.signUp(user.value.trim(), pass.value, dob.value || null);
            busy(go, false, "Create my account");
            if (!r.ok) { st.textContent = r.error; return; }
            toast(`Welcome to Riftgate, ${r.username}!`); close();
        } },
            field("Username", user, "3 to 24 letters, numbers, dots, dashes or underscores. Everyone sees it on what you share."),
            field("Password", pass), meter, field("Confirm password", pass2),
            field("Date of birth (optional)", dob, "Only used to decide whether mature titles can show, as in Riftgate."),
            go, st);
        clear(box).append(...head("Join Riftgate", "Share your themes and keep one account across both apps."), tabs("up"), form);
        user.focus();
    }

    function setupView(username) {
        const pass = pw("At least 8 characters", "new-password");
        const pass2 = pw("Type it again", "new-password");
        const st = status();
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("check"), "Set my password");
        clear(box).append(...head(`Hi ${username}`, "This account doesn't have a password yet. Choose one to finish setting it up."),
            h("form.account-form", { onsubmit: async (e) => {
                e.preventDefault();
                if (pass.value !== pass2.value) { st.textContent = "The two passwords don't match."; return; }
                busy(go, true, "Set my password");
                const r = await account.setPassword(username, pass.value);
                busy(go, false, "Set my password");
                if (!r.ok) { st.textContent = r.error; return; }
                toast(`You're all set, ${r.username}`); close();
            } }, field("New password", pass), field("Confirm password", pass2), go, st));
        pass.focus();
    }

    function forgotView(prefill = "") {
        const user = h("input.input", { type: "text", placeholder: "Username", value: prefill, maxlength: 40 });
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("arrow"), "Email me a code");
        clear(box).append(...head("Reset your password", "If your account has a confirmed email address, a reset code goes to it."),
            h("form.account-form", { onsubmit: async (e) => {
                e.preventDefault(); if (!user.value.trim()) return;
                busy(go, true, "Email me a code");
                await account.requestReset(user.value.trim());
                busy(go, false, "Email me a code");
                codeView(user.value.trim());
            } }, field("Username", user), go,
                h("button.link-btn", { type: "button", onclick: () => signInView(user.value.trim()) }, "Back to sign in")));
        user.focus();
    }

    function codeView(username) {
        const code = h("input.input", { type: "text", placeholder: "Code from the email", autocomplete: "one-time-code", maxlength: 12 });
        const pass = pw("At least 8 characters", "new-password");
        const st = status();
        const go = h("button.btn.primary.lg", { type: "submit" }, icon("check"), "Reset password");
        clear(box).append(...head("Check your email", `If ${username} has a confirmed email, the code is there. It only works for a short while.`),
            h("form.account-form", { onsubmit: async (e) => {
                e.preventDefault();
                if (pass.value.length < 8) { st.textContent = "Use at least 8 characters."; return; }
                busy(go, true, "Reset password");
                const r = await account.confirmReset(username, code.value.trim(), pass.value);
                busy(go, false, "Reset password");
                if (!r || !r.success) { st.textContent = (r && r.error) || "That code didn't work."; return; }
                toast("Password changed. Sign in with the new one."); signInView(username);
            } }, field("Code", code), field("New password", pass), go, st,
                h("button.link-btn", { type: "button", onclick: () => signInView(username) }, "Back to sign in")));
        code.focus();
    }

    if (mode === "up") signUpView(); else signInView();
}

// The chip at the bottom of the rail
export function accountChip() {
    const el = h("button.account-chip", { type: "button" });
    const paint = (s) => {
        clear(el);
        if (s.signedIn) {
            el.title = `Signed in as ${s.username}`;
            el.append(h("span.avatar", null, s.username.slice(0, 1).toUpperCase()), h("span.who", null, h("b", null, s.username), h("small", null, s.offline ? "Offline" : "Signed in")));
            el.onclick = () => menu();
        } else {
            el.title = "Sign in or create an account";
            el.append(h("span.avatar.out", null, icon("gem")), h("span.who", null, h("b", null, "Sign in"), h("small", null, "Share themes and more")));
            el.onclick = () => openAccount("in");
        }
    };
    function menu() {
        document.querySelector(".account-menu")?.remove();
        const m = h("div.account-menu", { role: "menu" },
            h("p.muted", null, `Signed in as ${account.current().username}`),
            h("button", { type: "button", role: "menuitem", onclick: () => { m.remove(); location.hash = "themes"; } }, icon("sparkles"), "My themes"),
            h("button", { type: "button", role: "menuitem", onclick: async () => { m.remove(); await account.signOut(); toast("Signed out"); } }, icon("x"), "Sign out"));
        const r = el.getBoundingClientRect();
        Object.assign(m.style, { left: `${r.left}px`, bottom: `${window.innerHeight - r.top + 6}px`, minWidth: `${r.width}px` });
        document.body.appendChild(m);
        setTimeout(() => document.addEventListener("click", function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
    }
    paint(account.current());
    account.onChange(paint);
    return el;
}
