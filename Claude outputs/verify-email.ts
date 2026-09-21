// Supabase Edge Function: verify-email
//
// Deploy path: supabase/functions/verify-email/index.ts
// Deploy command: supabase functions deploy verify-email --no-verify-jwt
//
// IMPORTANT: this one MUST be deployed with --no-verify-jwt (or, in the
// dashboard, its own "Enforce JWT verification" toggle turned off). It's
// the landing page for the link inside the "confirm your email" message
// (see send-verification-email) — opened directly in the user's browser
// when they click it, not called by the Riftgate app, so there's no
// Authorization header for Supabase's gateway to check. The token in the
// URL itself (a random 32-byte value nobody but the email's real
// recipient ever sees) is what proves the click is legitimate; the SQL
// function it calls, confirm_email_verification, needs nothing else.
//
// Renders a small human-readable HTML page rather than JSON, since a
// person is looking at it directly in a browser tab.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

function page(title: string, message: string, ok: boolean): Response {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#0f0f1a; color:#e8e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; padding: 24px; box-sizing: border-box; }
  .card { max-width: 420px; }
  h1 { color: ${ok ? "#7c3aed" : "#ff5f5f"}; font-size: 22px; }
  p { color: #b0b0c0; line-height: 1.5; }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return page(
      "Missing link",
      "This verification link is missing its token — please use the link exactly as it appeared in your email.",
      false
    );
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return page("Configuration error", "Riftgate's server isn't configured correctly. Please try again later.", false);
  }

  let rpcRes: Response;
  try {
    rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_email_verification`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input_token: token }),
    });
  } catch (err) {
    console.error("[verify-email] RPC request failed:", err);
    return page("Something went wrong", "We couldn't confirm your email right now — please try the link again in a moment.", false);
  }

  if (!rpcRes.ok) {
    const detail = await rpcRes.text();
    console.error("[verify-email] RPC returned", rpcRes.status, detail);
    return page("Something went wrong", "We couldn't confirm your email right now — please try the link again in a moment.", false);
  }

  const result = await rpcRes.json();
  if (!result.success) {
    return page(
      "Link expired or already used",
      result.error || "This verification link is invalid or has expired — you can request a new one from inside Riftgate.",
      false
    );
  }

  return page("Email confirmed! ✅", `You're all set, ${result.username}. This tab can be closed — head back to Riftgate.`, true);
});
