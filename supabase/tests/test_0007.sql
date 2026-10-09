\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== 0007'
select has_function_privilege('anon','public.vault_record_upload(text,text,text,text,text,integer)','execute') anon_record,
       has_function_privilege('anon','public.delete_shared_file(text,bigint,text,text)','execute') anon_delete,
       has_function_privilege('anon','public.cleanup_expired_shared_files(text,text)','execute') anon_cleanup,
       has_function_privilege('anon','public.add_shared_file(text,text,text,bigint,text,integer,text)','execute') anon_add,
       has_function_privilege('anon','public.force_clean_shared_folder(text,text)','execute') anon_force,
       has_function_privilege('anon','public.vault_orphan_paths()','execute') anon_orphans,
       has_function_privilege('service_role','public.vault_record_upload(text,text,text,text,text,integer)','execute') svc_record,
       (select public from storage.buckets where id='riftgate-shares') bucket_public,
       (select file_size_limit from storage.buckets where id='riftgate-shares') bucket_limit;
-- fake objects: one real upload, one too big, one old orphan
insert into storage.objects (bucket_id, name, metadata, created_at) values
  ('riftgate-shares', '11111111-2222-3333-4444-555555555555-notes.txt', '{"size": 1234}', now()),
  ('riftgate-shares', '11111111-2222-3333-4444-666666666666-big.bin', '{"size": 60000000}', now()),
  ('riftgate-shares', '11111111-2222-3333-4444-777777777777-orphan.zip', '{"size": 10}', now() - interval '2 hours');
begin; set local role service_role;
select (vault_record_upload('bob','brandnewpw1','notes.txt','11111111-2222-3333-4444-555555555555-notes.txt','hi',4)).file_size recorded_size;
commit;
\set ON_ERROR_STOP off
begin; set local role service_role;
select vault_record_upload('bob','wrong','x','11111111-2222-3333-4444-555555555555-notes.txt',null,4);  -- expect Not authorized
rollback;
begin; set local role service_role;
select vault_record_upload('bob','brandnewpw1','x','11111111-2222-3333-4444-555555555555-notes.txt',null,4);  -- expect already recorded
rollback;
begin; set local role service_role;
select vault_record_upload('bob','brandnewpw1','big','11111111-2222-3333-4444-666666666666-big.bin',null,4);  -- expect larger than 50 MB
rollback;
begin; set local role service_role;
select vault_record_upload('bob','brandnewpw1','x','../../etc/passwd',null,4);  -- expect Invalid storage path
rollback;
begin; set local role service_role;
select vault_record_upload('bob','brandnewpw1','x','11111111-2222-3333-4444-888888888888-missing.txt',null,4);  -- expect Upload not found
rollback;
begin; set local role service_role;
select vault_record_upload('dave','davepw','x','11111111-2222-3333-4444-666666666666-big.bin',null,4);  -- dave not allowlisted: Not authorized
rollback;
begin; set local role anon;
select delete_shared_file('bob', 1, null, 'brandnewpw1');  -- expect permission denied
rollback;
begin; set local role service_role;
select force_clean_shared_folder('dave','davepw');  -- dave not admin: Not authorized
rollback;
\set ON_ERROR_STOP on
begin; set local role service_role;
select array_agg(p) orphans from vault_orphan_paths() p;
select delete_shared_file('bob', (select id from shared_files limit 1), null, 'wrong') wrong_pw_delete;
select delete_shared_file('bob', (select id from shared_files limit 1), null, 'brandnewpw1') owner_delete;
commit;
select count(*) rows_left from shared_files;
select get_backend_info();
