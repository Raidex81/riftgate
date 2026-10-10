// Riftgate — Ask the Rift: tell it what you feel like ("something funny and
// short", "a co-op shooter to play with friends", "a cosy fantasy book, no
// romance", "a series like Severance") and it picks from Riftgate's own lists,
// ranked by what reviewers and players actually think.
//
// Everything runs here on your computer, for free: no AI service, no
// account, nothing you type leaves Riftgate. understand() turns the words
// into concepts (genres, moods, who you play with, how long, how new, how
// good), and rank() scores each candidate on how well it fits and on a
// fair rating: an average that only counts as much as the number of
// reviews behind it (8.9 from 40 votes doesn't beat 8.4 from 30,000).

import * as journal from "./store.js";

// ---- What the words mean ------------------------------------------------------------
// Each concept: `words` (start-of-word stems, English first, then a few
// Portuguese, Spanish and French ones), and how it shows in each kind of
// item: TMDB genres for films and series, store tags for games, subjects
// for books, plus words to look for in descriptions (`text`).
const C = [
    { id: "funny", label: "Funny", words: ["funny", "comedy", "comedies", "comic relief", "laugh", "hilarious", "humor", "humour", "silly", "lighthearted", "light-hearted", "goofy", "witty", "engraçad", "comédia", "comedia", "divertid", "risa", "drôle", "drole"],
        genres: ["Comedy"], tags: ["comedy", "funny"], subjects: ["humor", "humour", "comedy", "humorous", "satire", "wit and humor"], text: ["comedy", "hilarious", "funny", "humor", "humour"] },
    { id: "action", label: "Action", words: ["action", "explosion", "adrenaline", "fight", "fighting", "fast-paced", "fast paced", "intense action", "ação", "acção", "accion", "acción"],
        genres: ["Action", "Action & Adventure"], tags: ["action", "fighting", "fps", "shooter", "action & arcade games", "battle royale", "arcade"], subjects: ["action", "adventure stories"], text: ["action-packed", "action packed", "combat", "fight"] },
    { id: "adventure", label: "Adventure", words: ["adventure", "quest", "journey", "explore", "exploration", "exploring", "treasure", "aventura", "aventure"],
        genres: ["Adventure", "Action & Adventure"], tags: ["adventure", "exploration & travel", "exploration", "open world"], subjects: ["adventure", "adventure stories", "voyages"], text: ["adventure", "explore", "journey", "quest"] },
    { id: "horror", label: "Scary", words: ["scary", "horror", "creepy", "terrifying", "spooky", "halloween", "ghost", "zombie", "haunted", "frighten", "fear", "terror", "medo", "assustador", "miedo", "peur", "effrayant"],
        genres: ["Horror"], tags: ["horror"], subjects: ["horror", "ghost stories", "horror tales", "supernatural"], text: ["horror", "terrifying", "zombie", "haunted", "nightmare", "creepy", "survival horror"] },
    { id: "thriller", label: "Thrilling", words: ["thriller", "suspense", "tense", "gripping", "edge of my seat", "edge of the seat", "nail-biting", "twist", "suspens", "tensão"],
        genres: ["Thriller", "Crime", "Mystery"], tags: ["stealth"], subjects: ["thriller", "suspense", "thrillers", "spy stories"], text: ["thriller", "suspense", "conspiracy", "tense"] },
    { id: "mystery", label: "Mystery", words: ["mystery", "mysteries", "detective", "whodunit", "crime", "murder", "heist", "investigat", "noir", "mistério", "misterio", "policial", "policíaco", "policier", "enquête"],
        genres: ["Mystery", "Crime"], tags: ["detective", "mystery", "investigation"], subjects: ["mystery", "detective", "crime", "detective and mystery stories", "murder"], text: ["detective", "murder", "mystery", "investigat", "heist", "crime"] },
    { id: "scifi", label: "Sci-fi", words: ["sci-fi", "scifi", "science fiction", "space", "spaceship", "future", "futuristic", "alien", "robot", "cyberpunk", "time travel", "dystopi", "ficção científica", "ficcao cientifica", "ciencia ficción", "science-fiction"],
        genres: ["Science Fiction", "Sci-Fi & Fantasy"], tags: ["sci-fi", "science fiction", "space", "cyberpunk"], subjects: ["science fiction", "space", "robots", "time travel", "dystopias"], text: ["sci-fi", "space", "alien", "robot", "cyberpunk", "galaxy", "future", "futuristic", "planet"] },
    { id: "fantasy", label: "Fantasy", words: ["fantasy", "magic", "magical", "dragon", "wizard", "witch", "elves", "sword and sorcery", "mytholog", "fairy tale", "fantasia", "fantasía", "fantastique", "magia", "magie"],
        genres: ["Fantasy", "Sci-Fi & Fantasy"], tags: ["fantasy", "rpg", "role-playing"], subjects: ["fantasy", "magic", "dragons", "fantasy fiction", "fairy tales", "wizards"], text: ["fantasy", "magic", "dragon", "wizard", "sorcer", "kingdom", "mythical"] },
    { id: "romance", label: "Romantic", words: ["romance", "romantic", "love story", "love stories", "date night", "in love", "romântic", "romántic", "amour", "amor"],
        genres: ["Romance"], tags: ["dating", "romance"], subjects: ["romance", "love stories", "love"], text: ["romance", "love story", "falls in love", "romantic"] },
    { id: "emotional", label: "Moving", words: ["emotional", "cry", "crying", "moving", "touching", "drama", "dramatic", "heartfelt", "sad", "tearjerker", "deep", "meaningful", "emocion", "emotion", "chorar", "llorar", "pleurer", "dramático", "dramatique"],
        genres: ["Drama"], tags: ["story rich", "story-rich", "narrative"], subjects: ["drama", "psychological fiction", "domestic fiction"], text: ["moving", "heartfelt", "emotional", "grief", "touching", "drama"] },
    { id: "family", label: "For the family", words: ["family", "kids", "kid", "children", "child", "my son", "my daughter", "all ages", "família", "familia", "famille", "crianças", "niños", "enfants", "filhos"],
        genres: ["Family", "Kids", "Animation"], tags: ["family", "kids", "casual", "educational"], subjects: ["juvenile fiction", "children's", "children", "picture books", "juvenile literature"], text: ["family", "kids", "children", "all ages", "friendship"] },
    { id: "animated", label: "Animated", words: ["animated", "animation", "cartoon", "pixar", "animação", "animación", "dessin animé"],
        genres: ["Animation"], tags: ["animation"], subjects: ["comic books", "graphic novels"], text: ["animated"] },
    { id: "true", label: "True stories", words: ["documentary", "documentaries", "true story", "real life", "real story", "biography", "biopic", "based on a true", "nonfiction", "non-fiction", "learn", "documentário", "documental", "documentaire", "biografia", "biographie"],
        genres: ["Documentary", "History"], tags: ["documentaries & stories", "museums & culture", "educational"], subjects: ["biography", "history", "nonfiction", "autobiography", "memoir", "true crime", "science"], text: ["true story", "documentary", "real-life", "based on the true"] },
    { id: "history", label: "Historical", words: ["history", "historical", "war", "ww2", "wwii", "world war", "medieval", "ancient", "roman", "viking", "samurai", "história", "historia", "histoire", "guerra", "guerre"],
        genres: ["History", "War", "War & Politics", "Western"], tags: ["historical", "war", "medieval"], subjects: ["history", "historical fiction", "war", "world war", "war stories"], text: ["war", "historical", "medieval", "ancient", "empire", "1940", "world war", "viking", "samurai"] },
    { id: "western", label: "Western", words: ["western", "cowboy", "wild west", "faroeste"], genres: ["Western"], tags: ["western"], subjects: ["western stories", "western"], text: ["cowboy", "western", "wild west", "outlaw"] },
    { id: "music", label: "Music", words: ["music", "musical", "rhythm", "concert", "band", "música", "musique"], genres: ["Music"], tags: ["music", "rhythm"], subjects: ["music", "musicians"], text: ["music", "rhythm", "band", "singer"] },
    { id: "think", label: "Makes you think", words: ["think", "brain", "clever", "smart", "mind-bending", "mind bending", "mindbending", "cerebral", "philosoph", "intellectual", "thought-provoking", "pensar", "inteligente", "réfléchir"],
        genres: ["Mystery", "Science Fiction", "Documentary"], tags: ["strategy", "puzzle", "puzzle, board & card games", "turn-based", "card game", "rts"], subjects: ["philosophy", "science fiction", "psychological fiction"], text: ["mind-bending", "puzzle", "strategy", "philosoph", "reality", "mystery"] },
    { id: "strategy", label: "Strategy", words: ["strategy", "strategic", "tactics", "tactical", "rts", "4x", "turn-based", "turn based", "management", "city builder", "city-builder", "estratégia", "estrategia", "stratégie"],
        tags: ["strategy", "rts", "turn-based", "real-time", "moba", "card game"], text: ["strategy", "tactical", "tactics", "build your empire", "turn-based", "management"], gamesOnly: true },
    { id: "puzzle", label: "Puzzles", words: ["puzzle", "riddle", "logic", "brain teaser", "quebra-cabeça", "rompecabezas", "énigme"],
        tags: ["puzzle", "puzzle, board & card games"], subjects: ["puzzles"], text: ["puzzle", "riddle", "logic"] },
    { id: "rpg", label: "RPG", words: ["rpg", "role-playing", "role playing", "roleplaying", "jrpg", "mmorpg", "loot", "character build", "leveling", "levelling"],
        tags: ["rpg", "role-playing", "mmo"], text: ["rpg", "role-playing", "loot", "level up", "character"], gamesOnly: true },
    { id: "shooter", label: "Shooter", words: ["shooter", "shooting", "fps", "first-person shooter", "gun", "guns", "sniper", "battle royale", "tiros", "disparos"],
        tags: ["fps", "shooter", "battle royale", "tpp", "fpp"], text: ["shooter", "fps", "weapons", "guns", "battle royale"], gamesOnly: true },
    { id: "racing", label: "Racing", words: ["racing", "race", "cars", "car", "driving", "drift", "corrida", "carreras", "course automobile"],
        tags: ["racing"], text: ["racing", "race", "drift", "cars"], gamesOnly: true },
    { id: "sports", label: "Sports", words: ["sport", "sports", "football", "soccer", "basketball", "tennis", "golf", "futebol", "fútbol", "deporte", "desporto"],
        tags: ["sports", "fitness & wellness"], subjects: ["sports"], text: ["football", "soccer", "basketball", "sport", "tennis"] },
    { id: "survival", label: "Survival & crafting", words: ["survival", "survive", "crafting", "craft", "sandbox", "base building", "base-building", "building", "sobrevivência", "supervivencia", "survie"],
        tags: ["survival", "creativity & tools", "sandbox"], text: ["survival", "survive", "craft", "sandbox", "base"], gamesOnly: true },
    { id: "friends", label: "With friends", words: ["friends", "friend", "multiplayer", "multi-player", "co-op", "coop", "cooperative", "together", "online", "party", "pvp", "team", "squad", "with my brother", "with my sister", "with my partner", "with my girlfriend", "with my boyfriend", "amigos", "cooperativo", "ensemble", "amis"],
        tags: ["mmo", "moba", "battle royale", "social & multiplayer worlds", "multiplayer"], text: ["multiplayer", "co-op", "cooperative", "online", "pvp", "team-based", "squad", "friends", "mmo", "players"], gamesOnly: true },
    { id: "solo", label: "Story-driven", words: ["story", "story-driven", "story driven", "narrative", "single-player", "single player", "singleplayer", "solo", "alone", "by myself", "história", "historia", "sozinho"],
        tags: ["story rich", "narrative", "adventure"], text: ["story", "narrative", "single-player", "singleplayer"], gamesOnly: true },
    { id: "cosy", label: "Cosy", words: ["cosy", "cozy", "chill", "chilled", "relax", "relaxing", "calm", "comfy", "comfort", "wholesome", "tired", "easy", "laid-back", "laid back", "peaceful", "feel-good", "feel good", "light", "gentle", "unwind", "relaxar", "calmo", "tranquil", "relajar", "détente", "cansad"],
        genres: ["Comedy", "Family", "Animation", "Romance"], tags: ["casual", "puzzle", "puzzle, board & card games", "farming", "cozy", "relaxing", "music"], subjects: ["humor", "cozy", "friendship", "comfort", "feel-good"], text: ["relaxing", "cozy", "cosy", "calm", "peaceful", "wholesome", "farm", "charming", "gentle"],
        avoid: ["horror", "thriller", "history"] },
    { id: "dark", label: "Dark", words: ["dark", "gritty", "intense", "disturbing", "darker", "brutal", "bleak", "violent", "noir", "sombrio", "oscuro", "sombre"],
        genres: ["Thriller", "Crime", "Horror", "Drama", "War"], tags: ["horror", "survival"], subjects: ["horror", "noir", "thriller", "psychological fiction"], text: ["dark", "brutal", "gritty", "violent", "twisted", "revenge"] },
    { id: "vr", label: "VR", words: ["vr", "virtual reality", "headset", "quest 3", "quest 2", "oculus", "realidade virtual"], vr: true, gamesOnly: true }
];

// Kinds: which shelves the request is about
const KINDS = [
    { id: "game", words: ["game", "games", "play", "gaming", "jogo", "jogar", "juego", "jugar", "jeu", "jouer"] },
    { id: "film", words: ["film", "films", "movie", "movies", "cinema", "cinemas", "theater", "theatre", "filme", "filmes", "película", "pelicula"] },
    { id: "series", words: ["series", "shows", "tv show", "tv series", "tv", "binge", "episodes", "season", "série", "séries", "serie"] },
    { id: "anime", words: ["anime"] },
    { id: "book", words: ["book", "books", "read", "reading", "novel", "novels", "livro", "livros", "ler", "libro", "leer", "livre", "lire"] },
    { id: "manga", words: ["manga", "mangá"] },
    { id: "comic", words: ["comic", "comics", "graphic novel", "bd", "banda desenhada", "cómic"] }
];
// Modifiers: how new, how good, how known, how long, how much it costs
const MODS = [
    { id: "new", label: "New", words: ["new", "newest", "latest", "recent", "just released", "just came out", "fresh", "this week", "this month", "novo", "nova", "novidade", "nuevo", "nouveau", "récent"] },
    { id: "classic", label: "A classic", words: ["classic", "classics", "old", "older", "timeless", "retro", "vintage", "clássico", "clásico", "classique"] },
    { id: "gem", label: "Hidden gem", words: ["hidden gem", "gem", "underrated", "lesser-known", "lesser known", "unknown", "obscure", "indie", "not mainstream", "nobody knows", "pérola"] },
    { id: "popular", label: "Popular", words: ["popular", "everyone loves", "trending", "famous", "hyped", "hype", "blockbuster", "mainstream", "sucesso", "éxito"] },
    { id: "best", label: "Top rated", words: ["best", "top", "top-rated", "top rated", "masterpiece", "acclaimed", "award", "highly rated", "great reviews", "good reviews", "must-see", "must see", "must-play", "must read", "great", "excellent", "amazing", "brilliant", "melhor", "mejor", "meilleur", "obra-prima"] },
    { id: "short", label: "Short", words: ["short", "quick", "little time", "an hour", "one hour", "one evening", "tonight", "not too long", "not long", "curto", "rápido", "corto", "court"] },
    { id: "long", label: "Long", words: ["long", "epic", "saga", "huge", "hundreds of hours", "binge", "binge-worthy", "longo", "largo"] },
    { id: "keep", label: "Free to keep", words: ["free to keep", "keep forever", "giveaway", "claim", "to keep"] },
    { id: "f2p", label: "Free to play", words: ["free to play", "free-to-play", "f2p"] },
    { id: "mine", label: "Something I have", words: ["i own", "i have", "my library", "already have", "installed", "from my library", "my games", "my ebooks", "my books"] }
];

const NEG = ["no", "not", "without", "nothing", "avoid", "hate", "don't want", "dont want", "anything but", "except", "no more", "sem", "nada de", "não", "nao", "sin", "sans", "pas de"];
const LIKE = ["like", "similar to", "something like", "same as", "in the style of", "as good as", "parecido com", "tipo", "como", "parecido a", "comme"];

const plain = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// a word stem at the start of a word: "laugh" finds "laughs", "fantas" finds "fantasy"
const stemRe = (w) => new RegExp(`(^|[^a-z0-9])${escape(plain(w))}`, "i");
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${escape(plain(w))}($|[^a-z0-9])`, "i");
const compiled = new Map();
const re = (w, whole) => { const k = (whole ? "w:" : "s:") + w; if (!compiled.has(k)) compiled.set(k, whole ? wordRe(w) : stemRe(w)); return compiled.get(k); };
// Short words (war, sad, vr, tv...) only count as whole words, so "war"
// doesn't find "warm" and "kid" doesn't find "kidnap"
const finds = (text, w) => re(w, plain(w).length <= 4).test(text);
const findsWhole = (text, w) => re(w, true).test(text);

// ---- understand(): words -> request ----------------------------------------------
// Returns { want: [concept], avoid: [concept], kinds: Set, mods: Set, like: "title" | null, text }
export function understand(raw) {
    let text = " " + plain(raw).replace(/[“”"’]/g, "'").replace(/\s+/g, " ").trim() + " ";
    const out = { want: [], avoid: [], calm: [], kinds: new Set(), mods: new Set(), like: null, text: raw.trim() };

    // "like Severance", "similar to Hades" -> a title to match against
    for (const l of LIKE) {
        const m = text.match(new RegExp(`(?:^|[^a-z0-9])${escape(plain(l))}\\s+['"]?([^,.;!?]+?)['"]?\\s*(?:[,.;!?]| but | and | with | without | that | for | no | not | mas | pero |$)`, "i"));
        if (m && m[1] && m[1].trim().length >= 2 && !/^(a|an|the|um|uma|me|i|to)$/.test(m[1].trim())) {
            const t = m[1].trim();
            // "something like a comedy" is a concept, not a title; "like Team Fortress 2" is a title
            if (!/^(a|an|some|um|uma|uns|umas|un|una|une|des)\s/.test(t)) { out.like = t; text = text.replace(m[0], " "); break; }
        }
    }

    // Negations cover the next few words: "no horror", "not too dark", "without romance or sad endings"
    const negated = new Set();
    for (const n of NEG) {
        const r = new RegExp(`(?:^|[^a-z0-9'])${escape(plain(n))}\\s+((?:[a-z0-9'-]+\\s*){1,4})`, "gi");
        let m; while ((m = r.exec(text))) {
            const span = " " + m[1] + " ";
            C.forEach((c) => { if (c.words.some((w) => finds(span, w))) negated.add(c.id); });
        }
    }
    // "not too long" / "not long" means short, not "avoid long"
    if (/\bnot (too |very )?long\b/.test(text)) out.mods.add("short");

    for (const c of C) {
        if (!c.words.some((w) => finds(text, w))) continue;
        (negated.has(c.id) ? out.avoid : out.want).push(c);
    }
    // a concept both wanted and refused ("funny but not silly") counts as wanted
    out.avoid = out.avoid.filter((c) => !out.want.includes(c));
    // asking for something cosy quietly keeps the scary and the grim away
    for (const c of out.want) (c.avoid || []).forEach((id) => { const a = C.find((x) => x.id === id); if (a && !out.want.includes(a) && !out.avoid.includes(a)) out.calm.push(a); });

    // kinds and modifiers are whole words: "ready" isn't "read", "shower" isn't "show"
    KINDS.forEach((k) => { if (k.words.some((w) => findsWhole(text, w))) out.kinds.add(k.id); });
    MODS.forEach((m) => { if (m.words.some((w) => findsWhole(text, w))) out.mods.add(m.id); });
    if (out.mods.has("keep") || out.mods.has("f2p")) out.kinds.add("game");
    // "binge" says series; "tonight" alone doesn't say anything about the kind
    if (out.mods.has("short") && out.mods.has("long")) out.mods.delete(/\bnot (too |very )?long\b/.test(text) ? "long" : "short");
    // "free" on its own, in a game request, means any free game
    if (/(^|[^a-z])free($|[^a-z])/.test(text) && !out.mods.has("keep") && !out.mods.has("f2p")) out.mods.add("free");
    // "play" with nothing else about the kind is a game; "watch" is film or series
    if (/(^|[^a-z])(watch|ver|assistir|regarder)($|[^a-z])/.test(text) && ![...out.kinds].some((k) => k !== "game")) { out.kinds.delete("game"); out.kinds.add("film"); out.kinds.add("series"); out.kinds.add("anime"); }
    return out;
}

// What the rift understood, as short labels (shown as chips you can remove)
export function summary(req) {
    const kindLabel = { game: "Games", film: "Films", series: "Series", anime: "Anime", book: "Books", manga: "Manga", comic: "Comics" };
    return [
        ...[...req.kinds].map((k) => ({ type: "kind", id: k, label: kindLabel[k] })),
        ...req.want.map((c) => ({ type: "want", id: c.id, label: c.label })),
        ...[...req.mods].filter((m) => m !== "free").map((m) => ({ type: "mod", id: m, label: (MODS.find((x) => x.id === m) || {}).label || m })),
        ...(req.mods.has("free") ? [{ type: "mod", id: "free", label: "Free" }] : []),
        ...req.avoid.map((c) => ({ type: "avoid", id: c.id, label: `No ${c.label.toLowerCase()}` })),
        ...(req.like ? [{ type: "like", id: "like", label: `Like “${req.like}”` }] : [])
    ];
}
export function drop(req, chip) {
    const r = { ...req, want: req.want.slice(), avoid: req.avoid.slice(), calm: (req.calm || []).slice(), kinds: new Set(req.kinds), mods: new Set(req.mods) };
    if (chip.type === "kind") r.kinds.delete(chip.id);
    if (chip.type === "mod") r.mods.delete(chip.id);
    if (chip.type === "want") { const c = r.want.find((x) => x.id === chip.id); r.want = r.want.filter((x) => x !== c); if (c && c.avoid) r.calm = r.calm.filter((a) => !c.avoid.includes(a.id)); }
    if (chip.type === "avoid") r.avoid = r.avoid.filter((c) => c.id !== chip.id);
    if (chip.type === "like") r.like = null;
    return r;
}
export const isEmpty = (req) => !req.want.length && !req.avoid.length && !req.kinds.size && !req.mods.size && !req.like;

// ---- What an item is -----------------------------------------------------------
const kindOf = (i) => {
    if (i.type === "book") {
        const s = plain((i.subjects || []).join(" | ") + " " + i.title);
        if (/(^|[^a-z])manga/.test(s)) return "manga";
        if (/(^|[^a-z])(comic|graphic novel)/.test(s)) return "comic";
        return "book";
    }
    return i.type === "app" ? "app" : i.type; // game | film | series | anime
};
function profile(i) {
    if (i.__ask) return i.__ask;
    const raw = i.raw || {};
    const tags = (Array.isArray(raw.tags) ? raw.tags : i.genre ? [i.genre] : []).map(plain);
    const genres = (i.genres || []).map(plain);
    const subjects = (i.subjects || []).map(plain);
    const desc = plain(`${i.title} ${i.desc || raw.description || raw.summary || ""}`);
    const p = { kind: kindOf(i), tags, genres, subjects, desc, year: i.date ? Number(String(i.date).slice(0, 4)) || null : null };
    Object.defineProperty(i, "__ask", { value: p, enumerable: false, configurable: true });
    return p;
}
// How strongly an item shows a concept: 1 = it's its genre/tag/subject, .55 = its description says so
function strength(i, c) {
    const p = profile(i);
    if (c.vr) return i.vr ? 1 : 0;
    if (c.gamesOnly && p.kind !== "game") return 0;
    const any = (list, hay) => (list || []).some((w) => hay.some((x) => x === plain(w) || x.includes(plain(w))));
    if (p.kind === "game" ? any(c.tags, p.tags) : p.kind === "film" || p.kind === "series" || p.kind === "anime" ? any(c.genres, p.genres) : any(c.subjects, p.subjects)) return 1;
    if ((c.text || []).some((w) => finds(p.desc, w))) return .7;
    return 0;
}

// ---- How good it is, fairly -------------------------------------------------------
// A rating out of 10 and how many people it stands for. Bayesian average: few
// votes pull toward an ordinary score, many votes let the real score through.
function quality(i) {
    const raw = i.raw || {};
    let r = null, n = 0, prior = 6.6, weight = 150, text = null;
    if (i.type === "film" || i.type === "series" || i.type === "anime") {
        if (typeof i.rating === "number") { r = i.rating; n = i.votes || 25; }
        if (r !== null) text = `${r.toFixed(1)}/10${i.votes ? ` from ${i.votes.toLocaleString()} votes` : ""}`;
    } else if (i.type === "game") {
        if (typeof raw.rating === "number" && raw.reviewCount) { r = raw.rating / 10; n = raw.reviewCount; prior = 7; weight = 400; text = `${Math.round(raw.rating)}% positive from ${raw.reviewCount.toLocaleString()} player reviews`; }
        else if (typeof i.rating === "number") { r = i.rating; n = 80; text = i.ratingText || `${i.rating.toFixed(1)}/10`; }
        else if (i.playtime) { r = 7.5; n = 60; text = null; }
    } else if (i.type === "book") {
        if (typeof i.stars === "number" && i.ratings) { r = i.stars * 2; n = i.ratings; prior = 7.2; weight = 25; text = `${i.stars.toFixed(1)}★ from ${i.ratings.toLocaleString()} readers`; }
        else if (i.downloads) { r = 7 + Math.min(1.6, Math.log10(i.downloads + 1) / 3); n = 60; prior = 7; text = `read ${i.downloads.toLocaleString()} times`; }
    }
    // nothing to go on: below an ordinary score, so reviewed picks come first
    const score = r === null ? prior - .6 : (n / (n + weight)) * r + (weight / (n + weight)) * prior;
    return { score, n, text, r };
}
const popularityOf = (i) => {
    const raw = i.raw || {};
    if (typeof i.popularity === "number" && i.type === "game") return i.popularity / 100; // 0-1ish
    if (typeof raw.popularity === "number") return Math.min(1, Math.log10(raw.popularity + 1) / 3);
    if (i.votes) return Math.min(1, Math.log10(i.votes + 1) / 4.5);
    if (i.ratings) return Math.min(1, Math.log10(i.ratings + 1) / 3.5);
    if (i.downloads) return Math.min(1, Math.log10(i.downloads + 1) / 5);
    return .3;
};

// ---- rank(): request + candidates -> the best few, each with a why --------------
export function rank(req, items, { exclude = new Set(), limit = 30 } = {}) {
    const year = new Date().getFullYear();
    // "like X": find X among the candidates (or anything Riftgate knows), borrow its concepts
    let likeItem = null, want = req.want.slice();
    if (req.like) {
        const t = plain(req.like);
        likeItem = items.find((i) => plain(i.title) === t) || items.find((i) => plain(i.title).startsWith(t)) || items.find((i) => t.length >= 4 && plain(i.title).includes(t));
        if (likeItem) C.forEach((c) => { if (!want.includes(c) && !req.avoid.includes(c) && strength(likeItem, c) >= 1) want.push(c); });
    }
    const kinds = req.kinds;
    const scored = [];
    for (const i of items) {
        if (!i || !i.title || exclude.has(i.key) || i === likeItem) continue;
        const p = profile(i);
        // books include manga and comics; series include anime
        if (kinds.size && !kinds.has(p.kind) && !(kinds.has("book") && (p.kind === "manga" || p.kind === "comic")) && !(kinds.has("series") && p.kind === "anime")) continue;
        if (req.mods.has("free") && p.kind === "game" && i.kind !== "free") continue;
        if (req.mods.has("free") && (p.kind === "book" || p.kind === "manga" || p.kind === "comic") && !(i.access === "public" || i.kind === "ebook" || (i.raw && i.raw.source === "Project Gutenberg"))) continue;
        if (req.avoid.some((c) => strength(i, c) >= .7) || (req.calm || []).some((c) => strength(i, c) >= 1)) continue;
        if (req.mods.has("keep") && (i.kind !== "free" || i.alwaysFree)) continue;
        if (req.mods.has("f2p") && (i.kind !== "free" || !i.alwaysFree)) continue;
        if (req.mods.has("mine") && !(i.kind === "library" || i.kind === "ebook" || i.kind === "journal" || i.kind === "show")) continue;
        if (want.some((c) => c.vr) && !i.vr) continue;

        // fit: share of what you asked for that it has (game-only ideas like
        // "co-op" don't count against a film when you asked for both)
        const applies = want.filter((c) => !(c.gamesOnly && p.kind !== "game"));
        const hits = applies.map((c) => [c, strength(i, c)]).filter(([, s]) => s > 0);
        const fit = applies.length ? hits.reduce((a, [, s]) => a + s, 0) / applies.length : 0;
        if (applies.length && !hits.length) continue;
        const q = quality(i);
        const pop = popularityOf(i);
        // everything you asked for beats most of it
        const all = applies.length > 1 && hits.length === applies.length ? 1.5 : 0;
        let score = fit * 6 + all + (q.score - 6.5) * (req.mods.has("best") ? 1.6 : 1) + pop * (req.mods.has("gem") ? 0 : 1.4);
        // demos, test servers and titles in a script you didn't type in go a little further back
        if (/(^|[^a-z])(demo|playtest|prologue|test server|pts)($|[^a-z])/i.test(i.title) && !/demo|prologue/i.test(req.text)) score -= 1.2;
        if (/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/.test(i.title) && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/.test(req.text)) score -= .9;
        const age = p.year ? year - p.year : null;
        if (req.mods.has("new")) score += age === null ? 0 : age <= 0 ? 2 : age === 1 ? 1 : age <= 3 ? 0 : -1.5;
        if (req.mods.has("new") && i.firstSeenAt) { const d = (Date.now() - i.firstSeenAt) / 86400000; score += d < 8 ? 3 : d < 31 ? 1.5 : 0; }
        if (req.mods.has("classic")) score += age === null ? 0 : age >= 40 ? 2 : age >= 20 ? 1.2 : age >= 10 ? .3 : -1.2;
        if (req.mods.has("popular")) score += pop * 2.5;
        if (req.mods.has("gem")) score += (q.r !== null && q.r >= 7.5 ? 1.2 : 0) - pop * 2.2;
        if (req.mods.has("short")) score += p.kind === "film" ? 1.2 : p.kind === "series" || p.kind === "anime" ? -1.2 : (p.tags.some((t) => /casual|puzzle|arcade/.test(t)) ? .8 : 0);
        if (req.mods.has("long")) score += p.kind === "series" || p.kind === "anime" ? 1.2 : p.kind === "film" ? -1 : (p.tags.some((t) => /rpg|role|mmo|strategy|survival/.test(t)) ? .8 : 0);
        if (likeItem) score += profile(likeItem).kind === p.kind ? 1 : -1;
        // your own Journal: what you loved shapes it a little, what you finished stays out (handled by the caller)
        const e = journal.entry(i.key);
        if (e && e.status === "planned") score += .6;
        score += Math.random() * .9; // so asking twice doesn't always give the same three

        // strongest reasons first: its genre, then what its description says
        const why = hits.slice().sort((x, y) => y[1] - x[1]).map(([c]) => c.label);
        scored.push({ item: i, score, why, quality: q.text });
    }
    scored.sort((a, b) => b.score - a.score);
    return { picks: scored.slice(0, limit), likeItem, likeMissing: !!req.like && !likeItem };
}

// Examples to try, per mood (shown as clickable chips under the box)
export const EXAMPLES = {
    play: ["Something relaxing I haven't played", "A story-driven game for tonight", "A co-op game for friends", "One of my favourites"],
    free: ["A co-op shooter to play with friends", "A relaxing puzzle game", "A scary game, top rated", "A free RPG with great reviews", "New free to keep this week"],
    watch: ["Something funny and short", "A mind-bending sci-fi film", "A cosy series to binge, nothing dark", "A thriller with great reviews", "A film for the family tonight"],
    read: ["A cosy fantasy book, no romance", "A gripping mystery", "A classic adventure", "Popular manga", "A true story that makes you think"],
    any: ["Something funny for tonight", "A hidden gem", "Something scary", "A great story, any kind", "Something to share with friends"]
};
