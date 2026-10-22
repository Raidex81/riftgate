// node tests/suggestions.test.js — engine/suggestions.js: admins hear about
// new suggestions (not their own), once each, and nothing is asked otherwise.
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rg-sugg-"));
const shown = [], sent = [], asked = [];
let rows = [];
class FakeNotification { constructor(o) { this.o = o; } static isSupported() { return true; } on() {} show() { shown.push(this.o); } }
const origLoad = Module._load;
Module._load = function (req, ...rest) {
    if (req === "electron") return { app: { getPath: () => tmp }, Notification: FakeNotification };
    if (req === "../services/supabase") return { supabaseRequest: async (p) => { asked.push(p); return { statusCode: 200, body: rows }; } };
    if (req === "./core/window") return { send: (c, d) => sent.push([c, d]), show() {} };
    return origLoad.call(this, req, ...rest);
};
const sugg = require("../engine/suggestions");
const handlers = {};
sugg.register({ handle: (c, fn) => { handlers[c] = fn; } }, { iconPath: () => null });
const call = (c, ...a) => handlers[c]({}, ...a);
const ago = (min) => new Date(Date.now() - min * 60e3).toISOString();

(async () => {
    assert.deepStrictEqual(sugg.parse("[Bug] It crashes"), { kind: "Bug", text: "It crashes" });
    assert.deepStrictEqual(sugg.parse("[Feature Request] Dark mode"), { kind: "Feature request", text: "Dark mode" });

    // nobody signed in as admin: nothing is asked
    assert.deepStrictEqual(await call("r2-suggestions-watch", null), { count: 0 });
    assert.strictEqual(asked.length, 0);

    // the first time on this PC: starts from now, the old ones aren't announced
    rows = [{ id: 1, username: "ana", suggestion_text: "[Bug] old", created_at: ago(60) }];
    assert.deepStrictEqual(await call("r2-suggestions-watch", "Raidex81_Adm"), { count: 0 });
    assert.strictEqual(shown.length, 0);

    // a new one from someone else, and one of the admin's own
    await new Promise((r) => setTimeout(r, 30));
    rows = [{ id: 3, username: "Raidex81", suggestion_text: "mine", created_at: new Date(Date.now() - 5).toISOString() },
        { id: 2, username: "rui", suggestion_text: "[Feature Request] Spanish please", created_at: new Date(Date.now() - 10).toISOString() }, ...rows];
    assert.deepStrictEqual(await call("r2-suggestions-watch", "Raidex81"), { count: 1 });
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(shown[0].title, "New suggestion from rui");
    assert.strictEqual(shown[0].body, "Feature request: Spanish please");
    assert.deepStrictEqual(sent.pop(), ["r2-suggestions-new", { count: 1, latest: { username: "rui", text: "Spanish please" }, told: 1 }]);

    // asked again: still new (not opened yet) but not announced twice
    await call("r2-suggestions-watch", null); await call("r2-suggestions-watch", "Raidex81");
    assert.strictEqual(shown.length, 1);
    assert.strictEqual(sent.pop()[1].count, 1, "the button keeps blinking until Suggestions is opened");

    // opened: seen
    await new Promise((r) => setTimeout(r, 5));
    await call("r2-suggestions-seen");
    await call("r2-suggestions-watch", null); await call("r2-suggestions-watch", "Raidex81");
    assert.strictEqual(sent.pop()[1].count, 0);
    assert.strictEqual(shown.length, 1);

    await call("r2-suggestions-watch", null);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("suggestions: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
