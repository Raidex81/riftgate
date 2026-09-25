-- =============================================================================
-- 0003 · auth_hardening
-- -----------------------------------------------------------------------------
-- Purpose
--   1. Lockout: every password check goes through private.check_password(),
--      which locks a username for 15 min after 10 wrong passwords (doubling on
--      each further lockout, max 24 h) and returns the same "wrong password"
--      result while locked.
--   2. Stronger hashes: bcrypt cost 12 for new passwords; existing cost-6
--      hashes are upgraded automatically the next time that user logs in.
--   3. First-time password setup can no longer claim someone else's account:
--      * new 3-argument set_own_login_password(username, password, device_id)
--        only works from the device that registered the username;
--      * the old 2-argument version (used by app ≤ 1.5.2) only works within
--        30 minutes of the username being registered.
--   4. register_account(username, password, device_id, date_of_birth): one
--      atomic call for new app versions (creates the user and its password).
--   5. Registrations through the public API must match the app's own rule
--      (3-20 letters/numbers/underscores) and can't use reserved admin-looking
--      endings (_adm, _root, _admin, _administrator).
--   6. add_admin_reply / delete_reply / delete_suggestion check the normal
--      login password (via verify_admin_login) instead of a leftover legacy
--      admin-only password.
--   7. super_remove_admin now really requires a super-admin, as its name says.
--   8. super_trigger_password_reset no longer wipes the password (it flags
--      the account instead); it stays disabled for the app until 0005.
--   9. Client roles lose TRUNCATE / TRIGGER / REFERENCES on public tables
--      (never needed; row-level security doesn't cover TRUNCATE).
--
-- Prerequisites: 0002.
-- Old-client effect (≤ 1.5.2):
--   * first-time password setup works only within 30 min of registering
--     (otherwise: "couldn't set password"; the user needs v1.6.0 or the owner);
--   * 10 wrong passwords lock that username for 15 min ("incorrect password");
--   * admins reply to / delete suggestions with their normal login password (this
--     also fixes those actions for admins whose legacy password differed);
--   * only super-admins can remove admins.
--
-- Verify:
--   select public.get_backend_info();                 -- schema_version 3
--   select count(*) from private.auth_attempts;       -- table exists
--   -- In the app: log out and back in; reply to or delete a test suggestion.
--   -- Hash upgrade: after you log in, this shows your hash starts with $2a$12$:
--   select username, left(password_hash, 7) from private.account_secrets order by 1;
--
-- Rollback: rollback_20260925000300.sql
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Attempt tracking + the single password check everything uses
-- ---------------------------------------------------------------------------
create table if not exists private.auth_attempts (
  username     text primary key,
  fails        integer not null default 0,
  lock_count   integer not null default 0,
  locked_until timestamptz,
  last_fail_at timestamptz
);
revoke all on table private.auth_attempts from public, anon, authenticated;

create or replace function private.check_password(p_username text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = private, public, extensions
as $$
declare
  v_key  text := lower(coalesce(p_username, ''));
  v_hash text;
  v_att  private.auth_attempts%rowtype;
  v_ok   boolean;
begin
  if p_username is null or p_password is null then
    return false;
  end if;

  select * into v_att from private.auth_attempts where username = v_key;
  if found and v_att.locked_until is not null and v_att.locked_until > now() then
    return false;
  end if;

  select password_hash into v_hash from private.account_secrets where username = p_username;
  v_ok := v_hash is not null and v_hash = crypt(p_password, v_hash);

  if v_ok then
    update private.auth_attempts set fails = 0, lock_count = 0, locked_until = null where username = v_key;
    -- Upgrade old, weaker hashes (bcrypt cost < 12) transparently.
    if v_hash like '$2_$%' and substring(v_hash from 5 for 2)::int < 12 then
      update private.account_secrets
         set password_hash = crypt(p_password, gen_salt('bf', 12)), updated_at = now()
       where username = p_username;
    end if;
    return true;
  end if;

  insert into private.auth_attempts as a (username, fails, last_fail_at)
  values (v_key, 1, now())
  on conflict (username) do update
    set fails = case when a.last_fail_at < now() - interval '24 hours' then 1 else a.fails + 1 end,
        last_fail_at = now();

  update private.auth_attempts
     set locked_until = now() + least(interval '15 minutes' * power(2, lock_count), interval '24 hours'),
         lock_count = lock_count + 1,
         fails = 0
   where username = v_key and fails >= 10;

  return false;
end;
$$;
revoke execute on function private.check_password(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Login checks
-- ---------------------------------------------------------------------------
create or replace function public.verify_login(input_username text, input_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return private.check_password(input_username, input_password);
end;
$$;

create or replace function public.verify_admin_login(input_username text, input_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (select 1 from public.admins where username = input_username) then
    return false;
  end if;
  return private.check_password(input_username, input_password);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. First-time password setup
-- ---------------------------------------------------------------------------
-- App ≤ 1.5.2: only right after registering.
create or replace function public.set_own_login_password(input_username text, new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_password is null or length(new_password) < 4 then
    return null;
  end if;
  if not exists (select 1 from public.usernames
                 where username = input_username
                   and created_at is not null
                   and created_at > now() - interval '30 minutes') then
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

-- App ≥ 1.6.0: only from the device that registered the name.
create or replace function public.set_own_login_password(input_username text, new_password text, input_device_id text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_password is null or length(new_password) < 4 or input_device_id is null then
    return null;
  end if;
  update private.account_secrets
     set password_hash = crypt(new_password, gen_salt('bf', 12)), updated_at = now()
   where username = input_username
     and password_hash is null
     and device_id is not null
     and device_id = input_device_id;
  if found then return true; end if;
  return null;
end;
$$;
revoke execute on function public.set_own_login_password(text, text, text) from public;
grant execute on function public.set_own_login_password(text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Reserved names + atomic registration
-- ---------------------------------------------------------------------------
create or replace function private.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_username, '')) ~ '(_adm|_root|_admin|_administrator)$';
$$;
revoke execute on function private.is_reserved_username(text) from public, anon, authenticated;

create or replace function private.reject_reserved_usernames()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    if new.username is null or new.username !~ '^[a-zA-Z0-9_]{3,20}$' then
      raise exception 'Usernames must be 3-20 letters, numbers or underscores.' using errcode = 'check_violation';
    end if;
    if private.is_reserved_username(new.username) then
      raise exception 'Usernames can''t end in _Adm, _Root or similar.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_reserved_usernames() from public, anon, authenticated;

drop trigger if exists usernames_reject_reserved on public.usernames;
create trigger usernames_reject_reserved
  before insert on public.usernames
  for each row execute function private.reject_reserved_usernames();

create or replace function public.register_account(input_username text, input_password text, input_device_id text, input_date_of_birth date)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if input_username is null or input_username !~ '^[a-zA-Z0-9_]{3,20}$' then
    return jsonb_build_object('success', false, 'error', 'Usernames must be 3-20 letters, numbers or underscores.');
  end if;
  if private.is_reserved_username(input_username) then
    return jsonb_build_object('success', false, 'error', 'Usernames can''t end in "_Adm", "_Root", or similar — those are reserved to prevent impersonating an admin.');
  end if;
  if input_password is null or length(input_password) < 8 then
    return jsonb_build_object('success', false, 'error', 'Password must be at least 8 characters.');
  end if;
  if input_device_id is null or length(input_device_id) < 8 then
    return jsonb_build_object('success', false, 'error', 'Missing device id.');
  end if;
  if exists (select 1 from public.usernames where lower(username) = lower(input_username)) then
    return jsonb_build_object('success', false, 'error', 'That username is already taken.');
  end if;

  insert into public.usernames (username, device_id, date_of_birth)
  values (input_username, input_device_id, input_date_of_birth);

  insert into private.account_secrets as s (username, device_id, password_hash)
  values (input_username, input_device_id, crypt(input_password, gen_salt('bf', 12)))
  on conflict (username) do update
    set device_id = coalesce(s.device_id, excluded.device_id),
        password_hash = excluded.password_hash,
        updated_at = now();

  return jsonb_build_object('success', true);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'That username is already taken.');
end;
$$;
revoke execute on function public.register_account(text, text, text, date) from public;
grant execute on function public.register_account(text, text, text, date) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin actions on suggestions use the normal login password
-- ---------------------------------------------------------------------------
create or replace function public.add_admin_reply(input_username text, input_password text, target_suggestion_id uuid, reply_text text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_admin_login(input_username, input_password) then
    return false;
  end if;
  insert into public.suggestion_replies (suggestion_id, reply_text) values (target_suggestion_id, reply_text);
  return true;
end;
$$;

create or replace function public.delete_reply(input_username text, input_password text, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_admin_login(input_username, input_password) then
    return false;
  end if;
  delete from public.suggestion_replies where id = target_id;
  return true;
end;
$$;

create or replace function public.delete_suggestion(input_username text, input_password text, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.verify_admin_login(input_username, input_password) then
    return false;
  end if;
  delete from public.suggestions where id = target_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Super-admin actions
-- ---------------------------------------------------------------------------
create or replace function public.super_remove_admin(super_username text, super_password text, target_username text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if target_username = 'Raidex_Adm' then
    return false;
  end if;
  if not exists (select 1 from public.admins where username = super_username and is_super_admin) then
    return false;
  end if;
  if not public.verify_admin_login(super_username, super_password) then
    return false;
  end if;
  delete from public.admins where username = target_username;
  return true;
end;
$$;

-- Flags the account for a reset instead of deleting its password (which used to
-- leave it claimable by anyone). Stays revoked from client roles until 0005 adds
-- the server-side reset email.
create or replace function public.super_trigger_password_reset(super_username text, super_password text, target_username text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_rows int;
begin
  if not exists (select 1 from public.admins where username = super_username and is_super_admin) then
    return false;
  end if;
  if not public.verify_admin_login(super_username, super_password) then
    return false;
  end if;
  update private.account_secrets set must_reset = true, updated_at = now() where username = target_username;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Table privileges client roles never need
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 3, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
