// Riftgate — formatting helpers (plain words, the user's locale).

export function hours(seconds) {
    if (!seconds) return null;
    const h = seconds / 3600;
    if (h < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
    return h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(h).toLocaleString()} h`;
}

export function ago(ts) {
    if (!ts) return "";
    const d = typeof ts === "number" ? ts : Date.parse(ts);
    if (isNaN(d)) return "";
    const days = Math.floor((Date.now() - d) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} wk ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
}

export function until(dateStr) {
    const d = Date.parse(dateStr);
    if (isNaN(d)) return "";
    const days = Math.ceil((d - Date.now()) / 86400000);
    if (days < 0) return dateLong(dateStr);
    if (days === 0) return "Out today";
    if (days === 1) return "Tomorrow";
    if (days < 14) return `In ${days} days`;
    return dateLong(dateStr);
}

export function dateLong(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr || "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function money(value, currency) {
    if (typeof value !== "number") return "";
    if (value === 0) return "Free";
    try { return value.toLocaleString(undefined, { style: "currency", currency: currency || "USD" }); }
    catch (e) { return `${value.toFixed(2)} ${currency || ""}`.trim(); }
}

export function score(rating) {
    return typeof rating === "number" ? rating.toFixed(1).replace(/\.0$/, "") : null;
}

export function plural(n, one, many) { return `${n.toLocaleString()} ${n === 1 ? one : (many || one + "s")}`; }

// "in 2d 5h", "in 3h 12m", "in 8m": a countdown that reads at a glance
export function countdown(ts) {
    const ms = (typeof ts === "number" ? ts : Date.parse(ts)) - Date.now();
    if (isNaN(ms)) return "";
    if (ms <= 0) return "out now";
    const m = Math.floor(ms / 60000), hh = Math.floor(m / 60), d = Math.floor(hh / 24);
    if (d >= 14) return `in ${d} days`;
    if (d >= 1) return `in ${d}d ${hh % 24}h`;
    if (hh >= 1) return `in ${hh}h ${m % 60}m`;
    return `in ${Math.max(1, m)}m`;
}
// Every countdown on screen ticks once a minute (one timer for all of them)
let ticking = null;
export function tickCountdowns() {
    if (ticking) return;
    ticking = setInterval(() => {
        const els = document.querySelectorAll("[data-countdown]");
        if (!els.length) { clearInterval(ticking); ticking = null; return; }
        els.forEach((el) => { el.textContent = countdown(Number(el.dataset.countdown)); });
    }, 60000);
}
