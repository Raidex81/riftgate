# Changelog

Every Riftgate version, newest first. This file is made from the same notes as **What's new** inside Riftgate (`src/app/changelog.js`) by `node scripts/release-notes.js --changelog`, so don't edit it by hand.

Downloads for every version are on the [releases page](https://github.com/Raidex81/riftgate/releases).

## 2.0.4

**New**

- The Hallowed Rift has spooky decorations. From 22 October to 3 November, glowing jack-o'-lanterns (each with its own carved face) and flickering candles sit by the Nexus rift, cobwebs hang in the corners of the page and a little spider dangles on its thread. They leave by themselves on 4 November (Settings → Seasonal events).
- The lightning sounds like a real storm. The opening's bolts, and a click on the gem in Nexus, now break into a recorded thunderclap.
- News from your games. Nexus shows the latest update or announcement of each Steam game you play, and a Steam game's details show its developers' last three posts, with patch notes marked.
- Airing this season in the Theatre (if you're into anime): this season's anime from MyAnimeList, with when new episodes air in your own time.
- Free audiobooks in the Reading room: public-domain books read by volunteers (LibriVox), with how long each one is and a Listen free button.
- Hide any row you don't want. The × in a row's header hides it, and a hidden row loads nothing at all. The rows you've hidden are listed at the bottom of the page, to bring back with a click.
- Manage My shows. Theatre → My shows → Manage lists every show you follow, each with Remove (and Undo). A followed show's details now say Remove from My shows.

**Fixed**

- A trailer that YouTube won't play inside apps is no longer picked, and Watch on YouTube (in YouTube's own error screen, or the new button on every YouTube trailer) opens it in your browser.

## 2.0.3

**New**

- Your Steam achievements. A Steam game's details show every achievement: what you can get next (the ones most players earn first), what you unlocked by day, your rarest, and the full list. Each one wears a gem in its rarity (Legendary, Epic, Rare, Uncommon, Common), and hidden ones stay veiled until you choose to see them. It needs your SteamID64 in Settings and your Steam profile's Game details set to Public.
- The Trophy room in the Journal. Your achievements across every game: totals, what you unlocked lately, the games closest to 100% and your perfect games. If Steam keeps them private, it says what to change, opens the setting and checks again.
- Almost 100% in Nexus, the games where only a few achievements are left. Perfect games wear a gold trophy on their card, and there are two new Seals: Perfectionist and One in a hundred.
- When a site Riftgate uses isn't answering, it says so. Rows show what Riftgate saved last, with how old it is, a notice names what's down and has Try again, and everything fills back in by itself once you're back online. Settings → Sources shows how each one is doing.

**Changed**

- On wide and ultrawide screens the page grows with the screen and stays centred, the Nexus banner spans the full width with the rift beside the words, and Settings flows into columns.

**Fixed**

- Deals no longer empties its list when both stores are down at once; it keeps the last one it had.
- New episodes and trending rows show what Riftgate saved when the site behind them doesn't answer, instead of nothing.

## 2.0.2

**New**

- Never miss a free game. Riftgate tells you the moment a game goes free to keep on Steam, Epic, GOG and more, and reminds you on its last day if you haven't claimed it. Free games opens on Free to keep right now, with how long each one lasts and a Claim button (Settings → Alerts).
- Your wishlist. Add a game from its details and Riftgate tells you when its price drops. It's the first row in Deals.
- While you were away. Come back after a while and the rift shows what changed: new free games, the ones about to end, new episodes of your shows, price drops on your wishlist.
- Your rift grows. Everything you finish becomes a relic orbiting the Nexus rift, in its kind's colour.
- Seals. Twenty small achievements across games, films, series and books, in the Journal. Three are secret.
- Rift Rewind. Every December, your year in the rift: what you finished, what you loved, your most-played game, your Seals, and a card of your rift to save and share (and Your year so far in the Journal any time).
- Seasonal events. Riftgate changes with the year for a few days at a time, then goes back to your theme by itself. First: the Hallowed Rift, 22 October to 3 November (Settings → Seasonal events).
- Ask the Rift learns your taste. What you rate highly nudges its picks ("Because you loved…"), what you drop nudges them away, and things you've already rated aren't suggested again.
- Help Riftgate grow. If you say yes, Riftgate counts this PC once a week, anonymously: a random number, the version and Windows or Mac, nothing else (Settings).

**Fixed**

- The opening runs smoothly. Riftgate no longer builds its first page while the rift tears open (it waits for the calm moment once the name has settled), the Nexus banner stays still under the opening instead of animating unseen, the rings and the gem are prepared before they appear, the lightning's glow is drawn in a small layer around each bolt instead of across the whole screen, and the lightning's sound is prepared ahead instead of on the frame it strikes. It looks and sounds exactly the same. The lightning when you click the gem in Nexus is lighter too.

## 2.0.1

**New**

- The opening has sound. The tear rips open, the gem bursts through with a boom and a crystal chord, and every bolt of lightning cracks the instant it strikes, then rolls into thunder (Settings → Opening animation: with sound, silently, or skip it).
- Ask the Rift. Tell it what you feel like in your own words ("a co-op shooter for friends, no horror", "something funny and short", "a cosy fantasy book", "a game like Team Fortress 2") and it picks three, ranked by real reviews and ratings, and says why. It's in Surprise me and in Free games, the Theatre, the Reading room and the Library. It runs on your computer: free, and nothing you type leaves Riftgate.
- Add a show. Search any series or anime, even one Riftgate doesn't list, and add it to My shows (Theatre → My shows → Add a show, or Ctrl K). Its new episodes show up in Nexus.
- Riftgate says goodbye. When it closes for good, a soft, calm chord fades out as the app closes in on a point of light (Settings → Opening animation → Sound when Riftgate closes).
- Click the gem in Nexus and it strikes, with the opening's lightning.

**Changed**

- Find tickets only shows for films in cinemas now. A film from a streaming row has Watch on Netflix, YouTube, Prime Video… and opens it there.
- "Your shows" is now My shows, and a show's Track button takes it out again.
- In the opening, the name RIFTGATE stays on screen two seconds once it has fully appeared, before the rift opens onto the app.
- Find tickets opens a cinema's own website: the cinema you picked in the Theatre, or else the closest cinema to your city that has a website. It only searches Google when no cinema around has one.

**Fixed**

- A cinema chain's website is only used in the countries where the chain has cinemas, so Find tickets no longer opens a foreign site that blocks you (like Cinépolis's in Portugal).
- The taskbar icon is blue too, like the app's icon.

## 2.0.0

Riftgate 2.0, rebuilt from the ground up. It installs over your current Riftgate and keeps your library, shows, books and settings. New look, rebuilt from scratch: a living rift portal, gem-cut cards that glow in your theme's colours, and one design across every section.

**New**

- What do you want to do today? Pick a mood (Play, Play free, Watch, Read or Surprise me), narrow it down, and the rift picks the one thing for you, skipping what you've finished.
- Nexus, one page with what matters right now: free games, cinema, new episodes, deals, new series and anime, and what you were in the middle of.
- Your interests. Tell Riftgate what you love and it leads with that; anything you mark Not for me leaves the menu.
- Themes. 20 built-in themes, plus a studio for your own: colours, light or dark, glass, soft, neon, brutal or rounded surfaces, background patterns, fonts and your own pictures. Share them as files or with everyone in the community gallery.
- The Journal. Mark anything as playing, watching, reading, planned, completed, on hold or dropped, rate it with gems, track progress and keep a note.
- Every See all pages through everything available online, about 100 at a time, with no limit.
- Rows can be dragged into the order you like in every section.
- Theatre follows where you live (country, your city for showtimes, and the streaming services you have), and new series show where they stream.
- Applications. Anyone can put forward an app they made for the admins to publish.
- Ctrl+K searches everything at once, and goes anywhere.
- Did you know? A fact from the world you're in along the bottom of Riftgate: games, films and series, or books.
- A guided tour on your first start, and a short one whenever something new arrives (Settings replays it).
- Choose the card size, from small to huge, and colour every card by what it is, in Settings.
- Mature titles show only to adults who turn them on, from the date of birth on your Riftgate account, as before.
- for admins: The Vault (share files for 1 to 24 hours and links for 90 days) and an Admin section to moderate titles and Vault access.

**Changed**

- Riftgate's icon is blue, like the gem inside the app.
- A picture you choose for a theme fills the whole screen, whatever its shape (Whole picture and Tile are still there).
- Trailers play large and sharp; free games and deals appear instantly and refresh in the background.
- Sign in with your Riftgate account; your password is never stored on your PC.

## 1.8.3

*Never released on its own: these changes shipped in 2.0.0.*

New in Free Games: Warcraft Rumble (Battle.net); Battlefield REDSEC, skate., The Sims 4 and Star Wars: The Old Republic (EA); World of Tanks: HEAT (Wargaming); Star Conflict, Modern Warships and CRSED: Cuisine Royale (Gaijin) — all checked as permanently free on PC.

**Changed**

- Cards glow in your theme's colour when you point at them or pick them with a controller — a bright ring that fades out into a wide, soft halo. It's never cut off by its row, and it fades away underneath the cards next to it instead of covering them.
- A free game that has its own publisher row (EA, Ubisoft Connect, Gaijin.net…) now shows there once, instead of under Steam — so EA finally gets its own row.

**Fixed**

- The last card in a sideways row could be sliced at the edge — a whole number of cards now fills every row exactly.
- Some games and apps showed a description of something else with the same name (Rust showed the iron oxide). Riftgate now looks for the game's or app's own page first and checks it's the right kind of thing; descriptions saved by the old lookup are fetched again once.
- Surprise Me in Free Games showed blank tiles and a blank result — it now uses the same covers as the cards.

## 1.8.2

**Changed**

- Every Free Games row — Newly Added and each platform, Steam included — is now a sideways carousel like the New tab's rows, with ‹ › arrows that move a whole screenful at a time.
- The "See all →" button now sits right beside each row's title, the same as in New, in Free Games and in the Store.
- A smaller download — leftover build files are no longer packed into the installer.

**Fixed**

- "See all" in Free Games opens exactly that row's games — before, a platform could open another platform's list, Newly Added opened every free game and VR opened nothing. Every list shows 100 games per page, with page buttons and a search box.
- The Store's Newly Added, Most Popular and Recommended "See all" lists failed to open; they now show every matching deal (no longer capped at 48), 100 per page.
- "See all" buttons could be added twice to a row after filtering.

## 1.8.0

**New**

- Content-type color coding — all action buttons (Launch, Get it Free, Find Tickets, Add to My Shows, etc.) now use color-coded buttons by content type for quick visual recognition: Games (purple), Movies (cyan), Books (green), Apps (orange).
- Theatre section now distinguishes between different content types with unique colors — Movies (cyan), Series (purple), Anime (pink) — so you can see at a glance what type of content you're browsing.

**Changed**

- Free Games section now displays a maximum of 20 items per row with optimized layout — if there are more games available, a 'See all' button shows the complete collection without overwhelming the interface.

**Fixed**

- Browse All Free Games heading placement and layout — now properly positioned below the Newly Added section with clear visual separation and spacing between sections.

## 1.7.3

**New**

- Play with a controller or a TV remote — the D-pad, stick or arrow keys move a highlight around everything on screen; A opens, B goes back, X plays or gets a game, LB/RB switch sections and ☰ Menu opens the side panel. Down and up go row by row, to the item right under (or the first one of a shorter row); lists like country and city change only after pressing A on them. Button hints show at the bottom.
- TV mode makes the whole interface bigger for the couch. It turns on by itself while a controller is connected (or set it to Always on / Off in the side panel under Display).
- Riftgate asks once where you are (country and city), so cinemas, release dates, streaming and prices are right from the start. New accounts give it while signing up.
- Country and city lists next to In Theaters and Upcoming Movies, always in sync, with "Other city…" to type any city — the cinema list follows.
- Select a card with the controller or remote to reach everything on it — Details, ▶ Trailer, 🔊 Sound on/off, Play / Get / Tickets. Y opens details and X the main button straight away.
- A controls screen for Xbox, PlayStation, Nintendo, TV remote and keyboard showing what every button does (View / Share / − / Info / F1, or the side panel). Unplugging the controller goes straight back to desktop mode.
- A search box beside the page buttons that looks only in that list — "Search Steam games…", "Search Epic Games…", manga, comics, your library.
- A "Star on GitHub" button at the right of the search line, with Riftgate's real star count — click it to open the project and give it a star.

**Changed**

- Long lists come in pages of 100 — Free Games platforms and VR, and Reading Room's shelves, Manga and Comics — so they open much faster. Newly Added adds more games as you scroll.
- Every cover in the app (games, films, series, books) is now kept on your computer after it's shown once, so Riftgate opens faster next time.
- New "Add" buttons in Installed and Reading Room — a circle with a plus in your theme colour that turns and fills when you point at it.
- The section tabs, Free Games' platform buttons and Reading Room's tabs have a new look — the selected one has a slim glow in your theme's colours that slowly spins. The Store's reseller links glow while you point at them.
- A new Login / Log out button — glassy, lit from above in your theme's colour, with a soft halo when you point at it.
- The "See all" lists (Upcoming Movies and Games, In Theaters, New Series and Anime, streaming services, itch.io) show 100 at a time with page buttons, while the rest keeps loading in the background.
- New Refresh buttons (Free Games, Store, Refresh All Metadata, Refresh Steam Playtime) in your theme's colours — the refresh icon slides across the button when you point at it and spins while it refreshes.
- The main buttons on every card (Launch, Get it free, Find Tickets, Add to My Shows…) now sink in when you press them.

**Fixed**

- Upcoming games (and any game card with no cover, a broken one or a sideways screenshot) now get their real box art — from Steam first, then SteamGridDB — for games already out and most still to come.
- Most cities showed no cinemas — the list now comes from OpenStreetMap's search (fast and reliable), with the old source as a backup.
- No more white window flashing behind the opening animation.
- The cinema list retries when OpenStreetMap is busy, and the contact email is now riftgateappdev@zohomail.eu.

## 1.7.2

Your cinema is remembered for each city, and the Surprise Me wheel's Find Tickets uses it too. Cinema list from OpenStreetMap, refreshed every two weeks (or with ↻ Refresh cinema list).

**New**

- Pick your cinema — next to In Theaters (Theatre) and Upcoming Movies (New) there's a list of the cinemas around your city, nearest first. Once you choose one, "Find Tickets & Showtimes" opens that cinema's own website (or its chain's official site) to see sessions and buy tickets, instead of a Google search.

**Changed**

- Dragging a section tab (New, Installed, Free Games…) to put them in your own order is easier to see — the tab you're moving fades and a bar shows exactly where it will land; in the side menu it now follows up/down instead of left/right.
- The opening animation now shows the new Riftgate banner at full size — the gem lands inside the spinning portal, energy streaks and crystal shards sweep in, then RIFTGATE and "All your worlds. One gateway." appear — all in your chosen theme's colours.

## 1.7.1

**Changed**

- In Free Games, every line of cards now reaches the right edge of the window at any size — the big platform grids stretch to fill it, and the sideways rows (Newly Added and the smaller platforms) size their cards so a whole number of them fits exactly.
- Free Games' platform previews (Steam, GOG, itch.io…) and Store's Newly Added, Most Popular and Recommended rows always show exactly two full lines of cards — a wider window shows more instead of leaving empty space, a narrower one hides the ones that don't fit.

## 1.7.0

**New**

- A "See all" button on Upcoming Games, Upcoming Movies, New Series, New Anime, In Theaters and every streaming service row opens the complete list in a large panel, with search and sorting.
- Upcoming Movies covers every film coming to cinemas in your region over the next 12 months, not just the next 3 weeks — the row shows the most popular, See all shows every one.
- Upcoming Games' full list covers every game with a release date in the next 12 months.

**Changed**

- Free Games now lists every free GOG game (400+) instead of only the first 48, and itch.io's "View all" opens its full list, loading more as you scroll.

## 1.6.3

Fixed (Mac): Riftgate's icon now shows in the menu bar, and clicking the Dock icon brings the window back after "Minimize to Background".

**Changed**

- Upcoming Movies is now a single sideways-scrolling row, like the other rows, and shows more upcoming films instead of leaving empty space on wide screens.

**Fixed**

- Free Games was missing itch.io's free VR games — itch.io moved that page, and Riftgate now follows it.
- Removed a leftover font download that was being blocked on every launch.

## 1.6.2

**New**

- Books in My Library that have no cover of their own now get their real published cover looked up online (Open Library, then Google Books).

**Fixed**

- Cards on the same line are now always the same height — in Installed, the other card grids, Upcoming Games and every sideways-scrolling row — whatever extra info a card shows.

## 1.6.1

Changed (Mac): new-install detection now checks shortly after launch and then hourly, and also notices apps installed while Riftgate was closed — same as on Windows.

**Changed**

- A new, slimmer header banner that follows your chosen theme's colors (light mode included), replacing the tall video banner.
- Store's Newly Added, Most Popular and Recommended rows now always end on a full line of cards instead of leaving empty spaces.

## 1.6.0

Security: repeated wrong passwords now lock the account for a while, and stored passwords use stronger hashing. Security: password-reset codes and email-confirmation links are now created and emailed entirely by the server — they never pass through the app. Security: only one copy of Riftgate runs at a time, web links always open in your browser, and launching or opening files is limited to items in your library. Security: cover images are only downloaded from the public internet, with size and time limits. Security: the installed app is locked against being used to run other code, and bundled components are updated to their latest fixed versions.

**Changed**

- Free Games rows now show a platform's full list, most popular first (new sort option, now the default), and VR gets its own row with the VR games from the PC stores (Meta Quest keeps its own row) instead of a single stray card.
- New-install detection now compares your Desktop and Start Menu shortcuts shortly after launch and then hourly, so it also notices programs installed while Riftgate was closed.
- Update checks now run every few hours instead of constantly.

**Fixed**

- The email-confirmation page showed raw code and garbled symbols instead of a readable message.
- Epic's "Get It Free" button could open a page that doesn't exist.
- Some free games appeared twice after a store refreshed on its own.
- A cover could show up as an empty black box when the portrait artwork found online for it was blank or see-through — the original cover is kept instead — and a Free Games cover whose link no longer works now tries an online lookup before showing "No cover".

## 1.5.2

**New**

- A Region setting (Options → Region) — one country selector now drives Theatre showtimes and streaming availability, New tab's upcoming movies/shows, and Store's pricing and currency, replacing the separate pickers each used to have.
- "Forgot password?" on the login screen — recover your account with an emailed reset code if you forget your password, no admin needed.
- Store deal cards now show whether the seller is the official store, a key reseller, or a key marketplace, with a tooltip explaining the difference.

**Changed**

- The app now opens maximized to your screen instead of a small fixed window, so rows aren't cut off.
- The changelog no longer pops open automatically after an update — open it anytime with the 🔔 button.
- Switching sections resets scroll back to the top instead of keeping the previous section's scroll position.

**Fixed**

- Some Store and Free Games cards could show the wrong game's cover art and trailer entirely — now verified against Steam's own listing before being trusted.
- Cards with a non-portrait cover no longer get resized to fit — a real vertical cover is found instead, so every card in a row stays the same size, including Reading Room and book covers.
- Grid density (compact mode) now shrinks every section evenly instead of leaving Installed a different size than carousel rows.
- A carousel row (Upcoming Games, New Shows/Anime, Reading Room, Favorites, Recently Opened, Related items) could leave a card sliced in half at the edge after resizing the window.
- New Anime no longer shows a returning show's new season as if it were a brand-new series.
- Free games' trailers now prefer the real Steam trailer over a YouTube guess, which could show unrelated content for short or generic titles.
- Keyboard focus on a card's buttons (favorite, remove, sound, etc.) is now visible when tabbing to it, not just on hover.

## 1.5.1

**Fixed**

- The "Where to Watch" button on Recently Released episode cards was opening a broken JustWatch link instead of a working search.

## 1.5.0

**New**

- A Store section — browse discounted PC games aggregated from Steam and other resellers, with review scores, trailers, platform filters, and quick links straight to the storefront to buy.
- Optional email verification for new accounts.
- Theatre's Streaming Providers now shows one row per streaming service (Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Paramount+, Peacock, Crunchyroll) instead of a single dropdown-driven row, each with a "Watch on <Provider>" button that opens the title on that service's own site.
- A "New Anime" row in the New tab, alongside New Series.

**Fixed**

- Dragging the first New tab section (or sidebar section, or Free Games platform row) onto its immediate neighbor could silently fail to reorder it.
- Cards in the New tab and other carousels could render at inconsistent sizes or get cut off at the edge instead of resizing to fit.
- The hero banner's background no longer mismatches the video playing inside it.
- Removing a show from My Shows now also removes its entry from Recently Released instead of leaving it behind.

## 1.4.2

**Changed**

- Camera, microphone, location, and other sensitive browser permissions are now blocked by default app-wide, closing a gap where anything embedded in Riftgate could have silently been granted them.

## 1.4.1

**Changed**

- Upgraded Riftgate's underlying framework (Electron) to the current supported version, plus a round of under-the-hood security hardening.

**Fixed**

- Trailers (YouTube previews) were showing a black frame instead of playing.

## 1.4.0

**New**

- Applications rebuilt — each app now shows a GitHub avatar (or a generated icon if it isn't hosted on GitHub), a "NEW" badge for recent additions, a clickable link to the creator's GitHub profile, and a visit counter, plus a search box and a sort dropdown (Newest / Most Visited / Name / Author).

## 1.3.12

**New**

- Theatre now shows type badges, ratings (via TVMaze/TMDB/SteamSpy, with a source tooltip), and a next-episode countdown for shows you're tracking.
- New Series cards now show a rating badge (via TMDB), matching Theatre, My Shows, and Free Games.

**Changed**

- The "Scan for Apps & Games" and "Remove Apps & Games" buttons moved from the sidebar into the Installed section's topbar, next to Sort/Search/Add.

**Fixed**

- Reading Room's Recently Opened, Favorites, and Most Popular/Most Sold Books carousels were rendering cards at their native image size instead of the standard card width.

## 1.3.11

**New**

- Free Games platform rows can now be reordered by dragging them, same as the New tab's sections — your order is remembered.
- Added several free Battle.net games that were missing from the list — Heroes of the Storm, StarCraft II, the original StarCraft (including Brood War), and Call of Duty: Warzone.

**Changed**

- A Free Games cover that's wider than tall now widens its card to show the whole image instead of cropping it or leaving black bars, while staying the same row height as the portrait covers next to it.
- Free Games cards now match the Installed library's card size.
- The Free Games "🔄 Refresh" button, when you're viewing a single platform's full list, now only re-checks that one platform instead of re-fetching every platform.

**Fixed**

- Every itch.io game in Free Games was showing "NO COVER" — a scraper bug was splitting each game's listing in half right between its cover image and its title, so every title came through with no image at all.
- The Free Games spotlight banner could show a blank black box instead of a cover for older/obscure Steam titles — it now falls back to another cover source, same as every other Free Games card already did.

## 1.3.9

**Fixed**

- Updates now install silently in the background — clicking "Update Now" used to pop up the full Windows installer wizard and could show a "Riftgate cannot be closed" error instead of just updating and relaunching on its own.

## 1.3.8

Removed: Installed library category sections no longer grow and shrink as you scroll one into the center of the screen.

**Changed**

- Free Games cover art is now cached to disk, so reopening the section shows every cover instantly instead of re-downloading them.

**Fixed**

- Free Games covers with a different shape than the card no longer show black bars — every cover now fills its card completely.
- The Free Games spotlight banner no longer resizes and shoves the rest of the page around every time it rotates to a new game.

## 1.3.7

**New**

- A "🔍 Scan for Installed Games" button on the empty-library welcome screen finds every installed game via Steam, Epic, and Start Menu shortcuts — not just Steam and Epic.

**Fixed**

- Games installed through a shared launcher (Battle.net, GOG Galaxy, Ubisoft Connect, itch.io, etc.) are now told apart from ordinary software during a scan, instead of every shortcut-only find getting lumped in as a plain "app".
- "New Series" was showing all-time popular old shows (Breaking Bad, Game of Thrones) instead of anything actually new — it now only shows shows whose first season started in the last ~90 days.

## 1.3.6

Removed: the Light theme toggle.

**New**

- An admin-only preview switcher (🛡️ Admin / 🧑 Adult / 🔞 Minor) lets admins see what a different kind of user would see, without logging out.

**Fixed**

- Several titles sharing one launcher (every Battle.net game — Diablo, Overwatch, WoW, etc.) could get collapsed into a single entry during a scan instead of showing up individually.
- Manga/Comics could show a classic work (like a Shakespeare play) that only ended up tagged "manga"/"comic" because of a much later adaptation, not the original text itself.

## 1.3.5

Removed: the redundant mature-content checkbox from the search bar.

**New**

- New faceted purple gem app icon and logo, used in the startup animation and header.
- A new application banner.

**Changed**

- Nav icons replaced with a hollow faceted-line SVG set with a purple-to-pink gradient stroke.

**Fixed**

- App assets (icons, images) could keep showing a stale cached version after an update — asset caching is now disabled so changes always show up right away.

## 1.3.3

**New**

- Manga and Comics moved from their own sections into Reading Room, alongside Buy Books/Discover/My Library/eBook Apps — and are now sorted alphabetically, show a much bigger list, and collapse behind a "See more" toggle after 10 rows.
- The search bar now also searches the web (Steam, TMDB, Open Library) for games/movies/shows/books that aren't already in your library, Free Games, or Reading Room — shown as a quick lookup, never added to any list.
- Books, manga, and comics that are freely readable online now show a "Read Online" button right next to Buy/Download, linking straight to where it can actually be read.
- On a brand-new install, Free Games finds Steam's currently-free titles directly from Steam's own live search instead of checking thousands of games one by one — the very first refresh finishes in moments instead of taking a long time.
- New Series now has its own filter box, like Recent Episodes already did.

**Changed**

- Applications always sits last in the section list now, and eBook Apps always sits last among the Reading Room tabs (after Manga and Comics).
- More breathing room in the header and Reading Room tabs — a divider now separates the search/login area from the notification/Surprise Me/power icons, and the tabs sit in their own lightly-shaded strip instead of everything reading as one dense row.
- Every Reading Room tab (Buy Books, Discover Online, My Library, Manga, Comics) now shows its search bar in the same spot and its description in the same expandable "ⓘ About" format, instead of each tab looking laid out differently.

**Fixed**

- Manga and Comics were showing a lot of entries with no cover art at all — they now only show entries with real cover art, same as New Releases already did.
- Manga and Comics could show the same title in both lists, since Open Library often files manga under the generic "comics" subject too — Manga and Comics browsing and searching are now kept strictly separate.
- The manual Refresh button in Free Games could still leave a Steam title listed after it stopped being free — it only re-fetched the Epic/Steam/GOG lists, but still relied on the same capped, days-old verification as an ordinary refresh, so it never actually re-checked most already-cached Steam titles. It now does a real full re-check of every listed Steam game.
- A Steam game that stopped being free (a limited-time promo ending) but was still a perfectly normal store listing wasn't being caught at all — only outright delistings were checked for; current price is now checked too.
- A forced Free Games refresh looked like it was doing nothing when there were thousands of Steam games to re-verify — it really was working, just one request every 1.2 seconds against a list that can run into the thousands, which could take well over an hour before anything was saved. It now checks several at once with a short pause between batches (a few minutes for the whole catalog instead of over an hour), and saves progress as it goes instead of only at the very end, so closing Riftgate partway through a big check no longer throws away everything it already found.
- Every search/filter box (Games, Free Games, Reading Room, Manga, Comics, Movies, Shows, the header search) now clears itself when you switch to a different section or Reading Room tab, instead of leaving old search text and results sitting there.
- Manga and Comics' search bar sat flush against the list below it, unlike every other Reading Room tab.
- My Library's sort dropdown, Drop Folder, and + buttons looked like plain unstyled Windows controls instead of matching the rest of Riftgate.
- Upcoming Movies' country selector (and similar single-item header rows) could snap to the left instead of staying flush with the right edge.

## 1.3.2

**New**

- Upcoming Movies now has its own country selector — release schedules vary a lot by country, and it used to silently share a setting with Now Playing's showtimes country, which is why the same list could look completely different for two people.
- A Refresh button in Free Games gets an up-to-date list on demand instead of waiting for the next automatic refresh.

**Changed**

- Free Games now refreshes from Steam/Epic/GOG at most once every 24 hours instead of every time you open the section — it opens instantly from what was already loaded last time, and checks for a new list (adding newly-free games, dropping ones no longer available) once a day, including once at startup so it stays current even on days you never open that section.
- Trailers no longer auto-play on hover anywhere in the app — click the "Watch larger" button on a game, movie, or show to load and play its trailer instead. Hovering was quietly using up the shared trailer lookup for everyone; loading only on a real click keeps it working for the whole community.

**Fixed**

- An uninstalled Steam game could stay listed as installed indefinitely — the missing-game check now actually looks for it, instead of skipping every Steam title without checking at all.
- Surprise Me could show the same title twice in the reel — usually because the same game or item exists in the underlying list more than once (e.g. imported into your library through two different paths). The reel now only ever shows each title once.
- Surprise Me's result could very occasionally show a leftover result from a previous spin (e.g. from Free Games) if you closed the wheel or switched sections while a spin's reveal was still pending. Each spin's result now only ever applies to that same spin/session.
- Free Games could keep listing a Steam title well after it was delisted (e.g. shows a "no longer available" notice on its own store page) — that state wasn't visible to the check being used before, so it's now checked directly.
- Free Games could end up doing two full Steam/Epic/GOG refreshes back to back on startup (the automatic startup refresh and opening the section could both see a refresh as due at the same moment) — a refresh already in progress is now reused instead of a second one starting.
- A Free Games refresh could try to re-verify thousands of Steam titles in one pass, which was impractically slow — each verified game is now trusted for 7 days instead of ~1, and at most 200 titles are re-checked per refresh (newest/never-checked ones first), spreading the work across several days instead of redoing it all at once.
- Surprise Me's reel could still occasionally show the winning title twice in a row right next to where it lands — the earlier duplicate-tile fix covered the underlying list, but not this separate coincidence in how the reel strip itself is built.

## 1.3.1

**Fixed**

- A tray icon load failure could silently stop the rest of startup from running — including the automatic update check and the folder watcher for drag-and-drop while Riftgate is closed. Both now run reliably regardless of the tray icon, and the tray icon itself is fixed too.

## 1.3.0

Various smaller design and consistency polish across icons, colors, and background effects.

**New**

- A first-run tour now walks new installs through the main menu, search, your library, the quick-action buttons, Surprise Me, and Settings.

**Changed**

- Notifications, suggestions, Surprise Me, and Close App moved from a floating corner overlay into the header, so they never sit on top of your library again.
- The header is significantly more compact, and the main menu button now shows a fixed "Riftgate" label instead of the current section's name.
- Your library now shows a "Your Library — X games · Y applications" summary, and an empty Games or Applications section shows a real "drag a shortcut here" message instead of just disappearing.
- Card titles, metadata, and section intro text resized for readability; long intro paragraphs collapse behind an "ⓘ About" toggle.
- Library cards resize to fit the window instead of staying a fixed width, so long titles have more room before truncating.
- Applications now use a simpler icon-centered card style instead of the cinematic cover treatment used for games.
- Surprise Me always uses the same spin animation now, regardless of what you're spinning for, and its result screen shows a bit of context (genre, last played, release info, etc.) alongside the pick.

## 1.2.5

**New**

- App cards in Applications now show who actually made the app, alongside which admin added the listing.
- The Suggest an App box now also shows the email address directly, in case the mail button doesn't open anything on your machine.

**Fixed**

- Admins can edit an app's author and description together again — the edit button was pointing at a database function that no longer existed.
- The Reading Room search bar no longer stays stuck on screen after leaving to Installed, Free Games, or New.

## 1.2.3

**New**

- Applications is back as its own section — a browsable list of apps recommended by admins, each with a link out and a description.
- Admins can add an app with just a link — for a GitHub repo, its description is pulled in automatically, and any admin can edit it later.
- A "Suggest an App" button lets anyone email in an app they'd like to see added.

## 1.2.2

**New**

- EBook Apps — the recommended eBook reader apps and ranked Top 5 list now have their own tab in Reading Room, instead of being tucked at the bottom of My Library where they were easy to miss.

**Fixed**

- The eBook reader recommendations no longer stay visible after leaving Reading Room for another section.
- New Releases in Buy Books no longer pads out the list with a bunch of books missing cover art just to hit a round count — it now looks harder for ones that actually have covers first.
- Trailers no longer show a completely unrelated video for games without a real trailer uploaded yet — results are now checked for relevance and restricted to the right category before being accepted.

## 1.2.0

**New**

- Logging in is now optional — Riftgate no longer asks for a password on first launch, and works fully signed out.
- A Login button now sits next to the section switcher, visible in every section, and shows whether you're currently signed in.
- Logging out asks for confirmation first.
- A guided tour points out new or changed features like this one, the first time you open the app after an update.

**Fixed**

- The password-setup popup could leave you stuck with no way to cancel out of it.
- Compact display mode no longer overlaps the cover buttons on Installed/Applications cards.
- Free Games could still show a Steam game that had actually been delisted.

## 1.1.5

**Fixed**

- Only existing super-admins can now promote someone to super-admin or demote one back down — regular admins keep full control over everything else.

## 1.1.4

Various backend fixes to the admin permission system.

**Fixed**

- The owner account is now properly protected from being removed or demoted by any other admin.
- Usernames can no longer end in "_Adm", "_Root", or similar — prevents impersonating an admin.

## 1.1.3

Various smaller fixes and polish.

**Fixed**

- Several trailer, cover, and description issues across movies, shows, and books.

## 1.1.2

Improved: auto-update checks are more reliable, with proper retries instead of a single silent attempt. Various smaller fixes and polish.

**New**

- Buy Books — a third Reading Room tab for current/mainstream books with purchase links, plus Most Popular, Best Seller, and New Releases lists.
- Applications section now has real content — recommended free eBook readers and a ranked Top 5 (free and paid).
- Manually add or change a book's cover on any book, anywhere in Reading Room.
- Surprise Me now covers all three Reading Room tabs, including Buy Books.

**Fixed**

- Many book covers and descriptions that were missing or failing to load, across My Library, Discover Online, and Buy Books.
- Several trailers across the app (games, movies, shows) that could get silently stuck after a single failed attempt.
- My Shows trailers no longer risk pulling a game's trailer instead of the actual show's.
- Portuguese and other regional movies missing posters/descriptions in In Theaters and New.
- An app (like Discord) updating itself no longer gets mistaken for being uninstalled.
- Several sections no longer start empty while waiting on the network — they now show the last known results instantly and refresh quietly in the background.
- Items without a cover now consistently sort to the end of every list instead of appearing scattered throughout.

## 1.1.0

Various smaller fixes and polish.

**New**

- Reading Room — a full eBook section with your own personal library and a Discover Online tab pulling free public-domain books.
- Drag-and-drop or drop books straight into a dedicated Reading Room folder, even while Riftgate is closed — everything's picked up automatically.
- Favorites and Recently Opened rows for your library, both searchable from one bar at the top.
- Send to Device — copy any book straight to a connected Kindle, phone, tablet, or other drive.
- A Surprise Me wheel for Reading Room too, working across both your library and Discover Online.

**Fixed**

- Book covers now load correctly, with automatic repair for anything added before this fix.

## 1.0.0

Riftgate's version numbering has been reset to better reflect the project's actual stage — starting fresh from here. Various smaller fixes and polish.

**New**

- Reading Room — a personal eBook library for EPUB and PDF files, with real titles/authors/covers pulled from the files themselves.
