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
const SECTIONS = ["new", "installed", "free-games", "store", "theatre", "reading-room", "applications"];

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
    await page.waitForSelector(".sidebarNavBtn", { timeout: 45000 });
    record("App launches", true, "main window loaded");
  } catch {
    await page.screenshot({ path: path.join(OUT, "00-broken-launch.png") }).catch(() => {});
    record("App launches", false, "window opened but the interface never appeared");
    return;
  }

  await sleep(8000);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  record("Window size", vp.w >= 1000 && vp.h >= 600, `${vp.w}×${vp.h}`);
  await page.screenshot({ path: path.join(OUT, "01-first-launch.png") });
  desktopShot("01-first-launch-desktop");

  const tour = await page.evaluate(() => {
    const g = document.getElementById("tourOverlayGroup");
    const shown = !!g && g.style.display === "block";
    if (shown && typeof endTour === "function") endTour();
    return shown;
  });
  record("First-run tour", null, tour ? "appeared (closed it to continue)" : "did not appear");

  const reported = await page.evaluate(() => window.riftgate && window.riftgate.invoke ? window.riftgate.invoke("get-app-version") : null).catch(() => null);
  if (reported) record("Version reported by the app", EXPECTED ? reported === EXPECTED : null, reported);

  // 3. Every main section
  for (const [i, section] of SECTIONS.entries()) {
    const before = pageErrors.length;
    const ok = await page.evaluate((s) => { if (typeof switchSection !== "function") return false; switchSection(s); return true; }, section);
    await sleep(section === "store" || section === "free-games" || section === "new" ? 12000 : 6000);
    const file = `${String(i + 2).padStart(2, "0")}-${section}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const info = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
      const cards = [...document.querySelectorAll(".game-card")].filter(visible);
      // Cards sharing a row must be the same height (the 1.6.2 fix).
      let unevenRows = 0;
      for (const track of document.querySelectorAll(".carousel-track, .games-grid")) {
        if (!visible(track)) continue;
        const rows = new Map();
        for (const c of track.children) {
          if (!visible(c)) continue;
          const r = c.getBoundingClientRect();
          const key = Math.round(r.top);
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push(r.height);
        }
        for (const hs of rows.values()) if (hs.length > 1 && Math.max(...hs) - Math.min(...hs) > 2) unevenRows++;
      }
      const brokenImages = [...document.images].filter((im) => visible(im) && im.complete && im.naturalWidth === 0).length;
      return { cards: cards.length, unevenRows, brokenImages };
    });
    const newErrors = pageErrors.length - before;
    record(
      `Section: ${section}`,
      ok && newErrors === 0 && info.unevenRows === 0,
      `${info.cards} cards, ${info.unevenRows} uneven rows, ${info.brokenImages} broken images, ${newErrors} script errors — ${file}`
    );
  }

  // 4. Theme switch — the header should follow each theme's colours.
  await page.evaluate((s) => switchSection(s), "installed");
  await sleep(2000);
  const themed = [];
  for (const theme of ["emerald", "crimson", "frost", "riftgate"]) {
    const found = await page.evaluate((t) => {
      const btn = document.querySelector(`.themeOption[data-theme="${t}"]`);
      if (!btn) return false;
      btn.click();
      return true;
    }, theme);
    if (!found) continue;
    await sleep(1200);
    const header = await page.$(".hero-banner");
    if (header) await header.screenshot({ path: path.join(OUT, `header-${theme}.png`) });
    themed.push(theme);
  }
  record("Header in different themes", themed.length ? null : false, themed.length ? `header-${themed.join(".png, header-")}.png` : "theme buttons not found");

  desktopShot("99-desktop-end");
  await browser.close().catch(() => {});

  // 5. Still running after all of that?
  record("App still running at the end", !exitInfo, exitInfo ? `exited (code ${exitInfo.code}, signal ${exitInfo.signal})` : "");
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
  writeReport();
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\n${failed ? failed + " check(s) failed" : "All checks passed"} — screenshots and report in ${OUT}`);
  process.exit(failed ? 1 : 0);
}
