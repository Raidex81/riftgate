// Saving pictures of Riftgate: a picture the app made (Rift Rewind's card,
// asking where, Pictures by default) and a screenshot of the window (Ctrl K →
// "Save a screenshot", straight into Pictures/Riftgate).
"use strict";
const { app, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const windowRef = require("./core/window");

function register(ipcMain) {
    ipcMain.handle("r2-save-image", async (event, { name, dataUrl } = {}) => {
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
        if (!m || m[1].length > 30e6) return { ok: false };
        const safe = String(name || "Riftgate").replace(/[^\w .-]+/g, "").slice(0, 80) || "Riftgate";
        const r = await dialog.showSaveDialog(windowRef.get(), { title: "Save picture", defaultPath: path.join(app.getPath("pictures"), `${safe}.png`), filters: [{ name: "PNG picture", extensions: ["png"] }] });
        if (r.canceled || !r.filePath) return { ok: false, canceled: true };
        fs.writeFileSync(r.filePath, Buffer.from(m[1], "base64"));
        return { ok: true, path: r.filePath };
    });

    ipcMain.handle("r2-capture-window", async () => {
        try {
            const win = windowRef.get();
            if (!win) return { ok: false };
            const img = await win.webContents.capturePage();
            const dir = path.join(app.getPath("pictures"), "Riftgate");
            fs.mkdirSync(dir, { recursive: true });
            const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            const file = path.join(dir, `Riftgate ${stamp}.png`);
            fs.writeFileSync(file, img.toPNG());
            return { ok: true, name: path.basename(file) };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}

module.exports = { register };
