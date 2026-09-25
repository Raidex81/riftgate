-- =============================================================================
-- 0004 · profile_rpcs
-- -----------------------------------------------------------------------------
-- Purpose
--   Stop anyone from changing another person's date of birth (the adult/minor
--   gate) or mature-content setting, which until now needed only a username.
--   * set_own_date_of_birth(username, dob) — the version app ≤ 1.5.2 uses — now
--     only fills in a date of birth that is still missing (that is the only case
--     the app ever uses it for) and rejects impossible dates.
--   * set_own_date_of_birth(username, password, dob) — new, for app ≥ 1.6.0:
--     changing an existing date of birth requires the account password.
--   * set_own_mature_content_preference(username, value) — old version: turning
--     mature content ON is only accepted for accounts whose date of birth shows
--     they are 18+ (or admins); turning it OFF is always accepted.
--   * set_own_mature_content_preference(username, password, value) — new,
--     password-checked, same adult rule.
-- Prerequisites: 0003.
-- Old-client effect (≤ 1.5.2): none for normal use (DOB is only ever set once by
--   the app; the mature toggle is only shown to adults).
-- Verify:
--   select public.get_backend_info();   -- schema_version 4
-- Rollback: rollback_20260925000400.sql
-- =============================================================================
begin;

create or replace function private.is_adult_or_admin(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where username = p_username)
      or exists (select 1 from public.usernames
                 where username = p_username
                   and date_of_birth is not null
                   and date_of_birth <= (current_date - interval '18 years')::date);
$$;
revoke execute on function private.is_adult_or_admin(text) from public, anon, authenticated;

create or replace function public.set_own_date_of_birth(input_username text, new_dob date)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_dob is null or new_dob < date '1900-01-01' or new_dob > current_date then
    return null;
  end if;
  update public.usernames
     set date_of_birth = new_dob
   where username = input_username and date_of_birth is null;
  if found then return true; end if;
  return null;
end;
$$;

create or replace function public.set_own_date_of_birth(input_username text, input_password text, new_dob date)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_dob is null or new_dob < date '1900-01-01' or new_dob > current_date then
    return null;
  end if;
  if not public.verify_login(input_username, input_password) then
    return null;
  end if;
  update public.usernames set date_of_birth = new_dob where username = input_username;
  if found then return true; end if;
  return null;
end;
$$;
revoke execute on function public.set_own_date_of_birth(text, text, date) from public;
grant execute on function public.set_own_date_of_birth(text, text, date) to anon, authenticated, service_role;

create or replace function public.set_own_mature_content_preference(input_username text, new_value boolean)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_value is null then
    return null;
  end if;
  if new_value and not private.is_adult_or_admin(input_username) then
    return null;
  end if;
  update public.usernames set show_mature_content = new_value where username = input_username;
  if found then return true; end if;
  return null;
end;
$$;

create or replace function public.set_own_mature_content_preference(input_username text, input_password text, new_value boolean)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_value is null or not public.verify_login(input_username, input_password) then
    return null;
  end if;
  if new_value and not private.is_adult_or_admin(input_username) then
    return null;
  end if;
  update public.usernames set show_mature_content = new_value where username = input_username;
  if found then return true; end if;
  return null;
end;
$$;
revoke execute on function public.set_own_mature_content_preference(text, text, boolean) from public;
grant execute on function public.set_own_mature_content_preference(text, text, boolean) to anon, authenticated, service_role;

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 4, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
