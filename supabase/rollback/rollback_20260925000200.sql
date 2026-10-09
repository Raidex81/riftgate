-- Rollback for 0002 · private_account_secrets. Only use if 0002 broke login/registration.
-- Restores secrets onto public.usernames and the pre-0002 function bodies (as exported
-- from production on 2026-09-25). Pending email-verification links and reset codes are
-- lost (they were stored hashed) and must be requested again.
-- NOTE: this re-exposes the secret columns to the public API. Only use as a last resort.
begin;

drop trigger if exists usernames_capture_secrets on public.usernames;

update public.usernames u
set password_hash = s.password_hash,
    email = s.email,
    email_verified = s.email_verified,
    device_id = coalesce(s.device_id, 'unknown'),
    password_reset_attempts = s.reset_attempts
from private.account_secrets s
where s.username = u.username;
update public.usernames set device_id = 'unknown' where device_id is null;
alter table public.usernames alter column device_id set not null;

create or replace function public.verify_login(input_username text, input_password text)
returns boolean language sql security definer set search_path to 'public', 'extensions' as $$
  select exists (select 1 from public.usernames where username = input_username
    and password_hash is not null and password_hash = crypt(input_password, password_hash));
$$;

create or replace function public.verify_admin_login(input_username text, input_password text)
returns boolean language sql security definer set search_path to 'public', 'extensions' as $$
  select exists (select 1 from public.admins ad join public.usernames u on u.username = ad.username
    where ad.username = input_username and u.password_hash is not null
      and u.password_hash = crypt(input_password, u.password_hash));
$$;

create or replace function public.check_share_access(p_username text, p_password text default null::text)
returns boolean language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_authenticated boolean;
begin
  select exists (select 1 from usernames where username = p_username and password_hash is not null
    and p_password is not null and password_hash = crypt(p_password, password_hash)) into v_authenticated;
  if not v_authenticated then return false; end if;
  return exists (select 1 from admins where username = p_username)
      or exists (select 1 from share_allowlist where username = p_username);
end;
$$;

create or replace function public.login_needs_password_setup(input_username text)
returns boolean language sql security definer set search_path to 'public', 'extensions' as $$
  select exists (select 1 from public.usernames where username = input_username and password_hash is null);
$$;

create or replace function public.set_own_login_password(input_username text, new_password text)
returns boolean language sql security definer set search_path to 'public', 'extensions' as $$
  update public.usernames set password_hash = crypt(new_password, gen_salt('bf'))
  where username = input_username and password_hash is null returning true;
$$;

create or replace function public.get_own_email_status(input_username text, input_password text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_verified boolean; v_row record;
begin
  select verify_login(input_username, input_password) into v_verified;
  if not v_verified then return jsonb_build_object('success', false, 'error', 'Not authorized.'); end if;
  select email, email_verified, email_verification_sent_at into v_row from usernames where username = input_username;
  return jsonb_build_object('success', true, 'email', v_row.email, 'verified', v_row.email_verified, 'sentAt', v_row.email_verification_sent_at);
end;
$$;

create or replace function public.request_email_verification(input_username text, input_password text, input_new_email text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_verified boolean; v_email text; v_last_sent timestamptz; v_token text;
begin
  select verify_login(input_username, input_password) into v_verified;
  if not v_verified then return jsonb_build_object('success', false, 'error', 'Not authorized.'); end if;
  select email, email_verification_sent_at into v_email, v_last_sent from usernames where username = input_username;
  v_email := coalesce(nullif(trim(input_new_email), ''), v_email);
  if v_email is null then return jsonb_build_object('success', false, 'error', 'No email address to send to.'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('success', false, 'error', 'That doesn''t look like a valid email address.');
  end if;
  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    return jsonb_build_object('success', false, 'error', 'Please wait a moment before requesting another email.');
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  begin
    update usernames set email = v_email, email_verified = false, email_verification_token = v_token,
      email_verification_expires_at = now() + interval '24 hours', email_verification_sent_at = now()
    where username = input_username;
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'That email is already associated with another Riftgate account.');
  end;
  return jsonb_build_object('success', true, 'email', v_email, 'token', v_token);
end;
$$;

create or replace function public.confirm_email_verification(input_token text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_username text;
begin
  select username into v_username from usernames where email_verification_token = input_token
    and email_verification_expires_at is not null and email_verification_expires_at > now();
  if v_username is null then
    return jsonb_build_object('success', false, 'error', 'This verification link is invalid or has expired.');
  end if;
  update usernames set email_verified = true, email_verification_token = null, email_verification_expires_at = null
  where username = v_username;
  return jsonb_build_object('success', true, 'username', v_username);
end;
$$;

-- request_password_reset / confirm_password_reset / super_trigger_password_reset stay revoked;
-- they are not restored (the pre-0002 versions are the vulnerable ones).
create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 1, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
