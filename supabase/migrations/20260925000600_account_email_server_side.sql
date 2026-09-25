-- =============================================================================
-- 0006 · account_email_server_side
-- -----------------------------------------------------------------------------
-- Purpose
--   Bring back "Forgot password?" safely, and stop sending email tokens to the
--   app. Both emails are now produced and sent entirely server-side by the new
--   Edge Function `account-email`, which calls these two functions with the
--   service-role key (client roles cannot call them):
--   * issue_password_reset(username)  -> {send, email, code}
--   * issue_email_verification(username, password, email) -> {success, email, token}
--   The reset code stays hashed in the database; the app only ever sees
--   "if that account has a verified email, a code is on its way".
--   confirm_password_reset (code + new password) is opened to the app again —
--   the code is 8 random characters, single-use, valid 30 min, 5 tries max.
--   Also fixes a small bug in the old code generator (the alphabet has 31
--   letters but was indexed as if it had 32, so codes were sometimes short).
-- Prerequisites: 0002 (private.account_secrets), 0005.
-- Old-client effect (≤ 1.5.2): "Forgot password?" still fails there (the old
--   request function stays disabled); email verification keeps working as before.
-- Verify:
--   select public.get_backend_info();   -- schema_version 6
--   select has_function_privilege('anon','public.issue_password_reset(text)','execute');  -- false
--   select has_function_privilege('anon','public.confirm_password_reset(text,text,text)','execute'); -- true
-- Rollback: rollback_20260925000600.sql
-- =============================================================================
begin;

create or replace function private.random_reset_code()
returns text
language plpgsql
volatile
set search_path = extensions
as $$
declare
  v_alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
  i int;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end;
$$;
revoke execute on function private.random_reset_code() from public, anon, authenticated;

create or replace function public.issue_password_reset(input_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text; v_verified boolean; v_last_sent timestamptz; v_code text;
begin
  select email, email_verified, reset_sent_at into v_email, v_verified, v_last_sent
  from private.account_secrets where username = input_username;

  if not found or v_email is null or v_verified is not true then
    return jsonb_build_object('send', false);
  end if;
  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    return jsonb_build_object('send', false);
  end if;

  v_code := private.random_reset_code();
  update private.account_secrets
     set reset_code_hash = private.token_hash(v_code),
         reset_expires_at = now() + interval '30 minutes',
         reset_sent_at = now(),
         reset_attempts = 0,
         updated_at = now()
   where username = input_username;

  return jsonb_build_object('send', true, 'email', v_email, 'code', v_code);
end;
$$;
revoke execute on function public.issue_password_reset(text) from public, anon, authenticated;
grant execute on function public.issue_password_reset(text) to service_role;

create or replace function public.issue_email_verification(input_username text, input_password text, input_new_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  -- Same checks and storage as request_email_verification (password,
  -- format, 60 s throttle, one account per email); only the caller differs.
  return public.request_email_verification(input_username, input_password, input_new_email);
end;
$$;
revoke execute on function public.issue_email_verification(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_email_verification(text, text, text) to service_role;

grant execute on function public.confirm_password_reset(text, text, text) to anon, authenticated, service_role;

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 6, 'min_client_version', '1.5.2');
$$;

commit;
notify pgrst, 'reload schema';
