// Riftgate — media-proxy Edge Function
//
// Thin server-side proxy for the third-party media APIs Riftgate calls
// (TMDB, RAWG, YouTube, SteamGridDB). The real vendor API keys are stored
// as secrets on THIS function (Project Settings -> Edge Functions ->
// Secrets, or the "Manage secrets" button on this function's page) and are
// never sent to the client. The packaged app only ever holds the public
// Supabase project URL and its publishable key, which are safe to embed —
// that's how Supabase's own security model works (data is protected by
// Row Level Security, not by keeping that key secret).
//
// Request body (POST only):
//   {
//     vendor: "tmdb" | "rawg" | "youtube" | "steamgriddb" | "steam",
//     path: string,               // e.g. "/movie/now_playing"
//     query?: Record<string, string>
//   }
//
// The function looks up the secret that matches `vendor`, attaches it the
// way that vendor expects (a query param or an Authorization header), and
// forwards the request to that vendor's fixed API base + the given
// path/query. It returns the vendor's response body and status completely
// untouched, so Riftgate's existing response-parsing code on the app side
// doesn't need to know anything changed.

interface VendorConfig {
  base: string;
  auth: (url: URL, headers: Headers, key: string) => void;
}

const VENDORS: Record<string, VendorConfig> = {
  tmdb: {
    base: "https://api.themoviedb.org/3",
    auth: (url, _headers, key) => url.searchParams.set("api_key", key),
  },
  rawg: {
    base: "https://api.rawg.io/api",
    auth: (url, _headers, key) => url.searchParams.set("key", key),
  },
  youtube: {
    base: "https://www.googleapis.com/youtube/v3",
    auth: (url, _headers, key) => url.searchParams.set("key", key),
  },
  steamgriddb: {
    base: "https://www.steamgriddb.com/api/v2",
    auth: (_url, headers, key) => headers.set("Authorization", `Bearer ${key}`),
  },
  steam: {
    base: "https://api.steampowered.com",
    auth: (url, _headers, key) => url.searchParams.set("key", key),
  },
};

// Maps each vendor to the name of the Supabase secret holding its real key.
const SECRET_ENV: Record<string, string> = {
  tmdb: "TMDB_API_KEY",
  rawg: "RAWG_API_KEY",
  youtube: "YOUTUBE_API_KEY",
  steamgriddb: "STEAMGRIDDB_API_KEY",
  steam: "STEAM_API_KEY",
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { vendor?: string; path?: string; query?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { vendor, path, query } = body;

  if (!vendor || !VENDORS[vendor]) {
    return new Response(JSON.stringify({ error: "Unknown or missing vendor" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!path || !path.startsWith("/")) {
    return new Response(JSON.stringify({ error: "path must start with /" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const key = Deno.env.get(SECRET_ENV[vendor]);
  if (!key) {
    return new Response(
      JSON.stringify({ error: `${SECRET_ENV[vendor]} is not configured on this function` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const vendorConfig = VENDORS[vendor];
  const upstream = new URL(vendorConfig.base + path);
  for (const [k, v] of Object.entries(query || {})) {
    upstream.searchParams.set(k, String(v));
  }

  const headers = new Headers();
  vendorConfig.auth(upstream, headers, key);

  try {
    const upstreamRes = await fetch(upstream.toString(), { headers });
    const bodyText = await upstreamRes.text();

    return new Response(bodyText, {
      status: upstreamRes.status,
      headers: { "Content-Type": upstreamRes.headers.get("content-type") || "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Upstream request failed: ${String(err)}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
});
