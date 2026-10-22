// node tests/i18n.test.js — src/app/i18n.js's matching, and the Portuguese
// file: every sentence keeps its {0}s, nothing is empty.
"use strict";
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
    const i18n = await import(pathToFileURL(path.join(__dirname, "../src/app/i18n.js")).href);
    const pt = (await import(pathToFileURL(path.join(__dirname, "../src/app/lang/pt.js")).href)).default;

    // the language file
    const holes = (s) => [...new Set(s.match(/\{\d\}/g) || [])].sort().join();
    for (const [en, to] of Object.entries(pt)) {
        assert.ok(typeof to === "string" && to.trim(), `empty translation for ${JSON.stringify(en)}`);
        assert.strictEqual(holes(to), holes(en), `the {0}s differ in ${JSON.stringify(en)}`);
    }
    assert.ok(Object.keys(pt).length > 1500, "the Portuguese file is nearly complete");

    // what "Same as Windows" means
    assert.strictEqual(i18n.resolve("en"), "en");
    assert.strictEqual(i18n.resolve("pt"), "pt");
    assert.strictEqual(i18n.resolve("xx"), "en", "a language Riftgate doesn't have falls back to English");

    i18n.use({
        "Settings": "Definições",
        "Popular on {0}": "Popular na {0}",
        "Move {0}": "Mover {0}",
        "{0} days": "{0} dias",
        "{0} and {1}": "{0} e {1}",
        "In {0} days": "Daqui a {0} dias",
        "{0} of {1} · {2} to go": "{0} de {1} · faltam {2}",
        "{0} new free game{1}": "{0} jogo{1} grátis novo{1}",
        "game": "jogo"
    });
    const t = i18n.translate;
    assert.strictEqual(t("Settings"), "Definições");
    assert.strictEqual(t("  Settings \n"), "Definições", "spacing doesn't matter");
    assert.strictEqual(t("Library"), null, "anything not in the file stays as it is");
    assert.strictEqual(i18n.t("Library"), "Library");
    assert.strictEqual(t("Popular on Netflix"), "Popular na Netflix");
    assert.strictEqual(t("In 6 days"), "Daqui a 6 dias", "the longest pattern wins");
    assert.strictEqual(t("6 days"), "6 dias");
    assert.strictEqual(t("Hollow Tide Rising, In 6 days"), null, "a short pattern only takes a number, not part of a title");
    assert.strictEqual(t("Salt and Pepper"), null, "a pattern that is mostly blanks is never used");
    assert.strictEqual(t("3 of 10 · 7 to go"), "3 de 10 · faltam 7");
    assert.strictEqual(t("2 new free games"), "2 jogos grátis novos", "a blank used twice");
    assert.strictEqual(t("Move Popular on Netflix"), "Mover Popular na Netflix", "what's filled in is translated too");
    assert.strictEqual(t("Move game"), "Mover jogo");
    console.log("i18n: all checks passed");
})().catch((err) => { console.error(err); process.exit(1); });
