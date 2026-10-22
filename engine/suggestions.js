// New suggestions, for admins: while an admin is signed in, Riftgate looks
// for suggestions made since they last opened Suggestions (every 10 minutes,
// one small request for the newest 20), tells the window how many are new
// (the Suggestions button blinks) and shows a Windows notification for each
// new batch. Nothing is asked when no admin is signed in. What was seen and
// notified is kept per PC in r2-suggestions-seen.json.
"use strict";
const { Notification } = require("electron");
const { supabaseRequest } = require("../services/supabase");
const data = require("./core/data");
const windowRef = require("./core/window");

const FILE = () => data.file("r2-suggestions-seen.json");
const EVERY = 10 * 60 * 1000;
const PATH = "suggestions?select=id,username,suggestion_text,created_at&order=created_at.desc&limit=20";

// "[Bug] It crashes" -> { kind: "Bug", text: "It crashes" }
function parse(raw) {
    const text = String(raw || "");
    const m = /^\[(Bug|Feature Request|Other|App submission)\]\s*/.exec(text);
    return m ? { kind: m[1] === "Feature Request" ? "Feature request" : m[1], text: text.slice(m[0].length) } : { kind: null, text };
}

// The suggestions newer than `since` that someone else made
function fresh(list, since, me) {
    const mine = String(me || "").replace(/_(adm|root)$/i, "").toLowerCase();
    return (Array.isArray(list) ? list : [])
        .filter((s) => s && Date.parse(s.created_at) > since)
        .filter((s) => !mine || String(s.username || "").replace(/_(adm|root)$/i, "").toLowerCase() !== mine);
}

function register(ipcMain, { iconPath }) {
    let watching = null; // the admin's username while one is signed in
    let timer = null;
    let lastCount = 0;

    const state = () => data.readJson(FILE(), null) || {};
    const save = (patch) => data.writeJson(FILE(), { ...state(), ...patch });

    function notify(news) {
        try {
            if (!Notification.isSupported()) return;
            const first = news[0], p = parse(first.suggestion_text);
            const who = first.username || "Someone";
            const n = new Notification({
                title: news.length === 1 ? `New suggestion from ${who}` : `${news.length} new suggestions`,
                body: news.length === 1 ? `${p.kind ? p.kind + ": " : ""}${p.text}`.slice(0, 180) : news.slice(0, 3).map((s) => `${s.username || "Someone"}: ${parse(s.suggestion_text).text}`.slice(0, 60)).join("\n"),
                icon: iconPath(),
                silent: false
            });
            n.on("click", () => { windowRef.show(); windowRef.send("r2-alert-open", { view: "suggestions" }); });
            n.show();
        } catch (e) { console.error("[suggestions] notification failed:", e.message || e); }
    }

    async function check() {
        if (!watching) return { count: 0 };
        const st = state();
        // the first time on this PC: start from now, don't announce the whole history
        if (!st.seenAt) { save({ seenAt: Date.now(), notifiedAt: Date.now() }); return { count: 0 }; }
        let r;
        try { r = await supabaseRequest(PATH, "GET"); } catch (e) { return { count: lastCount }; }
        if (!r || r.statusCode !== 200) return { count: lastCount };
        const unseen = fresh(r.body, st.seenAt, watching);
        const toTell = fresh(r.body, st.notifiedAt || st.seenAt, watching);
        lastCount = unseen.length;
        windowRef.send("r2-suggestions-new", { count: lastCount, latest: toTell.length ? { username: toTell[0].username || null, text: parse(toTell[0].suggestion_text).text.slice(0, 140) } : null, told: toTell.length });
        if (toTell.length) {
            save({ notifiedAt: Math.max(...toTell.map((s) => Date.parse(s.created_at))) });
            notify(toTell);
        }
        return { count: lastCount };
    }

    // the window says who's signed in, and whether they're an admin
    ipcMain.handle("r2-suggestions-watch", async (event, who) => {
        const name = typeof who === "string" && /^[\w.-]{1,40}$/.test(who) ? who : null;
        watching = name;
        clearInterval(timer); timer = null;
        if (!watching) { lastCount = 0; return { count: 0 }; }
        timer = setInterval(() => check().catch(() => {}), EVERY);
        return check();
    });
    // the admin opened Suggestions: everything up to now is seen
    ipcMain.handle("r2-suggestions-seen", async () => {
        save({ seenAt: Date.now(), notifiedAt: Math.max(Date.now(), state().notifiedAt || 0) });
        lastCount = 0;
        return { count: 0 };
    });
}

module.exports = { register, parse, fresh };
