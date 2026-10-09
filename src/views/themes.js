// Riftgate — Themes: pick one of the built-in themes, make your own in the
// studio (colours, surface, pattern, font, glow, your own picture) with the
// whole app as the live preview, share it as a file or with everyone in the
// community gallery, and use themes other people made.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call } from "../app/api.js";
import * as T from "../app/theme.js";
import * as account from "../app/account.js";
import { openAccount } from "../components/account.js";
import { toast } from "../components/toast.js";
import { plural, ago } from "../app/format.js";

const COLOR_LABELS = { bg: "Background", panel: "Panels", card: "Cards", hover: "Hover", line: "Lines", accent: "Accent", accent2: "Accent 2", text: "Text", muted: "Muted text" };

export default {
    async render(root, ctx = {}) {
        await T.loadMine();
        let tab = "collection";
        const tabsEl = h("div.theme-tabs", { role: "tablist" });
        const body = h("div");
        const importBtn = h("button.btn", { type: "button", onclick: importFile }, icon("import"), "Open a theme file");
        const newBtn = h("button.btn.primary", { type: "button", onclick: () => studio(T.draft()) }, icon("plus"), "Create a theme");
        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Themes"), h("p", null, "Make Riftgate look like you: colours, surfaces, patterns, fonts and your own pictures. Share yours, try other people's.")),
                h("div.actions", null, importBtn, newBtn)),
            tabsEl, body);

        function tabs() {
            clear(tabsEl);
            [["collection", "Collection", "grid"], ["studio", "Studio", "sparkles"], ["community", "Community", "globe"]].forEach(([id, label, ico]) =>
                tabsEl.appendChild(h("button.chip.lg", { type: "button", role: "tab", "aria-pressed": String(tab === id), "aria-selected": String(tab === id),
                    onclick: () => { if (id === "studio") studio(T.draft()); else if (id === "community") community(); else collection(); } }, icon(ico), label)));
        }

        // ---- Collection -------------------------------------------------------------
        function themeCard(t, { community: c } = {}) {
            const isActive = !c && T.activeId() === t.id;
            const tileEl = T.tile(t, { thumb: c ? c.thumb : null });
            const actions = h("div.tc-actions");
            const el = h("div.theme-card", { class: isActive ? "is-active" : undefined },
                tileEl,
                h("div.tc-head", null, h("b", null, t.name), isActive ? h("span.badge", null, icon("check"), "In use") : null,
                    !c && t.publishedId ? h("span.tc-shared", { title: "In the community gallery" }, icon("globe"), "Shared") : null,
                    h("span.muted", null, c ? `by ${c.author} · ${plural(c.uses || 0, "use")}` : (t.builtin ? "Built in" : (t.author ? `by ${t.author}` : "Yours")))),
                h("p.tc-blurb", null, t.blurb || (c ? `Shared ${ago(Date.parse(c.created_at))}` : `${cap(t.surface)} · ${t.pattern === "none" ? "no pattern" : t.pattern} · ${(T.FONTS[t.font] || T.FONTS.rift).label}`)),
                actions);
            if (c) {
                const get = h("button.btn.primary", { type: "button" }, icon("download"), "Use it");
                get.onclick = async () => {
                    get.disabled = true;
                    const r = await call("r2-theme-download", c.id);
                    const theme = { ...sanitize(c.theme), name: c.name, author: c.author, communityId: c.id };
                    const w = (c.theme && c.theme.wallpaper) || {};
                    if (r && r.wallpaper) theme.wallpaper = { dim: Number(w.dim) || 55, blur: Number(w.blur) || 0, mode: T.wpMode(w.mode), pos: ["top", "center", "bottom"].includes(w.pos) ? w.pos : "center", src: r.wallpaper };
                    else theme.wallpaper = null;
                    const saved = await T.saveTheme(theme);
                    await T.use(saved.id);
                    toast(`${c.name} by ${c.author} is now your theme`);
                    get.disabled = false;
                };
                actions.append(get);
                tileEl.onclick = () => get.click();
                return el;
            }
            tileEl.onclick = () => use(t);
            if (!isActive) actions.append(h("button.btn.primary", { type: "button", onclick: () => use(t) }, icon("check"), "Use"));
            actions.append(h("button.btn", { type: "button", onclick: () => studio(t.builtin ? T.draft(t) : JSON.parse(JSON.stringify(t))) }, icon("sparkles"), t.builtin ? "Remix" : "Edit"));
            if (!t.builtin) {
                actions.append(
                    // icon-sized like its neighbours, so every card's buttons fit on one line in the same places
                    h("button.icon-btn.tc-share", { type: "button", class: t.publishedId ? "is-shared" : undefined,
                        title: t.publishedId ? "Update your shared copy in the community gallery" : "Share in the community gallery",
                        "aria-label": t.publishedId ? `Update the shared copy of ${t.name}` : `Share ${t.name}`, onclick: () => share(t) }, icon("globe")),
                    h("button.icon-btn", { type: "button", title: "Save as a file", "aria-label": "Save as a file", onclick: () => exportFile(t) }, icon("download")),
                    h("button.icon-btn", { type: "button", title: "Delete", "aria-label": `Delete ${t.name}`, onclick: async () => {
                        await T.deleteTheme(t.id); toast(`Deleted ${t.name}`); collection();
                    } }, icon("trash")));
            } else {
                actions.append(h("button.icon-btn", { type: "button", title: "Save as a file", "aria-label": "Save as a file", onclick: () => exportFile(t) }, icon("download")));
            }
            return el;
        }

        async function use(t) { await T.use(t.id); toast(`${t.name} is on`); collection(); }

        function collection() {
            tab = "collection"; tabs(); clear(body);
            const mine = T.myThemes();
            if (mine.length) body.append(h("p.section-label", null, "Your themes"), h("div.theme-grid", null, mine.map((t) => themeCard(t))));
            body.append(h("p.section-label", null, `Built in · ${T.BUILTIN_THEMES.length} themes`), h("div.theme-grid", null, T.BUILTIN_THEMES.map((t) => themeCard(t))));
        }

        // ---- Studio --------------------------------------------------------------------
        function studio(d) {
            tab = "studio"; tabs(); clear(body);
            const original = T.active();
            let dirty = false;
            const live = () => { dirty = true; T.apply(d); paintPreview(); };
            const preview = h("div.studio-preview");
            const paintPreview = () => clear(preview).append(T.tile(d), h("p.hint", null, "The whole app is your preview: every change shows at once. Nothing is kept until you save."));

            const name = h("input.input", { type: "text", value: d.name, maxlength: 40, "aria-label": "Theme name", oninput: (e) => { d.name = e.target.value; dirty = true; } });
            const seg = (opts, cur, onPick, cls = "") => {
                const el = h(`div.seg${cls}`);
                const paint = () => { clear(el); opts.forEach((o) => el.appendChild(h("button", { type: "button", "aria-pressed": String(cur() === o.id), title: o.hint || "",
                    onclick: () => { onPick(o.id); paint(); live(); } }, o.label, o.small ? h("small", null, o.small) : null))); };
                paint(); el._paint = paint; return el;
            };
            const tone = seg([{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }], () => d.tone, (v) => { d.tone = v; }, ".two");
            const surface = seg(T.SURFACES.map((s) => ({ ...s, small: s.hint.split(",")[0] })), () => d.surface, (v) => { d.surface = v; });
            const font = seg(Object.entries(T.FONTS).map(([id, f]) => ({ id, label: f.label })), () => d.font, (v) => { d.font = v; });
            const glow = seg([{ id: 0, label: "No glow" }, { id: 1, label: "Glow" }, { id: 2, label: "Intense" }], () => d.glow, (v) => { d.glow = v; });

            const patterns = h("div.pattern-pick");
            const paintPatterns = () => { clear(patterns); T.PATTERNS.forEach((p) => patterns.appendChild(h("button", { type: "button", dataset: { pattern: p }, "aria-pressed": String(d.pattern === p), title: p,
                onclick: () => { d.pattern = p; paintPatterns(); live(); } }, h("span", null, p)))); };
            paintPatterns();

            const colors = h("div.colors");
            const paintColors = () => {
                clear(colors);
                Object.keys(COLOR_LABELS).forEach((k) => colors.appendChild(h("label.color-field", null,
                    h("input", { type: "color", value: d.colors[k], "aria-label": COLOR_LABELS[k], oninput: (e) => { d.colors[k] = e.target.value; live(); } }), COLOR_LABELS[k])));
                colors.appendChild(h("label.color-field", null,
                    h("input", { type: "color", value: d.onAccent || "#ffffff", "aria-label": "Text on accent", oninput: (e) => { d.onAccent = e.target.value; live(); } }), "On accent"));
            };
            paintColors();
            const magicIn = h("input", { type: "color", value: d.colors.accent, "aria-label": "Build a palette from this colour" });
            const magic = h("button.btn", { type: "button", onclick: () => { d.colors = T.paletteFrom(magicIn.value, d.tone); d.onAccent = d.tone === "light" ? "#ffffff" : "#ffffff"; paintColors(); live(); } }, icon("sparkles"), "Build a palette from");

            // Picture
            const wpThumb = h("div.wp-thumb");
            const dim = h("input", { type: "range", min: 0, max: 95, value: d.wallpaper ? d.wallpaper.dim : 55 });
            const blur = h("input", { type: "range", min: 0, max: 30, value: d.wallpaper ? d.wallpaper.blur : 0 });
            const dimOut = h("span"), blurOut = h("span");
            const wpControls = h("div.wp-box");
            const paintWp = () => {
                const src = d.wallpaper && d.wallpaper.src;
                wpThumb.style.backgroundImage = src ? `url("${src.startsWith("data:") ? src : ""}")` : "";
                wpThumb.textContent = src ? "" : "No picture";
                dimOut.textContent = `${dim.value}%`; blurOut.textContent = `${blur.value}px`;
                wpControls.hidden = !src;
            };
            dim.oninput = () => { if (d.wallpaper) d.wallpaper.dim = +dim.value; paintWp(); live(); };
            blur.oninput = () => { if (d.wallpaper) d.wallpaper.blur = +blur.value; paintWp(); live(); };
            const pick = h("button.btn", { type: "button", onclick: async () => {
                const r = await call("r2-theme-pick-picture");
                if (!r) return;
                if (r.error) { toast(r.error, "err"); return; }
                pick.disabled = true;
                try {
                    const src = await T.shrink(r.dataUrl, 2560, 3.5e6);
                    d.wallpaper = { src, dim: +dim.value || 55, blur: +blur.value || 0, mode: "smart", pos: "center" };
                    paintWp(); paintWpSegs(); live();
                } catch (err) { toast(err.message, "err"); }
                pick.disabled = false;
            } }, icon("folder"), "Choose a picture");
            const linkIn = h("input.input", { type: "url", placeholder: "…or paste a picture link (https://)", "aria-label": "Picture link" });
            linkIn.addEventListener("change", () => {
                const v = linkIn.value.trim();
                if (!/^https:\/\/\S+$/i.test(v)) { if (v) toast("Use an https:// picture link.", "err"); return; }
                d.wallpaper = { src: v, dim: +dim.value || 55, blur: +blur.value || 0, mode: "smart", pos: "center" };
                paintWp(); paintWpSegs(); live();
            });
            const removeWp = h("button.btn.ghost", { type: "button", onclick: () => { d.wallpaper = null; linkIn.value = ""; paintWp(); live(); } }, icon("x"), "Remove picture");
            // How the picture sits on this screen (wide screens included) and which part stays in view
            const wpModeSeg = h("div.seg.four", { role: "radiogroup", "aria-label": "Picture size" });
            const wpPosSeg = h("div.seg.three", { role: "radiogroup", "aria-label": "Keep in view" });
            const paintWpSegs = () => {
                const m = T.wpMode(d.wallpaper && d.wallpaper.mode), ps = (d.wallpaper && d.wallpaper.pos) || "center";
                clear(wpModeSeg); T.WP_MODES.forEach((o) => wpModeSeg.appendChild(h("button", { type: "button", role: "radio", "aria-pressed": String(m === o.id), "aria-checked": String(m === o.id), title: o.hint,
                    onclick: () => { if (d.wallpaper) { d.wallpaper.mode = o.id; paintWpSegs(); live(); } } }, o.label)));
                clear(wpPosSeg); T.WP_POSITIONS.forEach((o) => wpPosSeg.appendChild(h("button", { type: "button", role: "radio", "aria-pressed": String(ps === o.id), "aria-checked": String(ps === o.id),
                    onclick: () => { if (d.wallpaper) { d.wallpaper.pos = o.id; paintWpSegs(); live(); } } }, o.label)));
                wpPosSeg.parentElement && (wpPosSeg.parentElement.hidden = m === "tile" || m === "whole");
            };
            // One click: a theme made for this picture
            const matchBtn = h("button.btn.match-btn", { type: "button", title: "Riftgate reads the picture's colours, light and detail and sets the theme to match" }, icon("sparkles"), "Match the theme to my picture");
            matchBtn.onclick = async () => {
                if (!d.wallpaper || !d.wallpaper.src) return;
                matchBtn.disabled = true; matchBtn.classList.add("busy");
                try {
                    const m = await T.matchPicture(d.wallpaper.src);
                    d.tone = m.tone; d.colors = { ...d.colors, ...m.colors }; d.onAccent = m.onAccent; d.surface = m.surface; d.glow = m.glow; d.pattern = m.pattern;
                    d.wallpaper.dim = m.dim; d.wallpaper.blur = m.blur; dim.value = m.dim; blur.value = m.blur;
                    paintColors(); paintPatterns(); [tone, surface, glow].forEach((x) => x._paint && x._paint());
                    magicIn.value = m.colors.accent;
                    paintWp(); live();
                    toast(`Matched: ${m.summary}. Tweak anything you like.`);
                } catch (err) { toast(err.message || "Couldn't read the picture.", "err"); }
                matchBtn.disabled = false; matchBtn.classList.remove("busy");
            };
            wpControls.append(
                matchBtn,
                h("div.wp-field", null, h("span", null, "Size"), wpModeSeg),
                h("div.wp-field", null, h("span", null, "Keep in view"), wpPosSeg),
                h("label.range", { title: "How much the picture fades into the theme colours" }, "Blend", dim, dimOut), h("label.range", null, "Blur", blur, blurOut), removeWp);
            paintWpSegs();

            paintWp();

            const save = h("button.btn.primary.lg", { type: "button", onclick: async () => {
                if (!d.name.trim()) { toast("Give your theme a name first.", "err"); name.focus(); return; }
                save.disabled = true;
                try {
                    const saved = await T.saveTheme({ ...d, name: d.name.trim(), author: account.current().username || d.author || null });
                    await T.use(saved.id);
                    dirty = false;
                    toast(`${saved.name} saved and switched on`);
                    collection();
                } catch (err) { toast(err.message, "err"); save.disabled = false; }
            } }, icon("check"), "Save and use");
            const cancel = h("button.btn.ghost.lg", { type: "button", onclick: () => { T.apply(original); dirty = false; collection(); } }, "Cancel");
            body._leave = () => { if (dirty) T.apply(original); };

            const group = (title, ...els) => h("div.studio-group", null, h("h3", null, title), ...els);
            body.append(h("div.studio", null,
                h("div.studio-panel", null,
                    group("Name", name),
                    group("Light or dark", tone),
                    group("Colours", h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } }, magic, magicIn), colors),
                    group("Surface", surface),
                    group("Background pattern", patterns),
                    group("Your picture", wpThumb, h("div.studio-actions", null, pick), linkIn, wpControls),
                    group("Font", font),
                    group("Glow", glow),
                    h("div.studio-actions", null, save, cancel)),
                preview));
            paintPreview();
            T.apply(d);
            name.focus();
        }

        // ---- Sharing -------------------------------------------------------------------
        async function share(t) {
            if (!account.current().signedIn) { openAccount("in", { reason: "Sign in to share your themes with everyone on Riftgate." }); return; }
            toast(`Sharing ${t.name}…`);
            let wallpaper = null, thumb = null;
            try {
                if (t.wallpaper && t.wallpaper.src) {
                    if (/^https:/i.test(t.wallpaper.src)) wallpaper = t.wallpaper.src;
                    else { wallpaper = await T.shrink(t.wallpaper.src, 1600, 680000, .8); thumb = await T.shrink(t.wallpaper.src, 420, 55000, .7); }
                }
            } catch (err) { toast("The picture couldn't be prepared for sharing.", "err"); return; }
            const theme = { ...t, wallpaper: t.wallpaper ? { dim: t.wallpaper.dim, blur: t.wallpaper.blur, mode: t.wallpaper.mode, pos: t.wallpaper.pos } : null };
            ["id", "builtin", "updatedAt", "publishedId", "communityId", "basedOn"].forEach((k) => delete theme[k]);
            const r = await call("r2-theme-publish", { name: t.name, theme, thumb, wallpaper });
            if (r && r.ok) { await T.saveTheme({ ...t, publishedId: r.id }); toast(`${t.name} is in the community gallery`); collection(); }
            else if (r && r.signIn) openAccount("in", { reason: "Sign in again to share your themes." });
            else toast((r && r.error) || "Couldn't share it right now.", "err");
        }
        async function exportFile(t) {
            const theme = { ...t }; ["builtin", "publishedId", "communityId"].forEach((k) => delete theme[k]);
            const r = await call("r2-theme-export", { name: t.name, theme });
            if (r && r.ok) toast(`Saved ${t.name}. Send the file to anyone with Riftgate.`);
        }
        async function importFile() {
            const r = await call("r2-theme-import");
            if (!r) return;
            if (r.error) { toast(r.error, "err"); return; }
            const saved = await T.saveTheme({ ...sanitize(r.theme), id: null });
            await T.use(saved.id);
            toast(`${saved.name} added and switched on`);
            collection();
        }

        // ---- Community -----------------------------------------------------------------
        async function community() {
            tab = "community"; tabs(); clear(body);
            let sort = "popular", query = "";
            const sortSeg = h("div.chips");
            const search = h("input.input", { type: "search", placeholder: "Search themes or authors", "aria-label": "Search community themes", style: { width: "260px" } });
            const grid = h("div.theme-grid");
            const head = h("div", { style: { display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "24px" } }, sortSeg, search);
            const signHint = h("div");
            body.append(signHint, head, grid);
            const paintSign = () => {
                clear(signHint);
                if (account.current().signedIn) return;
                signHint.appendChild(h("div.notice", null, icon("globe"), h("div.grow", null, h("strong", null, "Share your own themes"),
                    h("p", null, "Anyone can use these themes. Sign in to share the ones you make, with your name on them.")),
                    h("button.btn.primary", { type: "button", onclick: () => openAccount("in", { reason: "Sign in to share your themes with everyone on Riftgate." }) }, "Sign in")));
            };
            paintSign();
            const paintSort = () => { clear(sortSeg); [["popular", "Most used"], ["new", "Newest"]].forEach(([id, l]) =>
                sortSeg.appendChild(h("button.chip", { type: "button", "aria-pressed": String(sort === id), onclick: () => { sort = id; paintSort(); load(); } }, l))); };
            paintSort();
            async function load() {
                clear(grid).appendChild(h("p.muted", null, "Opening the gallery…"));
                const r = (await call("r2-themes-gallery", { sort, query })) || {};
                clear(grid);
                if (r.available === false) {
                    grid.appendChild(h("div.empty", { style: { gridColumn: "1 / -1" } }, icon("globe"), h("h3", null, "The community gallery opens soon"),
                        h("p", null, "Until then, share themes as files: open any of yours and press the save button, then send the file to a friend.")));
                    return;
                }
                if (r.error) { grid.appendChild(h("div.empty", { style: { gridColumn: "1 / -1" } }, icon("info"), h("h3", null, r.error))); return; }
                if (!r.themes.length) { grid.appendChild(h("div.empty", { style: { gridColumn: "1 / -1" } }, icon("sparkles"), h("h3", null, query ? `No theme matches “${query}”` : "No shared themes yet"), h("p", null, "Be the first: make one in the Studio and share it."))); return; }
                r.themes.forEach((c) => grid.appendChild(themeCard({ ...sanitize(c.theme), name: c.name, id: `c:${c.id}` }, { community: c })));
            }
            search.addEventListener("input", debounce(() => { query = search.value; load(); }, 350));
            load();
        }

        const off = T.onChange(() => { if (!root.isConnected) off(); });
        if (ctx.sub === "studio") studio(T.draft()); else if (ctx.sub === "community") community(); else collection();
        return () => { if (body._leave) body._leave(); };
    }
};

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }
// Keep only the fields a theme can have, with safe values
function sanitize(t) {
    const x = t && typeof t === "object" ? t : {};
    const hex = (v) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);
    const colors = {};
    Object.keys(COLOR_LABELS).forEach((k) => { const v = hex(x.colors && x.colors[k]); if (v) colors[k] = v; });
    const wp = x.wallpaper && typeof x.wallpaper === "object" && typeof x.wallpaper.src === "string" && /^(data:image\/|https:\/\/)/i.test(x.wallpaper.src)
        ? { src: x.wallpaper.src, dim: Number(x.wallpaper.dim) || 0, blur: Number(x.wallpaper.blur) || 0, mode: T.wpMode(x.wallpaper.mode), pos: ["top", "center", "bottom"].includes(x.wallpaper.pos) ? x.wallpaper.pos : "center" } : null;
    return {
        name: String(x.name || "Theme").slice(0, 40), author: typeof x.author === "string" ? x.author.slice(0, 40) : null,
        tone: x.tone === "light" ? "light" : "dark",
        surface: T.SURFACES.some((s) => s.id === x.surface) ? x.surface : "gem",
        pattern: T.PATTERNS.includes(x.pattern) ? x.pattern : "none",
        font: T.FONTS[x.font] ? x.font : "rift",
        glow: [0, 1, 2].includes(x.glow) ? x.glow : 1,
        onAccent: hex(x.onAccent) || "#ffffff",
        blurb: typeof x.blurb === "string" ? x.blurb.slice(0, 120) : undefined,
        colors, wallpaper: wp
    };
}
