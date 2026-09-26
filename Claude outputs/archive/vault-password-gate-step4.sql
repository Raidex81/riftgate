-- Step 4: Vault password gate — safe, additive SQL
--
-- This does NOT touch any existing table or function. It only adds a new
-- column and three new functions, so there's no risk of breaking anything
-- currently working (get_shared_files, add_shared_file, etc. are untouched
-- here — that's Step 5, which needs your input first).
--
-- Before running: replace "share_allowlist" below with your actual
-- allowlist table name if it's different. You can check it in the
-- Supabase dashboard under Table Editor, or run:
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name ilike '%allow%';

-- Requires pgcrypto for crypt()/gen_salt() — almost certainly already
-- enabled since your admin password system uses the same functions.
create extension if not exists pgcrypto;

-- 1. New column to hold each allowlisted user's own Vault password hash.
--    NULL means "on the allowlist, but hasn't set a password yet".
alter table public.share_allowlist
    add column if not exists password_hash text;

-- 2. True if this username is on the allowlist but still needs to set a
--    password (first time, or after an admin clears it for a reset).
create or replace function vault_needs_password_setup(input_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.share_allowlist
        where username = input_username
          and password_hash is null
    );
$$;

-- 3. Verifies a login attempt against the stored hash. Returns false for
--    anyone not on the allowlist or without a password set yet, same as
--    a wrong password — no distinction that would help someone probe
--    which usernames exist.
create or replace function verify_vault_login(input_username text, input_password text)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.share_allowlist
        where username = input_username
          and password_hash is not null
          and password_hash = crypt(input_password, password_hash)
    );
$$;

-- 4. Lets an allowlisted user set their OWN password — but only while
--    none is set yet (first-time setup). Changing an existing password
--    isn't handled here on purpose; add a super_reset_vault_password
--    function later (mirroring super_trigger_password_reset for admins)
--    if you want admins to be able to clear someone's password to force
--    a reset.
create or replace function set_own_vault_password(input_username text, new_password text)
returns boolean
language sql
security definer
set search_path = public
as $$
    update public.share_allowlist
    set password_hash = crypt(new_password, gen_salt('bf'))
    where username = input_username
      and password_hash is null
    returning true;
$$;

-- Grant execute to the anon/publishable role your app actually connects
-- as. If your admin RPCs (verify_admin_login etc.) already work without
-- an explicit grant, your project's default privileges already cover
-- this and you can skip the lines below. If you get a "permission
-- denied for function" error when the app calls these, run:
--
-- grant execute on function vault_needs_password_setup(text) to anon;
-- grant execute on function verify_vault_login(text, text) to anon;
-- grant execute on function set_own_vault_password(text, text) to anon;
