// Riftgate — Admin: one place for everything only admins do.
//   Overview    shortcuts to the places admins moderate (Suggestions, shared
//               themes, the Vault) and "See Riftgate as…" (adult / under 18)
//   Content     what's marked mature and what's removed, for everyone
//   Vault access  who may use the Vault, and who asked to
// Every action is checked by the server against your password (asked once,
// kept in memory only). Lock admin tools forgets it at once.

import { h, icon, clear } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import * as admin from "../app/admin.js";
import * as gate from "../app/mature.js";
import * as account from "../app/account.js";
import { toast } from "../components/toast.js";

const SECTION = { movie: "Film", show: "Series", book: "Book", freegame: "Free game", game: "Game" };
function linkFor(section, key) {
    if (section === "movie") return `https://www.themoviedb.org/movie/${key}`;
    if (section === "show") return `https://www.themoviedb.org/tv/${key}`;
    if (section === "book" && /^\/?works\//.test(key)) return `https://openlibrary.org/${key.replace(/^\//, "")}`;
    return null;
}

export default {
    async render(root) {
        if (!gate.isAdmin()) {
            root.appendChild(h("div.empty", null, icon("shield"), h("h3", null, "Admins only"), h("p", null, "Sign in with an admin account to see this section.")));
            return;
        }
        const role = await admin.myRole();
        let tab = "overview";
        const tabsEl = h("div.theme-tabs", { role: "tablist" });
        const body = h("div.admin-body");
        const lockBtn = h("button.btn", { type: "button" });
        const paintLock = () => clear(lockBtn).append(icon("lock"), admin.isUnlocked() ? "Lock admin tools" : "Admin tools are locked");
        lockBtn.onclick = () => { admin.lock(); paintLock(); toast("Admin tools locked: your password is forgotten"); };
        paintLock();
        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Admin"),
                    h("p", null, `Signed in as ${account.current().username}, ${role && role.root ? "super admin" : "admin"}. What you do here applies to everyone.`)),
                h("div.actions", null, lockBtn)),
            tabsEl, body);

        const TABS = [["overview", "Overview", "shield"], ["content", "Content", "eye"], ["access", "Vault access", "vault"]];
        function tabs() {
            tabsEl.replaceChildren(...TABS.map(([id, label, ic]) => h("button.chip.lg", { type: "button", role: "tab", "aria-pressed": String(tab === id), "aria-selected": String(tab === id),
                onclick: () => { tab = id; tabs(); show(); } }, icon(ic), label)));
        }
        function show() { clear(body); ({ overview, content, access })[tab](); paintLock(); }

        function overview() {
            const go = (hash) => () => { location.hash = hash; };
            const tile = (ic, title, text, act) => h("button.admin-tile", { type: "button", onclick: act }, icon(ic), h("b", null, title), h("span", null, text));
            const seeAs = h("div.seg.admin-seeas", { role: "group", "aria-label": "See Riftgate as" });
            const paintSee = () => seeAs.replaceChildren(...[[null, "Admin", "Everything"], ["adult", "Adult", "Mature titles on"], ["minor", "Under 18", "No mature titles"]].map(([v, l, d]) =>
                h("button", { type: "button", "aria-pressed": String(gate.previewAs() === v), onclick: () => { gate.setPreview(v); paintSee(); toast(v ? `Riftgate now shows what ${v === "adult" ? "an adult with mature titles on" : "someone under 18"} sees` : "Back to the admin view"); } },
                    h("b", null, l), h("small", null, d))));
            paintSee();
            body.append(
                h("div.admin-tiles", null,
                    tile("chat", "Suggestions", "Reply, mark done or decline, export", go("suggestions")),
                    tile("globe", "Shared themes", "Everyone's themes in the gallery", go("themes/community")),
                    tile("vault", "The Vault", "Files and links you share", go("vault")),
                    tile("eye", "Mature & removed", "Every title you've marked or removed", () => { tab = "content"; tabs(); show(); })),
                h("section.setting", null, h("div.grow", null, h("h3", null, "See Riftgate as…"),
                    h("p", null, "Check what other people see without signing out. Only changes what shows on this PC, until Riftgate closes.")), seeAs),
                h("section.setting", null, h("div.grow", null, h("h3", null, "Moderating a title"),
                    h("p", null, "Open any film, series, book or game: the Admin box at the bottom of its details marks it as mature or removes it from Riftgate."))));
        }

        async function content() {
            body.append(h("p.muted", null, "Loading…"));
            await gate.refresh();
            const { overrides, removed } = gate.lists();
            const list = (title, ids, ic, empty, undo) => h("section.admin-list", null,
                h("h3", null, icon(ic), title, h("span.n", null, String(ids.length))),
                ids.length ? h("div.admin-rows", null, ids.map((id) => {
                    const [section, ...rest] = id.split(":"); const key = rest.join(":");
                    const url = linkFor(section, key);
                    return h("div.admin-row", null, h("span.type", { dataset: { t: section === "movie" ? "film" : section === "show" ? "series" : section === "book" ? "book" : "game" } }, SECTION[section] || section),
                        h("code", null, key),
                        url ? h("button.link-btn", { type: "button", onclick: () => openExternal(url) }, "Look it up") : null,
                        undo ? undo(section, key) : null);
                })) : h("p.muted", null, empty));
            const clearMark = (section, itemKey) => h("button.btn", { type: "button", onclick: async () => {
                const r = await admin.run("admin-toggle-item-mature", { section, itemKey });
                if (r && r.success) { toast(r.isMature ? "Marked as mature again" : "Mature mark cleared"); await gate.refresh(); show(); }
                else if (r) toast(r.error || "That didn't work", "err");
            } }, icon("x"), "Clear");
            clear(body).append(
                list("Marked as mature", overrides, "eye", "Nothing marked by hand. Titles the keyword check flags are mature anyway.", clearMark),
                list("Removed from Riftgate", removed, "trash", "Nothing removed."),
                h("p.muted", null, "Removal is permanent from Riftgate; it can't be undone from here."));
        }

        async function access() {
            const c = await admin.credentials();
            if (!c) { body.append(h("button.btn.primary", { type: "button", onclick: show }, icon("lock"), "Unlock admin tools")); return; }
            paintLock();
            const ask = { adminUsername: c.username, adminPassword: c.password };
            const [al, rq] = await Promise.all([call("get-share-allowlist", ask), call("get-share-access-requests", ask)]);
            const names = (l) => (l || []).map((x) => (typeof x === "string" ? x : x.username || x.target_username || "")).filter(Boolean);
            const allowed = names(al && al.list), asked = names(rq && rq.list);
            if (!al || !al.success) { clear(body).append(h("p.muted", null, (al && al.error) || "The Vault access list couldn't be loaded. Try again in a moment.")); return; }
            const act = (ch, who, msg) => async () => {
                const r = await call(ch, { ...ask, targetUsername: who });
                if (r && r.success) { toast(msg); show(); } else toast((r && r.error) || "That didn't work", "err");
            };
            const add = h("input.input", { type: "text", placeholder: "Username", maxlength: 40, "aria-label": "Username to let in" });
            clear(body).append(
                h("section.admin-list", null, h("h3", null, icon("bell"), "Asking to get in", h("span.n", null, String(asked.length))),
                    asked.length ? h("div.admin-rows", null, asked.map((u) => h("div.admin-row", null, icon("gem"), h("b", null, u),
                        h("button.btn.primary", { type: "button", onclick: act("approve-share-access-request", u, `${u} can use the Vault`) }, icon("check"), "Let in"),
                        h("button.btn", { type: "button", onclick: act("deny-share-access-request", u, "Request declined") }, icon("x"), "Decline"))))
                        : h("p.muted", null, "No requests waiting.")),
                h("section.admin-list", null, h("h3", null, icon("vault"), "Allowed in the Vault", h("span.n", null, String(allowed.length))),
                    h("form.admin-add", { onsubmit: async (e) => {
                        e.preventDefault(); const u = add.value.trim(); if (!u) return;
                        act("add-to-share-allowlist", u, `${u} can use the Vault`)();
                    } }, add, h("button.btn", { type: "submit" }, icon("plus"), "Let in")),
                    allowed.length ? h("div.admin-rows", null, allowed.map((u) => h("div.admin-row", null, icon("gem"), h("b", null, u),
                        h("button.btn", { type: "button", onclick: act("remove-from-share-allowlist", u, `${u} can no longer use the Vault`) }, icon("x"), "Remove"))))
                        : h("p.muted", null, "Nobody yet besides admins.")));
        }

        tabs(); show();
    }
};
