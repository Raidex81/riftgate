// Riftgate — Seals, on screen: the badge, the grid in the Journal, and the
// moment one is earned (it rises from the bottom with a chime).

import { h, icon, clear } from "../app/dom.js";
import * as S from "../app/seals.js";
import { settings } from "../app/api.js";
import { dateLong } from "../app/format.js";

const RARITY = ["", "Common", "Rare", "Epic", "Legendary"];

export function badge(seal, { earned = false, big = false } = {}) {
    return h(`span.seal-badge.r${seal.rarity}${earned ? ".earned" : ""}${big ? ".big" : ""}`, { "aria-hidden": "true" },
        h("span.seal-gem", null, icon(earned || !seal.secret ? seal.icon : "lock")));
}

// The Journal's "Seals" section
export function sealsSection() {
    const grid = h("div.seals-grid");
    const head = h("p.muted.seals-count");
    const el = h("section.seals", { "aria-label": "Seals" }, h("h2", null, icon("trophy"), "Seals"), head, grid);
    async function paint() {
        const have = S.earned(), st = await S.stats();
        const n = S.SEALS.filter((x) => have[x.id]).length;
        head.textContent = `${n} of ${S.SEALS.length} earned. Small marks of everything you play, watch and read${n < S.SEALS.length ? "; some are secret" : ""}.`;
        clear(grid);
        S.SEALS.slice().sort((a, b) => (have[b.id] ? 1 : 0) - (have[a.id] ? 1 : 0)).forEach((x) => {
            const got = !!have[x.id];
            const hidden = x.secret && !got;
            const p = !got && x.progress ? x.progress(st) : null;
            grid.appendChild(h(`div.seal-tile${got ? ".earned" : ""}`, { title: got ? `Earned ${dateLong(have[x.id])}` : hidden ? "A secret seal" : x.hint },
                badge(x, { earned: got }),
                h("div.seal-text", null,
                    h("b", null, hidden ? "???" : x.name),
                    h("small", null, hidden ? x.hint : got ? `${RARITY[x.rarity]} · ${dateLong(have[x.id])}` : x.hint),
                    p ? h("div.bar.seal-bar", null, h("i", { style: { width: `${Math.min(100, p[0] / p[1] * 100)}%` } })) : null,
                    p ? h("small.seal-prog", null, `${Math.min(p[0], p[1])} / ${p[1]}`) : null)));
        });
    }
    paint();
    S.onEarned(() => { if (el.isConnected) paint(); });
    return el;
}

// The moment: the badge rises, a two-note chime, gone after a few seconds
let chime = null;
function ring(rarity) {
    settings().then((s) => {
        if (s.startupSound === false) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!chime) chime = new AC();
        const t = chime.currentTime + .02, notes = rarity >= 3 ? [76, 83, 88] : [79, 86];
        notes.forEach((m, i) => [[1, .09], [2.76, .03]].forEach(([k, v]) => {
            const o = chime.createOscillator(), g = chime.createGain();
            o.type = "sine"; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12) * k;
            g.gain.setValueAtTime(0.0001, t + i * .11); g.gain.linearRampToValueAtTime(v, t + i * .11 + .005); g.gain.exponentialRampToValueAtTime(.0001, t + i * .11 + 1.4 / k);
            o.connect(g); g.connect(chime.destination); o.start(t + i * .11); o.stop(t + i * .11 + 1.5);
        }));
    }).catch(() => {});
}
const queue = [];
let showing = false;
function next() {
    if (showing || !queue.length) return;
    showing = true;
    const x = queue.shift();
    const pop = h(`div.seal-pop.r${x.rarity}`, { role: "status" },
        badge(x, { earned: true, big: true }),
        h("div", null, h("small", null, `Seal earned · ${RARITY[x.rarity]}`), h("b", null, x.name), h("span", null, x.hint)));
    pop.onclick = () => { location.hash = "journal"; pop.remove(); };
    document.body.appendChild(pop);
    ring(x.rarity);
    setTimeout(() => { pop.classList.add("out"); setTimeout(() => { pop.remove(); showing = false; next(); }, 500); }, 5200);
}
export function announce(seal) { queue.push(seal); next(); }
