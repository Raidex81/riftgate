// Applications: community-recommended apps.
// A public, browsable list of third-party apps recommended by admins —
// this is open content for everyone (like Free Games or Theatre), not
// gated like The Vault. Only adding an app, editing its description, or
// removing it requires admin credentials, checked server-side via the
// exact same verify_admin_login every other admin-gated action in this
// app already uses (so this works for regular admins and super admins
// alike, matching the "admins or super admins" requirement with zero
// extra logic).
//
// Promoting your own app:
// Anyone can put an app they made forward for Applications. Publishing
// stays with admins (add-community-app needs their credentials), so a
// submission goes into the existing suggestions queue, clearly marked, for
// an admin to review and publish with the tools they already have.
// r2-app-preview fills the form from a GitHub link (owner, description, stars).
"use strict";
const github = require("../services/github");
const { fetchWithRetry } = require("../services/http");
const { callAdminRpc, supabaseRequest } = require("../services/supabase");

function register(ipcMain) {
    ipcMain.handle("get-community-apps", async () => {
        try {
            const result = await supabaseRequest("community_apps?select=*&order=created_at.desc", "GET");
            if (result.statusCode !== 200 || !Array.isArray(result.body)) {
                return { success: false, apps: [] };
            }
            return { success: true, apps: result.body };
        } catch (err) {
            console.error("[apps] fetch failed:", err.message || err);
            return { success: false, apps: [] };
        }
    });

    ipcMain.handle("add-community-app", async (event, { adminUsername, adminPassword, name, url, author, description }) => {
        const trimmedName = (name || "").trim();
        const trimmedUrl = (url || "").trim();

        if (!trimmedName || !trimmedUrl) {
            return { success: false, error: "Both a name and a link are required." };
        }

        try {
            new URL(trimmedUrl);
        } catch (err) {
            return { success: false, error: "That doesn't look like a valid link — make sure it includes https://." };
        }

        // The repo owner IS the author for a GitHub link — no extra request
        // needed, it's already right there in the URL.
        const repoPath = github.extractRepoPath(trimmedUrl);
        let finalAuthor = (author || "").trim() || null;
        if (!finalAuthor && repoPath) {
            finalAuthor = repoPath.split("/")[0];
        }

        let finalDescription = (description || "").trim() || null;
        if (!finalDescription) {
            finalDescription = await github.fetchRepoDescription(trimmedUrl);
        }

        const result = await callAdminRpc("add_community_app", {
            p_admin_username: adminUsername,
            p_admin_password: adminPassword,
            p_name: trimmedName,
            p_url: trimmedUrl,
            p_author: finalAuthor,
            p_description: finalDescription
        });

        if (!result.success) return result;
        if (result.result === null) return { success: false, error: "Not authorized." };
        return { success: true, autoAuthor: finalAuthor, autoDescription: finalDescription };
    });

    ipcMain.handle("update-community-app-details", async (event, { adminUsername, adminPassword, appId, author, description }) => {
        const result = await callAdminRpc("update_community_app_details", {
            p_admin_username: adminUsername,
            p_admin_password: adminPassword,
            p_app_id: appId,
            p_author: (author || "").trim() || null,
            p_description: (description || "").trim() || null
        });
        return { success: result.success && !!result.result, error: result.error };
    });

    ipcMain.handle("delete-community-app", async (event, { adminUsername, adminPassword, appId }) => {
        const result = await callAdminRpc("delete_community_app", {
            p_admin_username: adminUsername,
            p_admin_password: adminPassword,
            p_app_id: appId
        });
        return { success: result.success && !!result.result, error: result.error };
    });

    // Public counter, not admin-gated — anyone browsing Applications can bump
    // this just by clicking Visit, same as request-share-access above is a
    // public RPC call with no admin credentials. The RPC itself (see
    // community-apps-visits.sql) only ever adds exactly 1 to exactly one row,
    // so there's no arbitrary-write risk in leaving this open to every client.
    ipcMain.handle("increment-community-app-visit", async (event, appId) => {
        try {
            const result = await supabaseRequest("rpc/increment_community_app_visit", "POST", { p_app_id: appId });
            if (result.statusCode !== 200) return { success: false };
            return { success: true, visitCount: typeof result.body === "number" ? result.body : null };
        } catch (err) {
            console.error("[apps] visit increment failed:", err.message || err);
            return { success: false };
        }
    });

    let r2LastAppSubmitAt = 0;
    ipcMain.handle("r2-app-preview", async (event, rawUrl) => {
        const repoPath = typeof rawUrl === "string" ? github.extractRepoPath(rawUrl.trim()) : null;
        if (!repoPath) return { github: false };
        try {
            const data = await fetchWithRetry(`https://api.github.com/repos/${repoPath}`, 8000, 1);
            return {
                github: true,
                name: data && data.name ? String(data.name) : repoPath.split("/")[1],
                author: repoPath.split("/")[0],
                description: (data && typeof data.description === "string" && data.description.trim()) || null,
                stars: data && typeof data.stargazers_count === "number" ? data.stargazers_count : null,
                language: (data && data.language) || null,
                homepage: (data && data.homepage) || null
            };
        } catch (err) {
            return { github: true, author: repoPath.split("/")[0], name: repoPath.split("/")[1] };
        }
    });
    ipcMain.handle("r2-submit-app", async (event, { name, url, author, description, contact } = {}) => {
        const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
        const n = clip(name, 80), u = clip(url, 300), a = clip(author, 80), d = clip(description, 600), c = clip(contact, 120);
        if (!n || !u) return { success: false, error: "Your app needs a name and a link." };
        let parsed;
        try { parsed = new URL(u); } catch { return { success: false, error: "That link doesn't look right. Include https://" }; }
        if (parsed.protocol !== "https:") return { success: false, error: "Use an https:// link." };
        if (Date.now() - r2LastAppSubmitAt < 60 * 1000) return { success: false, error: "One moment: wait a minute between submissions." };
        const lines = [
            "[App submission]",
            `Name: ${n}`,
            `Link: ${u}`,
            `Author: ${a || github.extractRepoPath(u)?.split("/")[0] || "not given"}`,
            `Description: ${d || "not given"}`,
            c ? `Contact: ${c}` : null,
            "Sent from Riftgate (Applications > Promote your app). Add it under Applications when approved."
        ].filter(Boolean);
        try {
            const result = await supabaseRequest("suggestions", "POST", { username: a || null, suggestion_text: lines.join("\n") });
            if (result.statusCode === 201) { r2LastAppSubmitAt = Date.now(); return { success: true }; }
            return { success: false, error: "The submission didn't go through. Try again in a moment." };
        } catch (err) {
            console.error("[apps] submission failed:", err.message || err);
            return { success: false, error: "Couldn't reach the server. Check your connection and try again." };
        }
    });
}

module.exports = { register };
