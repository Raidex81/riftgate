// Generic low-level HTTP helpers, extracted from main.js — used across
// TVMaze, Steam/SteamSpy, Gutenberg, GamerPower, itch.io, ipapi.co, and
// more. None of these know anything about any particular vendor; they're
// just "fetch a URL and parse the response" in a few different shapes.
const https = require("https");

// Parses the body as JSON and resolves with it regardless of status code.
// Some callers need to inspect an error body that comes back on a non-2xx
// status rather than have it thrown away.
function httpsGetJson(url, headers) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

// Throws on a non-2xx status (surfacing the vendor's own error message
// when there is one) instead of silently resolving with an error body.
function httpsGetJsonPlain(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "RiftgateApp/1.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (err) {
                    reject(err);
                    return;
                }

                // The response can be valid JSON while still representing
                // an error (rate limiting, quota exceeded, etc.) — many
                // APIs, including Google's, return a normal JSON body like
                // {"error": {...}} alongside a non-2xx status. Without this
                // check, that was silently parsed as "success" with no
                // matching data, producing an empty result with no error
                // ever surfacing anywhere.
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const apiMessage = parsed && parsed.error && (parsed.error.message || parsed.error);
                    reject(new Error(apiMessage || `HTTP ${res.statusCode}`));
                    return;
                }

                resolve(parsed);
            });
        }).on("error", reject);

        // Without this, one hanging request (rate-limited API, dead
        // endpoint, etc.) can stall an entire feature indefinitely with no
        // fallback ever kicking in.
        req.setTimeout(timeoutMs || 8000, () => {
            req.destroy(new Error("Request timed out"));
        });
    });
}

// Same shape as httpsGetJsonPlain but for a plain-text/HTML response —
// used to read a Steam store page's actual rendered HTML, since some
// information is only ever present in the page itself, never in Steam's
// public JSON API.
function httpsGetTextPlain(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "RiftgateApp/1.0" } }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
        }).on("error", reject);

        req.setTimeout(timeoutMs || 8000, () => {
            req.destroy(new Error("Request timed out"));
        });
    });
}

// Runs `fn` over `items` with at most `limit` in flight at once. Used for
// batches that hit an external API dozens or hundreds of times (e.g.
// checking whether every SteamSpy "free" game is still actually available) —
// firing them all in parallel via Promise.all/allSettled can trip that
// API's rate limiting, turning a small number of genuine failures into
// nearly all of them failing at once. Returns one settled-style result per
// item, in the original order, so callers can keep using the same
// `status`/`value`/`reason` shape as Promise.allSettled.
async function runWithConcurrencyLimit(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const current = nextIndex++;
            try {
                results[current] = { status: "fulfilled", value: await fn(items[current], current) };
            } catch (err) {
                results[current] = { status: "rejected", reason: err };
            }
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

// Retries httpsGetJsonPlain a couple of times with backoff before giving
// up — originally written for Gutendex (Project Gutenberg's API, which
// independent uptime monitoring shows spends well under 50% of its time
// actually up), but generically useful for any flaky third-party API
// where failures tend to be transient rather than a full outage.
async function fetchWithRetry(url, timeoutMs, attempts = 3) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
        try {
            return await httpsGetJsonPlain(url, timeoutMs);
        } catch (err) {
            lastError = err;
            if (i < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
            }
        }
    }
    throw lastError;
}

// Generic JSON POST — resolves with { statusCode, body } (body as a raw
// string) regardless of status code, deliberately unlike
// httpsGetJsonPlain's throw-on-non-2xx: some callers (Epic's GraphQL
// endpoint, in particular) return a 200 with a GraphQL-shaped error body
// rather than an HTTP error status, so the caller needs to inspect the
// body itself either way — leaving that decision to them instead of
// guessing here.
function httpsPostJsonRaw(url, bodyObj, timeoutMs) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(bodyObj);
        const req = https.request(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
                "User-Agent": "RiftgateApp/1.0"
            }
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on("error", reject);
        if (timeoutMs) {
            req.setTimeout(timeoutMs, () => req.destroy(new Error("Request timed out")));
        }
        req.write(payload);
        req.end();
    });
}

module.exports = {
    httpsGetJson,
    httpsGetJsonPlain,
    httpsGetTextPlain,
    httpsPostJsonRaw,
    runWithConcurrencyLimit,
    fetchWithRetry
};
