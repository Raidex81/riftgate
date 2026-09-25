\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== A. login + hash upgrade (bob had cost 6)'
select left(password_hash,7) before from private.account_secrets where username='bob';
begin; set local role anon; select verify_login('bob','bobpw') bob_ok; commit;
select left(password_hash,7) after from private.account_secrets where username='bob';
begin; set local role anon; select verify_login('bob','bobpw') bob_ok_after_rehash; commit;

\echo '== B. lockout after 10 wrong'
begin; set local role anon;
select count(*) filter (where not verify_login('bob','wrong' || g)) wrong_attempts from generate_series(1,10) g;
select verify_login('bob','bobpw') correct_pw_while_locked;
commit;
select fails, lock_count, locked_until > now() locked from private.auth_attempts where username='bob';
update private.auth_attempts set locked_until = now() - interval '1 second' where username='bob';
begin; set local role anon; select verify_login('bob','bobpw') ok_after_lock_expired; commit;
select fails, lock_count, locked_until from private.auth_attempts where username='bob';

\echo '== C. claim protection: old account (carol backdated), 2-arg refused'
update public.usernames set created_at = now() - interval '10 days' where username = 'eve';
begin; set local role anon;
select set_own_login_password('eve','claimed1') old_client_claim_old_account;
select set_own_login_password('eve','claimed1','wrong-device') wrong_device;
select set_own_login_password('eve','mypass12','dev-eve') right_device, verify_login('eve','mypass12') eve_login;
commit;

\echo '== D. old-client fresh registration then 2-arg set within 30 min'
begin; set local role anon;
insert into public.usernames (username, device_id, date_of_birth) values ('frank', 'dev-frank', '1990-01-01') returning username, device_id;
commit;
begin; set local role anon; select set_own_login_password('frank','frankpw') fresh_set, verify_login('frank','frankpw') frank_login; commit;

\echo '== E. reserved / malformed names via API'
do $$ begin
  begin execute 'set local role anon'; insert into public.usernames (username, device_id) values ('Evil_Adm','d'); raise exception 'reserved allowed!';
  exception when check_violation then raise notice 'OK reserved rejected'; end;
  begin execute 'set local role anon'; insert into public.usernames (username, device_id) values ('bad name!','d'); raise exception 'malformed allowed!';
  exception when check_violation then raise notice 'OK malformed rejected'; end;
end $$;
reset role;

\echo '== F. register_account'
begin; set local role anon;
select register_account('gina','ginapass1','device-gina-123','1995-05-05') ok,
       register_account('gina','x12345678','device-other-1','1995-05-05') dup,
       register_account('Mallory_Root','x12345678','device-mal-1',null) reserved,
       register_account('hank','short','device-hank-1',null) shortpw;
select verify_login('gina','ginapass1') gina_login;
commit;
select username, device_id, left(password_hash,7) from private.account_secrets where username='gina';

\echo '== G. admin suggestion actions use the login password'
insert into public.suggestions (id, text) values ('00000000-0000-0000-0000-000000000001','s1');
update public.admins set password_hash = extensions.crypt('legacy', extensions.gen_salt('bf')) where username='alice';
begin; set local role anon;
select delete_suggestion('alice','legacy','00000000-0000-0000-0000-000000000001') legacy_pw_refused,
       delete_suggestion('alice','newpassword1','00000000-0000-0000-0000-000000000001') login_pw_works,
       delete_suggestion('bob','bobpw','00000000-0000-0000-0000-000000000001') non_admin_refused;
commit;

\echo '== H. super_remove_admin needs super'
insert into public.admins (username, is_super_admin) values ('bob', false), ('gina', false);
begin; set local role anon;
select super_remove_admin('bob','bobpw','gina') regular_admin_refused,
       super_remove_admin('alice','newpassword1','gina') super_ok;
commit;

\echo '== I. privileges + version'
select has_table_privilege('anon','public.usernames','truncate') anon_truncate, has_table_privilege('anon','public.usernames','select') anon_select;
select has_function_privilege('anon','public.super_trigger_password_reset(text,text,text)','execute') super_reset_anon;
select get_backend_info();
