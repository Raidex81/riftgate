// Riftgate 2 — short confirmations. A toast names what happened, in the
// same words as the action that caused it ("Added to Journal").

import { h } from "../app/dom.js";

let host = null;
export function toast(text, kind = "ok", ms = 3200) {
    if (!host) { host = h("div.toasts", { role: "status", "aria-live": "polite" }); document.body.appendChild(host); }
    const t = h(`div.toast.${kind}`, null, text);
    host.appendChild(t);
    setTimeout(() => t.remove(), ms);
}
