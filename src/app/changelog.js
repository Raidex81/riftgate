// Riftgate — what's new, newest first. This version's notes, then every
// 1.x release carried over from the original app (changelog-history.js).
import { HISTORY } from "./changelog-history.js";

export const CURRENT_NOTES = {
    "2.0.4": [
        "New: the Hallowed Rift has spooky decorations. From 22 October to 3 November, glowing jack-o'-lanterns (each with its own carved face) and flickering candles sit by the Nexus rift, cobwebs hang in the corners of the page and a little spider dangles on its thread. They leave by themselves on 4 November (Settings → Seasonal events)",
        "New: the lightning sounds like a real storm. The opening's bolts, and a click on the gem in Nexus, now break into a recorded thunderclap",
        "New: News from your games. Nexus shows the latest update or announcement of each Steam game you play, and a Steam game's details show its developers' last three posts, with patch notes marked",
        "New: Airing this season in the Theatre (if you're into anime): this season's anime from MyAnimeList, with when new episodes air in your own time",
        "New: Free audiobooks in the Reading room: public-domain books read by volunteers (LibriVox), with how long each one is and a Listen free button",
        "New: hide any row you don't want. The × in a row's header hides it, and a hidden row loads nothing at all. The rows you've hidden are listed at the bottom of the page, to bring back with a click",
        "New: Manage My shows. Theatre → My shows → Manage lists every show you follow, each with Remove (and Undo). A followed show's details now say Remove from My shows",
        "Fixed: a trailer that YouTube won't play inside apps is no longer picked, and Watch on YouTube (in YouTube's own error screen, or the new button on every YouTube trailer) opens it in your browser"
    ],
    "2.0.3": [
        "New: your Steam achievements. A Steam game's details show every achievement: what you can get next (the ones most players earn first), what you unlocked by day, your rarest, and the full list. Each one wears a gem in its rarity (Legendary, Epic, Rare, Uncommon, Common), and hidden ones stay veiled until you choose to see them. It needs your SteamID64 in Settings and your Steam profile's Game details set to Public",
        "New: the Trophy room in the Journal. Your achievements across every game: totals, what you unlocked lately, the games closest to 100% and your perfect games. If Steam keeps them private, it says what to change, opens the setting and checks again",
        "New: Almost 100% in Nexus, the games where only a few achievements are left. Perfect games wear a gold trophy on their card, and there are two new Seals: Perfectionist and One in a hundred",
        "New: when a site Riftgate uses isn't answering, it says so. Rows show what Riftgate saved last, with how old it is, a notice names what's down and has Try again, and everything fills back in by itself once you're back online. Settings → Sources shows how each one is doing",
        "Changed: on wide and ultrawide screens the page grows with the screen and stays centred, the Nexus banner spans the full width with the rift beside the words, and Settings flows into columns",
        "Fixed: Deals no longer empties its list when both stores are down at once; it keeps the last one it had",
        "Fixed: new episodes and trending rows show what Riftgate saved when the site behind them doesn't answer, instead of nothing"
    ],
    "2.0.2": [
        "New: never miss a free game. Riftgate tells you the moment a game goes free to keep on Steam, Epic, GOG and more, and reminds you on its last day if you haven't claimed it. Free games opens on Free to keep right now, with how long each one lasts and a Claim button (Settings → Alerts)",
        "New: your wishlist. Add a game from its details and Riftgate tells you when its price drops. It's the first row in Deals",
        "New: While you were away. Come back after a while and the rift shows what changed: new free games, the ones about to end, new episodes of your shows, price drops on your wishlist",
        "New: your rift grows. Everything you finish becomes a relic orbiting the Nexus rift, in its kind's colour",
        "New: Seals. Twenty small achievements across games, films, series and books, in the Journal. Three are secret",
        "New: Rift Rewind. Every December, your year in the rift: what you finished, what you loved, your most-played game, your Seals, and a card of your rift to save and share (and Your year so far in the Journal any time)",
        "New: seasonal events. Riftgate changes with the year for a few days at a time, then goes back to your theme by itself. First: the Hallowed Rift, 22 October to 3 November (Settings → Seasonal events)",
        "New: Ask the Rift learns your taste. What you rate highly nudges its picks (\"Because you loved…\"), what you drop nudges them away, and things you've already rated aren't suggested again",
        "New: Help Riftgate grow. If you say yes, Riftgate counts this PC once a week, anonymously: a random number, the version and Windows or Mac, nothing else (Settings)",
        "Fixed: the opening runs smoothly. Riftgate no longer builds its first page while the rift tears open (it waits for the calm moment once the name has settled), the Nexus banner stays still under the opening instead of animating unseen, the rings and the gem are prepared before they appear, the lightning's glow is drawn in a small layer around each bolt instead of across the whole screen, and the lightning's sound is prepared ahead instead of on the frame it strikes. It looks and sounds exactly the same. The lightning when you click the gem in Nexus is lighter too"
    ],
    "2.0.1": [
        "New: the opening has sound. The tear rips open, the gem bursts through with a boom and a crystal chord, and every bolt of lightning cracks the instant it strikes, then rolls into thunder (Settings → Opening animation: with sound, silently, or skip it)",
        "New: Ask the Rift. Tell it what you feel like in your own words (\"a co-op shooter for friends, no horror\", \"something funny and short\", \"a cosy fantasy book\", \"a game like Team Fortress 2\") and it picks three, ranked by real reviews and ratings, and says why. It's in Surprise me and in Free games, the Theatre, the Reading room and the Library. It runs on your computer: free, and nothing you type leaves Riftgate",
        "Changed: Find tickets only shows for films in cinemas now. A film from a streaming row has Watch on Netflix, YouTube, Prime Video… and opens it there",
        "New: Add a show. Search any series or anime, even one Riftgate doesn't list, and add it to My shows (Theatre → My shows → Add a show, or Ctrl K). Its new episodes show up in Nexus",
        "Changed: \"Your shows\" is now My shows, and a show's Track button takes it out again",
        "Changed: in the opening, the name RIFTGATE stays on screen two seconds once it has fully appeared, before the rift opens onto the app",
        "New: Riftgate says goodbye. When it closes for good, a soft, calm chord fades out as the app closes in on a point of light (Settings → Opening animation → Sound when Riftgate closes)",
        "New: click the gem in Nexus and it strikes, with the opening's lightning",
        "Changed: Find tickets opens a cinema's own website: the cinema you picked in the Theatre, or else the closest cinema to your city that has a website. It only searches Google when no cinema around has one",
        "Fixed: a cinema chain's website is only used in the countries where the chain has cinemas, so Find tickets no longer opens a foreign site that blocks you (like Cinépolis's in Portugal)",
        "Fixed: the taskbar icon is blue too, like the app's icon"
    ],
    "2.0.0": [
        "Riftgate 2.0, rebuilt from the ground up. It installs over your current Riftgate and keeps your library, shows, books and settings",
        "New look, rebuilt from scratch: a living rift portal, gem-cut cards that glow in your theme's colours, and one design across every section",
        "New: What do you want to do today? Pick a mood (Play, Play free, Watch, Read or Surprise me), narrow it down, and the rift picks the one thing for you, skipping what you've finished",
        "New: Nexus, one page with what matters right now: free games, cinema, new episodes, deals, new series and anime, and what you were in the middle of",
        "New: your interests. Tell Riftgate what you love and it leads with that; anything you mark Not for me leaves the menu",
        "New: Themes. 20 built-in themes, plus a studio for your own: colours, light or dark, glass, soft, neon, brutal or rounded surfaces, background patterns, fonts and your own pictures. Share them as files or with everyone in the community gallery",
        "New: the Journal. Mark anything as playing, watching, reading, planned, completed, on hold or dropped, rate it with gems, track progress and keep a note",
        "New: every See all pages through everything available online, about 100 at a time, with no limit",
        "New: rows can be dragged into the order you like in every section",
        "New: Theatre follows where you live (country, your city for showtimes, and the streaming services you have), and new series show where they stream",
        "New: Applications. Anyone can put forward an app they made for the admins to publish",
        "New: Ctrl+K searches everything at once, and goes anywhere",
        "New: Did you know? A fact from the world you're in along the bottom of Riftgate: games, films and series, or books",
        "New: a guided tour on your first start, and a short one whenever something new arrives (Settings replays it)",
        "New: choose the card size, from small to huge, and colour every card by what it is, in Settings",
        "New: mature titles show only to adults who turn them on, from the date of birth on your Riftgate account, as before",
        "New for admins: the Vault (share files for 1 to 24 hours and links for 90 days) and an Admin section to moderate titles and Vault access",
        "Changed: Riftgate's icon is blue, like the gem inside the app",
        "Changed: a picture you choose for a theme fills the whole screen, whatever its shape (Whole picture and Tile are still there)",
        "Changed: trailers play large and sharp; free games and deals appear instantly and refresh in the background",
        "Changed: sign in with your Riftgate account; your password is never stored on your PC"
    ]
};

export const CHANGELOG = { ...CURRENT_NOTES, ...HISTORY };
