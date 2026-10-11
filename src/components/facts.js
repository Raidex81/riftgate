// Riftgate — "Did you know?", the line along the foot of the stage (the fact
// ticker of Riftgate 1.x, reworked). It follows the section you're in: games
// facts in the games sections, film and series facts in the Theatre, book
// facts in the Reading room, and a mix of the worlds you're into elsewhere.
// One fact at a time, long enough to read; it waits while you point at it,
// a click on → shows the next, × turns it off (Settings turns it back on).

import { h, icon } from "../app/dom.js";
import { FACTS, SEASON_FACTS } from "../app/facts.js";
import * as season from "../app/season.js";
import * as interests from "../app/interests.js";
import * as journal from "../app/store.js";
import { toast } from "./toast.js";

const EVERY = 16000;
const WORLD = { theatre: "screen", reading: "books", free: "games", deals: "games", library: "games", apps: "games" };
const LABEL = { games: "Games", screen: "Films & series", books: "Books" };
const ICON = { games: "library", screen: "film", books: "book" };
const queues = {};
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let told = 0;
function next(world) {
    // while a season is on, one fact in three is the season's
    const sf = season.current() && SEASON_FACTS[season.current().id];
    if (sf && sf[world] && ++told % 3 === 0) {
        const k = `${season.current().id}:${world}`;
        if (!queues[k] || !queues[k].length) queues[k] = shuffle(sf[world]);
        return queues[k].shift();
    }
    if (!queues[world] || !queues[world].length) queues[world] = shuffle(FACTS[world]);
    return queues[world].shift();
}
function worldFor(view) {
    if (WORLD[view]) return WORLD[view];
    // everywhere else: the worlds you're into, the ones you love more often
    const pool = [];
    if (interests.level("games", "free", "deals") > 0) pool.push("games", ...(interests.level("games", "free", "deals") > 1 ? ["games"] : []));
    if (interests.level("screen", "anime") > 0) pool.push("screen", ...(interests.level("screen", "anime") > 1 ? ["screen"] : []));
    if (interests.level("books") > 0) pool.push("books", ...(interests.level("books") > 1 ? ["books"] : []));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : "games";
}

export const enabled = () => journal.pref("ui:facts", true) !== false;
export async function setEnabled(on) { await journal.setPref("ui:facts", !!on); }

let el = null, textEl, kindEl, timer = null, view = null, paused = false;

function show(world) {
    const fact = next(world);
    const line = h("span.fact-text", null, fact);
    const old = textEl.querySelector(".fact-text");
    kindEl.replaceChildren(icon(ICON[world]), h("span", null, LABEL[world]));
    el.dataset.world = world;
    if (old) { old.classList.add("out"); setTimeout(() => old.remove(), 420); }
    textEl.appendChild(line);
    el.title = fact;
}
function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { if (paused || document.hidden) return schedule(); show(worldFor(view)); schedule(); }, EVERY);
}

// Called by the router on every section change
export function follow(viewId) {
    view = viewId;
    if (!el) return;
    el.hidden = viewId === "settings";
    const w = worldFor(viewId);
    if (el.dataset.world !== w || WORLD[viewId]) { show(w); schedule(); }
}

export function mountFacts(app) {
    if (el) el.remove();
    el = null;
    if (!enabled()) return;
    textEl = h("div.fact-track", { "aria-live": "polite" });
    kindEl = h("span.fact-kind");
    el = h("div.facts", { role: "note", "aria-label": "Did you know?" },
        h("span.fact-label", null, icon("bulb"), h("b", null, "Did you know?")),
        kindEl, textEl,
        h("button.icon-btn.fact-next", { type: "button", title: "Another one", "aria-label": "Another fact", onclick: () => { show(worldFor(view)); schedule(); } }, icon("right")),
        h("button.icon-btn.fact-close", { type: "button", title: "Turn off Did you know?", "aria-label": "Turn off Did you know?", onclick: async () => {
            await setEnabled(false); clearTimeout(timer); el.remove(); el = null;
            toast("Did you know? is off. Settings turns it back on.");
        } }, icon("x")));
    el.addEventListener("pointerenter", () => { paused = true; });
    el.addEventListener("pointerleave", () => { paused = false; });
    app.appendChild(el);
    if (view) follow(view);
}
