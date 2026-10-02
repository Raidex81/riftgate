// Riftgate 2 — Theatre: films in cinemas and coming soon, your shows' new
// episodes, new series and anime, and what's popular on each streaming
// service in your region.

import { h, icon, coverSrc } from "../app/dom.js";
import { cached, country } from "../app/api.js";
import * as D from "../app/data.js";
import { fromProviderTitle } from "../app/items.js";
import { row } from "../components/row.js";
import { until } from "../app/format.js";

const noMature = (l) => l.filter((x) => !x.mature);

export default {
    async render(root) {
        root.append(h("div.view-head", null, h("div", null,
            h("h1", null, "Theatre"),
            h("p", null, "What's showing near you, what's streaming in your region, and the shows you follow."))));

        root.append(
            row({ title: "In cinemas", icon: "film", items: D.inCinemas().then(noMature) }),
            row({ title: "New episodes of your shows", icon: "tv", items: D.latestEpisodes(), empty: "Track a show (open any series → Track this show) and its new episodes land here." }),
            row({ title: "Coming to cinemas", icon: "calendar",
                items: D.upcomingFilms().then((l) => noMature(l).map((m) => ({ ...m, sub: m.date ? until(m.date) : m.sub }))) }),
            row({ title: "Your shows", icon: "journal", items: D.watchlist(), hideEmpty: true }),
            row({ title: "New series", icon: "tv", items: D.newSeries().then(noMature) }),
            row({ title: "New anime", icon: "sparkles", items: D.newAnime().then(noMature) }));

        // Streaming services: the four most relevant in the user's region
        const cc = await country();
        const providers = ((await cached("get-watch-providers", [cc])) || []).slice(0, 4);
        providers.forEach((p) => {
            const logo = p.logo ? h("img", { src: coverSrc(p.logo), alt: "", style: { width: "22px", height: "22px", borderRadius: "5px" } }) : null;
            const r = row({ title: `Popular on ${p.name}`, icon: "tv",
                items: cached("get-trending-by-provider", [{ providerName: p.name, countryCode: cc }]).then((l) => noMature((l || []).map(fromProviderTitle))) });
            if (logo) r.querySelector("h2 svg")?.replaceWith(logo);
            root.appendChild(r);
        });
    },
    rollTitle: "What to watch tonight",
    async rollPool() {
        const [a, b] = await Promise.all([D.inCinemas(), D.newSeries()]);
        return noMature([...a, ...b]);
    }
};
