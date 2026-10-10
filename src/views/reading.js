// Riftgate — Reading room: popular and best-selling books, new releases,
// manga, comics, free classics, and your own eBook library.

import { h, icon, debounce, clear } from "../app/dom.js";
import { call } from "../app/api.js";
import * as D from "../app/data.js";
import { fromBook } from "../app/items.js";
import { row } from "../components/row.js";
import { shelf } from "../components/shelf.js";
import { pagedGrid } from "../components/paged.js";
import { toast } from "../components/toast.js";
import { askButton } from "../components/today.js";

// Same flow as the engine expects: copy into the library folder, read the
// file's own metadata (title, author, cover), then record it.
async function addEbook(originalPath) {
    const ext = String(originalPath).toLowerCase().split(".").pop();
    if (ext !== "epub" && ext !== "pdf") { toast("Only EPUB and PDF files can be added.", "err"); return false; }
    const copy = await call("add-ebook-to-library", originalPath);
    if (!copy || !copy.success) { toast((copy && copy.error) || "Couldn't add that file.", "err"); return false; }
    const meta = (await call("get-ebook-metadata", copy.path)) || {};
    const fallback = copy.path.split(/[\\/]/).pop().replace(/\.(epub|pdf)$/i, "").replace(/[._]/g, " ").trim();
    const r = await call("save-ebook", { path: copy.path, title: meta.title || fallback, author: meta.author || null, description: meta.description || null, cover: meta.coverPath || null, format: ext });
    return !!(r && r.success);
}

export default {
    async render(root) {
        const search = h("input.input", { type: "search", placeholder: "Find any book in the world", "aria-label": "Find any book", style: { width: "300px" } });
        const add = h("button.btn", { type: "button" }, icon("plus"), "Add an eBook");
        const results = h("div");
        const shelves = h("div");
        root.append(
            h("div.view-head", null,
                h("div", null, h("h1", null, "Reading room"), h("p", null, "Best sellers, new releases, manga, comics and free classics, next to your own eBooks.")),
                h("div.actions", null, askButton("read"), search, add)),
            results, shelves);

        shelves.append(shelf("reading", [
            row({ title: "Your eBooks", icon: "book", items: D.ebooks(), hideEmpty: true }),
            row({ title: "Most popular", icon: "flame", items: () => D.booksPopular(), full: { kind: "buy-books-popular" }, seeAllTitle: "Most popular books" }),
            row({ title: "Best sellers", icon: "trophy", items: () => D.booksBest(), full: { kind: "buy-books-bestseller" }, seeAllTitle: "Best-selling books" }),
            row({ title: "New releases", icon: "sparkles", items: () => D.booksNew(), full: { kind: "buy-books-new-releases" }, seeAllTitle: "New books" }),
            row({ title: "Manga", icon: "book", items: () => D.mangaPopular(), full: { kind: "manga-popular" }, seeAllTitle: "Popular manga" }),
            row({ title: "New manga", icon: "sparkles", items: () => D.mangaNew(), full: { kind: "manga-new-releases" }, hideEmpty: true }),
            row({ title: "Comics", icon: "book", items: () => D.comicsPopular(), full: { kind: "comics-popular" }, seeAllTitle: "Popular comics" }),
            row({ title: "New comics", icon: "sparkles", items: () => D.comicsNew(), full: { kind: "comics-new-releases" }, hideEmpty: true }),
            row({ title: "Free classics", icon: "gift", note: "Public domain, free to read", items: () => D.classics(), full: { kind: "classics" }, seeAllTitle: "Free classics" })
        ]));

        search.addEventListener("input", debounce(async () => {
            const q = search.value.trim();
            clear(results);
            if (q.length < 2) { shelves.hidden = false; return; }
            shelves.hidden = true;
            results.appendChild(h("p.muted", null, "Searching Open Library…"));
            const r = await call("search-openlibrary-books", q);
            if (search.value.trim() !== q) return;
            clear(results);
            const items = ((r && r.books) || []).map(fromBook);
            results.append(h("h2", { style: { marginBottom: "20px" } }, `Books matching “${q}”`), pagedGrid(items, {}, results));
        }, 400));

        add.onclick = async () => {
            const files = (await call("select-ebook-file")) || [];
            let added = 0;
            for (const f of files) if (await addEbook(f)) added++;
            if (added) { toast(added === 1 ? "Added to your eBooks" : `Added ${added} eBooks`); location.reload(); }
        };
    },
    addEbook,
    rollTitle: "Pick something to read",
    async rollPool() {
        const [a, b] = await Promise.all([D.booksPopular(), D.ebooks()]);
        return [...b, ...a];
    }
};
