-- Rollback for 0007 · vault_function.
-- Restores the app's direct access to the old Vault RPCs (as they were before 0007).
-- The bucket stays private and keeps its 50 MB limit (harmless either way).
begin;
drop function if exists public.vault_record_upload(text, text, text, text, text, integer);
drop function if exists public.force_clean_shared_folder(text, text);
drop function if exists public.vault_orphan_paths();
grant execute on function public.delete_shared_file(text, bigint, text, text) to anon, authenticated;
grant execute on function public.cleanup_expired_shared_files(text, text) to anon, authenticated;
do $$
begin
  if to_regprocedure('public.add_shared_file(text,text,text,bigint,text,integer,text)') is not null then
    execute 'grant execute on function public.add_shared_file(text,text,text,bigint,text,integer,text) to anon, authenticated';
  end if;
  if to_regprocedure('public.add_shared_file(text,text,text,bigint,text,text)') is not null then
    execute 'grant execute on function public.add_shared_file(text,text,text,bigint,text,text) to anon, authenticated';
  end if;
end $$;
create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 6, 'min_client_version', '1.5.2');
$$;
commit;
notify pgrst, 'reload schema';
