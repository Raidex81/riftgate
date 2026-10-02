// Riftgate 2 — regions: the countries Riftgate offers by name, and where
// you are (country + city), shared by Settings and the Theatre.

import * as journal from "./store.js";
import { saveSettings, forget } from "./api.js";

export const COUNTRIES = [
    ["US", "United States"], ["GB", "United Kingdom"], ["PT", "Portugal"], ["BR", "Brazil"], ["ES", "Spain"], ["FR", "France"],
    ["DE", "Germany"], ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"], ["IE", "Ireland"], ["CA", "Canada"],
    ["MX", "Mexico"], ["AR", "Argentina"], ["AU", "Australia"], ["NZ", "New Zealand"], ["JP", "Japan"], ["KR", "South Korea"],
    ["IN", "India"], ["PL", "Poland"], ["SE", "Sweden"], ["NO", "Norway"], ["DK", "Denmark"], ["FI", "Finland"],
    ["CH", "Switzerland"], ["AT", "Austria"], ["TR", "Türkiye"], ["ZA", "South Africa"]
];

export function countryName(code) { const c = COUNTRIES.find(([k]) => k === code); return c ? c[1] : code; }

// Your city sharpens cinema showtimes ("<film> showtimes Lisbon")
export function city() { return journal.pref("city", "") || ""; }
export function setCity(v) { return journal.setPref("city", String(v || "").trim().slice(0, 80) || null); }
export function showtimesUrl(title) {
    const c = city();
    return `https://www.google.com/search?q=${encodeURIComponent(`${title} showtimes${c ? " " + c : ""}`)}`;
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
