// Riftgate — what's new, newest first. This version's notes, then every
// 1.x release carried over from the original app (changelog-history.js).
import { HISTORY } from "./changelog-history.js";

export const CURRENT_NOTES = {
    "2.0.0-alpha.1": [
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
        "New: mature titles show only to adults who turn them on, from the date of birth on your Riftgate account, as in Riftgate 1.x",
        "New for admins: the Vault (share files for 1 to 4 hours and links for 7 days) and an Admin section to moderate titles and Vault access",
        "Changed: trailers play large and sharp; free games and deals appear instantly and refresh in the background",
        "Changed: sign in with your Riftgate account; your password is never stored on your PC"
    ]
};

export const CHANGELOG = { ...CURRENT_NOTES, ...HISTORY };
