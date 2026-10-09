// Riftgate — Theatre: films in cinemas and coming soon, your shows' new
// episodes, new series and anime, and what's popular on each streaming
// service in your region.

import { openAddShow } from "../components/add-show.js";
import * as gate from "../app/mature.js";
import { h, icon, coverSrc, clear } from "../app/dom.js";
import { cached, country } from "../app/api.js";
import * as D from "../app/data.js";
import * as seen from "../app/seen.js";
import { fromProviderTitle } from "../app/items.js";
import { row } from "../components/row.js";
import { shelf } from "../components/shelf.js";
import { until } from "../app/format.js";
import { COUNTRIES, countryName, city, setCity, setCountry, myServices, setMyServices, ready as regionReady, cinema, setCinema, cinemasNear, ticketsHint } from "../app/regions.js";
import * as interests from "../app/interests.js";
import { toast } from "../components/toast.js";

const noMature = (l) => gate.visible(l);

export default {
    async render(root) {
        const cc = await country();
        const allProviders = (await cached("get-watch-providers", [cc])) || [];

        // Where you are: country, city (for showtimes) and your services
        const countrySel = h("select.input", { "aria-label": "Your country" },
            (COUNTRIES.some(([c]) => c === cc) ? COUNTRIES : [[cc, cc], ...COUNTRIES]).map(([c, n]) => h("option", { value: c }, n)));
        countrySel.value = cc;
        countrySel.addEventListener("change", () => { toast(`Theatre now follows ${countryName(countrySel.value)}`); setCountry(countrySel.value); });
        await regionReady;
        const cityIn = h("input.input", { type: "text", placeholder: "Your city (for showtimes)", value: city(), "aria-label": "Your city", style: { width: "190px" } });
        // Your cinema: Find tickets then opens its own website
        const cinemaSel = h("select.input", { "aria-label": "Your cinema", style: { maxWidth: "260px" } });
        let cinemas = [];
        const paintCinemas = (state) => {
            clear(cinemaSel);
            cinemaSel.hidden = !city();
            const chosen = cinema(cc);
            cinemaSel.appendChild(h("option", { value: "" }, `Any cinema in ${city()}`));
            if (chosen && !cinemas.some((c) => c.id === chosen.id)) cinemaSel.appendChild(h("option", { value: chosen.id }, chosen.label || chosen.name));
            cinemas.forEach((c) => cinemaSel.appendChild(h("option", { value: c.id }, [c.label || c.name, typeof c.distanceKm === "number" ? `${c.distanceKm} km` : null, c.url ? null : "web search"].filter(Boolean).join(" · "))));
            if (state === "loading") cinemaSel.appendChild(h("option", { value: "__note", disabled: true }, "Loading cinemas…"));
            if (state === "error") cinemaSel.appendChild(h("option", { value: "__note", disabled: true }, "Couldn't load cinemas"));
            if (state === "ready" && !cinemas.length) cinemaSel.appendChild(h("option", { value: "__note", disabled: true }, `No cinemas found near ${city()}`));
            if (state !== "loading") cinemaSel.appendChild(h("option", { value: "__refresh" }, "↻ Refresh the cinema list"));
            cinemaSel.value = chosen ? chosen.id : "";
            cinemaSel.title = `${ticketsHint(cc)}\nCinema data © OpenStreetMap contributors`;
        };
        const loadCinemas = async (refresh) => {
            if (!city()) { cinemas = []; paintCinemas("idle"); return; }
            paintCinemas("loading");
            const r = await cinemasNear(cc, refresh);
            cinemas = Array.isArray(r.cinemas) ? r.cinemas : [];
            paintCinemas(r.error && !cinemas.length ? "error" : "ready");
        };
        cinemaSel.addEventListener("change", async () => {
            if (cinemaSel.value === "__refresh") { loadCinemas(true); return; }
            const c = cinemas.find((x) => x.id === cinemaSel.value) || (cinema(cc) && cinema(cc).id === cinemaSel.value ? cinema(cc) : null);
            await setCinema(cc, c);
            paintCinemas("ready");
            toast(c ? `Find tickets now opens ${c.name}` : "Find tickets searches every cinema nearby");
        });
        cityIn.addEventListener("change", async () => {
            await setCity(cityIn.value);
            toast(cityIn.value.trim() ? `Showtimes now look in ${cityIn.value.trim()}` : "Showtimes search your whole country");
            loadCinemas(false);
        });
        loadCinemas(false);
        const servicesBtn = h("button.btn", { type: "button", "aria-expanded": "false" }, icon("tv"), "My services");
        const servicesBox = h("div.services", { hidden: true });
        servicesBtn.onclick = () => { servicesBox.hidden = !servicesBox.hidden; servicesBtn.setAttribute("aria-expanded", String(!servicesBox.hidden)); };
        const paintServices = () => {
            const mine = myServices(cc);
            clear(servicesBox).append(
                h("p.muted", null, `The streaming services you have in ${countryName(cc)}. Their catalogues get a row each, in this order.`),
                h("div.chips", null, allProviders.slice(0, 60).map((p) => h("button.chip", { type: "button", "aria-pressed": String(mine.includes(p.name)),
                    onclick: async () => {
                        const now = myServices(cc);
                        const i = now.indexOf(p.name);
                        if (i >= 0) now.splice(i, 1); else now.push(p.name);
                        await setMyServices(cc, now);
                        paintServices(); paintProviderRows();
                    } }, p.logo ? h("img", { src: coverSrc(p.logo), alt: "", style: { width: "18px", height: "18px", borderRadius: "4px" } }) : null, p.name))));
        };
        paintServices();

        root.append(h("div.view-head", null,
            h("div", null,
                h("h1", null, "Theatre"),
                h("p", null, `What's showing in ${countryName(cc)}, what's streaming on your services, and the shows you follow.`)),
            h("div.actions", null, countrySel, cityIn, cinemaSel, servicesBtn)), servicesBox);

        const W = interests.wants;
        const rows = shelf("theatre", [
            row({ title: "In cinemas", icon: "film", items: D.inCinemas().then(noMature), full: { kind: "now-playing" } }),
            row({ title: "New episodes of your shows", icon: "tv", items: () => Promise.all([D.latestEpisodes(), seen.load()]).then(([l]) => seen.unwatchedFirst(l)), empty: "Follow a show (Add a show, below, or open any series → Track this show) and its new episodes land here." }),
            row({ title: "My shows", id: "your-shows", icon: "journal", items: () => D.watchlist(),
                empty: "Follow any series or anime: Add a show finds it, even if Riftgate doesn't list it.",
                tools: h("button.btn.sm", { type: "button", title: "Search any series and add it to My shows", onclick: () => openAddShow() }, icon("plus"), "Add a show") }),
            row({ title: "Coming to cinemas", icon: "calendar", full: { kind: "upcoming-movies" },
                items: D.upcomingFilms().then((l) => noMature(l).map((m) => ({ ...m, sub: m.date ? until(m.date) : m.sub }))) }),
            row({ title: "New series", icon: "tv", items: D.newSeries().then(noMature), full: { kind: "new-series" }, enhance: D.withProviders }),
            W("anime") ? row({ title: "New anime", icon: "sparkles", items: D.newAnime().then(noMature), full: { kind: "new-anime" }, enhance: D.withProviders }) : null].filter(Boolean));
        root.append(rows);

        // Streaming services: yours (or the region's top six), each with its
        // whole catalogue behind See all
        const providerRows = [];
        function paintProviderRows() {
            providerRows.splice(0).forEach((r) => r.remove());
            const mine = myServices(cc);
            const list = mine.length ? mine.map((n) => allProviders.find((p) => p.name === n)).filter(Boolean) : allProviders.slice(0, 6);
            list.forEach((p) => {
                const logo = p.logo ? h("img", { src: coverSrc(p.logo), alt: "", style: { width: "22px", height: "22px", borderRadius: "5px" } }) : null;
                const r = row({ title: `${mine.length ? "On" : "Popular on"} ${p.name}`, id: `provider-${p.id || p.name}`, icon: "tv", seeAllTitle: `Everything on ${p.name}`,
                    full: { kind: "provider", providerName: p.name },
                    items: cached("get-trending-by-provider", [{ providerName: p.name, countryCode: cc }]).then((l) => noMature((l || []).map(fromProviderTitle))) });
                if (logo) r.querySelector("h2 svg")?.replaceWith(logo);
                providerRows.push(r);
                rows.add(r);
            });
        }
        paintProviderRows();
    },
    rollTitle: "What to watch tonight",
    async rollPool() {
        const [a, b] = await Promise.all([D.inCinemas(), D.newSeries()]);
        return noMature([...a, ...b]);
    }
};
