// Accounts, the part every section that signs in shares: the saved login
// session, this install's device id, which backend features the server has,
// and the usernames reserved for admins. Used by engine/account.js,
// engine/themes.js and the older login handlers still in main.js.
//
// Keeps the user logged in across app restarts — a password is only asked
// for again after an explicit Log Out, not just because the app was closed
// and reopened. The file is encrypted at rest with Electron's safeStorage
// (OS-level — DPAPI on Windows); if that isn't available on this machine the
// session is simply not persisted.
//
// On a backend that supports login sessions (get_backend_info
// schema_version >= 5) the file holds only a random session token that the
// server can revoke — never the password. Older backends still get the
// previous behaviour (the password itself, encrypted), and a password saved
// by an older app version is exchanged for a token the first time it's read.
"use strict";
const { safeStorage } = require("electron");
const fs = require("fs");
const crypto = require("crypto");
const { callAdminRpc } = require("../../services/supabase");
const data = require("./data");
const settings = require("./settings");

const sessionFile = () => data.file("session.dat");

const SESSION_TOKEN_MIN_SCHEMA = 5;
const SERVER_SIDE_EMAIL_MIN_SCHEMA = 6;
const DEVICE_BOUND_PASSWORD_MIN_SCHEMA = 3;

let cachedBackendInfo = null;

// Asks the server which hardened features it has. A server that predates the
// check (404) or can't be reached counts as version 0 — and isn't cached, so
// the next call asks again.
async function getBackendSchemaVersion() {
    if (cachedBackendInfo) return cachedBackendInfo.schema_version || 0;
    const r = await callAdminRpc("get_backend_info", {});
    if (r.success && r.result && typeof r.result === "object") {
        cachedBackendInfo = r.result;
        return cachedBackendInfo.schema_version || 0;
    }
    return 0;
}

function readSessionFile() {
    if (!fs.existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null;
    try {
        const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
        return parsed && parsed.username ? parsed : null;
    } catch (err) {
        // Corrupt, left over in plain text by an old version, or encrypted by
        // another Windows user profile — same as having no session.
        return null;
    }
}

function writeSessionFile(payload) {
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(payload)));
}

function deleteSessionFile() {
    if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
}

async function createServerSession(username, password) {
    const r = await callAdminRpc("create_login_session", { input_username: username, input_password: password });
    if (r.success && r.result && r.result.success && typeof r.result.token === "string") {
        return { ok: true, token: r.result.token };
    }
    // reachable-but-refused vs. network failure matters to the caller
    return { ok: false, refused: r.success };
}

function revokeServerSession(username, token) {
    // Best effort — an unreachable server just means the token expires on its own.
    return callAdminRpc("revoke_login_session", { input_username: username, input_token: token }).catch(() => null);
}

// This install's own device id (see get-device-id below), or null.
function readDeviceIdSync() {
    try {
        const current = JSON.parse(fs.readFileSync(data.file(settings.FILE), "utf8"));
        return typeof current.deviceId === "string" ? current.deviceId : null;
    } catch (err) {
        return null;
    }
}

// This install's device id, made (and saved) the first time it's needed.
async function ensureDeviceId() {
    const id = readDeviceIdSync();
    if (id) return id;
    let current = {};
    try { current = JSON.parse(fs.readFileSync(data.file(settings.FILE), "utf8")); } catch {}
    current.deviceId = crypto.randomUUID();
    fs.writeFileSync(data.file(settings.FILE), JSON.stringify(current, null, 2));
    return current.deviceId;
}

const RESERVED_USERNAME_SUFFIXES = ["_adm", "_root", "_admin", "_administrator"];

function hasReservedAdminSuffix(username) {
    const lower = username.toLowerCase();
    return RESERVED_USERNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

// The signed-in session ({ username, token }), or null.
function currentSession() {
    const s = readSessionFile();
    return s && typeof s.username === "string" && typeof s.token === "string" ? s : null;
}

module.exports = {
    SESSION_TOKEN_MIN_SCHEMA, SERVER_SIDE_EMAIL_MIN_SCHEMA, DEVICE_BOUND_PASSWORD_MIN_SCHEMA,
    getBackendSchemaVersion, readSessionFile, writeSessionFile, deleteSessionFile,
    createServerSession, revokeServerSession, readDeviceIdSync, ensureDeviceId,
    hasReservedAdminSuffix, currentSession
};
