-- Rollback for 0003 · auth_hardening. Returns login checks to their 0002 behaviour
-- (no lockout), removes register_account and the device-bound password setup, and
-- restores the previous admin-reply/delete checks. Hashes already upgraded to cost 12
-- keep working. Use only if 0003 broke login.
begin;

drop trigger if exists usernames_reject_reserved on public.usernames;
drop function if exists public.register_account(text, text, text, date);
drop function if exists public.set_own_login_password(text, text, text);

create or replace function public.verify_login(input_username text, input_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  return exists (select 1 from private.account_secrets s where s.username = input_username
    and s.password_hash is not null and s.password_hash = crypt(input_password, s.password_hash));
end; $$;

create or replace function public.verify_admin_login(input_username text, input_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  return exists (select 1 from public.admins ad join private.account_secrets s on s.username = ad.username
    where ad.username = input_username and s.password_hash is not null
      and s.password_hash = crypt(input_password, s.password_hash));
end; $$;

create or replace function public.set_own_login_password(input_username text, new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.usernames where username = input_username) then return null; end if;
  insert into private.account_secrets (username) values (input_username) on conflict (username) do nothing;
  update private.account_secrets set password_hash = crypt(new_password, gen_salt('bf', 12)), updated_at = now()
   where username = input_username and password_hash is null;
  if found then return true; end if;
  return null;
end; $$;

create or replace function public.super_remove_admin(super_username text, super_password text, target_username text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if target_username = 'Raidex_Adm' then return false; end if;
  if not public.verify_admin_login(super_username, super_password) then return false; end if;
  delete from public.admins where username = target_username;
  return true;
end; $$;

-- add_admin_reply / delete_reply / delete_suggestion are intentionally left on
-- verify_admin_login (the pre-0003 legacy check was broken for most admins).

create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 2, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
