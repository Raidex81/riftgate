-- =============================================================================
-- 0005 · login_sessions
-- -----------------------------------------------------------------------------
-- Purpose
--   Let the app stay logged in between launches WITHOUT keeping the user's
--   password on disk. On login the app exchanges the password for a random
--   session token (only its SHA-256 hash is stored here) and saves just that
--   token. On the next launch it redeems the token instead of a password.
--   * create_login_session(username, password) -> {success, token, expires_at}
--   * redeem_login_session(username, token)    -> boolean (slides expiry 30 days)
--   * revoke_login_session(username, token)    -> boolean (used on Log Out)
--   Sessions are refused while an account is flagged must_reset, removed when
--   a password reset completes, and capped at 10 per account.
-- Prerequisites: 0003 (private.check_password).
-- Old-client effect (≤ 1.5.2): none (they keep using their saved password;
--   app ≥ 1.6.0 converts that file to a token on first launch).
-- Verify:
--   select public.get_backend_info();        -- schema_version 5
--   select count(*) from private.login_sessions;
-- Rollback: rollback_20260925000500.sql
-- =============================================================================
begin;

create table if not exists private.login_sessions (
  id           bigserial primary key,
  username     text not null references public.usernames (username) on update cascade on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists login_sessions_username_idx on private.login_sessions (username);
revoke all on table private.login_sessions from public, anon, authenticated;
revoke all on sequence private.login_sessions_id_seq from public, anon, authenticated;

create or replace function public.create_login_session(input_username text, input_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token   text;
  v_expires timestamptz := now() + interval '30 days';
begin
  if not private.check_password(input_username, input_password) then
    return jsonb_build_object('success', false, 'error', 'Incorrect password.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into private.login_sessions (username, token_hash, expires_at)
  values (input_username, private.token_hash(v_token), v_expires);

  -- Keep at most 10 sessions per account (oldest go first) and drop expired ones.
  delete from private.login_sessions
   where username = input_username
     and (expires_at < now()
          or id not in (select id from private.login_sessions
                         where username = input_username
                         order by last_used_at desc limit 10));

  return jsonb_build_object('success', true, 'token', v_token, 'expires_at', v_expires);
end;
$$;
revoke execute on function public.create_login_session(text, text) from public;
grant execute on function public.create_login_session(text, text) to anon, authenticated, service_role;

create or replace function public.redeem_login_session(input_username text, input_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id bigint;
begin
  if input_username is null or input_token is null then
    return false;
  end if;

  select ls.id into v_id
  from private.login_sessions ls
  join private.account_secrets s on s.username = ls.username
  where ls.username = input_username
    and ls.token_hash = private.token_hash(input_token)
    and ls.expires_at > now()
    and s.password_hash is not null
    and not s.must_reset;

  if v_id is null then
    return false;
  end if;

  update private.login_sessions
     set last_used_at = now(), expires_at = now() + interval '30 days'
   where id = v_id;
  return true;
end;
$$;
revoke execute on function public.redeem_login_session(text, text) from public;
grant execute on function public.redeem_login_session(text, text) to anon, authenticated, service_role;

create or replace function public.revoke_login_session(input_username text, input_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from private.login_sessions
   where username = input_username and token_hash = private.token_hash(input_token);
  return found;
end;
$$;
revoke execute on function public.revoke_login_session(text, text) from public;
grant execute on function public.revoke_login_session(text, text) to anon, authenticated, service_role;

-- Same as 0003's version, except the automatic hash upgrade marks itself so the
-- trigger below can tell it apart from a real password change.
create or replace function private.check_password(p_username text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = private, public, extensions
as $f$
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
    if v_hash like '$2_$%' and substring(v_hash from 5 for 2)::int < 12 then
      perform set_config('riftgate.rehash', '1', true);
      update private.account_secrets
         set password_hash = crypt(p_password, gen_salt('bf', 12)), updated_at = now()
       where username = p_username;
      perform set_config('riftgate.rehash', '', true);
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
$f$;
revoke execute on function private.check_password(text, text) from public, anon, authenticated;

-- A real password change (e.g. a completed reset) signs out every session for
-- that account; the automatic hash upgrade above does not.
create or replace function private.drop_sessions_on_password_change()
returns trigger
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if coalesce(current_setting('riftgate.rehash', true), '') = '1' then
    return new;
  end if;
  if new.password_hash is distinct from old.password_hash and old.password_hash is not null then
    delete from private.login_sessions where username = new.username;
  end if;
  return new;
end;
$$;
revoke execute on function private.drop_sessions_on_password_change() from public, anon, authenticated;

drop trigger if exists account_secrets_drop_sessions on private.account_secrets;
create trigger account_secrets_drop_sessions
  after update of password_hash on private.account_secrets
  for each row execute function private.drop_sessions_on_password_change();

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 5, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
