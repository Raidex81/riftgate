# Riftgate

**Your games. Your apps. Your media. One gateway.**

A unified desktop launcher — organize your installed games and apps,
discover what's free or on sale right now across Steam, GOG, Epic, and
dozens of other stores, and keep track of the movies and shows you care
about, all in one place.

![Riftgate — New tab, showing upcoming games and new series](screenshots/new.png)

---

## Download

### 👉 [Download the latest version](https://github.com/Raidex81/Riftgate/releases/latest)

Click the link above, then look for **Assets** on that page and download
the `.exe` file.

> **First-time install note:** Windows may show a blue "Windows
> protected your PC" screen the first time you run the installer. This
> is normal for independently-published apps that aren't digitally
> signed — click **More info → Run anyway** to continue.
>
> This only happens once. Every update after your first install
> installs itself automatically through the app — no more downloads,
> no more warnings.

---

## What's inside

**📀 Installed Library** — organize every game, app, and VR title you
run, with drag-and-drop reordering, auto-fetched cover art and
descriptions, and hover trailers.

![Installed Library](screenshots/installed-library.png)

**🎁 Free Games** — a live, auto-updating list of what's free to keep
or free to play right now on Steam, Epic Games, GOG, itch.io, and
giveaway aggregators like GamerPower.

![Free Games](screenshots/free-games.png)

**🛒 Store** — the best discounts on PC games right now, aggregated
across Steam and dozens of other resellers (GOG, Epic, Humble,
Fanatical, GreenManGaming, and more) in one searchable, sortable grid.
Every deal shows its discount, a review-score badge (Steam rating or
Metacritic), and a trailer preview, with quick links straight to each
store to buy. Prices and currency follow your Region setting, so
they match the store you'd actually be buying from.

**🎬 Theatre** — track TV series for new episodes (with ratings and a
next-episode countdown), browse movies currently playing near you, and
jump into a full-screen trailer preview.

![Theatre](screenshots/theatre.png)

**📚 Reading Room** — your own eBook library (EPUB/PDF), plus Discover
Online and Buy Books tabs for free and mainstream titles, with
dedicated Manga and Comics browsing.

![Reading Room](screenshots/reading-room.png)

**🧩 Applications** — tools and apps built by the community, each with
a creator credit and a link straight to where to grab it — browse by
search or sort by newest, most visited, name, or author.

![Applications](screenshots/applications.png)

**🆕 New** — see what's newly released or coming soon across movies,
series, and games, all in one feed.

**🎲 Surprise Me** — can't decide? Spin the wheel.

![Surprise Me](screenshots/surprise-me.png)

Nine color themes, light/dark mode, adjustable grid density, and a
fully custom interface — automatic updates included.

---

## For developers

This is a personal project — all rights reserved. It isn't currently
open for external contributions, but feel free to look around.

Built with [Electron](https://www.electronjs.org/), backed by
[Supabase](https://supabase.com/) for shared/cloud data (accounts,
Applications, community suggestions). Third-party media APIs
(TMDB, RAWG, SteamGridDB, YouTube) are proxied server-side, so no vendor
keys ship inside the app.

For a deeper technical look — the Electron process model, IPC and
security hardening, what's stored locally vs. in the cloud, external data
sources, and the build/release pipeline — see
**[ARCHITECTURE.md](ARCHITECTURE.md)**.
