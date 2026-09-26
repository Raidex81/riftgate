\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== 0008'
select pg_get_functiondef('public.force_clean_shared_links(text,text)'::regprocedure) ~* 'where true' links_patched,
       pg_get_functiondef('public.force_clean_shared_folder(text,text)'::regprocedure) ~* 'where true' files_patched,
       has_function_privilege('anon','public.force_clean_shared_folder(text,text)','execute') anon_force_files;
insert into shared_files (filename, storage_path, uploader_username) values ('a','p','bob');
insert into shared_links (url, poster_username) values ('https://example.com','bob');
begin; set local role service_role;
select count(*) files_cleaned from force_clean_shared_folder('alice','newpassword1');
commit;
select count(*) links_cleaned from force_clean_shared_links('alice','newpassword1');
