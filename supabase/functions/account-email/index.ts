// Riftgate — account-email Edge Function
//
// Sends Riftgate's two account emails entirely server-side, so reset codes and
// verification tokens never pass through the desktop app:
//   POST { action: "password-reset", username }
//     -> always { success: true } (never reveals whether the account exists or
//        has a verified email); emails an 8-character code if it does.
//   POST { action: "verify-email", username, password, email }
//     -> { success: true, email } or { success: false, error }
//        (checks the account password, then emails a confirmation link).
//
// It talks to the database with the service-role key (SUPABASE_SERVICE_ROLE_KEY,
// which Supabase provides to every Edge Function automatically) and calls
// public.issue_password_reset / public.issue_email_verification, which client
// roles cannot call (migration 0006).
//
// Secrets (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY  — already set for the existing email functions
//   RESEND_FROM     — optional: the "From" address, e.g. "Riftgate <noreply@yourdomain>".
//                     Use the same address as your existing email functions.
//                     Defaults to Resend's test sender, which only delivers to
//                     the Resend account owner's own address.
// "Verify JWT" setting: same as media-proxy (the app calls it the same way).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_ADDRESS = Deno.env.get("RESEND_FROM") || "Riftgate <onboarding@resend.dev>";

const JSON_HEADERS = { "Content-Type": "application/json" };
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort per-IP limit (per function instance): 10 requests / 10 minutes.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 10;
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...JSON_HEADERS },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    console.error(`[account-email] ${fn} returned ${res.status}:`, await res.text());
    return null;
  }
  return await res.json();
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, ...JSON_HEADERS },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error("[account-email] Resend error:", res.status, await res.text());
    return false;
  }
  return true;
}

function frame(inner: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e;">${inner}</div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply({ error: "Use POST" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return reply({ error: "Server is not configured." }, 500);
  }
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > 4096) return reply({ error: "Request too large." }, 413);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return reply({ success: false, error: "Too many requests — try again in a few minutes." }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid JSON body" }, 400);
  }

  const username = typeof body.username === "string" ? body.username : "";

  if (body.action === "password-reset") {
    // Same answer no matter what, so this can't be used to find accounts.
    if (USERNAME_RE.test(username)) {
      const issued = await rpc("issue_password_reset", { input_username: username });
      if (issued && issued.send && issued.email && issued.code) {
        await sendEmail(
          issued.email,
          "Your Riftgate password reset code",
          frame(`
            <h2 style="color:#7c3aed;">Reset your Riftgate password</h2>
            <p>Hi ${escapeHtml(username)},</p>
            <p>Your reset code is:</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:18px 0;">${escapeHtml(issued.code)}</p>
            <p>Enter it in Riftgate within 30 minutes. If you didn't ask for this, you can ignore this email — your password hasn't changed.</p>`),
        );
      }
    }
    return reply({ success: true });
  }

  if (body.action === "verify-email") {
    const password = typeof body.password === "string" ? body.password : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!USERNAME_RE.test(username) || !password || password.length > 200) {
      return reply({ success: false, error: "Not authorized." });
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return reply({ success: false, error: "That doesn't look like a valid email address." });
    }
    const issued = await rpc("issue_email_verification", {
      input_username: username, input_password: password, input_new_email: email,
    });
    if (!issued) return reply({ success: false, error: "Couldn't start email verification." });
    if (!issued.success || !issued.token) {
      return reply({ success: false, error: issued.error || "Couldn't start email verification." });
    }
    const link = `${SUPABASE_URL}/functions/v1/verify-email?token=${encodeURIComponent(issued.token)}`;
    const sent = await sendEmail(
      issued.email,
      "Confirm your email for Riftgate",
      frame(`
        <h2 style="color:#7c3aed;">Confirm your email for Riftgate</h2>
        <p>Hi ${escapeHtml(username)},</p>
        <p>Click the button below to confirm this is your email address. The link expires in 24 hours.</p>
        <p style="margin:28px 0;"><a href="${link}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Confirm my email</a></p>
        <p style="color:#666;font-size:13px;">If the button doesn't work, paste this link into your browser:<br>${link}</p>
        <p style="color:#666;font-size:13px;">If you didn't request this, you can ignore it.</p>`),
    );
    if (!sent) return reply({ success: false, error: "Couldn't send the verification email — try again in a moment." });
    return reply({ success: true, email: issued.email });
  }

  return reply({ error: "Unknown action" }, 400);
});
