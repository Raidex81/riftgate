// Riftgate 2's own data: the cross-media Journal (status, rating, progress
// and a note for any game, film, series, anime or book) and interface
// preferences. Kept in one JSON file in the app's data folder, written
// atomically (temp file + rename) so a crash mid-save can't corrupt it.
//
// Also the one-time "Import from Riftgate": copies (never moves or shares)
// the original app's library, shows, books, settings and covers into this
// app's own data folder, so Riftgate 2 starts with the user's real data
// while the original keeps working untouched.

const fs = require("fs");
const path = require("path");

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SECTIONS = new Set(["journal", "prefs"]);
const KEY_RE = /^[a-z]+:[^\s]{1,400}$/i;

// Files from the original Riftgate worth bringing over (user data only —
// caches are rebuilt fresh so Riftgate 2's richer data, like film
// backdrops, comes in from the start).
const IMPORT_FILES = ["games.json", "watchlist.json", "ebooks.json", "settings.json", "overrides.json", "trailer-cache.json", "freegames-vr.json", "freegames-verified.json"];
const IMPORT_FOLDERS = ["covers", "downloaded-ebooks"];

function register(ipcMain, app) {
    const dataFile = () => path.join(app.getPath("userData"), "r2-data.json");

    const read = () => {
        try {
            const raw = fs.readFileSync(dataFile(), "utf8");
            const data = JSON.parse(raw);
            return { journal: data.journal || {}, prefs: data.prefs || {} };
        } catch (err) {
            return { journal: {}, prefs: {} };
        }
    };
    const write = (data) => {
        const json = JSON.stringify(data);
        if (Buffer.byteLength(json) > MAX_FILE_BYTES) throw new Error("Riftgate 2 data is too large");
        const tmp = dataFile() + ".tmp";
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, dataFile());
    };

    ipcMain.handle("r2-store-get", () => read());

    // set: { section: "journal"|"prefs", key, value } — value null deletes.
    ipcMain.handle("r2-store-set", (event, args) => {
        const { section, key, value } = args || {};
        if (!SECTIONS.has(section) || typeof key !== "string" || !KEY_RE.test(key)) return { ok: false, error: "Invalid key" };
        if (value !== null && (typeof value !== "object" || Array.isArray(value))) return { ok: false, error: "Invalid value" };
        if (value && JSON.stringify(value).length > 20000) return { ok: false, error: "Entry too large" };
        const data = read();
        if (value === null) delete data[section][key];
        else data[section][key] = { ...value, updatedAt: Date.now() };
        try { write(data); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
    });

    const originalDataDirs = () => {
        const appData = app.getPath("appData");
        return ["Riftgate", "riftgate"].map((n) => path.join(appData, n))
            .filter((d, i, all) => all.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i)
            .filter((d) => path.resolve(d).toLowerCase() !== path.resolve(app.getPath("userData")).toLowerCase())
            .filter((d) => fs.existsSync(path.join(d, "games.json")) || fs.existsSync(path.join(d, "settings.json")));
    };

    const countJson = (file) => {
        try { const v = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(v) ? v.length : 1; } catch (err) { return 0; }
    };

    ipcMain.handle("r2-riftgate-available", () => {
        const dir = originalDataDirs()[0];
        if (!dir) return { available: false };
        return {
            available: true,
            games: countJson(path.join(dir, "games.json")),
            shows: countJson(path.join(dir, "watchlist.json")),
            books: countJson(path.join(dir, "ebooks.json")),
            alreadyImported: !!read().prefs["import:riftgate"]
        };
    });

    ipcMain.handle("r2-import-riftgate", () => {
        const dir = originalDataDirs()[0];
        if (!dir) return { ok: false, error: "Riftgate's data folder wasn't found on this computer." };
        const dest = app.getPath("userData");
        const copied = [];
        try {
            for (const f of IMPORT_FILES) {
                const src = path.join(dir, f);
                if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dest, f)); copied.push(f); }
            }
            for (const folder of IMPORT_FOLDERS) {
                const src = path.join(dir, folder);
                if (fs.existsSync(src)) { fs.cpSync(src, path.join(dest, folder), { recursive: true, force: false, errorOnExist: false }); copied.push(folder + "/"); }
            }
            const data = read();
            data.prefs["import:riftgate"] = { at: Date.now(), from: dir, copied };
            write(data);
            return { ok: true, copied };
        } catch (err) {
            return { ok: false, error: err.message, copied };
        }
    });
}

module.exports = { register };
