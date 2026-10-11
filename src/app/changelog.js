// Riftgate — what's new, newest first. This version's notes, then every
// 1.x release carried over from the original app (changelog-history.js).
import { HISTORY } from "./changelog-history.js";

export const CURRENT_NOTES = {
    "2.0.2": [
        "Fixed: the opening runs smoothly. The lightning's glow is drawn in a small layer around each bolt instead of across the whole screen, and the lightning's sound is prepared during the first seconds instead of on the frame it strikes. It looks and sounds exactly the same. The lightning when you click the gem in Nexus is lighter too"
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
