// Riftgate — Suggestions: ideas, bugs and app submissions from everyone,
// with the Riftgate Team's replies and what happened to each (Applied or
// Refused). Admins reply, mark, remove and export from right here.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as account from "../app/account.js";
import * as admin from "../app/admin.js";
import { openAccount } from "../components/account.js";
import { toast } from "../components/toast.js";
import { ago } from "../app/format.js";

const CATEGORIES = [
    { id: "Feature Request", label: "Feature request", icon: "sparkles" },
    { id: "Bug", label: "Bug", icon: "info" },
    { id: "Other", label: "Other", icon: "list" }
];
const DAY = 86400000;

function parse(raw) {
    const text = String(raw || "");
    const m = /^\[(Bug|Feature Request|Other)\]\s?/.exec(text);
    if (m) return { category: m[1], text: text.slice(m[0].length) };
    if (/^\[App submission\]/.test(text)) return { category: "App", text: text.replace(/^\[App submission\]\s*/, "") };
    return { category: null, text };
}
const CAT_LABEL = { "Feature Request": "Feature request", Bug: "Bug", Other: "Other", App: "App submission" };

export default {
    async render(root) {
        let filter = "all", query = "", category = "Feature Request";
        await account.ready();
        const me = account.current();
        const role = await admin.myRole();

        // ---- Compose ----
        const catChips = h("div.chips", { role: "radiogroup", "aria-label": "Kind of suggestion" });
        const paintCats = () => { clear(catChips); CATEGORIES.forEach((c) => catChips.appendChild(h("button.chip", { type: "button", role: "radio", "aria-checked": String(category === c.id), "aria-pressed": String(category === c.id),
            onclick: () => { category = c.id; paintCats(); } }, icon(c.icon), c.label))); };
        paintCats();
        const text = h("textarea.input.note-input.sg-input", { maxlength: 500, rows: 3, placeholder: "What would you like to see added or changed? Found something broken? Tell us." });
        const count = h("span.muted.sg-count", null, "0 / 500");
        text.addEventListener("input", () => { count.textContent = `${text.value.length} / 500`; });
        const err = h("p.account-status");
        const send = h("button.btn.primary", { type: "button" }, icon("arrow"), "Send suggestion");
        const who = h("p.muted.sg-who", null, me.signedIn ? `Posting as ${me.username}` : "Posting anonymously. ",
            me.signedIn ? null : h("button.link-btn", { type: "button", onclick: () => openAccount("in", { reason: "Sign in so your suggestions carry your name." }) }, "Sign in to use your name"));
        send.onclick = async () => {
            const t = text.value.trim();
            if (t.length < 3) { err.textContent = "Please write a bit more detail."; return; }
            send.disabled = true; err.textContent = "";
            const r = await call("submit-suggestion", { username: account.current().username || null, text: `[${category}] ${t}` });
            send.disabled = false;
            if (!r || !r.success) { err.textContent = (r && r.error) || "That didn't go through. Try again."; return; }
            text.value = ""; count.textContent = "0 / 500";
            toast("Thanks! Your suggestion is in.");
            load();
        };

        // ---- List ----
        const chips = h("div.chips", { role: "group", "aria-label": "Show" });
        const search = h("input.input", { type: "search", placeholder: "Search suggestions", "aria-label": "Search suggestions", style: { width: "240px" } });
        const list = h("div.sg-list");
        const tools = h("div.actions");
        if (role) {
            tools.append(
                h("span.badge.sg-role", null, icon("gem"), role.root ? "Root" : "Admin"),
                h("button.btn", { type: "button", onclick: async () => {
                    const r = await admin.run("export-suggestions-txt", {});
                    if (r && r.success) toast("Suggestions exported");
                    else if (r && !r.canceled) toast(r.error || "Export didn't finish.", "err");
                } }, icon("download"), "Export .txt"));
        }

        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Suggestions"), h("p", null, "Got an idea for Riftgate, or found a bug? Everyone can see what's been suggested, and the Riftgate Team answers here.")),
                tools),
            h("section.sg-compose", null, catChips, text, h("div.sg-row", null, who, count), err, h("div", null, send)),
            h("div.sg-filters", null, chips, search),
            list);

        let all = [], admins = [];
        const roleName = (u) => {
            const a = admins.find((x) => x.username === u) || admins.find((x) => String(x.username).replace(/_(adm|root)$/i, "").toLowerCase() === String(u || "").replace(/_(adm|root)$/i, "").toLowerCase());
            return a ? (a.is_super_admin ? "Root" : "Admin") : null;
        };

        function paintChips() {
            clear(chips);
            const n = (f) => all.filter(f).length;
            [["all", "All", () => true], ["Feature Request", "Feature requests", (s) => s.cat === "Feature Request"], ["Bug", "Bugs", (s) => s.cat === "Bug"],
                ["Other", "Other", (s) => s.cat === "Other"], ["App", "App submissions", (s) => s.cat === "App"],
                ...(account.current().signedIn ? [["mine", "Mine", (s) => s.username === account.current().username]] : []),
                ["answered", "Answered", (s) => s.replies.length || s.status]]
                .forEach(([id, label, f]) => {
                    const c = n(f);
                    if (id !== "all" && id !== "mine" && !c) return;
                    chips.appendChild(h("button.chip", { type: "button", "aria-pressed": String(filter === id), onclick: () => { filter = id; paintChips(); paint(); } }, label, h("span.n", null, String(c))));
                });
        }

        function item(s) {
            const r = roleName(s.username);
            const el = h("article.sg-item", { dataset: { status: s.status || "open" } },
                h("div.sg-meta", null,
                    h("b", null, s.username || "Anonymous"),
                    r ? h("span.sg-admin", null, r) : null,
                    s.cat ? h("span.sg-cat", { dataset: { c: s.cat } }, CAT_LABEL[s.cat]) : null,
                    h("span.muted", null, ago(Date.parse(s.created_at))),
                    s.status === "applied" ? h("span.sg-status.ok", null, icon("check"), "Applied") : null,
                    s.status === "rejected" ? h("span.sg-status.no", null, icon("x"), "Refused") : null),
                h("p.sg-text", null, s.text));
            s.replies.forEach((rp) => {
                const rr = h("div.sg-reply", null, h("div.sg-meta", null, h("img.sg-team", { src: "assets/riftgate-gem-mark.png", alt: "" }), h("b", null, "Riftgate Team"), h("span.muted", null, ago(Date.parse(rp.created_at)))),
                    h("p.sg-text", null, rp.reply_text));
                if (role) rr.appendChild(h("button.link-btn.sg-del", { type: "button", onclick: async () => {
                    const x = await admin.run("delete-reply", { id: rp.id }); if (x && x.success) { toast("Reply removed"); load(); } } }, "Remove reply"));
                el.appendChild(rr);
            });
            if (role) {
                const box = h("div.sg-admin-tools");
                const replyIn = h("textarea.input.note-input", { rows: 2, maxlength: 1000, placeholder: "Reply as the Riftgate Team…" });
                const doReply = h("button.btn", { type: "button", onclick: async () => {
                    const t = replyIn.value.trim(); if (!t) return;
                    const x = await admin.run("add-admin-reply", { suggestionId: s.id, text: t });
                    if (x && x.success) { toast("Reply posted"); load(); } else if (x) toast(x.error || "The reply didn't go through.", "err");
                } }, icon("arrow"), "Reply");
                const mark = (ch, okMsg) => async () => { const x = await admin.run(ch, { id: s.id }); if (x && x.success) { toast(okMsg); load(); } else if (x) toast(x.error || "That didn't go through.", "err"); };
                box.append(replyIn, h("div.sg-admin-actions", null, doReply,
                    s.status !== "applied" ? h("button.btn", { type: "button", onclick: mark("apply-suggestion", "Marked as applied") }, icon("check"), "Applied") : null,
                    s.status !== "rejected" ? h("button.btn", { type: "button", onclick: mark("reject-suggestion", "Marked as refused") }, icon("x"), "Refuse") : null,
                    h("button.btn.ghost", { type: "button", onclick: mark("delete-suggestion", "Suggestion removed") }, icon("trash"), "Remove")));
                const toggle = h("button.link-btn", { type: "button", onclick: () => { box.hidden = !box.hidden; if (!box.hidden) replyIn.focus(); } }, "Admin tools");
                box.hidden = true;
                el.append(toggle, box);
            }
            return el;
        }

        function paint() {
            const q = query.trim().toLowerCase();
            const me2 = account.current().username;
            const f = {
                all: () => true, mine: (s) => s.username === me2, answered: (s) => s.replies.length || s.status
            }[filter] || ((s) => s.cat === filter);
            const shown = all.filter(f).filter((s) => !q || `${s.text} ${s.username || ""}`.toLowerCase().includes(q));
            clear(list);
            if (!shown.length) { list.appendChild(h("div.empty", null, icon("list"), h("h3", null, all.length ? "Nothing matches" : "No suggestions yet"), h("p", null, all.length ? "Try another filter." : "Be the first!"))); return; }
            shown.forEach((s) => list.appendChild(item(s)));
        }

        async function load() {
            clear(list).appendChild(h("p.muted", null, "Loading suggestions…"));
            forget("get-admin-list-detailed");
            const [r, adm] = await Promise.all([call("get-suggestions"), admin.adminList()]);
            admins = adm;
            if (!r || !r.success) { clear(list).appendChild(h("div.empty", null, icon("info"), h("h3", null, (r && r.error) || "Suggestions couldn't load."))); return; }
            // Applied or refused ones stay visible for a day, as in Riftgate 1.x (admins see all)
            all = r.suggestions
                .filter((s) => role || !s.resolved_at || Date.now() - Date.parse(s.resolved_at) < DAY)
                .map((s) => { const p = parse(s.suggestion_text); return { ...s, cat: p.category, text: p.text, replies: s.suggestion_replies || [] }; });
            paintChips(); paint();
        }
        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 150));
        // Signing in or out redraws the page (your name, admin tools)
        let lastUser = me.username;
        const off = account.onChange((st) => {
            if (!root.isConnected) return off();
            if (st.username === lastUser) return;
            lastUser = st.username; off();
            clear(root); this.render(root);
        });
        load();
    }
};
