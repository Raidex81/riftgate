// Explicit-content keyword filter, used across Books/Manga/Comics/Movies/
// Shows to compute an isMature flag on each item — deliberately narrow
// (sexual/explicit-content terms only, not broad "mature themes" like
// violence or horror). This is best-effort: it only catches what the
// item's own title/subjects/genres/summary text actually says, so an
// admin can also manually force an item mature (or clear a false
// positive) via admin-toggle-item-mature/mature_overrides, checked
// separately from this.
const MATURE_KEYWORDS = [
    "hentai", "porn", "pornographic", "xxx", "erotica", "erotic",
    "nsfw", "fetish", "bdsm", "adult content", "explicit content",
    "sexually explicit"
];

function textContainsMatureKeyword(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    return MATURE_KEYWORDS.some((kw) => lower.includes(kw));
}

module.exports = {
    textContainsMatureKeyword
};
