-- Vault access-request workflow
--
-- Adds a "Request Access" button for non-allowlisted users, and an admin
-- view to accept/deny those requests, instead of the admin having to
-- manually add a username to the allowlist with no idea anyone even
-- wants in.
--
-- Run this in the Supabase SQL Editor for the Riftgate project.

create table if not exists public.share_access_requests (
    id uuid primary key default gen_random_uuid(),
    username text not null unique,
    requested_at timestamptz not null default now()
);

-- No public policies on purpose — exactly like every other Vault table in
-- this project, all access goes through the security-definer functions
-- below, never straight against the table.
alter table public.share_access_requests enable row level security;

-- 1. request_share_access — called by any user (no admin password needed,
--    same as check_share_access). Already-allowlisted users and admins
--    are turned away since there's nothing to request. Re-requesting just
--    bumps requested_at instead of creating a duplicate row.
create or replace function public.request_share_access(p_username text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, extensions
as $function$
BEGIN
    IF EXISTS (SELECT 1 FROM share_allowlist WHERE username = p_username)
       OR EXISTS (SELECT 1 FROM admins WHERE username = p_username) THEN
        RETURN false;
    END IF;

    INSERT INTO share_access_requests (username, requested_at)
    VALUES (p_username, now())
    ON CONFLICT (username) DO UPDATE SET requested_at = now();

    RETURN true;
END;
$function$;

-- 2. get_share_access_requests — admin only.
create or replace function public.get_share_access_requests(p_admin_username text, p_admin_password text)
 returns setof share_access_requests
 language plpgsql
 security definer
as $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    RETURN QUERY SELECT * FROM share_access_requests ORDER BY requested_at ASC;
END;
$function$;

-- 3. approve_share_access_request — admin only. Adds the user to
--    share_allowlist (same minimal insert shape as add_to_share_allowlist
--    — password_hash stays null until they set one on first login, same
--    as every other allowlist addition) and clears their request.
create or replace function public.approve_share_access_request(p_admin_username text, p_admin_password text, p_target_username text)
 returns boolean
 language plpgsql
 security definer
as $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    INSERT INTO share_allowlist (username) VALUES (p_target_username)
    ON CONFLICT (username) DO NOTHING;

    DELETE FROM share_access_requests WHERE username = p_target_username;

    RETURN true;
END;
$function$;

-- 4. deny_share_access_request — admin only. Just clears the request,
--    the user is never added to the allowlist.
create or replace function public.deny_share_access_request(p_admin_username text, p_admin_password text, p_target_username text)
 returns boolean
 language plpgsql
 security definer
as $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    DELETE FROM share_access_requests WHERE username = p_target_username;

    RETURN true;
END;
$function$;
