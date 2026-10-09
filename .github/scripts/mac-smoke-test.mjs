// Riftgate — Mac smoke test (run by .github/workflows/mac-smoke-test.yml)
//
// Launches an installed Riftgate.app on a real macOS machine, walks through
// every main section and saves screenshots plus a pass/fail report. It drives
// the app over Chromium's remote-debugging port (the --inspect route is
// switched off by the enableNodeCliInspectArguments fuse), so it needs only
// playwright-core, not a browser download.
//
// Env: APP_PATH (default /Applications/Riftgate.app), OUT_DIR, EXPECTED_VERSION, LABEL

import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const APP = process.env.APP_PATH || "/Applications/Riftgate.app";
const OUT = process.env.OUT_DIR || path.resolve("smoke-results");
const EXPECTED = (process.env.EXPECTED_VERSION || "").replace(/^v/, "");
const LABEL = process.env.LABEL || "mac";
const PORT = 9333;
const SECTIONS = ["nexus", "free", "deals", "theatre", "reading", "apps", "library", "journal", "themes", "settings"];

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const pageErrors = [];
const consoleErrors = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok === true ? "PASS" : ok === false ? "FAIL" : "INFO"}  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ""}${e.stderr || ""}`.trim() || e.message };
  }
}
function desktopShot(name) {
  // Whole-screen capture: shows the menu bar (tray icon) and native dialogs.
  // Needs screen-recording permission, which some runner images lack.
  const r = run("screencapture", ["-x", path.join(OUT, `${name}.png`)]);
  if (!r.ok) console.log(`(desktop screenshot ${name} not available: ${r.out})`);
}

function writeReport() {
  const icon = (ok) => (ok === true ? "✅" : ok === false ? "❌" : "ℹ️");
  const lines = [
    `## Riftgate Mac smoke test — ${LABEL}`,
    "",
    "| | Check | Detail |",
    "|---|---|---|",
    ...results.map((r) => `| ${icon(r.ok)} | ${r.name} | ${String(r.detail).replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    "",
  ];
  if (pageErrors.length) lines.push("### Uncaught page errors", "", ...pageErrors.map((e) => `- ${e}`), "");
  fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n"));
  fs.writeFileSync(path.join(OUT, "console-errors.txt"), consoleErrors.join("\n") || "(none)");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

let child;
let exitInfo = null;

async function main() {
  // 1. What's installed
  const plist = path.join(APP, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) {
    record("Riftgate.app installed", false, `${APP} not found`);
    return;
  }
  const version = run("plutil", ["-extract", "CFBundleShortVersionString", "raw", plist]).out;
  record("App version", EXPECTED ? version === EXPECTED : null, EXPECTED ? `found ${version}, expected ${EXPECTED}` : version);

  const arch = run("lipo", ["-archs", path.join(APP, "Contents", "MacOS", "Riftgate")]).out;
  record("Architecture", null, `${arch} (machine: ${run("uname", ["-m"]).out}, macOS ${run("sw_vers", ["-productVersion"]).out})`);

  const sig = run("codesign", ["--verify", "--deep", "--strict", APP]);
  record("Code signature intact (ad-hoc)", sig.ok, sig.ok ? "" : sig.out.slice(0, 300));

  const gk = run("spctl", ["--assess", "--type", "execute", APP]);
  record("Gatekeeper", null, gk.ok ? "accepted" : "rejected — expected for an unsigned build (users need right-click → Open)");

  // 2. Launch
  const log = fs.openSync(path.join(OUT, "app-log.txt"), "w");
  child = spawn(path.join(APP, "Contents", "MacOS", "Riftgate"), [`--remote-debugging-port=${PORT}`], {
    stdio: ["ignore", log, log],
  });
  child.on("exit", (code, signal) => { exitInfo = { code, signal }; });

  let connected = false;
  for (let i = 0; i < 90 && !exitInfo; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { connected = true; break; }
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  if (!connected) {
    record("App launches", false, exitInfo ? `exited early (code ${exitInfo.code}, signal ${exitInfo.signal}) — see app-log.txt` : "no window after 90 s");
    return;
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    for (const ctx of browser.contexts()) {
      page = ctx.pages().find((p) => p.url().startsWith("http://127.0.0.1")) || null;
      if (page) break;
    }
    if (!page) await sleep(1000);
  }
  if (!page) {
    record("App launches", false, "Riftgate's main window never loaded");
    return;
  }
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 500)); });

  try {
    await page.waitForSelector(".rail .nav-item", { timeout: 45000 });
    record("App launches", true, "main window loaded");
  } catch {
    await page.screenshot({ path: path.join(OUT, "00-broken-launch.png") }).catch(() => {});
    record("App launches", false, "window opened but the interface never appeared");
    return;
  }

  // The opening animation (5.5 s) plays on a real start; let it finish.
  await sleep(8000);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  record("Window size", vp.w >= 1000 && vp.h >= 600, `${vp.w}×${vp.h}`);
  await page.screenshot({ path: path.join(OUT, "01-first-launch.png") });
  desktopShot("01-first-launch-desktop");

  // First start: "What are you into?", then the tour. Answer like a user.
  const interests = await page.evaluate(() => {
    const done = document.querySelector(".interests-portal .btn.primary");
    if (!done) return false;
    done.click();
    return true;
  });
  record("What are you into?", null, interests ? "appeared (kept the defaults)" : "did not appear");
  await sleep(2500);
  const tour = await page.evaluate(() => !!document.querySelector(".tour-tip"));
  if (tour) await page.keyboard.press("Escape");
  record("First-run tour", null, tour ? "appeared (closed it to continue)" : "did not appear");

  const reported = await page.evaluate(() => window.riftgate && window.riftgate.invoke ? window.riftgate.invoke("get-app-version") : null).catch(() => null);
  if (reported) record("Version reported by the app", EXPECTED ? reported === EXPECTED : null, reported);

  // 3. Every section
  for (const [i, section] of SECTIONS.entries()) {
    const before = pageErrors.length;
    await page.evaluate((s) => { location.hash = s; }, section);
    await sleep(["nexus", "free", "deals"].includes(section) ? 12000 : 6000);
    const file = `${String(i + 2).padStart(2, "0")}-${section}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const info = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      const opened = !document.querySelector(".view .empty h3")?.textContent.includes("couldn't open");
      const cards = [...document.querySelectorAll(".view .card")].filter(visible);
      // Cards sharing a row must be the same height, their coloured bars lined up.
      let unevenRows = 0;
      for (const track of document.querySelectorAll(".row-track, .grid")) {
        if (!visible(track)) continue;
        const rows = new Map();
        for (const c of track.children) {
          if (!c.classList.contains("card") || !visible(c)) continue;
          const r = c.getBoundingClientRect();
          const key = Math.round(r.top);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push(r.height);
        }
        for (const hs of rows.values()) if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 2) unevenRows++;
      }
      const brokenImages = [...document.images].filter((im) => visible(im) && im.complete && im.naturalWidth === 0).length;
      return { opened, cards: cards.length, unevenRows, brokenImages };
    });
    const newErrors = pageErrors.length - before;
    record(
      `Section: ${section}`,
      info.opened && newErrors === 0 && info.unevenRows === 0,
      `${info.cards} cards, ${info.unevenRows} uneven rows, ${info.brokenImages} broken images, ${newErrors} script errors — ${file}`
    );
  }

  // 3b. "See all" on the first rows of Nexus and Theatre: each should load real items.
  for (const section of ["nexus", "theatre"]) {
    await page.evaluate((s) => { location.hash = s; }, section);
    await sleep(6000);
    const titles = await page.evaluate(() => [...document.querySelectorAll(".row-head .see-all:not([hidden])")].slice(0, 3).map((a, i) => i));
    for (const i of titles) {
      const name = await page.evaluate((n) => { const a = document.querySelectorAll(".row-head .see-all:not([hidden])")[n]; if (!a) return null; const t = a.closest(".row-head")?.querySelector("h2")?.textContent || `row ${n}`; a.click(); return t; }, i);
      if (!name) continue;
      let cards = 0;
      for (let k = 0; k < 30 && !cards; k++) { await sleep(1000); cards = await page.evaluate(() => document.querySelectorAll(".browser .card").length); }
      await page.screenshot({ path: path.join(OUT, `see-all-${section}-${i}.png`) });
      record(`See all: ${name.trim()}`, cards > 0, `${cards} cards`);
      await page.keyboard.press("Escape");
      await sleep(800);
    }
  }

  // 3c. Cinemas from OpenStreetMap for a city (the Theatre's "Your cinema").
  for (const [cc, city] of [["PT", "Lisbon"], ["US", "New York"]]) {
    const r = await page.evaluate((a) => window.riftgate.invoke("get-cinemas", a), { countryCode: cc, city }).catch((e) => ({ cinemas: [], error: String(e) }));
    const list = (r && r.cinemas) || [];
    const withSite = list.filter((c) => c.url).length;
    record(`Cinemas: ${city}`, list.length > 0 ? true : r && r.error ? null : false,
      r && r.error ? r.error : `${list.length} cinemas, ${withSite} with a website — nearest: ${list.slice(0, 3).map((c) => c.label).join("; ")}`);
  }

  // 4. Themes: the menu (gem, wordmark) should follow each theme's colours.
  await page.evaluate(() => { location.hash = "settings"; });
  await sleep(3000);
  const themed = [];
  for (let n = 0; n < 4; n++) {
    const name = await page.evaluate((k) => { const b = document.querySelectorAll(".swatches button")[k]; if (!b) return null; b.click(); return b.title; }, n);
    if (!name) continue;
    await sleep(1200);
    const rail = await page.$(".rail");
    const file = `theme-${n + 1}.png`;
    if (rail) await rail.screenshot({ path: path.join(OUT, file) });
    themed.push(`${name} (${file})`);
  }
  record("Menu in different themes", themed.length ? null : false, themed.length ? themed.join(", ") : "theme swatches not found");

  desktopShot("99-desktop-end");
  await browser.close().catch(() => {});

  // 5. Still running after all of that?
  record("App still running at the end", !exitInfo, exitInfo ? `exited (code ${exitInfo.code}, signal ${exitInfo.signal})` : "");
}

// Problems that only show up in the app's own log / the page console.
function checkLogs() {
  let log = "";
  try { log = fs.readFileSync(path.join(OUT, "app-log.txt"), "utf8"); } catch { return; }
  record("Menu-bar icon", !/tray icon failed/.test(log), (log.match(/tray icon failed[^\n]*/) || [""])[0].slice(0, 200));
    const vr = log.match(/itch\.io VR: found (\d+)/);
  const vrFailed = /itch\.io fetch failed \([^)]*tag-/.test(log);
  record("itch.io free VR games", vrFailed ? false : vr ? Number(vr[1]) > 0 : null, vrFailed ? "itch.io VR page failed to load" : vr ? `${vr[1]} found` : "not fetched this run");
  const blocked = consoleErrors.filter((e) => /Content Security Policy/.test(e));
  record("Nothing blocked by the security policy", blocked.length === 0, blocked.length ? blocked[0].slice(0, 200) : "");
}

try {
  await main();
} catch (e) {
  record("Test script", false, String(e && e.stack ? e.stack : e).slice(0, 500));
} finally {
  if (child && !exitInfo) {
    child.kill("SIGTERM");
    for (let i = 0; i < 20 && !exitInfo; i++) await sleep(500);
    if (!exitInfo) child.kill("SIGKILL");
  }
  checkLogs();
  writeReport();
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\n${failed ? failed + " check(s) failed" : "All checks passed"} — screenshots and report in ${OUT}`);
  process.exit(failed ? 1 : 0);
}
