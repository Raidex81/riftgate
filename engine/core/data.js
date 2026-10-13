// Riftgate's data folder (Electron's userData): where every section keeps its
// files, and the one way to read and write them. Writes go to a temporary file
// first and then replace the old one, so a crash mid-write never leaves a
// half-written file behind.
"use strict";
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const dir = () => app.getPath("userData");
const file = (name) => path.join(dir(), name);

function readJson(p, fallback = null) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (err) { return fallback; }
}

function writeJson(p, data) {
    const text = JSON.stringify(data, null, 2);
    try {
        const tmp = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, p);
        return true;
    } catch (err) {
        // a file another program holds open can refuse the rename: write it in place
        try { fs.writeFileSync(p, text); return true; } catch (e) {
            console.error(`[data] couldn't save ${path.basename(p)}:`, e.message || e);
            return false;
        }
    }
}

// Saved copies of online lists (cache-*.json), by name.
const loadCache = (name) => readJson(file(name), null);
const saveCache = (name, data) => writeJson(file(name), data);

module.exports = { dir, file, readJson, writeJson, loadCache, saveCache };
