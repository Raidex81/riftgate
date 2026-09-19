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

// Supabase Storage uses a different API shape than the JSON REST calls
// above (binary upload bodies, a signed-URL endpoint) — these two
// helpers handle that, used specifically for the private shared folder
// feature.
function supabaseStorageUpload(storagePath, fileBuffer, contentType) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/riftgate-shares/${storagePath}`);

        const req = https.request(url, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": contentType || "application/octet-stream",
                "Content-Length": fileBuffer.length
            }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                resolve({ statusCode: res.statusCode, body: raw });
            });
        });

        req.on("error", reject);
        req.setTimeout(60000, () => req.destroy(new Error("Upload timed out")));
        req.write(fileBuffer);
        req.end();
    });
}

// Resolves to { url, error } rather than just a bare URL/null — every
// failure used to collapse into the same generic "couldn't generate a
// link" message with nothing to actually diagnose it by (expired/missing
// storage object, an RLS/policy rejection, a bad path, a network error
// all looked identical). Now the real reason from Supabase's response
// flows all the way up to the dialog the user actually sees, the same
// way upload failures already surface their real reason instead of a
// generic one.
function supabaseStorageSignedUrl(storagePath, expiresInSeconds) {
    return new Promise((resolve) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/sign/riftgate-shares/${storagePath}`);
        const payload = JSON.stringify({ expiresIn: expiresInSeconds || 300 });

        const req = https.request(url, {
            method: "POST",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            }
        }, (res) => {
            let raw = "";
            res.on("data", (chunk) => raw += chunk);
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    let detail = raw;
                    try {
                        const parsed = JSON.parse(raw);
                        detail = parsed.message || parsed.error || raw;
                    } catch (err) {
                        // body wasn't JSON — use it raw
                    }
                    console.error(`[share] signed URL request failed — status ${res.statusCode}:`, raw);
                    resolve({ url: null, error: `(${res.statusCode}) ${detail}` });
                    return;
                }

                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.signedURL) {
                        resolve({ url: `${SUPABASE_URL}/storage/v1${parsed.signedURL}`, error: null });
                    } else {
                        console.error("[share] signed URL response had no signedURL field:", raw);
                        resolve({ url: null, error: "Storage didn't return a signed URL." });
                    }
                } catch (err) {
                    console.error("[share] signed URL response wasn't valid JSON:", raw);
                    resolve({ url: null, error: "Unexpected response from storage." });
                }
            });
        });

        req.on("error", (err) => {
            console.error("[share] signed URL request errored:", err.message || err);
            resolve({ url: null, error: err.message || String(err) });
        });
        req.setTimeout(10000, () => req.destroy(new Error("Signed URL request timed out")));
        req.write(payload);
        req.end();
    });
}

function supabaseStorageDelete(storagePath) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/storage/v1/object/riftgate-shares/${storagePath}`);

        const req = https.request(url, {
            method: "DELETE",
            headers: {
                "apikey": SUPABASE_KEY,
                "Authorization": `Bearer ${SUPABASE_KEY}`
            }
        }, (res) => {
            res.on("data", () => {});
            res.on("end", () => resolve(res.statusCode));
        });

        req.on("error", reject);
        req.setTimeout(10000, () => req.destroy(new Error("Delete request timed out")));
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

module.exports = {
    supabaseRequest,
    supabaseStorageUpload,
    supabaseStorageSignedUrl,
    supabaseStorageDelete,
    callAdminRpc,
    mediaProxyGetJson,
    mediaProxyGetJsonPlain
};
