// Riftgate — the Journal's Trophy room: your Steam achievements across every
// game (the logic is in app/achievements.js).

import { h, icon, clear, coverSrc } from "../app/dom.js";
import * as A from "../app/achievements.js";
import * as D from "../app/data.js";
import { openDetail } from "./detail.js";

export function trophyRoom() {
    const sec = h("section.trophy-room", { hidden: true });
    let turn = 0; // a newer paint wins over one still waiting
    async function paint() {
        const mine = ++turn;
        const s = await A.summary();
        if (mine !== turn) return;
        const t = A.totals(s);
        clear(sec);
        if (!s.steamId || !t.games) {
            // nothing yet: a quiet hint, only if there's something to say
            if (!s.steamId) {
                sec.append(h("p.trophy-hint.muted", null, icon("trophy"), "Your Steam achievements can live here too: add your SteamID64 in ", h("a", { href: "#settings" }, "Settings"), "."));
                sec.hidden = false;
            } else sec.hidden = true;
            return;
        }
        sec.hidden = false;
        const lib = await D.library().catch(() => []);
        if (mine !== turn) return;
        const libFor = (appid) => lib.find((it) => String(it.steamAppId) === String(appid));
        const openGame = (appid) => { const it = libFor(appid); if (it) openDetail(it); };

        sec.append(h("div.trophy-head", null, h("h2", null, icon("trophy"), "Trophy room"), h("p.muted", null, "Your Steam achievements, across every game")));
        const stat = (n, label, extra) => h("div.trophy-stat", null, h("b", null, n), h("span", null, label), extra || null);
        sec.append(h("div.trophy-stats", null,
            stat(t.unlocked.toLocaleString(), `achievements, of ${t.total.toLocaleString()} in ${t.games} game${t.games === 1 ? "" : "s"}`),
            stat(String(t.perfect), t.perfect === 1 ? "perfect game" : "perfect games"),
            t.rarest ? stat(`${t.rarest.percent}%`, `rarest: ${t.rarest.name}`, h("small.muted", null, t.rarest.game || "")) : null,
            stat(`${t.avg}%`, "done on average, in games you've started")));

        if (s.state === "private") sec.append(h("p.ach-note", null, "Steam stopped sharing your achievements: your profile's Game details are private now."));

        // recently unlocked, across games
        if (s.recent && s.recent.length) {
            const strip = h("div.trophy-recent");
            for (const a of s.recent.slice(0, 12)) {
                const tier = A.tierOf(a.percent);
                strip.append(h("button.trophy-unlock", { type: "button", dataset: { tier: tier ? tier.id : "none" }, title: `${a.name}, ${a.game || ""}${typeof a.percent === "number" ? ` · ${a.percent}% of players` : ""}`, onclick: () => openGame(a.appid) },
                    a.icon ? h("img", { src: coverSrc(a.icon), alt: "", loading: "lazy" }) : h("span.blank", null, icon("trophy")),
                    h("b", null, a.name), h("small", null, a.game || ""), h("small.muted", null, A.dayLabel(a.at))));
            }
            sec.append(h("h3", null, "Recently unlocked"), strip);
        }
        // closest to 100%
        const near = A.almostThere(s).slice(0, 6);
        if (near.length) {
            sec.append(h("h3", null, "Almost 100%"), h("div.trophy-near", null, ...near.map((g) =>
                h("button.trophy-game", { type: "button", onclick: () => openGame(g.appid) },
                    h("b", null, g.name || "A Steam game"),
                    h("span.bar", null, h("i", { style: { width: `${Math.round(g.unlocked / g.total * 100)}%` } })),
                    h("small", null, `${g.unlocked} of ${g.total} · ${g.left} to go`)))));
        }
        // perfect games
        const perfect = Object.entries(s.games).filter(([, g]) => g.total && g.unlocked === g.total);
        if (perfect.length) {
            sec.append(h("h3", null, "Perfect games"), h("div.trophy-perfect", null, ...perfect.map(([appid, g]) =>
                h("button.chip.is-perfect", { type: "button", onclick: () => openGame(appid) }, icon("trophy"), g.name || "A Steam game"))));
        }
    }
    paint();
    const off = A.onChange(() => { if (!sec.isConnected) return off(); paint(); });
    return sec;
}
