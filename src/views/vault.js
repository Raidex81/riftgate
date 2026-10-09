// Riftgate — The Vault: share a file for a few hours (1 to 4) or a link for a
// week (WeTransfer and the like, for anything over the 50 MB file limit) with
// the people allowed in. Admins only for now, as in Riftgate 1.x. The server
// holds the files privately and checks your password on every action; the
// password is asked once and kept in memory only (see admin.js).

import { h, icon, clear } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as admin from "../app/admin.js";
import * as gate from "../app/mature.js";
import * as account from "../app/account.js";
import { toast } from "../components/toast.js";

const HOURS = [1, 2, 3, 4];
const FILE_MAX = 4 * 3600e3, LINK_MAX = 7 * 24 * 3600e3;

const size = (b) => (!b ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
function left(at) {
    const ms = new Date(at) - Date.now();
    if (!(ms > 0)) return "Expired";
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min left`;
    if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} min left`;
    return `${Math.round(m / 1440)} days left`;
}
const kindOf = (name) => {
    const e = (String(name).split(".").pop() || "").toLowerCase();
    if (/^(png|jpe?g|gif|webp|bmp|avif)$/.test(e)) return "image";
    if (/^(mp4|mkv|webm|mov|avi)$/.test(e)) return "video";
    if (/^(zip|rar|7z|tar|gz)$/.test(e)) return "archive";
    if (/^(pdf|epub|txt|docx?|md)$/.test(e)) return "doc";
    return "file";
};
const KIND_ICON = { image: "sparkles", video: "film", archive: "folder", doc: "book", file: "download" };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function expiryBar(at, max) {
    const fill = h("i");
    const el = h("span.vault-bar", null, fill);
    const paint = () => { const p = Math.max(0, Math.min(1, (new Date(at) - Date.now()) / max)); fill.style.width = `${p * 100}%`; el.dataset.low = String(p < .2); };
    paint();
    return { el, paint };
}

export default {
    async render(root) {
        if (!gate.isAdmin()) {
            root.appendChild(h("div.empty", null, icon("vault"), h("h3", null, "The Vault is for admins for now"),
                h("p", null, "Sign in with an admin account to share files and links.")));
            return;
        }
        const me = account.current().username;
        let tab = "files", files = [], links = [], query = "";
        const tickers = new Set();
        const tabsEl = h("div.theme-tabs", { role: "tablist" });
        const body = h("div.vault-list");
        const status = h("p.muted.vault-status");
        const search = h("input.input", { type: "search", placeholder: "Search the Vault", "aria-label": "Search the Vault", oninput: () => { query = search.value.trim().toLowerCase(); paint(); } });

        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "The Vault"),
                    h("p", null, "Share a file for 1 to 4 hours, or a link for 7 days, with the people allowed in. Then it cleans itself up.")),
                h("div.actions", null,
                    h("button.btn.primary", { type: "button", onclick: () => composeFile() }, icon("upload"), "Share a file"),
                    h("button.btn", { type: "button", onclick: () => composeLink() }, icon("link"), "Share a link"),
                    h("button.btn", { type: "button", title: "Remove everything that has expired, right now", onclick: () => cleanNow() }, icon("trash"), "Clean now"))),
            h("div.vault-bar-row", null, tabsEl, search), status, body);

        const composer = h("div.vault-compose");
        root.insertBefore(composer, tabsEl.parentNode);

        function tabs() {
            tabsEl.replaceChildren(...[["files", "Files", files.length, "download"], ["links", "Links", links.length, "link"]].map(([id, label, n, ic]) =>
                h("button.chip.lg", { type: "button", role: "tab", "aria-pressed": String(tab === id), "aria-selected": String(tab === id), onclick: () => { tab = id; tabs(); paint(); } },
                    icon(ic), label, h("span.n", null, String(n)))));
        }

        function fileRow(f) {
            const bar = expiryBar(f.expires_at, FILE_MAX);
            const when = h("span", null, left(f.expires_at));
            tickers.add(() => { bar.paint(); when.textContent = left(f.expires_at); });
            const count = h("span", null, `${f.download_count || 0} download${f.download_count === 1 ? "" : "s"}`);
            const kind = kindOf(f.filename);
            const thumb = h("div.vault-icon", { dataset: { kind } }, icon(KIND_ICON[kind]));
            if (kind === "image") thumb.addEventListener("pointerenter", () => preview(f, thumb), { once: true });
            const mine = f.uploader_username === me;
            return h("article.vault-item", null, thumb,
                h("div.grow", null,
                    h("h3", null, f.filename),
                    f.description ? h("p", null, f.description) : null,
                    h("p.vault-meta", null, h("span", null, icon("gem"), f.uploader_username || "someone"), h("span", null, size(f.file_size)), count, when),
                    bar.el),
                h("div.vault-actions", null,
                    h("button.btn", { type: "button", onclick: async () => {
                        const r = await admin.run("download-shared-file", { storagePath: f.storage_path, filename: f.filename });
                        if (!r || r.canceled) return;
                        if (!r.success) return toast(r.error || "That file couldn't be downloaded", "err");
                        toast("Saved");
                        const c = await call("increment-shared-file-download", f.id);
                        f.download_count = c && typeof c.downloadCount === "number" ? c.downloadCount : (f.download_count || 0) + 1;
                        count.textContent = `${f.download_count} download${f.download_count === 1 ? "" : "s"}`;
                    } }, icon("download"), "Download"),
                    removeBtn("Remove this file", async () => {
                        const c = await admin.credentials(); if (!c) return false;
                        return call("delete-shared-file", { username: c.username, fileId: f.id, storagePath: f.storage_path, password: mine ? c.password : null, adminPassword: c.password });
                    })));
        }
        async function preview(f, thumb) {
            const r = await admin.run("get-shared-file-preview-url", { storagePath: f.storage_path });
            if (r && r.success && r.url) { thumb.replaceChildren(h("img", { src: r.url, alt: "" })); thumb.classList.add("has-img"); }
        }
        function linkRow(l) {
            const bar = expiryBar(l.expires_at, LINK_MAX);
            const when = h("span", null, left(l.expires_at));
            tickers.add(() => { bar.paint(); when.textContent = left(l.expires_at); });
            const count = h("span", null, `${l.open_count || 0} open${l.open_count === 1 ? "" : "s"}`);
            const mine = l.poster_username === me;
            return h("article.vault-item", null, h("div.vault-icon", { dataset: { kind: "link" } }, icon("link")),
                h("div.grow", null,
                    h("h3", null, l.description || "Shared link"),
                    h("p.vault-meta", null, h("span", null, icon("gem"), l.poster_username || "someone"), h("span", null, host(l.url)), count, when),
                    bar.el),
                h("div.vault-actions", null,
                    h("button.btn", { type: "button", onclick: async () => {
                        openExternal(l.url);
                        const c = await call("increment-shared-link-open", l.id);
                        l.open_count = c && typeof c.openCount === "number" ? c.openCount : (l.open_count || 0) + 1;
                        count.textContent = `${l.open_count} open${l.open_count === 1 ? "" : "s"}`;
                    } }, icon("external"), "Open"),
                    h("button.icon-btn", { type: "button", title: "Copy the link", "aria-label": "Copy the link", onclick: () => { navigator.clipboard.writeText(l.url).then(() => toast("Link copied")); } }, icon("link")),
                    removeBtn("Remove this link", async () => {
                        const c = await admin.credentials(); if (!c) return false;
                        return call("delete-shared-link", { username: c.username, linkId: l.id, password: mine ? c.password : null, adminPassword: c.password });
                    })));
        }
        function removeBtn(label, act) {
            let armed = 0;
            const b = h("button.icon-btn.danger", { type: "button", title: label, "aria-label": label }, icon("trash"));
            b.onclick = async () => {
                if (Date.now() - armed > 3500) { armed = Date.now(); b.classList.add("armed"); b.title = "Click again to remove"; setTimeout(() => b.classList.remove("armed"), 3500); return; }
                b.disabled = true;
                const ok = await act();
                b.disabled = false;
                if (ok) { toast("Removed"); load(); } else if (ok === null || ok === undefined || ok === false) toast("That couldn't be removed", "err");
            };
            return b;
        }

        function paint() {
            tickers.clear();
            const match = (...xs) => !query || xs.some((x) => String(x || "").toLowerCase().includes(query));
            const list = tab === "files"
                ? files.filter((f) => match(f.filename, f.description, f.uploader_username)).map(fileRow)
                : links.filter((l) => match(l.description, l.poster_username, l.url)).map(linkRow);
            clear(body).append(...(list.length ? list : [h("div.empty", null, icon(tab === "files" ? "upload" : "link"),
                h("h3", null, query ? "Nothing matches" : tab === "files" ? "No files shared right now" : "No links shared right now"),
                h("p", null, query ? "Try other words." : tab === "files" ? "Share a file: it stays here 1 to 4 hours, up to 50 MB." : "Over 50 MB? Share a WeTransfer (or any) link: it stays 7 days."))]));
        }

        async function load() {
            status.textContent = "Opening the Vault…";
            const c = await admin.credentials();
            if (!c) { status.textContent = "The Vault needs your password once per session."; clear(body).appendChild(h("button.btn.primary", { type: "button", onclick: load }, icon("lock"), "Unlock the Vault")); return; }
            // expired shares are cleaned by whoever opens the Vault (there's no server job)
            await Promise.all([call("cleanup-expired-shared-files", c), call("cleanup-expired-shared-links", c)]);
            const [f, l] = await Promise.all([call("get-shared-files", c), call("get-shared-links", c)]);
            if (!f || !f.success) { status.textContent = (f && f.error) || "The Vault couldn't be reached. Try again in a moment."; return; }
            files = f.files || []; links = (l && l.links) || [];
            status.textContent = "";
            tabs(); paint();
        }

        function composeFile() {
            let hours = 4;
            const desc = h("input.input", { type: "text", maxlength: 200, placeholder: "What is it? (optional)" });
            const seg = h("div.seg.vault-hours", { role: "group", "aria-label": "Keep it for" });
            const paintSeg = () => seg.replaceChildren(...HOURS.map((n) => h("button", { type: "button", "aria-pressed": String(hours === n), onclick: () => { hours = n; paintSeg(); } }, h("b", null, `${n} h`))));
            paintSeg();
            const go = h("button.btn.primary", { type: "button" }, icon("upload"), "Choose the file and share");
            go.onclick = async () => {
                go.disabled = true; go.lastChild.textContent = "Uploading…";
                const r = await admin.run("upload-shared-file", { description: desc.value.trim(), expiresHours: hours });
                go.disabled = false; go.lastChild.textContent = "Choose the file and share";
                if (!r || r.canceled) return;
                if (!r.success) return toast(r.error || "The file couldn't be shared", "err", 8000);
                toast(`Shared for ${hours} hour${hours === 1 ? "" : "s"}`); clear(composer); tab = "files"; load();
            };
            clear(composer).appendChild(h("div.vault-form", null,
                h("h3", null, icon("upload"), "Share a file"),
                h("label.field", null, h("span", null, "Description"), desc),
                h("div.field", null, h("span", null, "Keep it for"), seg),
                h("p.muted", null, "Up to 50 MB. Bigger? Upload it to WeTransfer and share the link instead."),
                h("div.vault-form-btns", null, h("button.btn", { type: "button", onclick: () => clear(composer) }, "Cancel"), go)));
            desc.focus();
        }
        function composeLink() {
            const url = h("input.input", { type: "url", placeholder: "https://…", maxlength: 2000 });
            const desc = h("input.input", { type: "text", maxlength: 200, placeholder: "What is it?" });
            const go = h("button.btn.primary", { type: "submit" }, icon("link"), "Share for 7 days");
            clear(composer).appendChild(h("form.vault-form", { onsubmit: async (e) => {
                e.preventDefault();
                if (!/^https?:\/\/\S+\.\S+/i.test(url.value.trim())) { toast("That doesn't look like a web link", "err"); url.focus(); return; }
                go.disabled = true;
                const r = await admin.run("add-shared-link", { url: url.value.trim(), description: desc.value.trim() });
                go.disabled = false;
                if (!r || !r.success) return r && toast(r.error || "The link couldn't be shared", "err");
                toast("Link shared for 7 days"); clear(composer); tab = "links"; load();
            } },
                h("h3", null, icon("link"), "Share a link"),
                h("label.field", null, h("span", null, "Link"), url),
                h("label.field", null, h("span", null, "Description"), desc),
                h("div.vault-form-btns", null, h("button.btn", { type: "button", onclick: () => clear(composer) }, "Cancel"), go)));
            url.focus();
        }
        async function cleanNow() {
            const c = await admin.credentials(); if (!c) return;
            const ask = { adminUsername: c.username, adminPassword: c.password };
            const [a, b] = await Promise.all([call("force-clean-shared-folder", ask), call("force-clean-shared-links", ask)]);
            const n = ((a && a.cleaned) || 0) + ((b && b.cleaned) || 0);
            if ((a && a.success === false) || (b && b.success === false)) toast((a && a.error) || (b && b.error) || "Clean now didn't finish", "err");
            else toast(n ? `Cleaned ${n} expired item${n === 1 ? "" : "s"}` : "Nothing had expired");
            load();
        }

        tabs();
        load();
        const tick = setInterval(() => tickers.forEach((fn) => fn()), 30000);
        return () => clearInterval(tick);
    }
};
