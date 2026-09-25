-- Rollback for 0006 · account_email_server_side.
begin;
revoke execute on function public.confirm_password_reset(text, text, text) from public, anon, authenticated;
drop function if exists public.issue_password_reset(text);
drop function if exists public.issue_email_verification(text, text, text);
drop function if exists private.random_reset_code();
create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 5, 'min_client_version', '1.5.2');
$$;
commit;
notify pgrst, 'reload schema';
