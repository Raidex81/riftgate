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

function setting(title, desc, control) {
    return h("section.setting", null, h("div.grow", null, h("h3", null, title), h("p", null, desc)), control);
}

export default {
    async render(root) {
        const s = await settings({ fresh: true });
        root.append(h("div.view-head", null, h("div", null, h("h1", null, "Settings"), h("p", null, "Your region, the look of Riftgate 2, and your data."))));
        const box = h("div.settings");
        root.appendChild(box);

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
        box.appendChild(setting("Your Riftgate account", "One account for Riftgate and Riftgate 2. Optional: sign in to share your themes with everyone. Your password is never stored on this PC.", acct));

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
                if (r && r.ok) { toast("Imported from Riftgate"); forget(""); setTimeout(() => location.reload(), 600); }
                else { toast(`Import didn't finish: ${(r && r.error) || "unknown error"}`, "err"); b.disabled = false; }
            };
            box.appendChild(setting("Import from Riftgate",
                `Copies your library (${plural(info.games, "item")}), ${plural(info.shows, "tracked show")}, ${plural(info.books, "book")}, settings and covers. The original Riftgate keeps working; nothing is moved.`, b));
        }

        // Steam playtime
        const steamIn = h("input.input", { type: "text", placeholder: "SteamID64", value: s.steamId64 || "", "aria-label": "SteamID64", style: { width: "200px" } });
        const steamBtn = h("button.btn", { type: "button" }, icon("refresh"), "Update playtime");
        steamBtn.onclick = async () => {
            steamBtn.disabled = true;
            await saveSettings({ steamId64: steamIn.value.trim() });
            const r = await call("refresh-steam-playtime");
            steamBtn.disabled = false;
            forget("load-games");
            toast(r && r.success === false ? (r.error || "Steam playtime couldn't be read. Is your profile's game details public?") : "Steam playtime updated", r && r.success === false ? "err" : "ok");
        };
        box.appendChild(setting("Steam playtime", "Your public Steam profile's hours, shown on your games. Find your SteamID64 on steamid.io.", h("div", { style: { display: "flex", gap: "8px" } }, steamIn, steamBtn)));

        // Data
        box.appendChild(setting("Your data", "Library, Journal, covers and settings live in Riftgate 2's own folder on this PC.",
            h("button.btn", { type: "button", onclick: () => call("open-data-folder") }, icon("folder"), "Open data folder")));
    }
};
