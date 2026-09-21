-- Email verification — optional, and separate from sign-in.
--
-- Riftgate keeps signing everyone in with a username + their existing
-- login password, exactly as today. This only lets an account
-- optionally add an email address and prove it owns it (by clicking a
-- link Riftgate emails to it) — useful later for account recovery, but
-- never a second way to log in.
--
-- What this does:
--   1. Adds email / email_verified / email_verification_token /
--      email_verification_expires_at / email_verification_sent_at to
--      usernames.
--   2. A unique index so two accounts can never claim the same email at
--      once.
--   3. Explicitly revokes SELECT on all five new columns from anon and
--      authenticated — the token especially must never be readable
--      through the public REST API (that would let anyone verify any
--      email on any account just by reading it back), so this closes
--      that off regardless of whatever row-level policy already exists
--      on this table. The three new RPC functions below are
--      SECURITY DEFINER, so they can still read/write these columns
--      normally — this only blocks the public REST endpoint.
--   4. request_email_verification(username, password, new_email) —
--      password-gated (same as set_own_login_password), generates a
--      fresh token, and returns it ONLY to the authenticated caller
--      (Riftgate's main process, which immediately hands it to the
--      send-verification-email Edge Function and never shows it to the
--      page/renderer). Pass new_email to set/change the address and
--      send to it; pass null to just resend to whatever's already on
--      file. Rate-limited to once per 60 seconds.
--   5. confirm_email_verification(token) — public, called only by the
--      verify-email Edge Function when someone clicks the emailed link.
--      Takes just the token: a random 32-byte value nobody but the
--      email's real recipient ever sees is proof enough on its own.
--   6. get_own_email_status(username, password) — password-gated read,
--      since email isn't exposed via public REST the way
--      username/date_of_birth currently are.
--
-- NOTE — worth checking while you're in here: this same "revoke SELECT
-- on sensitive columns from anon/authenticated" treatment doesn't exist
-- yet for usernames.password_hash as far as I can tell from what's
-- tracked here. If the table's current RLS policy allows public SELECT
-- of arbitrary columns, that hash could be readable through the REST API
-- today — worth locking down the same way if so:
--   revoke select (password_hash) on public.usernames from anon, authenticated;
-- (Safe to run any time — RPCs like verify_login are SECURITY DEFINER
-- and are completely unaffected by column-level REST grants.)

-- ============================================================
-- 1. New columns
-- ============================================================
alter table public.usernames
    add column if not exists email text,
    add column if not exists email_verified boolean not null default false,
    add column if not exists email_verification_token text,
    add column if not exists email_verification_expires_at timestamptz,
    add column if not exists email_verification_sent_at timestamptz;

-- ============================================================
-- 2. One email per account, at most
-- ============================================================
create unique index if not exists usernames_email_unique_idx
    on public.usernames (lower(email))
    where email is not null;

create index if not exists usernames_email_verification_token_idx
    on public.usernames (email_verification_token)
    where email_verification_token is not null;

-- ============================================================
-- 3. Keep the new columns out of the public REST API entirely
-- ============================================================
revoke select (email, email_verified, email_verification_token, email_verification_expires_at, email_verification_sent_at)
    on public.usernames from anon, authenticated;

-- ============================================================
-- 4. request_email_verification — password-gated, mints a token
-- ============================================================
create or replace function public.request_email_verification(input_username text, input_password text, input_new_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_verified boolean;
    v_email text;
    v_last_sent timestamptz;
    v_token text;
BEGIN
    SELECT verify_login(input_username, input_password) INTO v_verified;
    IF NOT v_verified THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized.');
    END IF;

    SELECT email, email_verification_sent_at INTO v_email, v_last_sent
    FROM usernames WHERE username = input_username;

    v_email := COALESCE(NULLIF(trim(input_new_email), ''), v_email);

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No email address to send to.');
    END IF;

    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'That doesn''t look like a valid email address.');
    END IF;

    IF v_last_sent IS NOT NULL AND v_last_sent > now() - interval '60 seconds' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Please wait a moment before requesting another email.');
    END IF;

    v_token := encode(gen_random_bytes(32), 'hex');

    BEGIN
        UPDATE usernames
        SET email = v_email,
            email_verified = false,
            email_verification_token = v_token,
            email_verification_expires_at = now() + interval '24 hours',
            email_verification_sent_at = now()
        WHERE username = input_username;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'That email is already associated with another Riftgate account.');
    END;

    RETURN jsonb_build_object('success', true, 'email', v_email, 'token', v_token);
END;
$function$;

-- ============================================================
-- 5. confirm_email_verification — public, token is the only proof
-- ============================================================
create or replace function public.confirm_email_verification(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_username text;
BEGIN
    SELECT username INTO v_username
    FROM usernames
    WHERE email_verification_token = input_token
      AND email_verification_expires_at IS NOT NULL
      AND email_verification_expires_at > now();

    IF v_username IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This verification link is invalid or has expired.');
    END IF;

    UPDATE usernames
    SET email_verified = true,
        email_verification_token = null,
        email_verification_expires_at = null
    WHERE username = v_username;

    RETURN jsonb_build_object('success', true, 'username', v_username);
END;
$function$;

-- ============================================================
-- 6. get_own_email_status — password-gated read
-- ============================================================
create or replace function public.get_own_email_status(input_username text, input_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_verified boolean;
    v_row record;
BEGIN
    SELECT verify_login(input_username, input_password) INTO v_verified;
    IF NOT v_verified THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authorized.');
    END IF;

    SELECT email, email_verified, email_verification_sent_at INTO v_row
    FROM usernames WHERE username = input_username;

    RETURN jsonb_build_object(
        'success', true,
        'email', v_row.email,
        'verified', v_row.email_verified,
        'sentAt', v_row.email_verification_sent_at
    );
END;
$function$;
