// Riftgate — how cards look: their size (Settings → Card size) and whether
// each card wears the colour of what it is (games, films, series, anime,
// books, apps). Kept with your Journal preferences, so they follow a backup.

import * as journal from "./store.js";

export const SIZES = [
    { id: "s", label: "Small", scale: 0.84 },
    { id: "m", label: "Medium", scale: 1 },
    { id: "l", label: "Large", scale: 1.18 },
    { id: "xl", label: "Huge", scale: 1.4 }
];
export const cardSize = () => journal.pref("ui:cards", "m") || "m";
export const typeColours = () => journal.pref("ui:typeColours", true) !== false;

export function applyLook() {
    const s = SIZES.find((x) => x.id === cardSize()) || SIZES[1];
    document.documentElement.style.setProperty("--card-scale", String(s.scale));
    document.documentElement.toggleAttribute("data-type-colours", typeColours());
}
export async function setCardSize(id) { await journal.setPref("ui:cards", id); applyLook(); window.dispatchEvent(new Event("resize")); }
export async function setTypeColours(on) { await journal.setPref("ui:typeColours", !!on); applyLook(); }
