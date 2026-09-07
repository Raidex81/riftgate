-- Step A: one login for everyone.
--
-- This replaces the two separate password systems (a Vault-only password,
-- and an admin-only password) with a single account password per
-- username, checked once when the app opens. From then on, admin status
-- and Vault access are both automatic based on who you're logged in as —
-- no second password prompt for either one.
--
-- What this does, in order:
--   1. Adds password_hash to the "usernames" table — this becomes the
--      ONE password store for every account, admin or not.
--   2. Copies over any password that already exists for today's real
--      admins (Fausto_Adm, draco_Adm, Raidex_Adm_Root, BlackBeard94_Adm,
--      etc.) so none of them have to redo anything. Everyone else will
--      be asked to set a password the next time they open the app —
--      same one-time step as picking a username currently is.
--   3. Adds login_needs_password_setup / verify_login / set_own_login_password
--      — the universal login, replacing vault_needs_password_setup /
--      verify_vault_login / set_own_vault_password from Step 4.
--   4. Repoints admin_needs_password_setup / verify_admin_login at the
--      same usernames.password_hash — so an admin's ONE login password is
--      what verify_admin_login checks too. Nothing else that calls
--      verify_admin_login (deleting someone else's shared file, force-clean,
--      etc.) needs to change — they keep working exactly as before.
--   5. Repoints check_share_access at usernames.password_hash instead of
--      the Vault-only one from Step 5, and now also requires it for admins
--      (closing the same "known username, no proof" gap for admins too,
--      not just allowlisted users).
--   6. Extends delete_shared_file / delete_shared_link so deleting your
--      OWN upload also requires your login password — right now anyone
--      who simply knows (or sets their local nickname to) another
--      person's username can delete that person's upload with no proof
--      at all. This was flagged as a follow-up in Step 5; closing it now
--      since the same login password already covers it.
--
-- Known follow-up NOT covered here: super_trigger_password_reset (a
-- super-admin forcing another admin to redo their password) isn't
-- touched by this script because I don't have its current definition —
-- it may need a matching update later so it forces a reset of the new
-- unified password instead of the old admin-only one. Flagging this
-- rather than guessing at its SQL.

-- ============================================================
-- 1 & 2. usernames.password_hash + one-time migration
-- ============================================================
alter table public.usernames
    add column if not exists password_hash text;

-- Backfill from existing admin passwords (only fills in where a username
-- row doesn't already have a password set, and only for real admins who
-- already set one under the old system).
update public.usernames u
set password_hash = a.password_hash
from public.admins a
where u.username = a.username
  and u.password_hash is null
  and a.password_hash is not null;

-- Covers the edge case of an admin account that somehow doesn't have a
-- row in "usernames" yet (this is what Raidex_Adm hit — an admin created
-- directly, never through the normal "pick a username" flow, so there
-- was no device_id to carry over; a placeholder is fine here since
-- device_id is just informational and unused by anything security-related).
insert into public.usernames (username, password_hash, device_id)
select a.username, a.password_hash, 'legacy-admin-' || a.username
from public.admins a
where a.password_hash is not null
on conflict (username) do update
    set password_hash = coalesce(public.usernames.password_hash, excluded.password_hash);

-- Same defensive backfill from the Vault-only passwords added in Step 4,
-- in case anyone already set one of those in the short time it existed.
update public.usernames u
set password_hash = s.password_hash
from public.share_allowlist s
where u.username = s.username
  and u.password_hash is null
  and s.password_hash is not null;

-- ============================================================
-- 3. Universal login functions
-- ============================================================
create or replace function public.login_needs_password_setup(input_username text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.usernames
        where username = input_username
          and password_hash is null
    );
$$;

create or replace function public.verify_login(input_username text, input_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.usernames
        where username = input_username
          and password_hash is not null
          and password_hash = crypt(input_password, password_hash)
    );
$$;

create or replace function public.set_own_login_password(input_username text, new_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.usernames
    set password_hash = crypt(new_password, gen_salt('bf'))
    where username = input_username
      and password_hash is null
    returning true;
$$;

-- ============================================================
-- 4. Admin checks now point at the same, single password
-- ============================================================
create or replace function public.admin_needs_password_setup(input_username text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.admins ad
        join public.usernames u on u.username = ad.username
        where ad.username = input_username
          and u.password_hash is null
    );
$$;

create or replace function public.verify_admin_login(input_username text, input_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.admins ad
        join public.usernames u on u.username = ad.username
        where ad.username = input_username
          and u.password_hash is not null
          and u.password_hash = crypt(input_password, u.password_hash)
    );
$$;

-- ============================================================
-- 5. check_share_access — same signature as Step 5, now checking the
--    universal password, and requiring it for admins too.
-- ============================================================
create or replace function public.check_share_access(p_username text, p_password text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, extensions
as $function$
DECLARE
    v_authenticated boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM usernames
        WHERE username = p_username
          AND password_hash IS NOT NULL
          AND p_password IS NOT NULL
          AND password_hash = crypt(p_password, password_hash)
    ) INTO v_authenticated;

    IF NOT v_authenticated THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM admins WHERE username = p_username
    ) OR EXISTS (
        SELECT 1 FROM share_allowlist WHERE username = p_username
    );
END;
$function$;

-- ============================================================
-- 6. delete_shared_file / delete_shared_link — owner-delete now also
--    requires proving the login password, not just a matching username.
--    Dropped and recreated (not just replaced) so the old, password-less
--    3-argument version can't still be called directly.
-- ============================================================
drop function if exists public.delete_shared_file(text, bigint, text);

create or replace function public.delete_shared_file(p_username text, p_file_id bigint, p_admin_password text default null::text, p_password text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, extensions
as $function$
DECLARE
    v_uploader TEXT;
    v_is_admin BOOLEAN := false;
    v_owner_verified BOOLEAN := false;
BEGIN
    SELECT uploader_username INTO v_uploader FROM shared_files WHERE id = p_file_id;
    IF v_uploader IS NULL THEN
        RETURN false;
    END IF;

    IF v_uploader = p_username THEN
        SELECT verify_login(p_username, p_password) INTO v_owner_verified;
        IF v_owner_verified THEN
            DELETE FROM shared_files WHERE id = p_file_id;
            RETURN true;
        END IF;
    END IF;

    -- Not the (verified) uploader — require valid admin credentials,
    -- reusing verify_admin_login, which now checks the same unified
    -- password.
    IF p_admin_password IS NOT NULL THEN
        SELECT verify_admin_login(p_username, p_admin_password) INTO v_is_admin;
        IF v_is_admin THEN
            DELETE FROM shared_files WHERE id = p_file_id;
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$function$;

drop function if exists public.delete_shared_link(text, bigint, text);

create or replace function public.delete_shared_link(p_username text, p_link_id bigint, p_admin_password text default null::text, p_password text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path = public, extensions
as $function$
DECLARE
    v_poster TEXT;
    v_is_admin BOOLEAN := false;
    v_owner_verified BOOLEAN := false;
BEGIN
    SELECT poster_username INTO v_poster FROM shared_links WHERE id = p_link_id;
    IF v_poster IS NULL THEN
        RETURN false;
    END IF;

    IF v_poster = p_username THEN
        SELECT verify_login(p_username, p_password) INTO v_owner_verified;
        IF v_owner_verified THEN
            DELETE FROM shared_links WHERE id = p_link_id;
            RETURN true;
        END IF;
    END IF;

    IF p_admin_password IS NOT NULL THEN
        SELECT verify_admin_login(p_username, p_admin_password) INTO v_is_admin;
        IF v_is_admin THEN
            DELETE FROM shared_links WHERE id = p_link_id;
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$function$;
