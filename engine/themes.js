// Themes: pictures and theme files through the system file dialogs, and the
// community gallery.
// Pictures and theme files come through the system file dialogs; the
// community gallery lives in public.r2_themes (supabase migration 0009).
// Publishing is checked against the signed-in session on the server.
"use strict";
const { dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { callAdminRpc, supabaseRequest } = require("../services/supabase");
const { currentSession } = require("./core/session");
const windowRef = require("./core/window");

const R2_IMAGE_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp", ".avif": "image/avif" };
function r2ThemesMissing(res) {
    const b = res && res.body;
    return res && (res.statusCode === 404 || (b && (b.code === "42P01" || b.code === "PGRST205" || b.code === "PGRST202")));
}

function register(ipcMain) {
    ipcMain.handle("r2-theme-pick-picture", async () => {
        const r = await dialog.showOpenDialog(windowRef.get(), { title: "Choose a picture for your theme", properties: ["openFile"], filters: [{ name: "Pictures", extensions: Object.keys(R2_IMAGE_TYPES).map((e) => e.slice(1)) }] });
        if (r.canceled || !r.filePaths[0]) return null;
        const file = r.filePaths[0];
        const type = R2_IMAGE_TYPES[path.extname(file).toLowerCase()];
        if (!type) return { error: "That isn't a picture Riftgate can use." };
        if (fs.statSync(file).size > 30 * 1024 * 1024) return { error: "That picture is over 30 MB. Pick a smaller one." };
        return { dataUrl: `data:${type};base64,${fs.readFileSync(file).toString("base64")}`, name: path.basename(file) };
    });
    ipcMain.handle("r2-theme-export", async (event, { name, theme } = {}) => {
        const safe = String(name || "theme").replace(/[^\w .-]+/g, "").trim().slice(0, 60) || "theme";
        const r = await dialog.showSaveDialog(windowRef.get(), { title: "Share this theme as a file", defaultPath: `${safe}.riftgate-theme`, filters: [{ name: "Riftgate theme", extensions: ["riftgate-theme"] }] });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        fs.writeFileSync(r.filePath, JSON.stringify({ riftgateTheme: 1, theme }, null, 1));
        return { ok: true, path: r.filePath };
    });
    ipcMain.handle("r2-theme-import", async () => {
        const r = await dialog.showOpenDialog(windowRef.get(), { title: "Open a Riftgate theme", properties: ["openFile"], filters: [{ name: "Riftgate theme", extensions: ["riftgate-theme", "json"] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        try {
            if (fs.statSync(r.filePaths[0]).size > 40 * 1024 * 1024) return { error: "That file is too big to be a theme." };
            const data = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
            if (!data || data.riftgateTheme !== 1 || typeof data.theme !== "object") return { error: "That file isn't a Riftgate theme." };
            return { theme: data.theme };
        } catch (err) {
            return { error: "That file couldn't be read as a theme." };
        }
    });
    ipcMain.handle("r2-themes-gallery", async (event, { sort, query, page } = {}) => {
        const order = sort === "new" ? "created_at.desc" : "uses.desc,created_at.desc";
        const p = Math.max(0, Math.min(200, parseInt(page, 10) || 0));
        let q = `r2_themes?select=id,author,name,theme,thumb,uses,created_at&order=${order}&limit=48&offset=${p * 48}`;
        const text = String(query || "").replace(/[^\w .-]/g, "").trim().slice(0, 40);
        if (text) q += `&or=(name.ilike.*${encodeURIComponent(text)}*,author.ilike.*${encodeURIComponent(text)}*)`;
        try {
            const res = await supabaseRequest(q, "GET");
            if (r2ThemesMissing(res)) return { available: false, themes: [] };
            if (res.statusCode !== 200 || !Array.isArray(res.body)) return { available: true, themes: [], error: "The gallery didn't answer. Try again in a moment." };
            return { available: true, themes: res.body };
        } catch (err) {
            return { available: true, themes: [], error: "Couldn't reach the gallery. Check your connection." };
        }
    });
    ipcMain.handle("r2-theme-download", async (event, id) => {
        const n = parseInt(id, 10);
        if (!(n > 0)) return null;
        try {
            const res = await supabaseRequest(`r2_themes?id=eq.${n}&select=wallpaper`, "GET");
            supabaseRequest("rpc/r2_use_theme", "POST", { p_id: n }).catch(() => {});
            return { wallpaper: res.statusCode === 200 && Array.isArray(res.body) && res.body[0] ? res.body[0].wallpaper || null : null };
        } catch (err) {
            return { wallpaper: null };
        }
    });
    ipcMain.handle("r2-theme-publish", async (event, { name, theme, thumb, wallpaper } = {}) => {
        const s = currentSession();
        if (!s) return { ok: false, signIn: true, error: "Sign in to share themes with everyone." };
        const json = JSON.stringify(theme || {});
        if (json.length > 16000) return { ok: false, error: "This theme has too much in it to share." };
        if (wallpaper && String(wallpaper).length > 700000) return { ok: false, error: "The picture is too large to share. Try a smaller one." };
        const r = await callAdminRpc("r2_publish_theme", {
            input_username: s.username, input_token: s.token,
            p_name: String(name || "").trim().slice(0, 40), p_theme: theme || {},
            p_thumb: thumb || null, p_wallpaper: wallpaper || null
        });
        if (!r.success) return { ok: false, error: r.error && /function|schema/i.test(String(r.error)) ? "The community gallery isn't switched on yet." : "Couldn't share the theme. Try again in a moment." };
        const out = r.result || {};
        return out.success ? { ok: true, id: out.id } : { ok: false, error: out.error || "Couldn't share the theme." };
    });
    ipcMain.handle("r2-theme-unpublish", async (event, id) => {
        const s = currentSession();
        if (!s) return { ok: false, signIn: true };
        const r = await callAdminRpc("r2_delete_theme", { input_username: s.username, input_token: s.token, p_id: parseInt(id, 10) || 0 });
        return { ok: !!(r.success && r.result === true) };
    });
}

module.exports = { register };
