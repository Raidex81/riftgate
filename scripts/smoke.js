// node scripts/smoke.js — every page of Riftgate opens without an error.
// Serves the interface from this folder, opens it in a headless Chromium with
// a stand-in for the engine (every question answered with nothing, so pages
// show their empty states), then visits each page of the rail and Settings.
// A JavaScript error on any page fails the run. Needs Playwright:
//   npm i --no-save playwright && npx playwright install chromium
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { console.error("smoke: Playwright isn't installed (npm i --no-save playwright && npx playwright install chromium)"); process.exit(2); }

const root = path.join(__dirname, "..");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".ico": "image/x-icon" };

// the pages: every { id: "…" } in the rail (src/app/main.js), and Settings
const mainJs = fs.readFileSync(path.join(root, "src/app/main.js"), "utf8");
const block = mainJs.slice(mainJs.indexOf("const VIEWS = ["), mainJs.indexOf("];", mainJs.indexOf("const VIEWS = [")));
const pages = [...block.matchAll(/\{ id: "([a-z-]+)"/g)].map((m) => m[1]).concat("settings");

// the engine's stand-in: settings, a store with the first-run tour already seen, nothing else
const STUB = `(() => {
  const S = { seasonalEvents: false, startupAnimation: false, startupSound: false, language: "en" };
  const answers = { "get-settings": S, "load-settings": S, "r2-settings": S, "load-games": [], "r2-library": [],
    "r2-store-get": { journal: {}, prefs: { "pref:tour:done": { value: ["general","rail-drag","gh-star","facts","card-size","ask-rift","free-alerts","wishlist","achievements","seals"] } } } };
  window.riftgate = {
    invoke: async (ch) => (ch in answers ? answers[ch] : null),
    invokeMeta: async (ch, ...a) => ({ value: await window.riftgate.invoke(ch, ...a), meta: null }),
    on: () => () => {}, send: () => {}, writeText: () => {}, pathForFile: () => null
  };
  try { sessionStorage.setItem("r2-intro", "1"); } catch (e) {}
})();`;

const server = http.createServer((q, r) => {
    const p = path.join(root, decodeURIComponent(q.url.split("?")[0]));
    if (!p.startsWith(root)) { r.statusCode = 403; return r.end(); }
    fs.readFile(p, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader("content-type", TYPES[path.extname(p)] || "application/octet-stream"); r.end(d); });
});

server.listen(0, "127.0.0.1", async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    let where = "start";
    page.on("pageerror", (e) => errors.push(`${where}: ${e.message}`));
    // a page that failed to draw (the router logs it and shows "This section couldn't open");
    // a site that couldn't be reached isn't a failure here: everything outside is refused on purpose
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_|ERR_FAILED|ERR_BLOCKED|fetch/i.test(m.text())) errors.push(`${where}: ${m.text().slice(0, 300)}`); });
    // nothing leaves this machine: the internet is answered with "no"
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.addInitScript(STUB);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForTimeout(2500);
    for (const id of pages) {
        where = id;
        await page.evaluate((h) => { location.hash = h; }, id);
        await page.waitForTimeout(1200);
        const shown = await page.evaluate((h) => !!document.querySelector(`.view[data-view="${h}"]`), id);
        const broke = await page.evaluate(() => [...document.querySelectorAll(".view .empty h3")].some((e) => /couldn't open/i.test(e.textContent)));
        if (broke) errors.push(`${id}: "This section couldn't open"`);
        // companion and admin pages only appear when they apply; the rest must open
        if (!shown && !["dune", "vault", "admin"].includes(id)) errors.push(`${id}: the page didn't open`);
        console.log(`${shown ? "ok " : "-- "} ${id}`);
    }
    await browser.close(); server.close();
    if (errors.length) { console.error(`\nsmoke: ${errors.length} problem(s)\n` + errors.map((e) => "  " + e).join("\n")); process.exit(1); }
    console.log(`smoke: ${pages.length} pages opened without an error`);
});
