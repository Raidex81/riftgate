-- =============================================================================
-- 0002 · private_account_secrets
-- -----------------------------------------------------------------------------
-- Purpose
--   Move every secret or personal-identifier column of public.usernames
--   (password hash, email + verification state, verification token,
--   password-reset code/state, device id) into private.account_secrets, a
--   table in a schema the REST API does not expose and client roles cannot use.
--   Tokens and reset codes are stored as SHA-256 hashes, never in plain text.
--   Every function that read/wrote those columns is rewritten to use the new
--   table. The public columns are kept (always NULL / default) so shipped
--   clients keep working; they are dropped later in the contract migration.
--
-- How shipped clients keep working
--   * Registration: clients POST /usernames {username, device_id, date_of_birth}
--     with "Prefer: return=representation" (RETURNING *). A BEFORE INSERT trigger
--     copies device_id into private.account_secrets and blanks it on the public
--     row, so the insert and its RETURNING still succeed — they just return NULLs.
--     Secret fields supplied by an API client on INSERT (anything except
--     device_id) are discarded, not stored.
--   * Login, email verification, admin checks: all go through SECURITY DEFINER
--     RPCs with unchanged names, arguments and return shapes.
--   * Profile read (date_of_birth, show_mature_content) and username lists are
--     untouched (those columns stay public until migration 0008/0010).
--
-- Other changes
--   * New passwords are hashed with bcrypt cost 12 (was 6). Existing hashes keep
--     working; rehash-on-login comes in 0003.
--   * Pending email-verification links and password-reset codes stay valid
--     (their hashes are migrated).
--
-- Prerequisites: 0001. Take a backup first (Dashboard → Database → Backups, or
--   the SQL export in OWNER_ACTIONS).
-- Old-client effect (≤ 1.5.2): none expected. Verify registration + login below.
--
-- Verify (run after applying):
--   -- 1) nothing secret left on the public table (all zeros):
--   select count(*) filter (where password_hash is not null) as hashes,
--          count(*) filter (where email is not null)         as emails,
--          count(*) filter (where device_id is not null)     as device_ids,
--          count(*) filter (where email_verification_token is not null or password_reset_token is not null) as tokens
--   from public.usernames;
--   -- 2) every account with a password still has it (compare with the count before):
--   select count(*) from private.account_secrets where password_hash is not null;
--   -- 3) client roles can't read the private table (expect false, false):
--   select has_table_privilege('anon', 'private.account_secrets', 'select'),
--          has_schema_privilege('anon', 'private', 'usage');
--   -- 4) In the app: log out, log back in; register a throwaway username on a
--   --    second PC/VM if available.
--
-- Rollback: rollback_20260925000200.sql (restores public columns and the previous
--   function bodies; plain-text tokens can't be restored, so pending verification
--   links/reset codes would have to be requested again).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Private schema + table
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.account_secrets (
  username                      text primary key
                                  references public.usernames (username)
                                  on update cascade on delete cascade
                                  deferrable initially deferred,
  password_hash                 text,
  email                         text,
  email_verified                boolean not null default false,
  email_verification_token_hash text,
  email_verification_expires_at timestamptz,
  email_verification_sent_at    timestamptz,
  reset_code_hash               text,
  reset_expires_at              timestamptz,
  reset_sent_at                 timestamptz,
  reset_attempts                integer not null default 0,
  device_id                     text,
  must_reset                    boolean not null default false,
  updated_at                    timestamptz not null default now()
);
revoke all on table private.account_secrets from public, anon, authenticated;

create unique index if not exists account_secrets_email_unique_idx
  on private.account_secrets (lower(email)) where email is not null;
create index if not exists account_secrets_email_token_idx
  on private.account_secrets (email_verification_token_hash)
  where email_verification_token_hash is not null;

create or replace function private.token_hash(t text)
returns text
language sql
immutable
set search_path = extensions
as $$
  select case when t is null then null else encode(extensions.digest(t, 'sha256'), 'hex') end;
$$;
revoke execute on function private.token_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill (existing private rows are left alone, so re-running is safe)
-- ---------------------------------------------------------------------------
insert into private.account_secrets (
  username, password_hash, email, email_verified,
  email_verification_token_hash, email_verification_expires_at, email_verification_sent_at,
  reset_code_hash, reset_expires_at, reset_sent_at, reset_attempts, device_id)
select u.username, u.password_hash, u.email, coalesce(u.email_verified, false),
       private.token_hash(u.email_verification_token), u.email_verification_expires_at, u.email_verification_sent_at,
       private.token_hash(upper(u.password_reset_token)), u.password_reset_expires_at, u.password_reset_sent_at,
       coalesce(u.password_reset_attempts, 0), u.device_id
from public.usernames u
on conflict (username) do nothing;

alter table public.usernames alter column device_id drop not null;

update public.usernames
set password_hash = null,
    email = null,
    email_verified = false,
    email_verification_token = null,
    email_verification_expires_at = null,
    email_verification_sent_at = null,
    password_reset_token = null,
    password_reset_expires_at = null,
    password_reset_sent_at = null,
    password_reset_attempts = 0,
    device_id = null
where password_hash is not null or email is not null or email_verified
   or email_verification_token is not null or email_verification_expires_at is not null
   or email_verification_sent_at is not null or password_reset_token is not null
   or password_reset_expires_at is not null or password_reset_sent_at is not null
   or password_reset_attempts <> 0 or device_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Trigger: keep the public columns empty forever
-- ---------------------------------------------------------------------------
create or replace function private.capture_account_secrets()
returns trigger
language plpgsql
security definer
set search_path = private, public, extensions
as $$
declare
  v_from_api boolean := coalesce(current_setting('role', true), '') in ('anon', 'authenticated');
begin
  if v_from_api then
    -- Shipped clients only ever send device_id. Anything else secret coming
    -- through the public API is dropped rather than trusted.
    if new.device_id is not null then
      insert into private.account_secrets as s (username, device_id)
      values (new.username, new.device_id)
      on conflict (username) do update
        set device_id = coalesce(s.device_id, excluded.device_id), updated_at = now();
    end if;
  elsif new.password_hash is not null or new.email is not null or new.email_verified
     or new.email_verification_token is not null or new.email_verification_expires_at is not null
     or new.email_verification_sent_at is not null or new.password_reset_token is not null
     or new.password_reset_expires_at is not null or new.password_reset_sent_at is not null
     or coalesce(new.password_reset_attempts, 0) <> 0 or new.device_id is not null then
    -- Owner/service edits (e.g. setting a password by hand in the SQL editor)
    -- land in the private table instead of the public one.
    insert into private.account_secrets as s (
      username, password_hash, email, email_verified,
      email_verification_token_hash, email_verification_expires_at, email_verification_sent_at,
      reset_code_hash, reset_expires_at, reset_sent_at, reset_attempts, device_id)
    values (
      new.username, new.password_hash, new.email, coalesce(new.email_verified, false),
      private.token_hash(new.email_verification_token), new.email_verification_expires_at, new.email_verification_sent_at,
      private.token_hash(upper(new.password_reset_token)), new.password_reset_expires_at, new.password_reset_sent_at,
      coalesce(new.password_reset_attempts, 0), new.device_id)
    on conflict (username) do update set
      password_hash                 = coalesce(excluded.password_hash, s.password_hash),
      email                         = coalesce(excluded.email, s.email),
      email_verified                = s.email_verified or excluded.email_verified,
      email_verification_token_hash = coalesce(excluded.email_verification_token_hash, s.email_verification_token_hash),
      email_verification_expires_at = coalesce(excluded.email_verification_expires_at, s.email_verification_expires_at),
      email_verification_sent_at    = coalesce(excluded.email_verification_sent_at, s.email_verification_sent_at),
      reset_code_hash               = coalesce(excluded.reset_code_hash, s.reset_code_hash),
      reset_expires_at              = coalesce(excluded.reset_expires_at, s.reset_expires_at),
      reset_sent_at                 = coalesce(excluded.reset_sent_at, s.reset_sent_at),
      reset_attempts                = greatest(s.reset_attempts, excluded.reset_attempts),
      device_id                     = coalesce(excluded.device_id, s.device_id),
      updated_at                    = now();
  end if;

  new.password_hash                 := null;
  new.email                         := null;
  new.email_verified                := false;
  new.email_verification_token      := null;
  new.email_verification_expires_at := null;
  new.email_verification_sent_at    := null;
  new.password_reset_token          := null;
  new.password_reset_expires_at     := null;
  new.password_reset_sent_at        := null;
  new.password_reset_attempts       := 0;
  new.device_id                     := null;
  return new;
end;
$$;
revoke execute on function private.capture_account_secrets() from public, anon, authenticated;

drop trigger if exists usernames_capture_secrets on public.usernames;
create trigger usernames_capture_secrets
  before insert or update on public.usernames
  for each row execute function private.capture_account_secrets();

-- ---------------------------------------------------------------------------
-- 4. Functions rewritten to use private.account_secrets
--    (names, arguments, return types and existing permissions unchanged —
--    CREATE OR REPLACE keeps each function's current grants/revokes)
-- ---------------------------------------------------------------------------
create or replace function public.verify_login(input_username text, input_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from private.account_secrets s
    where s.username = input_username
      and s.password_hash is not null
      and s.password_hash = crypt(input_password, s.password_hash)
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
    join private.account_secrets s on s.username = ad.username
    where ad.username = input_username
      and s.password_hash is not null
      and s.password_hash = crypt(input_password, s.password_hash)
  );
$$;

create or replace function public.check_share_access(p_username text, p_password text default null::text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_password is null or not public.verify_login(p_username, p_password) then
    return false;
  end if;
  return exists (select 1 from public.admins where username = p_username)
      or exists (select 1 from public.share_allowlist where username = p_username);
end;
$$;

create or replace function public.login_needs_password_setup(input_username text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.usernames u
    left join private.account_secrets s on s.username = u.username
    where u.username = input_username
      and s.password_hash is null
  );
$$;

do $$
begin
  if to_regprocedure('public.admin_needs_password_setup(text)') is not null then
    execute $f$
      create or replace function public.admin_needs_password_setup(input_username text)
      returns boolean language sql security definer set search_path = public, extensions as $b$
        select exists (
          select 1 from public.admins ad
          left join private.account_secrets s on s.username = ad.username
          where ad.username = input_username and s.password_hash is null);
      $b$;
    $f$;
  end if;
end $$;

-- Same (still too permissive) rule as before: sets a password only on an account
-- that has none. Made device-bound in 0003.
create or replace function public.set_own_login_password(input_username text, new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.usernames where username = input_username) then
    return null;
  end if;
  insert into private.account_secrets (username) values (input_username)
  on conflict (username) do nothing;
  update private.account_secrets
     set password_hash = crypt(new_password, gen_salt('bf', 12)), updated_at = now()
   where username = input_username and password_hash is null;
  if found then return true; end if;
  return null;
end;
$$;

create or replace function public.get_own_email_status(input_username text, input_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_row record;
begin
  if not public.verify_login(input_username, input_password) then
    return jsonb_build_object('success', false, 'error', 'Not authorized.');
  end if;
  select email, email_verified, email_verification_sent_at into v_row
  from private.account_secrets where username = input_username;
  return jsonb_build_object('success', true, 'email', v_row.email,
                            'verified', coalesce(v_row.email_verified, false),
                            'sentAt', v_row.email_verification_sent_at);
end;
$$;

-- Behaviour unchanged for now (still returns the token to the app, which
-- emails it); moved server-side in 0006.
create or replace function public.request_email_verification(input_username text, input_password text, input_new_email text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text; v_last_sent timestamptz; v_token text;
begin
  if not public.verify_login(input_username, input_password) then
    return jsonb_build_object('success', false, 'error', 'Not authorized.');
  end if;

  select email, email_verification_sent_at into v_email, v_last_sent
  from private.account_secrets where username = input_username;

  v_email := coalesce(nullif(trim(input_new_email), ''), v_email);
  if v_email is null then
    return jsonb_build_object('success', false, 'error', 'No email address to send to.');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('success', false, 'error', 'That doesn''t look like a valid email address.');
  end if;
  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    return jsonb_build_object('success', false, 'error', 'Please wait a moment before requesting another email.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  begin
    update private.account_secrets
       set email = v_email,
           email_verified = false,
           email_verification_token_hash = private.token_hash(v_token),
           email_verification_expires_at = now() + interval '24 hours',
           email_verification_sent_at = now(),
           updated_at = now()
     where username = input_username;
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'That email is already associated with another Riftgate account.');
  end;

  return jsonb_build_object('success', true, 'email', v_email, 'token', v_token);
end;
$$;

create or replace function public.confirm_email_verification(input_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_username text;
begin
  select username into v_username
  from private.account_secrets
  where email_verification_token_hash = private.token_hash(input_token)
    and email_verification_expires_at is not null
    and email_verification_expires_at > now();

  if v_username is null then
    return jsonb_build_object('success', false, 'error', 'This verification link is invalid or has expired.');
  end if;

  update private.account_secrets
     set email_verified = true,
         email_verification_token_hash = null,
         email_verification_expires_at = null,
         updated_at = now()
   where username = v_username;

  return jsonb_build_object('success', true, 'username', v_username);
end;
$$;

-- Still not callable by client roles (revoked in 0001); replaced by the
-- server-side reset flow in 0005. Rewritten here only so it keeps working
-- against the new table.
create or replace function public.request_password_reset(input_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text; v_verified boolean; v_last_sent timestamptz;
  v_bytes bytea; v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; v_code text := ''; i int;
begin
  select email, email_verified, reset_sent_at into v_email, v_verified, v_last_sent
  from private.account_secrets where username = input_username;

  if not found or v_email is null or v_verified is not true then
    return jsonb_build_object('success', true);
  end if;
  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    return jsonb_build_object('success', true);
  end if;

  v_bytes := gen_random_bytes(8);
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  update private.account_secrets
     set reset_code_hash = private.token_hash(v_code),
         reset_expires_at = now() + interval '30 minutes',
         reset_sent_at = now(),
         reset_attempts = 0,
         updated_at = now()
   where username = input_username;

  return jsonb_build_object('success', true, 'email', v_email, 'code', v_code);
end;
$$;

create or replace function public.confirm_password_reset(input_username text, input_code text, input_new_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text; v_expires timestamptz; v_attempts int;
begin
  select reset_code_hash, reset_expires_at, reset_attempts into v_hash, v_expires, v_attempts
  from private.account_secrets where username = input_username;

  if v_hash is null or v_expires is null or v_expires < now() then
    return jsonb_build_object('success', false, 'error', 'This code has expired or is invalid. Request a new one.');
  end if;
  if v_attempts >= 5 then
    return jsonb_build_object('success', false, 'error', 'Too many incorrect attempts. Request a new code.');
  end if;
  if private.token_hash(upper(trim(input_code))) <> v_hash then
    update private.account_secrets set reset_attempts = reset_attempts + 1 where username = input_username;
    return jsonb_build_object('success', false, 'error', 'That code is incorrect.');
  end if;
  if length(input_new_password) < 8 then
    return jsonb_build_object('success', false, 'error', 'Password must be at least 8 characters.');
  end if;

  update private.account_secrets
     set password_hash = crypt(input_new_password, gen_salt('bf', 12)),
         reset_code_hash = null, reset_expires_at = null, reset_sent_at = null,
         reset_attempts = 0, must_reset = false, updated_at = now()
   where username = input_username;

  return jsonb_build_object('success', true);
end;
$$;

-- Still revoked from client roles (0001). Replaced in 0003 by a flow that never
-- leaves an account without a password.
create or replace function public.super_trigger_password_reset(super_username text, super_password text, target_username text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_is_super boolean; v_rows int;
begin
  select ad.is_super_admin into v_is_super
  from public.admins ad
  where ad.username = super_username and public.verify_admin_login(super_username, super_password);
  if v_is_super is not true then return false; end if;

  update private.account_secrets set password_hash = null, updated_at = now() where username = target_username;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 2, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
