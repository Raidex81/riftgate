// Riftgate's Supabase backend — REST API, Storage, and the "media-proxy"
// Edge Function that fronts every third-party media API (TMDB, RAWG,
// SteamGridDB, YouTube, ...). Extracted from main.js so all of this app's
// server-side surface lives in one place instead of being interleaved with
// local filesystem/OS logic.
//
// This "publishable" key is meant to be embedded in client apps exactly
// like this — it can only do what the database's Row Level Security
// policies allow (public read + insert on these two tables, nothing else),
// so it carries no meaningful risk on its own.
const https = require("https");

const SUPABASE_URL = "https://hblndwtdksnxlzlhiqir.supabase.co";
const SUPABASE_KEY = "sb_publishable_y8RbQHAV0rlHmkOLXz5iUw_5OdyUnpT";

function supabaseRequest(pathAndQuery, method, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`);
        const payload = body ? JSON.stringify(body) : null;

        const options = {
            method,
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json"
            }
        };

        if (method === "POST") {
            options.headers["Prefer"] = "return=representation";
        }
        if (payload) {
            options.headers["Content-Length"] = Buffer.byteLength(payload);
        }

        const req = https.request(url, options, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                let parsed = null;
                try { parsed = raw ? JSON.parse(raw) : null; } catch (err) { /* leave null */ }
                resolve({ statusCode: res.statusCode, body: parsed });
            });
        });

        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("Supabase request timed out")));

        if (payload) req.write(payload);
        req.end();
    });
}

// Vault files live in a private bucket; the "vault" Edge Function hands out a
// short-lived signed upload URL and this PUTs the file to it.
function supabaseSignedUpload(uploadUrl, fileBuffer) {
    return new Promise((resolve, reject) => {
        const url = new URL(uploadUrl);
        if (url.origin !== new URL(SUPABASE_URL).origin || !url.pathname.startsWith("/storage/v1/object/upload/sign/")) {
            reject(new Error("Unexpected upload URL"));
            return;
        }
        const req = https.request(url, {
            method: "PUT",
            headers: {
                "apikey": SUPABASE_KEY,
                "Content-Type": "application/octet-stream",
                "Content-Length": fileBuffer.length,
                "x-upsert": "false"
            }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => resolve({ statusCode: res.statusCode, body: raw }));
        });

        req.on("error", reject);
        req.setTimeout(120000, () => req.destroy(new Error("Upload timed out")));
        req.write(fileBuffer);
        req.end();
    });
}

async function callAdminRpc(fnName, params) {
    try {
        const result = await supabaseRequest(`rpc/${fnName}`, "POST", params);
        if (result.statusCode !== 200) {
            // A non-200 here doesn't necessarily mean a connectivity
            // problem — it's just as likely the SQL function itself
            // rejecting the call (e.g. a stale/incorrect cached admin
            // password failing verify_admin_login and raising "Not
            // authorized"). Surfacing the real body instead of a
            // generic message is what actually tells the two apart.
            let detail = result.body;
            try {
                const parsed = typeof result.body === "string" ? JSON.parse(result.body) : result.body;
                detail = (parsed && (parsed.message || parsed.error)) || result.body;
            } catch (err) {
                // body wasn't JSON — use it raw
            }
            console.error(`[admin] ${fnName} returned ${result.statusCode}:`, detail);
            return { success: false, error: `${detail || "Request failed"} (status ${result.statusCode})` };
        }
        return { success: true, result: result.body };
    } catch (err) {
        console.error(`[admin] ${fnName} failed:`, err.message || err);
        return { success: false, error: "Couldn't reach the server — check your connection and try again." };
    }
}

// --- Third-party media API proxy (Supabase Edge Function) -----------------
//
// Posts to the "media-proxy" Edge Function deployed on this app's own
// Supabase project, which attaches the real vendor key server-side and
// forwards the request — TMDB/RAWG/SteamGridDB/YouTube keys never touch
// the client at all.

function httpsPostJson(url, headers, bodyObj) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(bodyObj);
        const req = https.request(
            new URL(url),
            {
                method: "POST",
                headers: {
                    ...headers,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(bodyStr)
                }
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
            }
        );
        req.on("error", reject);
        req.write(bodyStr);
        req.end();
    });
}

async function mediaProxyRaw(vendor, proxyPath, query) {
    const { statusCode, body } = await httpsPostJson(
        `${SUPABASE_URL}/functions/v1/media-proxy`,
        { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        { vendor, path: proxyPath, query: query || {} }
    );
    return { statusCode, parsed: JSON.parse(body) };
}

// Mirrors the old httpsGetJson(vendorUrl, ...) call sites: returns the
// parsed body regardless of status code, since some callers (the YouTube
// quota check) need to inspect an error body that comes back on a non-2xx
// status rather than have it thrown away.
async function mediaProxyGetJson(vendor, proxyPath, query) {
    const { parsed } = await mediaProxyRaw(vendor, proxyPath, query);
    return parsed;
}

// Mirrors the old httpsGetJsonPlain(vendorUrl) call sites: throws on
// non-2xx, surfacing the vendor's own error message when there is one.
async function mediaProxyGetJsonPlain(vendor, proxyPath, query) {
    const { statusCode, parsed } = await mediaProxyRaw(vendor, proxyPath, query);
    if (statusCode < 200 || statusCode >= 300) {
        const apiMessage = (parsed && parsed.error && (parsed.error.message || parsed.error)) || (parsed && parsed.status_message);
        throw new Error(apiMessage || `HTTP ${statusCode}`);
    }
    return parsed;
}

// Posts to the "send-verification-email" Edge Function, which emails a
// confirm-your-email link via Resend. This is only ever called right
// after the request_email_verification RPC has already succeeded and
// handed back a fresh token for an account the caller just proved (via
// its own login password) they're authorized to act as — this
// function's job is only "deliver this token by email", not
// authorization.
async function sendVerificationEmail(username, email, token) {
    try {
        const { statusCode, body } = await httpsPostJson(
            `${SUPABASE_URL}/functions/v1/send-verification-email`,
            { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
            { username, email, token }
        );
        if (statusCode < 200 || statusCode >= 300) {
            console.error("[email] send-verification-email failed:", statusCode, body);
            return { success: false };
        }
        return { success: true };
    } catch (err) {
        console.error("[email] send-verification-email errored:", err.message || err);
        return { success: false };
    }
}

// Posts to the "send-password-reset-email" Edge Function, which emails
// a short reset CODE via Resend (not a clickable link, unlike
// sendVerificationEmail above -- setting a new password is a form,
// which belongs inside the trusted app rather than on a bare web page).
// Only ever called right after the request_password_reset RPC has
// already decided a code should be issued for this account.
// Calls one of this project's Edge Functions with the public key and returns
// { statusCode, parsed } (parsed is null if the body isn't JSON).
async function callEdgeFunction(name, body) {
    const { statusCode, body: raw } = await httpsPostJson(
        `${SUPABASE_URL}/functions/v1/${name}`,
        { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body
    );
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { /* not JSON */ }
    return { statusCode, parsed };
}

async function sendPasswordResetEmail(username, email, code) {
    try {
        const { statusCode, body } = await httpsPostJson(
            `${SUPABASE_URL}/functions/v1/send-password-reset-email`,
            { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
            { username, email, code }
        );
        if (statusCode < 200 || statusCode >= 300) {
            console.error("[email] send-password-reset-email failed:", statusCode, body);
            return { success: false };
        }
        return { success: true };
    } catch (err) {
        console.error("[email] send-password-reset-email errored:", err.message || err);
        return { success: false };
    }
}

module.exports = {
    supabaseRequest,
    supabaseSignedUpload,
    callAdminRpc,
    mediaProxyGetJson,
    mediaProxyGetJsonPlain,
    sendVerificationEmail,
    sendPasswordResetEmail,
    callEdgeFunction
};
