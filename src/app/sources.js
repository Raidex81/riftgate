// Riftgate — what to say when an outside source fails, the same way
// everywhere. The engine tells api.js, beside each answer, which sources
// failed during that call and whether the answer is a saved copy
// (engine/providers.js); rows, See all and the banner turn that into one of
// three states:
//
//   saved:  there's something to show, but it's what Riftgate saved earlier
//           ("Saved 3 h ago", with Try again);
//   failed: nothing to show because a source didn't answer (a clear message
//           naming it, with Try again);
//   null:   all good.
//
// Try again stops the engine backing off failing sources, forgets this
// session's answers and draws the section again.

import { call, forget } from "./api.js";

const REASON = {
    offline: "isn't reachable. Check your internet connection",
    timeout: "took too long to answer",
    busy: "is busy right now",
    down: "is having trouble right now",
    resting: "isn't answering right now",
    quota: "has reached its limit for now",
    error: "isn't answering right now"
};

export function shortAgo(ts) {
    if (!ts) return "";
    const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (min < 2) return "just now";
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
}

const names = (failed) => {
    const labels = [...new Set((failed || []).map((f) => f.label))];
    return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
};

// status: the meta from api.js ({ failed, savedAt, offline }) or null.
export function describe(status, count) {
    if (!status) return null;
    const failed = status.failed || [];
    if (!failed.length && !status.savedAt) return null;
    const who = names(failed);
    if (count > 0) {
        const when = status.savedAt ? shortAgo(status.savedAt) : "";
        return {
            kind: "saved",
            label: when ? `Saved ${when}` : "Saved list",
            text: status.offline
                ? `You're offline, so this is what Riftgate saved${when ? " " + when : ""}.`
                : `${who || "A source"} didn't answer, so this is what Riftgate saved${when ? " " + when : ""}.`
        };
    }
    if (!failed.length) return null;
    const first = failed[0];
    return {
        kind: "failed",
        label: status.offline ? "Offline" : `${who} unavailable`,
        text: status.offline
            ? "You're offline. This fills in again once you're back online."
            : `${who} ${failed.length === 1 ? REASON[first.reason] || REASON.error : "aren't answering right now"}, so there's nothing to show here yet.`
    };
}

// Try again: everywhere at once, so every row that failed gets its chance.
let retrying = null;
export function retry() {
    if (retrying) return retrying;
    retrying = (async () => {
        await call("r2-provider-retry");
        forget("");
        clearFailing(); // anything still failing reports itself again
        window.dispatchEvent(new CustomEvent("r2-sources-reset")); // data.js forgets its lists first
        window.dispatchEvent(new CustomEvent("r2-retry"));         // then the section is drawn again
    })().finally(() => { setTimeout(() => { retrying = null; }, 1500); });
    return retrying;
}

// Every source that failed in this session's recent answers, for the banner.
const failing = new Map(); // provider id -> { label, what, reason, at }
let offlineAt = 0;
export function noteAnswer(meta) {
    const now = Date.now();
    if (meta && meta.failed && meta.failed.length) {
        for (const f of meta.failed) failing.set(f.id, { ...f, at: now });
        if (meta.offline) offlineAt = now;
        window.dispatchEvent(new CustomEvent("r2-sources-changed"));
    }
}
export function noteHealth(list) {
    // the engine's own view wins: a source that's answering again is cleared
    let changed = false;
    for (const p of list || []) if (p.state === "ok" && failing.delete(p.id)) changed = true;
    if (changed) window.dispatchEvent(new CustomEvent("r2-sources-changed"));
}
export function clearFailing() { failing.clear(); offlineAt = 0; window.dispatchEvent(new CustomEvent("r2-sources-changed")); }
export function failingNow() {
    const recent = [...failing.values()].filter((f) => Date.now() - f.at < 10 * 60 * 1000);
    return { list: recent, offline: recent.length > 0 && Date.now() - offlineAt < 10 * 60 * 1000 && recent.every((f) => f.reason === "offline") };
}
