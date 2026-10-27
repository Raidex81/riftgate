// Riftgate — Settings → Your data: back up everything that is yours into one
// file, put a backup back (on this PC or a new one), and keep a copy
// automatically in a folder you choose, such as OneDrive or Dropbox
// (engine/backup.js does the work).

import { h, icon, clear } from "../app/dom.js";
import { call } from "../app/api.js";
import { toast } from "./toast.js";
import { plural } from "../app/format.js";

const size = (b) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

// "30 games and apps, 104 eBooks, 6 shows…"
function what(c = {}) {
    const parts = [];
    if (c.library) parts.push(plural(c.library, "game or app", "games and apps"));
    if (c.journal) parts.push(plural(c.journal, "Journal entry", "Journal entries"));
    if (c.shows) parts.push(plural(c.shows, "show"));
    if (c.ebooks) parts.push(plural(c.ebooks, "eBook"));
    if (c.wishlist) parts.push(plural(c.wishlist, "wishlist game"));
    if (c.pictures) parts.push(plural(c.pictures, "cover"));
    return parts.join(", ");
}

// Asks before a backup replaces what's here, then restores and restarts.
function confirmRestore(b) {
    const date = b.createdAt ? new Date(b.createdAt) : null;
    const go = h("button.btn.primary", { type: "button" }, icon("refresh"), "Restore and restart");
    const stay = h("button.btn", { type: "button" }, "Cancel");
    const note = h("p.muted", { role: "status" });
    const games = Array.isArray(b.saves) ? b.saves : [];
    const putSaves = h("input", { type: "checkbox", checked: true });
    const savesPick = games.length ? h("label.check.backup-saves-pick", null, putSaves, h("span", null,
        `Put back the game saves too (${games.length === 1 ? games[0] : `${games.length} games: ${games.slice(0, 4).join(", ")}${games.length > 4 ? "…" : ""}`}). The saves on this PC now are kept aside first.`)) : null;
    const box = h("div.wn-box.backup-box", null,
        h("div.wn-head", null, h("h2", null, "Restore this backup?"),
            h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: () => close() }, icon("x"))),
        h("p", null, h("b", null, b.name)),
        h("p.muted", null, [date ? `Made ${date.toLocaleString()}` : null, b.appVersion ? `with Riftgate ${b.appVersion}` : null].filter(Boolean).join(" ")),
        what(b.counts) ? h("p", null, what(b.counts), b.ebooks ? ", with the eBook files" : "") : null,
        savesPick,
        h("p.muted", null, "Your Library, Journal, shows, eBooks list, wishlist, themes and settings are replaced by the ones in the backup. What you have now is kept in a before-restore folder in the data folder, just in case. Your sign-in stays as it is. Riftgate restarts when it's done."),
        note,
        h("div.backup-actions", null, stay, go));
    const wrap = h("div.wn-modal", { role: "dialog", "aria-modal": "true", "aria-label": "Restore a backup", onclick: (e) => { if (e.target === wrap && !go.disabled) close(); } }, box);
    const onKey = (e) => { if (e.key === "Escape" && !go.disabled) { e.stopPropagation(); close(); } };
    function close() { document.removeEventListener("keydown", onKey, true); wrap.remove(); }
    stay.onclick = close;
    go.onclick = async () => {
        go.disabled = stay.disabled = true;
        note.textContent = "Restoring…";
        const r = await call("r2-backup-restore", b.path, { gameSaves: !!(games.length && putSaves.checked) }).catch((err) => ({ ok: false, error: err.message }));
        if (r && r.ok) { note.textContent = "Done. Riftgate is restarting…"; return; }
        go.disabled = stay.disabled = false;
        note.textContent = (r && r.error) || "The backup couldn't be restored.";
    };
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(wrap);
    go.focus();
}

export function backupSetting() {
    const summary = h("p");
    const withBooks = h("input", { type: "checkbox" });
    const backupBtn = h("button.btn.primary", { type: "button" }, icon("download"), "Back up now");
    const restoreBtn = h("button.btn", { type: "button" }, icon("upload"), "Restore from a backup…");
    const autoLine = h("p.muted.backup-auto-line");
    const autoBtn = h("button.btn", { type: "button" });
    const autoOff = h("button.btn.ghost", { type: "button", hidden: true }, "Stop");
    const autoBooks = h("input", { type: "checkbox" });
    const autoBooksLabel = h("label.check", { hidden: true }, autoBooks, h("span", null, "Include the eBook files in the automatic copies"));
    // game saves
    const withSaves = h("input", { type: "checkbox", checked: true });
    const savesLine = h("p.muted.backup-saves-line", null, "Riftgate finds the save files of the games in your Library and keeps them in your backups, so a new PC or a reinstall doesn't lose your progress.");
    const findBtn = h("button.btn", { type: "button" }, icon("search"), "Look for my game saves");
    const paintSaves = (r) => {
        if (!r || !Array.isArray(r.games)) return;
        const total = r.games.reduce((n, g) => n + (g.bytes || 0), 0);
        savesLine.textContent = r.games.length
            ? `Found for ${plural(r.games.length, "game")} (${size(total)}): ${r.games.slice(0, 8).map((g) => g.name).join(", ")}${r.games.length > 8 ? "…" : ""}.`
            : "No save files found for the games in your Library yet. Games that keep their saves only in the cloud, or in the registry, aren't included.";
    };
    call("r2-saves-status").then(paintSaves).catch(() => {});
    findBtn.onclick = async () => {
        findBtn.disabled = true;
        savesLine.textContent = "Looking… The first time, Riftgate downloads the list of where games keep their saves (about 18 MB).";
        const r = await call("r2-saves-scan").catch((err) => ({ ok: false, error: err.message }));
        findBtn.disabled = false;
        if (r && r.ok) paintSaves(r); else savesLine.textContent = (r && r.error) || "Riftgate couldn't look for your game saves.";
    };
    withSaves.addEventListener("change", () => call("r2-backup-auto-folder", { gameSaves: withSaves.checked }).catch(() => {}));

    const paint = (st) => {
        if (!st) return;
        const c = st.now && st.now.counts;
        summary.textContent = what(c) ? `A backup holds ${what(c)} and your settings (about ${size(st.now.bytes)}).` : "A backup holds your Library, Journal, shows, eBooks list, wishlist, themes and settings.";
        withBooks.parentElement.lastChild.textContent = st.ebookBytes > (st.now ? st.now.bytes : 0) ? `Include the eBook files (adds about ${size(st.ebookBytes - st.now.bytes)})` : "Include the eBook files";
        clear(autoBtn).append(icon("folder"), st.folder ? "Change folder" : "Choose a folder…");
        autoOff.hidden = !st.folder;
        autoBooksLabel.hidden = !st.folder;
        autoBooks.checked = !!st.ebooks;
        withSaves.checked = st.gameSaves !== false;
        autoLine.textContent = st.folder ? `A copy goes into ${st.folder} once a day (the last 5 are kept)${st.lastAt ? `. Last one: ${new Date(st.lastAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` : "."}` : "Choose a folder, such as OneDrive or Dropbox, and Riftgate puts a backup there once a day, keeping the last 5. If this PC ever breaks, your data is waiting.";
    };
    const refresh = () => call("r2-backup-status").then(paint).catch(() => {});

    backupBtn.onclick = async () => {
        backupBtn.disabled = true;
        if (withSaves.checked) savesLine.textContent = "Backing up, game saves included…";
        const r = await call("r2-backup-create", { ebooks: withBooks.checked, gameSaves: withSaves.checked }).catch((err) => ({ ok: false, error: err.message }));
        if (withSaves.checked) call("r2-saves-status").then(paintSaves).catch(() => {});
        backupBtn.disabled = false;
        if (r && r.ok) toast(r.counts && r.counts.saves ? `Backed up (${size(r.bytes)}), with the saves of ${plural(r.counts.saves, "game")}` : `Backed up (${size(r.bytes)})`, "ok");
        else if (!(r && r.canceled)) toast((r && r.error) || "The backup couldn't be saved", "err");
    };
    restoreBtn.onclick = async () => {
        const b = await call("r2-backup-pick").catch((err) => ({ ok: false, error: err.message }));
        if (b && b.ok) confirmRestore(b);
        else if (!(b && b.canceled)) toast((b && b.error) || "That backup couldn't be read", "err");
    };
    autoBtn.onclick = async () => {
        autoBtn.disabled = true;
        const st = await call("r2-backup-auto-folder").catch(() => null);
        autoBtn.disabled = false;
        paint(st);
        if (st && st.folder && st.lastAt && Date.now() - st.lastAt < 60e3) toast("The first copy is in your folder", "ok");
    };
    autoOff.onclick = async () => { paint(await call("r2-backup-auto-folder", { off: true }).catch(() => null)); toast("Automatic copies are off"); };
    autoBooks.addEventListener("change", async () => paint(await call("r2-backup-auto-folder", { ebooks: autoBooks.checked }).catch(() => null)));

    const el = h("section.setting.wide.backup-setting", null,
        h("div.grow", null, h("h3", null, "Back up and restore"), summary,
            h("p", null, "Covers Riftgate can download again and your sign-in aren't included. Restore a backup here or on a new PC.")),
        h("div.backup-actions", null, backupBtn, restoreBtn, h("label.check", null, withBooks, h("span", null, "Include the eBook files"))),
        h("div.backup-auto", null, h("h4", null, "Game saves"), savesLine,
            h("div.backup-actions", null, h("label.check", null, withSaves, h("span", null, "Include game saves in every backup")), findBtn),
            h("small.muted", null, "Where games keep their saves comes from the Ludusavi manifest, built from PCGamingWiki.")),
        h("div.backup-auto", null, h("h4", null, "Keep a copy automatically"), autoLine,
            h("div.backup-actions", null, autoBtn, autoOff, autoBooksLabel)));
    refresh();
    return el;
}
