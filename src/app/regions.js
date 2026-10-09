// Riftgate — regions: the countries Riftgate offers by name, and where
// you are (country + city), shared by Settings and the Theatre.

import * as journal from "./store.js";
import { saveSettings, forget, settings, call, country, openExternal } from "./api.js";

export const COUNTRIES = [
    ["US", "United States"], ["GB", "United Kingdom"], ["PT", "Portugal"], ["BR", "Brazil"], ["ES", "Spain"], ["FR", "France"],
    ["DE", "Germany"], ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["IE", "Ireland"], ["CA", "Canada"],
    ["MX", "Mexico"], ["AR", "Argentina"], ["AU", "Australia"], ["NZ", "New Zealand"], ["JP", "Japan"], ["KR", "South Korea"],
    ["IN", "India"], ["PL", "Poland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
    ["CH", "Switzerland"], ["AT", "Austria"], ["TR", "Türkiye"], ["ZA", "South Africa"]
];

export function countryName(code) { const c = COUNTRIES.find(([k]) => k === code); return c ? c[1] : code; }

// Your city and your cinema, kept exactly as Riftgate 1.x keeps them
// (settings.movieCity, settings.cinemaByCity["CC|city"]), so they carry over.
let st = { movieCity: "", cinemaByCity: {}, country: "US" };
export const ready = settings().then((s) => { st = { movieCity: s.movieCity || "", cinemaByCity: s.cinemaByCity || {}, country: s.movieCountry || s.country || "US" }; return st; });
export function city() { return st.movieCity || journal.pref("city", "") || ""; }
export async function setCity(v) {
    st.movieCity = String(v || "").trim().slice(0, 80);
    await saveSettings({ movieCity: st.movieCity });
}
const cityKey = (cc) => `${cc || st.country}|${city()}`;
export function cinema(cc) { const c = st.cinemaByCity[cityKey(cc)]; return c && typeof c.id === "string" && typeof c.name === "string" ? c : null; }
export async function setCinema(cc, c) {
    const map = { ...st.cinemaByCity };
    if (c) map[cityKey(cc)] = { id: c.id, name: c.name, label: c.label || null, url: c.url || null };
    else delete map[cityKey(cc)];
    st.cinemaByCity = map;
    await saveSettings({ cinemaByCity: map });
}
// Cinemas around your city (OpenStreetMap, kept two weeks by the engine)
export function cinemasNear(cc, refresh = false) {
    if (!city()) return Promise.resolve({ cinemas: [] });
    return call("get-cinemas", { countryCode: cc, city: city(), refresh }).then((r) => r || { cinemas: [], error: "Couldn't load cinemas." });
}

const GOOGLE = { US: "com", GB: "co.uk", PT: "pt", CA: "ca", AU: "com.au", DE: "de", FR: "fr", ES: "es", BR: "com.br", IT: "it", NL: "nl", BE: "be", IE: "ie", CH: "ch", AT: "at",
    MX: "com.mx", AR: "com.ar", CL: "cl", CO: "com.co", JP: "co.jp", KR: "co.kr", HK: "com.hk", TW: "com.tw", IN: "co.in", SE: "se", NO: "no", DK: "dk", FI: "fi",
    PL: "pl", TR: "com.tr", GR: "gr", CZ: "cz", HU: "hu", RO: "ro", ZA: "co.za", NZ: "co.nz", PH: "com.ph", ID: "co.id", MY: "com.my", SG: "com.sg", TH: "co.th", VN: "com.vn", AE: "ae", IL: "co.il", UA: "com.ua" };

// Find tickets: your cinema's own website when you've picked one that has
// it; otherwise a search in your country's Google for the film near you.
export async function openTickets(title) {
    await ready;
    const cc = await country();
    const c = cinema(cc);
    if (c && c.url) { openExternal(c.url); return; }
    const parts = c ? [c.name, city(), title, "showtimes", "tickets"] : [title, "showtimes", "tickets", city(), countryName(cc)];
    openExternal(`https://www.google.${GOOGLE[cc] || "com"}/search?q=${encodeURIComponent(parts.filter(Boolean).join(" "))}`);
}
export function ticketsHint(cc) {
    const c = cinema(cc);
    if (!c) return city() ? `Searches for showtimes in ${city()}` : "Searches for showtimes near you";
    try { return c.url ? `Opens ${c.name} (${new URL(c.url).hostname.replace(/^www\./, "")})` : `Searches for ${c.name} showtimes`; } catch { return `Opens ${c.name}`; }
}

// Changing country: every regional list (cinemas, streaming, prices) follows
export async function setCountry(code) {
    await saveSettings({ country: code, movieCountry: code, locationConfirmed: true });
    forget("");
    setTimeout(() => location.reload(), 500);
}

// The streaming services you have, per country (empty = show the top ones)
export function myServices(cc) { return (journal.pref(`services:${cc}`, null) || []).slice(); }
export function setMyServices(cc, names) { return journal.setPref(`services:${cc}`, names.length ? names : null); }
