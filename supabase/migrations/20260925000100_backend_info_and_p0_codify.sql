-- =============================================================================
-- 0001 · backend_info_and_p0_codify
-- -----------------------------------------------------------------------------
-- Purpose
--   1. Record, as a versioned migration, the emergency permission changes the
--      owner applied by hand on 2026-09-25 (so a rebuilt database gets them too).
--   2. Add get_backend_info(), which newer app versions call at startup to find
--      out which server-side features exist (feature detection).
-- Prerequisites: none. Safe to run more than once.
-- Old-client effect (≤ 1.5.2): none beyond what is already live since 2026-09-25
--   ("Forgot password?" unavailable; Vault file transfer unavailable).
-- Verify (all should return false / 0 rows):
--   select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute')
--   from pg_proc p where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('request_password_reset','confirm_password_reset','super_trigger_password_reset',
--       'add_admin','remove_admin','set_admin_password','verify_admin_password','admin_password_is_default',
--       'set_own_admin_password','admin_needs_password_setup','set_own_vault_password',
--       'vault_needs_password_setup','verify_vault_login');
--   select public.get_backend_info();   -- {"schema_version": 1, ...}
-- Rollback: `drop function public.get_backend_info();` (do NOT re-grant the functions).
-- =============================================================================
begin;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'request_password_reset', 'confirm_password_reset', 'super_trigger_password_reset',
        'add_admin', 'remove_admin', 'set_admin_password', 'verify_admin_password',
        'admin_password_is_default', 'set_own_admin_password', 'admin_needs_password_setup',
        'set_own_vault_password', 'vault_needs_password_setup', 'verify_vault_login')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Vault storage: no client role may touch the bucket directly (the old policies
-- were dropped by hand; this makes it hold for a rebuilt database too).
drop policy if exists "riftgate-shares anon select" on storage.objects;
drop policy if exists "riftgate_shares_upload_only" on storage.objects;

create or replace function public.get_backend_info()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object('schema_version', 1, 'min_client_version', '1.5.2');
$$;
revoke execute on function public.get_backend_info() from public;
grant execute on function public.get_backend_info() to anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
