// Riftgate 2 — Settings: region, look, your data.

import { h, icon, clear } from "../app/dom.js";
import { call, settings, saveSettings, forget } from "../app/api.js";
import * as journal from "../app/store.js";
import { toast } from "../components/toast.js";
import { plural } from "../app/format.js";

const COUNTRIES = [
    ["US", "United States"], ["GB", "United Kingdom"], ["PT", "Portugal"], ["BR", "Brazil"], ["ES", "Spain"], ["FR", "France"],
    ["DE", "Germany"], ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["IE", "Ireland"], ["CA", "Canada"],
    ["MX", "Mexico"], ["AR", "Argentina"], ["AU", "Australia"], ["NZ", "New Zealand"], ["JP", "Japan"], ["KR", "South Korea"],
    ["IN", "India"], ["PL", "Poland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
    ["CH", "Switzerland"], ["AT", "Austria"], ["TR", "Türkiye"], ["ZA", "South Africa"]
];
const ACCENTS = [
    ["rift", "Rift", "linear-gradient(135deg,#8b3dff,#e03cff)"],
    ["cyan", "Cyan", "linear-gradient(135deg,#2fb7ff,#7a5cff)"],
    ["ember", "Ember", "linear-gradient(135deg,#ff5a36,#ffb02e)"],
    ["crimson", "Crimson", "linear-gradient(135deg,#ff2f62,#ff2fd0)"],
    ["venom", "Venom", "linear-gradient(135deg,#2fe08a,#c6ff3d)"]
];

function setting(title, desc, control) {
    return h("section.setting", null, h("div.grow", null, h("h3", null, title), h("p", null, desc)), control);
}

export default {
    async render(root) {
        const s = await settings({ fresh: true });
        root.append(h("div.view-head", null, h("div", null, h("h1", null, "Settings"), h("p", null, "Your region, the look of Riftgate 2, and your data."))));
        const box = h("div.settings");
        root.appendChild(box);

        // Region
        const sel = h("select.input", { "aria-label": "Your country" }, COUNTRIES.map(([c, n]) => h("option", { value: c }, n)));
        if (!COUNTRIES.some(([c]) => c === s.country) && s.country) sel.prepend(h("option", { value: s.country }, s.country));
        sel.value = s.country || "US";
        sel.addEventListener("change", async () => {
            await saveSettings({ country: sel.value, movieCountry: sel.value, locationConfirmed: true });
            forget(""); toast("Region saved. Cinemas, streaming and prices now follow it.");
            setTimeout(() => location.reload(), 600);
        });
        box.appendChild(setting("Your region", "Cinemas, streaming services, release dates and store prices follow this country.", sel));

        // Accent
        const sw = h("div.swatches", { role: "group", "aria-label": "Accent colour" });
        const paintSw = () => {
            clear(sw);
            const cur = journal.pref("accent", "rift");
            ACCENTS.forEach(([id, name, bg]) => sw.appendChild(h("button", { type: "button", title: name, "aria-label": name, "aria-pressed": String(cur === id), style: { background: bg },
                onclick: async () => {
                    if (id === "rift") delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = id;
                    await journal.setPref("accent", id); paintSw();
                } })));
        };
        paintSw();
        box.appendChild(setting("Accent", "The colour of the rift: glows, selections and the portal follow it.", sw));

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
