-- Step 4 (fixed): the previous version failed because pgcrypto's crypt()
-- function lives in the "extensions" schema on Supabase, not "public" —
-- so a function whose search_path is just "public" can't see it. Adding
-- "extensions" to the search_path fixes that. Safe to run in full again:
-- create extension/alter table use "if not exists", and the functions use
-- "create or replace".

create extension if not exists pgcrypto;

alter table public.share_allowlist
    add column if not exists password_hash text;

create or replace function vault_needs_password_setup(input_username text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.share_allowlist
        where username = input_username
          and password_hash is null
    );
$$;

create or replace function verify_vault_login(input_username text, input_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    select exists (
        select 1 from public.share_allowlist
        where username = input_username
          and password_hash is not null
          and password_hash = crypt(input_password, password_hash)
    );
$$;

create or replace function set_own_vault_password(input_username text, new_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.share_allowlist
    set password_hash = crypt(new_password, gen_salt('bf'))
    where username = input_username
      and password_hash is null
    returning true;
$$;
