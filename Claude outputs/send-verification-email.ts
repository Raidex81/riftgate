// Supabase Edge Function: send-verification-email
//
// Deploy path: supabase/functions/send-verification-email/index.ts
// Deploy command: supabase functions deploy send-verification-email
// (default JWT verification is fine here — leave it on)
//
// Emails Riftgate's "confirm your email" link via Resend. Called only by
// the Riftgate desktop app's own main process (services/supabase.js ->
// sendVerificationEmail), and only right after the
// request_email_verification RPC has already confirmed — via the
// account's own login password — that the caller is authorized. This
// function does no authorization of its own beyond the normal Supabase
// apikey/JWT check every Edge Function call already carries; its only
// job is "deliver this token by email".
//
// Requires one secret on this Supabase project (Project Settings ->
// Edge Functions -> Secrets, or `supabase secrets set`):
//   RESEND_API_KEY   — from https://resend.com -> Settings -> API Keys
//
// Also requires a verified sending domain in Resend for production use —
// update FROM_ADDRESS below to an address on that domain once it's set
// up. Until then, FROM_ADDRESS defaults to Resend's shared test address,
// which only delivers to the Resend account's own verified email — fine
// for confirming the function itself works end-to-end before the real
// domain is ready.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

// TODO: change to an address on your verified Resend domain, e.g.
// "Riftgate <noreply@yourdomain.com>", once that domain is set up.
const FROM_ADDRESS = "Riftgate <onboarding@resend.dev>";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY is not configured" }), { status: 500 });
  }

  let body: { username?: string; email?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { username, email, token } = body;
  if (!username || !email || !token) {
    return new Response(
      JSON.stringify({ error: "username, email, and token are all required" }),
      { status: 400 }
    );
  }

  const verifyUrl = `${SUPABASE_URL}/functions/v1/verify-email?token=${encodeURIComponent(token)}`;
  const safeUsername = escapeHtml(username);

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="color:#7c3aed;">Confirm your email for Riftgate</h2>
      <p>Hi ${safeUsername},</p>
      <p>Click the button below to confirm this is your email address. This link expires in 24 hours.</p>
      <p style="margin: 28px 0;">
        <a href="${verifyUrl}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Confirm my email</a>
      </p>
      <p style="color:#666;font-size:13px;">If the button doesn't work, paste this link into your browser:<br>${verifyUrl}</p>
      <p style="color:#666;font-size:13px;">You still sign into Riftgate with your username only — this email is just used to help verify or recover your account. If you didn't request this, you can safely ignore it.</p>
    </div>
  `;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject: "Confirm your email for Riftgate",
      html,
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    console.error("[send-verification-email] Resend error:", resendRes.status, detail);
    return new Response(JSON.stringify({ error: "Failed to send email" }), { status: 502 });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
