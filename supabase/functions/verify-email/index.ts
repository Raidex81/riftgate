// Supabase Edge Function: verify-email
//
// Must be deployed with JWT verification OFF: it's the landing page for the
// link inside the "confirm your email" message, opened directly in the user's
// browser (no Authorization header). The random token in the URL is what
// proves the click is legitimate; confirm_email_verification needs nothing else.
//
// Replies in plain text (not HTML): Supabase serves Edge Function responses on
// the *.supabase.co domain as text/plain, so an HTML page shows up as raw
// source with garbled symbols. Plain ASCII text reads cleanly in any browser.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

function page(title: string, message: string, ok: boolean): Response {
  const text = `${title}\n\n${message}\n\n- Riftgate\n`;
  return new Response(text, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token || token.length > 200) {
    return page(
      "Missing link",
      "This verification link is incomplete. Please use the link exactly as it appeared in your email.",
      false,
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
    return page("Something went wrong", "We couldn't confirm your email right now. Please try the link again in a moment.", false);
  }

  if (!rpcRes.ok) {
    console.error("[verify-email] RPC returned", rpcRes.status, await rpcRes.text());
    return page("Something went wrong", "We couldn't confirm your email right now. Please try the link again in a moment.", false);
  }

  const result = await rpcRes.json();
  if (!result.success) {
    return page(
      "Link expired or already used",
      "This verification link is invalid or has expired. You can request a new one from inside Riftgate.",
      false,
    );
  }

  return page("Email confirmed!", `You're all set, ${result.username}. You can close this tab and go back to Riftgate.`, true);
});
