// Riftgate 2 — Settings: region, look, your data.

import { h, icon, clear } from "../app/dom.js";
import { call, settings, saveSettings, forget } from "../app/api.js";
import * as journal from "../app/store.js";
import { toast } from "../components/toast.js";
import { plural } from "../app/format.js";
import { COUNTRIES } from "../app/regions.js";
import * as interests from "../app/interests.js";
import * as theme from "../app/theme.js";
import * as account from "../app/account.js";
import { openAccount } from "../components/account.js";
import { appVersion, isPreview, openWhatsNew, checkForUpdates } from "../components/whatsnew.js";
import * as gamepad from "../app/gamepad.js";

function setting(title, desc, control) {
    return h("section.setting", null, h("div.grow", null, h("h3", null, title), h("p", null, desc)), control);
}

export default {
    async render(root) {
        const s = await settings({ fresh: true });
        root.append(h("div.view-head", null, h("div", null, h("h1", null, "Settings"), h("p", null, "Your region, the look of Riftgate, and your data."))));
        const box = h("div.settings");
        root.appendChild(box);

        // About: version, what's new, updates
        const ver = await appVersion();
        box.appendChild(h("section.setting.about", null,
            h("img.about-gem", { src: "assets/riftgate-gem-mark.png", alt: "" }),
            h("div.grow", null, h("h3", null, `Riftgate ${ver}`),
                h("p", null, isPreview(ver) ? "A test version: it doesn't take automatic updates." : "Riftgate checks for updates when it starts and always asks before installing one.")),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
                h("button.btn", { type: "button", onclick: () => openWhatsNew() }, icon("bell"), "What's new"),
                h("button.btn", { type: "button", onclick: () => checkForUpdates() }, icon("refresh"), "Check for updates"),
                h("button.btn", { type: "button", onclick: () => { location.hash = "suggestions"; } }, icon("chat"), "Suggestions"))));

        // TV mode and controllers
        const tvSel = h("select.input", { "aria-label": "TV mode" },
            h("option", { value: "auto" }, "With a controller"), h("option", { value: "on" }, "Always on"), h("option", { value: "off" }, "Off"));
        tvSel.value = gamepad.tvMode();
        tvSel.addEventListener("change", () => { gamepad.setTvMode(tvSel.value); toast(tvSel.value === "on" ? "TV mode on" : tvSel.value === "off" ? "TV mode off" : "TV mode follows your controller"); });
        box.appendChild(setting("TV mode & controllers", "Play from the couch with an Xbox, PlayStation or Nintendo controller or a TV remote. TV mode makes everything bigger.",
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } }, tvSel,
                h("button.btn", { type: "button", onclick: () => gamepad.toggleControls(true) }, icon("app"), "Controls"))));

        // Interests
        box.appendChild(h("section.setting.wide", null,
            h("div.grow", null, h("h3", null, "Your interests"), h("p", null, "Riftgate leads with what you love. Anything set to “Not for me” leaves the menu and Nexus (still one Ctrl K away).")),
            interests.interestPicker()));

        // Region
        const sel = h("select.input", { "aria-label": "Your country" }, COUNTRIES.map(([c, n]) => h("option", { value: c }, n)));
        if (!COUNTRIES.some(([c]) => c === s.country) && s.country) sel.prepend(h("option", { value: s.country }, s.country));
        sel.value = s.country || "US";
        sel.addEventListener("change", async () => {
            await saveSettings({ country: sel.value, movieCountry: sel.value, locationConfirmed: true });
            forget(""); toast("Region saved. Cinemas, streaming and prices now follow it.");
            setTimeout(() => location.reload(), 600);
        });
        box.appendChild(setting("Your region", "Cinemas, streaming services, release dates and store prices follow this country. Set your city and streaming services in the Theatre.", sel));

        // Theme: quick picks, and the full Themes studio
        const sw = h("div.swatches", { role: "group", "aria-label": "Quick themes" });
        const paintSw = () => {
            clear(sw);
            const cur = theme.activeId();
            theme.BUILTIN_THEMES.slice(0, 8).forEach((t) => sw.appendChild(h("button", { type: "button", title: t.name, "aria-label": t.name, "aria-pressed": String(cur === t.id),
                style: { background: `linear-gradient(135deg, ${t.colors.accent}, ${t.colors.accent2})` },
                onclick: async () => { await theme.use(t.id); paintSw(); } })));
        };
        paintSw();
        box.appendChild(setting("Theme", `Now: ${theme.active().name}. Pick a quick one here, or open Themes for all of them, your own pictures, and themes made by other people.`,
            h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" } }, sw,
                h("button.btn", { type: "button", onclick: () => { location.hash = "themes"; } }, icon("sparkles"), "Open Themes"))));

        // Account
        const acct = h("div");
        const paintAcct = (st) => {
            clear(acct).appendChild(st.signedIn
                ? h("button.btn", { type: "button", onclick: async () => { await account.signOut(); toast("Signed out"); } }, icon("x"), `Sign out ${st.username}`)
                : h("button.btn.primary", { type: "button", onclick: () => openAccount("in") }, icon("gem"), "Sign in"));
        };
        paintAcct(account.current());
        const offAcct = account.onChange((st) => { if (!acct.isConnected) return offAcct(); paintAcct(st); });
        box.appendChild(setting("Your Riftgate account", "Optional: sign in to share your themes with everyone. Your password is never stored on this PC.", acct));

        // Row order
        const resetBtn = h("button.btn", { type: "button" }, icon("refresh"), "Restore default order");
        resetBtn.onclick = async () => {
            await Promise.all(["nexus", "free", "deals", "theatre", "reading"].map((v) => journal.setPref(`order:${v}`, null)));
            toast("Every section is back to its original row order");
        };
        box.appendChild(setting("Row order", "Drag any row by the grip beside its title (or focus the grip and press ↑ ↓) to reorder a section. Each section remembers its order.", resetBtn));

        // Import
        const info = await call("r2-riftgate-available");
        if (info && info.available) {
            const b = h("button.btn", { type: "button" }, icon("import"), info.alreadyImported ? "Import again" : "Import");
            b.onclick = async () => {
                b.disabled = true;
                const r = await call("r2-import-riftgate");
                if (r && r.ok) { toast("Your earlier Riftgate data is here"); forget(""); setTimeout(() => location.reload(), 600); }
                else { toast(`Import didn't finish: ${(r && r.error) || "unknown error"}`, "err"); b.disabled = false; }
            };
            box.appendChild(setting("Bring over your earlier Riftgate",
                `Copies your library (${plural(info.games, "item")}), ${plural(info.shows, "tracked show")}, ${plural(info.books, "book")}, settings and covers from your earlier version of Riftgate. It keeps working; nothing is moved.`, b));
        }

        // Steam playtime
        const steamIn = h("input.input", { type: "text", placeholder: "SteamID64", value: s.steamId64 || "", "aria-label": "SteamID64", style: { width: "200px" } });
        const steamBtn = h("button.btn", { type: "button" }, icon("refresh"), "Update playtime");
        steamBtn.onclick = async () => {
            // The ID used to be only saved, never handed to the engine, so the
            // engine always checked an empty ID. Pass it, and accept a pasted
            // profile link too (steamcommunity.com/profiles/7656…).
            const raw = steamIn.value.trim();
            const id = (/(\d{17})/.exec(raw.replace(/\s+/g, "")) || [])[1] || raw;
            if (id !== raw) steamIn.value = id;
            steamBtn.disabled = true;
            await saveSettings({ steamId64: id });
            const r = await call("refresh-steam-playtime", id);
            steamBtn.disabled = false;
            forget("load-games");
            window.dispatchEvent(new CustomEvent("r2-library-changed"));
            toast(r && r.success === false ? (r.error || "Steam playtime couldn't be read. Is your profile's game details public?") : "Steam playtime updated", r && r.success === false ? "err" : "ok");
        };
        box.appendChild(setting("Steam playtime", "Your public Steam profile's hours, shown on your games. Paste your SteamID64 (find it on steamid.io) or your Steam profile link.", h("div", { style: { display: "flex", gap: "8px" } }, steamIn, steamBtn)));

        // Data
        box.appendChild(setting("Your data", "Library, Journal, covers and settings live in Riftgate's data folder on this PC.",
            h("button.btn", { type: "button", onclick: () => call("open-data-folder") }, icon("folder"), "Open data folder")));
    }
};
