-- Step 5: require the Vault password on every function that reads or
-- writes Vault content, not just at the app's login screen.
--
-- Why this matters: right now, check_share_access(p_username) only checks
-- whether that username STRING exists in share_allowlist or admins — no
-- password. That means every function below (get_shared_files,
-- add_shared_file, add_shared_link, cleanup_expired_shared_files,
-- cleanup_expired_shared_links) grants full Vault access to anyone who
-- calls it with a known/guessed allowlisted username, completely
-- bypassing the login screen we added in Step 4. This step closes that at
-- the database level, so the fix can't be routed around even by someone
-- calling the Supabase API directly instead of using the app.
--
-- Each function below is DROPPED and recreated (not just "replaced") on
-- purpose: Postgres treats "add a parameter" as a new function signature,
-- so a plain CREATE OR REPLACE would leave the OLD, password-less version
-- still callable side-by-side with the new one. Dropping first guarantees
-- only the password-checking version exists afterward.

-- ============================================================
-- 1. check_share_access — now requires a matching password for
--    allowlisted (non-admin) users. Admins are untouched: they already
--    prove identity separately via verify_admin_login in the app's admin
--    flow, so no password is required from THIS function for them.
-- ============================================================
drop function if exists public.check_share_access(text);

create or replace function public.check_share_access(p_username text, p_password text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, extensions
as $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM admins WHERE username = p_username
    ) OR EXISTS (
        SELECT 1 FROM share_allowlist
        WHERE username = p_username
          AND password_hash IS NOT NULL
          AND p_password IS NOT NULL
          AND password_hash = crypt(p_password, password_hash)
    );
END;
$function$;

-- ============================================================
-- 2. add_shared_file — both overloads, each gains p_password.
--    All other logic (including the 1/2/4-hour expiry validation on the
--    6-param overload) is unchanged.
-- ============================================================
drop function if exists public.add_shared_file(text, text, text, bigint, text);
drop function if exists public.add_shared_file(text, text, text, bigint, text, integer);

create or replace function public.add_shared_file(p_username text, p_filename text, p_storage_path text, p_file_size bigint, p_description text, p_password text default null::text)
 returns shared_files
 language plpgsql
 security definer
as $function$
DECLARE
    v_row shared_files;
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    INSERT INTO shared_files (filename, storage_path, file_size, description, uploader_username)
    VALUES (p_filename, p_storage_path, p_file_size, p_description, p_username)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

create or replace function public.add_shared_file(p_username text, p_filename text, p_storage_path text, p_file_size bigint, p_description text, p_expires_hours integer, p_password text default null::text)
 returns shared_files
 language plpgsql
 security definer
as $function$
DECLARE
    v_row shared_files;
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF p_expires_hours NOT IN (1, 2, 4) THEN
        RAISE EXCEPTION 'Expiration must be 1, 2, or 4 hours';
    END IF;
    INSERT INTO shared_files (filename, storage_path, file_size, description, uploader_username, expires_at)
    VALUES (p_filename, p_storage_path, p_file_size, p_description, p_username, now() + (p_expires_hours || ' hours')::interval)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

-- ============================================================
-- 3. add_shared_link
-- ============================================================
drop function if exists public.add_shared_link(text, text, text);

create or replace function public.add_shared_link(p_username text, p_url text, p_description text, p_password text default null::text)
 returns shared_links
 language plpgsql
 security definer
as $function$
DECLARE
    v_row shared_links;
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    INSERT INTO shared_links (url, description, poster_username)
    VALUES (p_url, p_description, p_username)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

-- ============================================================
-- 4. cleanup_expired_shared_files / cleanup_expired_shared_links
-- ============================================================
drop function if exists public.cleanup_expired_shared_files(text);

create or replace function public.cleanup_expired_shared_files(p_username text, p_password text default null::text)
 returns setof shared_files
 language plpgsql
 security definer
as $function$
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY DELETE FROM shared_files WHERE expires_at <= now() RETURNING *;
END;
$function$;

drop function if exists public.cleanup_expired_shared_links(text);

create or replace function public.cleanup_expired_shared_links(p_username text, p_password text default null::text)
 returns setof shared_links
 language plpgsql
 security definer
as $function$
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY DELETE FROM shared_links WHERE expires_at <= now() RETURNING *;
END;
$function$;

-- ============================================================
-- 5. get_shared_files / get_shared_links
-- ============================================================
drop function if exists public.get_shared_files(text);

create or replace function public.get_shared_files(p_username text, p_password text default null::text)
 returns setof shared_files
 language plpgsql
 security definer
as $function$
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY SELECT * FROM shared_files WHERE expires_at > now() ORDER BY uploaded_at DESC;
END;
$function$;

drop function if exists public.get_shared_links(text);

create or replace function public.get_shared_links(p_username text, p_password text default null::text)
 returns setof shared_links
 language plpgsql
 security definer
as $function$
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY SELECT * FROM shared_links WHERE expires_at > now() ORDER BY posted_at DESC;
END;
$function$;

-- Note: delete_shared_file / delete_shared_link are intentionally left
-- untouched here — they already require either an exact uploader-username
-- match or a verified admin password, which is a separate, independent
-- check from check_share_access. (There's a smaller, related gap in the
-- owner-match branch of those two, worth a quick follow-up — flagged
-- separately, not part of this step.)
