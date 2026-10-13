// The opt-in usage count (supabase/migrations/..._usage_pings.sql).
// Only with a yes in Settings: once a week, "a PC opened Riftgate" (a random
// id made here, the version, win/mac). Nothing about the person, nothing else.
"use strict";
const { app } = require("electron");
const crypto = require("crypto");
const { callAdminRpc } = require("../services/supabase");
const settings = require("./core/settings");

// the Monday of this week, as YYYY-MM-DD
function week(d = new Date()) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return m.toISOString().slice(0, 10);
}

async function ping() {
    const s = settings.read();
    if (s.usageStats !== true) return;
    const w = week();
    if (s.usageLastWeek === w) return;
    const id = /^[0-9a-f]{32}$/.test(s.usageId || "") ? s.usageId : crypto.randomBytes(16).toString("hex");
    const r = await callAdminRpc("r2_usage_ping", { p_install: id, p_version: String(app.getVersion()).slice(0, 20), p_platform: process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux" });
    if (r && r.success && r.result === true) settings.update({ usageId: id, usageLastWeek: w });
}

function register(ipcMain) {
    setTimeout(() => ping().catch(() => {}), 2 * 60 * 1000);
    setInterval(() => ping().catch(() => {}), 6 * 3600e3);
    ipcMain.handle("r2-usage-ping-now", async () => { await ping().catch(() => {}); return true; });
    ipcMain.handle("r2-usage-weekly", async (event, { username, password } = {}) => {
        if (typeof username !== "string" || typeof password !== "string") return { success: false, error: "Sign in as an admin." };
        return callAdminRpc("r2_usage_weekly", { input_username: username, input_password: password });
    });
}

module.exports = { register, week };
