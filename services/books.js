// Free eBooks (Project Gutenberg via the Gutendex API) and Buy Books
// (Open Library) — the pure fetch/shape functions, extracted out of
// main.js. Caching, language filtering, and the ipcMain wiring for these
// stay in main.js; this module only knows how to call the two APIs and
// map their raw responses into Riftgate's book shape.
const { fetchWithRetry } = require("./http");
const { textContainsMatureKeyword } = require("./content-filters");

// --- Project Gutenberg (via Gutendex) --------------------------------
// Gutendex is Gutenberg's own public, no-auth-required JSON API, and
// crucially exposes a real download_count per book — the one clean,
// genuine popularity signal available across the sources considered for
// this feature.

async function fetchGutenbergPages(pages) {
    const allBooks = [];
    let lastError = null;
    for (let page = 1; page <= pages; page++) {
        try {
            const data = await fetchWithRetry(`https://gutendex.com/books/?sort=popular&page=${page}`, 10000);
            if (data && Array.isArray(data.results)) {
                allBooks.push(...data.results);
            }
            if (!data || !data.next) break;
        } catch (err) {
            lastError = err.message || String(err);
            console.error(`[ebooks] Gutenberg fetch failed after retries (page ${page}):`, lastError);
            break;
        }
    }
    return { books: allBooks, error: allBooks.length === 0 ? lastError : null };
}

function mapGutenbergBook(b) {
    const epubUrl = (b.formats && b.formats["application/epub+zip"]) || null;
    const coverUrl = (b.formats && b.formats["image/jpeg"]) || null;
    // Every Gutenberg book is public-domain and freely readable online —
    // prefer their own in-browser HTML reader when Gutendex lists one,
    // otherwise fall back to the book's normal Gutenberg.org page, which
    // always offers a "Read this book online" link of its own.
    const htmlFormatKey = b.formats
        ? Object.keys(b.formats).find((k) => k.startsWith("text/html"))
        : null;
    const readUrl = (htmlFormatKey && b.formats[htmlFormatKey])
        || (b.id ? `https://www.gutenberg.org/ebooks/${b.id}` : null);
    const subjects = [
        ...(Array.isArray(b.subjects) ? b.subjects : []),
        ...(Array.isArray(b.bookshelves) ? b.bookshelves : [])
    ];
    const summaryText = (b.summaries && b.summaries[0]) || null;
    const isMature = textContainsMatureKeyword(b.title)
        || subjects.some((s) => textContainsMatureKeyword(s))
        || textContainsMatureKeyword(summaryText);

    return {
        id: `gutenberg-${b.id}`,
        title: b.title || "Untitled",
        author: (b.authors && b.authors[0] && b.authors[0].name) || "Unknown",
        cover: coverUrl,
        downloadUrl: epubUrl,
        downloadCount: b.download_count || 0,
        summary: summaryText,
        source: "Project Gutenberg",
        language: (b.languages && b.languages[0]) || null,
        readUrl,
        isMature
    };
}

// --- Buy Books (Open Library API) ------------------------------------
// Open Library (run by the nonprofit Internet Archive) has a genuinely
// free, public, well-documented API with no key needed. Since it's a
// library catalog rather than a marketplace, it has no real sale/price
// data of its own — every result links out to its Open Library page,
// which itself surfaces borrow/read/buy options where available.
// Nothing from this source is ever treated as "free" for the Discover
// Online transfer, since there's no reliable signal here to base that
// on (unlike Gutenberg, which is downloadable public domain by
// definition).

// True if a book's title or subject list mentions the given keyword —
// used to keep Manga and (Western/general) Comics from bleeding into
// each other, since Open Library files plenty of manga under a generic
// "comics" subject too. Checked against the raw search doc (subjects
// aren't kept on the mapped book object).
function openLibraryDocMentions(doc, keyword) {
    const lowerKeyword = keyword.toLowerCase();
    if ((doc.title || "").toLowerCase().includes(lowerKeyword)) return true;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    return subjects.some((s) => String(s).toLowerCase().includes(lowerKeyword));
}

function openLibraryDocMentionsAny(doc, keywords) {
    return keywords.some((kw) => openLibraryDocMentions(doc, kw));
}

// Open Library's search.json groups results by WORK, not edition — and a
// work's "subject" list is the union of every edition's subjects. A classic,
// centuries-old text (a Shakespeare play, a public-domain novel) that later
// got a manga/graphic-novel adaptation (e.g. the real "Manga Shakespeare"
// series, or "Cirque du Freak: The Manga") ends up with "manga"/"comic" in
// its aggregate subject list even though the specific cover/edition Open
// Library hands back for that work is the original prose/play, not the
// adaptation — which is exactly how a Shakespeare title page or a plain
// novel cover was showing up inside Manga/Comics. first_publish_year is
// also a work-level minimum across all editions, so it still reflects the
// ORIGINAL work's date even when the match came from a much later
// adaptation — making it a reliable, already-fetched signal for filtering
// these out: manga as a format didn't exist before the mid-20th century,
// and neither did the modern comic book, so a work whose earliest known
// edition predates that has to be a false positive from this aggregation
// quirk, not an actual period-appropriate manga/comic.
function openLibraryYearIsPlausible(doc, minYear) {
    if (!minYear || !doc.first_publish_year) return true;
    return doc.first_publish_year >= minYear;
}

// A subject string like "Comics, graphic novels, manga" is a broad
// umbrella tag some libraries file ANY graphic-format book under — it
// makes a plain Western-style graphic novel (Dog Man, say — nothing
// Japanese about it) match a bare "manga" keyword search even though it
// isn't manga at all. A subject genuinely specific to manga is almost
// never phrased as "comic ... manga" in the same breath, so this requires
// a subject that mentions manga WITHOUT also reading like one of those
// umbrella comic/graphic-novel categories.
function openLibraryDocHasSpecificManga(doc) {
    if ((doc.title || "").toLowerCase().includes("manga")) return true;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    return subjects.some((s) => {
        const lower = String(s).toLowerCase();
        return lower.includes("manga") && !lower.includes("comic") && !lower.includes("graphic novel");
    });
}

function mapOpenLibraryBook(doc) {
    const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;
    const workKey = doc.key || null;
    const subjects = Array.isArray(doc.subject) ? doc.subject : [];
    const isMature = textContainsMatureKeyword(doc.title) || subjects.some((s) => textContainsMatureKeyword(s));

    // Open Library's own access-level field — since only a fraction of
    // its 20M+ catalog records actually have readable content attached,
    // this tells the UI whether a given book is genuinely accessible
    // here or just a metadata listing with no direct access.
    let accessLevel = "catalog";
    if (doc.ebook_access === "public") accessLevel = "public";
    else if (doc.ebook_access === "borrowable") accessLevel = "borrowable";
    else if (doc.ebook_access === "printdisabled") accessLevel = "printdisabled";

    return {
        id: `openlibrary-${workKey || doc.cover_edition_key || Math.random()}`,
        title: doc.title || "Untitled",
        author: (doc.author_name && doc.author_name[0]) || "Unknown",
        cover: coverUrl,
        description: null,
        workKey,
        publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : null,
        isFree: false,
        price: null,
        accessLevel,
        buyLink: workKey ? `https://openlibrary.org${workKey}` : null,
        infoLink: workKey ? `https://openlibrary.org${workKey}` : null,
        source: "Open Library",
        isMature
    };
}

async function fetchOpenLibraryBooks(query, sort) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const data = await fetchWithRetry(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=40&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access,subject`,
        10000
    );
    const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
    return docs.filter((d) => d.title).map(mapOpenLibraryBook);
}

// New Releases specifically has a much worse cover-availability rate
// than the other lists — Open Library's "new" sort surfaces
// freshly-cataloged entries, and cover art indexing consistently lags
// behind cataloging, so a large share of genuinely recent entries just
// don't have artwork yet. A single 200-candidate page used to come up
// short and get padded out with no-cover entries to hit the desired
// count, which is how a "New Releases" row ended up half blank covers.
// Instead, page through several batches of candidates (Open Library
// has no key/auth and a generous limit, so this is cheap and only runs
// once per cache refresh) and keep ONLY books that actually have cover
// art, stopping as soon as there are enough. If every page is
// exhausted and there still aren't enough, return what was found
// rather than padding with bare listings — a shorter, fully-illustrated
// row beats a full one that's mostly blank placeholders.
async function fetchOpenLibraryBooksWithCovers(query, sort, desiredCount, excludeKeyword, requireKeywords, minYear) {
    const sortParam = sort ? `&sort=${sort}` : "";
    const pageSize = 200;
    const maxPages = 10; // up to 2000 candidates before giving up — Manga/Comics now ask for a much bigger list (150) than the original 40, so this needs more room to find that many with real cover art
    const withCovers = [];
    const seenKeys = new Set();

    for (let page = 0; page < maxPages && withCovers.length < desiredCount; page++) {
        let data;
        try {
            data = await fetchWithRetry(
                `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}${sortParam}&limit=${pageSize}&offset=${page * pageSize}&fields=key,title,author_name,cover_i,first_publish_year,cover_edition_key,ebook_access,subject`,
                10000
            );
        } catch (err) {
            break; // keep whatever was already gathered rather than failing the whole list over one bad page
        }

        const docs = (data && Array.isArray(data.docs)) ? data.docs : [];
        if (docs.length === 0) break; // ran out of results before reaching maxPages

        for (const d of docs) {
            if (!d.title || !d.cover_i) continue;
            if (excludeKeyword && openLibraryDocMentions(d, excludeKeyword)) continue;
            // requireKeywords can be a plain keyword list (checked with
            // openLibraryDocMentionsAny) or a custom predicate function,
            // for cases like manga that need sharper logic than a bare
            // substring match (see openLibraryDocHasSpecificManga).
            if (requireKeywords) {
                const passes = typeof requireKeywords === "function"
                    ? requireKeywords(d)
                    : openLibraryDocMentionsAny(d, requireKeywords);
                if (!passes) continue;
            }
            if (!openLibraryYearIsPlausible(d, minYear)) continue;
            const dedupeKey = d.key || d.cover_edition_key;
            if (dedupeKey) {
                if (seenKeys.has(dedupeKey)) continue;
                seenKeys.add(dedupeKey);
            }
            withCovers.push(mapOpenLibraryBook(d));
            if (withCovers.length >= desiredCount) break;
        }
    }

    return withCovers;
}

module.exports = {
    fetchGutenbergPages,
    mapGutenbergBook,
    openLibraryDocMentions,
    openLibraryDocMentionsAny,
    openLibraryYearIsPlausible,
    openLibraryDocHasSpecificManga,
    mapOpenLibraryBook,
    fetchOpenLibraryBooks,
    fetchOpenLibraryBooksWithCovers
};
