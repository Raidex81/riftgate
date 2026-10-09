-- =============================================================================
-- 0008 · vault_clean_fix
-- -----------------------------------------------------------------------------
-- Purpose
--   "Clean Vault now" failed with "DELETE requires a WHERE clause": Supabase's
--   safe-update guard refuses a DELETE with no WHERE when it runs through the
--   API. Both clean-up functions now say "where true" explicitly.
--   * force_clean_shared_folder (from 0007) is redefined.
--   * force_clean_shared_links (older, same problem) is patched in place from
--     its current definition, so its parameters and grants stay as they are.
-- Prerequisites: 0007.
-- Verify:
--   select pg_get_functiondef('public.force_clean_shared_links(text,text)'::regprocedure) ~* 'where true';  -- true
-- Rollback: not needed (behaviour is identical apart from no longer failing).
-- =============================================================================
begin;

create or replace function public.force_clean_shared_folder(p_admin_username text, p_admin_password text)
returns setof public.shared_files
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_admin_password is null or not public.verify_admin_login(p_admin_username, p_admin_password) then
    raise exception 'Not authorized';
  end if;
  return query delete from public.shared_files where true returning *;
end;
$$;

do $$
declare
  v_def text;
begin
  if to_regprocedure('public.force_clean_shared_links(text,text)') is not null then
    v_def := pg_get_functiondef('public.force_clean_shared_links(text,text)'::regprocedure);
    if v_def ~* 'delete\s+from\s+(public\.)?shared_links\s+returning' then
      v_def := regexp_replace(v_def, '(delete\s+from\s+(public\.)?shared_links)\s+(returning)', '\1 WHERE true \3', 'gi');
      execute v_def;
    end if;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
