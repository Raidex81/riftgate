-- Rollback for 0005 · login_sessions. App ≥ 1.6.0 then falls back to asking for the
-- password at launch (it never stores the password again once it has used tokens).
begin;
drop trigger if exists account_secrets_drop_sessions on private.account_secrets;
drop function if exists private.drop_sessions_on_password_change();
drop function if exists public.create_login_session(text, text);
drop function if exists public.redeem_login_session(text, text);
drop function if exists public.revoke_login_session(text, text);
drop table if exists private.login_sessions;
-- private.check_password keeps the 0005 body (identical behaviour to 0003 apart from a
-- harmless marker used during hash upgrades).
create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 4, 'min_client_version', '1.5.2');
$$;
commit;
notify pgrst, 'reload schema';
