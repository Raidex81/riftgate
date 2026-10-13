// The Riftgate account in Riftgate 2: sign up, sign in, set a password,
// sign out, and restoring the session at start.
// One Riftgate account for both apps (same server). The password goes to
// the server once and is swapped for a session token; only that token is
// kept, encrypted with the OS (session.dat), and it never reaches the
// interface: the interface only ever learns the username.
"use strict";
const { safeStorage } = require("electron");
const { callAdminRpc, supabaseRequest } = require("../services/supabase");
const {
    readSessionFile, writeSessionFile, deleteSessionFile, createServerSession, revokeServerSession,
    ensureDeviceId, hasReservedAdminSuffix, currentSession
} = require("./core/session");

const R2_USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;

function register(ipcMain) {
    async function r2StartSession(username, password) {
        if (!safeStorage.isEncryptionAvailable()) return { ok: true, username, remembered: false };
        const created = await createServerSession(username, password);
        if (!created.ok) return created.refused ? { ok: false, error: "Wrong username or password." } : { ok: false, error: "Couldn't reach the server. Check your connection." };
        const previous = readSessionFile();
        if (previous && previous.token) revokeServerSession(previous.username, previous.token);
        writeSessionFile({ username, token: created.token });
        return { ok: true, username, remembered: true };
    }

    ipcMain.handle("r2-account-restore", async () => {
        const s = currentSession();
        if (!s) return { signedIn: false };
        const r = await callAdminRpc("redeem_login_session", { input_username: s.username, input_token: s.token });
        if (!r.success) return { signedIn: true, username: s.username, offline: true }; // can't check now: trust it until we can
        if (r.result !== true) { deleteSessionFile(); return { signedIn: false, expired: true }; }
        return { signedIn: true, username: s.username };
    });

    ipcMain.handle("r2-account-sign-in", async (event, { username, password } = {}) => {
        username = String(username || "").trim();
        if (!username || typeof password !== "string" || !password) return { ok: false, error: "Enter your username and password." };
        const setup = await callAdminRpc("login_needs_password_setup", { input_username: username });
        if (setup.success && setup.result === true) return { ok: false, needsSetup: true, username };
        return r2StartSession(username, password);
    });

    ipcMain.handle("r2-account-sign-up", async (event, { username, password, dateOfBirth } = {}) => {
        username = String(username || "").trim();
        if (!R2_USERNAME_RE.test(username)) return { ok: false, error: "Usernames are 3 to 24 letters, numbers, dots, dashes or underscores." };
        if (hasReservedAdminSuffix(username)) return { ok: false, error: "That ending is reserved for admins. Pick another username." };
        if (typeof password !== "string" || password.length < 8) return { ok: false, error: "Use at least 8 characters for your password." };
        if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return { ok: false, error: "That date of birth doesn't look right." };
        try {
            const taken = await supabaseRequest(`usernames?username=eq.${encodeURIComponent(username)}&select=id`, "GET");
            if (taken.statusCode === 200 && Array.isArray(taken.body) && taken.body.length) return { ok: false, error: "That username is taken. Try another." };
            const deviceId = await ensureDeviceId();
            const reg = await supabaseRequest("usernames", "POST", { username, device_id: deviceId, date_of_birth: dateOfBirth || null });
            if (reg.statusCode === 409) return { ok: false, error: "That username was just taken. Try another." };
            if (reg.statusCode !== 201) return { ok: false, error: "Couldn't create the account. Try again in a moment." };
            const pw = await callAdminRpc("set_own_login_password", { input_username: username, new_password: password, input_device_id: deviceId });
            if (!pw.success || pw.result !== true) return { ok: false, error: "Your username is saved, but the password wasn't. Sign in to set it." };
            return r2StartSession(username, password);
        } catch (err) {
            console.error("[account] sign-up failed:", err.message || err);
            return { ok: false, error: "Couldn't reach the server. Check your connection." };
        }
    });

    // An account registered in Riftgate without a password yet (same device only)
    ipcMain.handle("r2-account-set-password", async (event, { username, password } = {}) => {
        if (typeof password !== "string" || password.length < 8) return { ok: false, error: "Use at least 8 characters for your password." };
        const deviceId = await ensureDeviceId();
        const r = await callAdminRpc("set_own_login_password", { input_username: String(username || ""), new_password: password, input_device_id: deviceId });
        if (!r.success || r.result !== true) return { ok: false, error: "This account's password can only be set from the computer that created it." };
        return r2StartSession(String(username), password);
    });

    ipcMain.handle("r2-account-sign-out", async () => {
        const s = currentSession();
        if (s) await revokeServerSession(s.username, s.token);
        deleteSessionFile();
        return { ok: true };
    });
}

module.exports = { register };
