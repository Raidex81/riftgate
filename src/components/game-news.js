// Riftgate — a Steam game's latest news in its details: its developers' own
// posts (announcements, updates, patch notes), newest first. The engine keeps
// each game's news for six hours (engine/content.js).

import { h, icon } from "../app/dom.js";
import { call, openExternal } from "../app/api.js";
import { ago } from "../app/format.js";

export function steamAppIdOf(item) {
    if (!item) return null;
    if (item.steamAppId) return String(item.steamAppId);
    const m = item.raw && /^steam:\/\/(?:rungameid|run)\/(\d+)/i.exec(item.raw.path || "");
    return m ? m[1] : null;
}

export function newsBox(item) {
    const appid = steamAppIdOf(item);
    if (!appid || item.kind !== "library" || item.type !== "game") return null;
    const list = h("div.news-list");
    const box = h("section.detail-section.game-news", { "aria-label": "News", hidden: true },
        h("div.news-head", null, h("h3", null, icon("bell"), "News"), h("span.muted", null, "From the developers, on Steam")), list);
    call("r2-steam-news", appid).then((news) => {
        const items = (Array.isArray(news) ? news : []).slice(0, 3);
        if (!items.length) return;
        box.hidden = false;
        for (const n of items) {
            list.append(h("article.news-item", null,
                h("p.news-meta", null, n.patch ? h("span.news-tag", null, "Patch notes") : null, h("span", null, n.at ? ago(n.at) : "")),
                h("b.news-title", null, n.title),
                n.text ? h("p.news-text", null, n.text) : null,
                h("button.linkish.news-read", { type: "button", onclick: () => openExternal(n.url) }, "Read it on Steam", icon("external"))));
        }
    }).catch(() => { /* no news is fine */ });
    return box;
}
