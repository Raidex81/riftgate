// GitHub exposes a repo's own short description with no auth needed for
// public repos — used to fill in a description automatically when an
// admin adds a github.com link, so they don't have to type one unless
// they want to. Any other host, a private/missing repo, or a repo with
// no description set just comes back null, and the admin types one in
// themselves.
const { fetchWithRetry } = require("./http");

function extractRepoPath(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        return `${parts[0]}/${parts[1]}`;
    } catch (err) {
        return null;
    }
}

async function fetchRepoDescription(rawUrl) {
    const repoPath = extractRepoPath(rawUrl);
    if (!repoPath) return null;

    try {
        const data = await fetchWithRetry(`https://api.github.com/repos/${repoPath}`, 8000, 1);
        return (data && typeof data.description === "string" && data.description.trim()) || null;
    } catch (err) {
        console.error("[apps] GitHub description fetch failed:", err.message || err);
        return null;
    }
}

module.exports = {
    extractRepoPath,
    fetchRepoDescription
};
