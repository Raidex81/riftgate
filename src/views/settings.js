// Riftgate — Settings: region, look, your data.

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
import * as look from "../app/look.js";
import * as gate from "../app/mature.js";
import * as facts from "../components/facts.js";
import { startTour } from "../components/tour.js";

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

        // The opening (same setting as Riftgate 1.x)
        const introSel = h("select.input", { "aria-label": "Opening animation" }, h("option", { value: "on" }, "Play it"), h("option", { value: "off" }, "Skip it"));
        introSel.value = s.startupAnimation === false ? "off" : "on";
        introSel.addEventListener("change", async () => { await saveSettings({ startupAnimation: introSel.value === "on" }); toast(introSel.value === "on" ? "The opening plays next time Riftgate starts" : "Riftgate opens straight onto Nexus"); });
        const preview = h("button.btn", { type: "button", onclick: async () => {
            const el = document.createElement("div"); el.id = "intro"; el.className = "intro"; el.setAttribute("aria-hidden", "true"); el.appendChild(document.createElement("canvas"));
            document.body.appendChild(el);
            try { sessionStorage.removeItem("r2-intro"); } catch (e) { /* ignore */ }
            const { playIntro } = await import("../components/intro.js?again=" + Date.now());
            playIntro({ enabled: true });
        } }, icon("play"), "Watch it now");
        box.appendChild(setting("Opening animation", "The rift opening as Riftgate starts (5 seconds; any click or key skips it). Only on a real start, never on a reload.",
            h("div", { style: { display: "flex", gap: "8px" } }, introSel, preview)));

        // Cards: size, and colour by kind
        const sizeSeg = h("div.seg.card-sizes", { role: "group", "aria-label": "Card size" });
        const paintSize = () => sizeSeg.replaceChildren(...look.SIZES.map((z) => h("button", { type: "button", "aria-pressed": String(look.cardSize() === z.id),
            onclick: async () => { await look.setCardSize(z.id); paintSize(); } }, h("i.cs-demo", { style: { width: `${Math.round(14 * z.scale)}px`, height: `${Math.round(21 * z.scale)}px` } }), h("b", null, z.label))));
        paintSize();
        const tc = h("input", { type: "checkbox", checked: look.typeColours(), "aria-label": "Colour cards by kind" });
        tc.addEventListener("change", () => look.setTypeColours(tc.checked));
        const legend = h("span.type-legend", null, ["game", "film", "series", "anime", "book", "app"].map((t) => h("span.type", { dataset: { t } }, { game: "Games", film: "Films", series: "Series", anime: "Anime", book: "Books", app: "Apps" }[t])));
        box.appendChild(setting("Cards", "How big the cards are everywhere, and whether each one wears the colour of what it is.",
            h("div.cards-setting", null, sizeSeg, h("label.check", null, tc, h("span", null, "Colour by kind")), legend)));

        // Did you know? and the tour
        const fx = h("input", { type: "checkbox", checked: facts.enabled(), "aria-label": "Show Did you know?" });
        fx.addEventListener("change", async () => { await facts.setEnabled(fx.checked); facts.mountFacts(document.getElementById("app")); toast(fx.checked ? "Did you know? is back along the bottom" : "Did you know? is off"); });
        box.appendChild(setting("Did you know?", "A fact from the world you're in, along the bottom of Riftgate: games, films and series, or books.",
            h("label.check", null, fx, h("span", null, "Show facts"))));
        box.appendChild(setting("The tour", "A quick walk through Riftgate, step by step.",
            h("button.btn", { type: "button", onclick: () => { location.hash = "nexus"; setTimeout(() => startTour(), 500); } }, icon("compass"), "Take the tour")));

        // Mature titles (the age gate, tied to your account like in Riftgate 1.x)
        const mat = h("div.mature-setting");
        const paintMature = () => {
            const st = gate.state();
            clear(mat);
            if (!st.signedIn) { mat.append(h("button.btn", { type: "button", onclick: () => openAccount("in") }, icon("gem"), "Sign in")); return; }
            if (st.admin) { mat.append(h("span.muted", null, "Admins see everything. Admin → See Riftgate as… shows what others see.")); return; }
            if (!st.dateOfBirth) {
                const dob = h("input.input", { type: "date", max: new Date().toISOString().slice(0, 10), "aria-label": "Your date of birth" });
                const save = h("button.btn", { type: "button", onclick: async () => {
                    if (!dob.value) return dob.focus();
                    const r = await gate.setDateOfBirth(dob.value);
                    toast(r && r.success ? "Date of birth saved to your account" : (r && r.error) || "It couldn't be saved", r && r.success ? "ok" : "err");
                    paintMature();
                } }, icon("check"), "Save");
                mat.append(dob, save); return;
            }
            if (!st.adult) { mat.append(h("span.muted", null, "Mature titles stay hidden until you're 18.")); return; }
            const cb = h("input", { type: "checkbox", checked: st.showMatureContent, "aria-label": "Show mature titles" });
            cb.addEventListener("change", async () => {
                const r = await gate.setShowMature(cb.checked);
                if (!r || !r.success) { cb.checked = !cb.checked; toast((r && r.error) || "That couldn't be saved", "err"); }
                else toast(cb.checked ? "Mature titles now show" : "Mature titles are hidden");
            });
            mat.append(h("label.check", null, cb, h("span", null, "Show mature titles")));
        };
        paintMature();
        const offGate = gate.onChange(() => { if (!mat.isConnected) return offGate(); paintMature(); });
        box.appendChild(setting("Mature titles", "Films, series and books flagged as mature only show to adults who turn them on, from the date of birth on your Riftgate account. Saved with your account, so it follows you.", mat));

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
            await settings({ fresh: true }); // the new Steam hours live in the settings
            window.dispatchEvent(new CustomEvent("r2-library-changed"));
            toast(r && r.success === false ? (r.error || "Steam playtime couldn't be read. Is your profile's game details public?") : "Steam playtime updated", r && r.success === false ? "err" : "ok");
        };
        box.appendChild(setting("Steam playtime", "Your public Steam profile's hours, shown on your games. Paste your SteamID64 (find it on steamid.io) or your Steam profile link.", h("div", { style: { display: "flex", gap: "8px" } }, steamIn, steamBtn)));

        // Data
        box.appendChild(setting("Your data", "Library, Journal, covers and settings live in Riftgate's data folder on this PC.",
            h("button.btn", { type: "button", onclick: () => call("open-data-folder") }, icon("folder"), "Open data folder")));
    }
};
