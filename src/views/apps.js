// Riftgate — Applications: apps made by the Riftgate community. Browse,
// visit, and promote your own: a submission goes to the Riftgate admins,
// who review and publish it here.

import { h, icon, clear, debounce } from "../app/dom.js";
import { call, forget } from "../app/api.js";
import * as D from "../app/data.js";
import * as journal from "../app/store.js";
import { card } from "../components/card.js";
import { toast } from "../components/toast.js";
import { plural, ago } from "../app/format.js";

const SORTS = {
    newest: { label: "Newest", fn: (a, b) => String(b.date || "").localeCompare(String(a.date || "")) },
    visited: { label: "Most visited", fn: (a, b) => (b.visits || 0) - (a.visits || 0) },
    az: { label: "Name A–Z", fn: (a, b) => a.title.localeCompare(b.title) }
};

function promoteForm(onDone) {
    const f = {
        url: h("input.input", { type: "url", placeholder: "https://github.com/you/your-app", required: true, "aria-label": "Link to your app" }),
        name: h("input.input", { type: "text", placeholder: "Your app's name", maxlength: 80, required: true, "aria-label": "App name" }),
        author: h("input.input", { type: "text", placeholder: "You (name or handle)", maxlength: 80, "aria-label": "Made by" }),
        description: h("textarea.input.note-input", { placeholder: "What does it do, and who is it for?", maxlength: 600, "aria-label": "Description" }),
        contact: h("input.input", { type: "text", placeholder: "How the admins can reach you (optional)", maxlength: 120, "aria-label": "Contact" })
    };
    const status = h("p.muted");
    const preview = h("div.promote-preview");
    const send = h("button.btn.primary.lg", { type: "submit" }, icon("rift"), "Send for review");
    const field = (label, el) => h("label.field", null, h("span", null, label), el);

    // A GitHub link fills the rest in
    f.url.addEventListener("change", async () => {
        const r = await call("r2-app-preview", f.url.value.trim());
        if (!r || !r.github) return;
        if (!f.name.value && r.name) f.name.value = r.name;
        if (!f.author.value && r.author) f.author.value = r.author;
        if (!f.description.value && r.description) f.description.value = r.description;
        clear(preview).append(icon("star"), `${r.stars != null ? r.stars.toLocaleString() + " stars" : "GitHub project"}${r.language ? " · " + r.language : ""}`);
    });

    const form = h("form.promote", { onsubmit: async (e) => {
        e.preventDefault();
        send.disabled = true; status.textContent = "Sending…";
        const r = await call("r2-submit-app", { name: f.name.value, url: f.url.value, author: f.author.value, description: f.description.value, contact: f.contact.value });
        send.disabled = false;
        if (r && r.success) {
            const mine = journal.pref("apps:submitted", []) || [];
            journal.setPref("apps:submitted", [{ name: f.name.value.trim(), url: f.url.value.trim(), at: Date.now() }, ...mine].slice(0, 20));
            status.textContent = "";
            toast(`${f.name.value.trim()} is on its way to the Riftgate admins`);
            onDone();
        } else status.textContent = (r && r.error) || "That didn't go through. Try again.";
    } },
        h("div.promote-head", null,
            h("h2", null, "Promote your app"),
            h("p.muted", null, "Made something? Share it with everyone on Riftgate. The admins review each submission and publish it here.")),
        field("Link", f.url), preview,
        h("div.field-row", null, field("Name", f.name), field("Made by", f.author)),
        field("Description", f.description),
        field("Contact", f.contact),
        h("div.promote-actions", null, send, h("button.btn.ghost", { type: "button", onclick: () => onDone(true) }, "Cancel"), status));
    return form;
}

export default {
    async render(root) {
        let query = "", sort = "newest";
        const search = h("input.input", { type: "search", placeholder: "Search applications", "aria-label": "Search applications", style: { width: "240px" } });
        const sortSel = h("select.input", { "aria-label": "Sort" }, Object.entries(SORTS).map(([k, s]) => h("option", { value: k }, s.label)));
        const promote = h("button.btn.primary", { type: "button" }, icon("plus"), "Promote your app");
        const formBox = h("div");
        const pending = h("div");
        const summary = h("p", null, "Apps made by the Riftgate community.");
        const grid = h("div.grid.apps-grid");
        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Applications"), summary),
                h("div.actions", null, search, sortSel, promote)),
            formBox, pending, grid);

        const showForm = (on) => {
            clear(formBox);
            if (on) { formBox.appendChild(promoteForm((cancelled) => { showForm(false); if (!cancelled) paintPending(); })); formBox.querySelector("input")?.focus(); }
            promote.hidden = on;
        };
        promote.onclick = () => showForm(true);

        let all = [];
        function paintPending() {
            const mine = (journal.pref("apps:submitted", []) || []).filter((s) => !all.some((a) => a.url === s.url || a.title.toLowerCase() === s.name.toLowerCase()));
            clear(pending);
            if (!mine.length) return;
            pending.appendChild(h("div.notice", null, icon("clock"),
                h("div.grow", null, h("strong", null, mine.length === 1 ? "Your submission is with the admins" : `${mine.length} of your submissions are with the admins`),
                    h("p", null, mine.map((s) => `${s.name} (sent ${ago(s.at)})`).join(" · ")))));
        }
        function paint() {
            const q = query.trim().toLowerCase();
            const list = all.filter((a) => !q || `${a.title} ${a.sub} ${a.desc}`.toLowerCase().includes(q)).sort(SORTS[sort].fn);
            clear(grid);
            if (!all.length) {
                grid.appendChild(h("div.empty", { style: { gridColumn: "1 / -1" } }, icon("app"), h("h3", null, "No community apps yet"),
                    h("p", null, "Be the first: promote an app you made.")));
                return;
            }
            list.forEach((a) => grid.appendChild(card(a, { wide: true })));
            if (!list.length) grid.appendChild(h("p.row-empty", null, `No application matches “${query}”.`));
        }

        search.addEventListener("input", debounce(() => { query = search.value; paint(); }, 120));
        sortSel.addEventListener("change", () => { sort = sortSel.value; paint(); });
        for (let i = 0; i < 6; i++) grid.appendChild(h("div.card.wide.skeleton", null, h("div.card-frame", null, h("div.card-body", null, h("div.card-art.skel")))));
        all = await D.communityApps();
        const visits = all.reduce((s, a) => s + (a.visits || 0), 0);
        summary.textContent = `${plural(all.length, "app")} made by the Riftgate community${visits ? `, visited ${visits.toLocaleString()} times` : ""}.`;
        paint();
        paintPending();
    },
    rollTitle: "Try something new",
    async rollPool() { return D.communityApps(); }
};
