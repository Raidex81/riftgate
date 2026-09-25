\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== 1. public table holds no secrets'
select count(*) filter (where password_hash is not null) hashes, count(*) filter (where email is not null) emails,
       count(*) filter (where device_id is not null) devs,
       count(*) filter (where email_verification_token is not null or password_reset_token is not null) tokens
from public.usernames;
\echo '== 2. private rows backfilled'
select username, password_hash is not null has_pw, email, email_verified, email_verification_token_hash is not null has_evt,
       reset_code_hash is not null has_reset, device_id from private.account_secrets order by 1;

\echo '== 3. shipped-client registration as anon: POST return=representation'
begin; set local role anon;
insert into public.usernames (username, device_id, date_of_birth) values ('dave', 'dev-dave', '2000-01-01') returning *;
commit;
select username, device_id from private.account_secrets where username = 'dave';

\echo '== 4. anon tries to smuggle a hash/email on insert — must be dropped'
begin; set local role anon;
insert into public.usernames (username, device_id, password_hash, email, email_verified)
values ('eve', 'dev-eve', extensions.crypt('x', extensions.gen_salt('bf')), 'victim@example.com', true) returning username, password_hash, email;
commit;
select username, password_hash is null pw_dropped, email is null email_dropped, email_verified from private.account_secrets where username = 'eve';

\echo '== 5. duplicate username registration fails and does NOT overwrite the existing device id'
do $$ begin
  begin
    execute 'set local role anon';
    insert into public.usernames (username, device_id) values ('alice', 'attacker-dev');
    raise exception 'duplicate insert unexpectedly succeeded';
  exception when unique_violation then null;
  end;
end $$;
reset role;
select device_id from private.account_secrets where username = 'alice';

\echo '== 6. anon cannot read private'
begin; set local role anon;
do $$ begin
  perform 1 from private.account_secrets limit 1;
  raise exception 'anon read private!';
exception when insufficient_privilege then raise notice 'OK: permission denied for anon';
end $$;
commit;
select * from (select 1) x where false;
reset role;

\echo '== 7. anon SELECT * shows only nulls'
begin; set local role anon;
select username, password_hash, email, device_id, email_verification_token, password_reset_token from public.usernames order by 1;
commit;

\echo '== 8. login functions (as anon, via RPC)'
begin; set local role anon;
select verify_login('alice','alicepw') ok_alice, verify_login('alice','wrong') bad_alice, verify_login('carol','x') nopw_carol,
       verify_admin_login('alice','alicepw') admin_alice, verify_admin_login('bob','bobpw') admin_bob,
       check_share_access('bob','bobpw') share_bob, check_share_access('bob', null) share_nullpw, check_share_access('carol','x') share_carol,
       login_needs_password_setup('carol') carol_needs, login_needs_password_setup('dave') dave_needs, login_needs_password_setup('alice') alice_needs;
commit;

\echo '== 9. first-time password setup (dave) then login; second set attempt refused'
begin; set local role anon;
select set_own_login_password('dave','davepw') first_set, verify_login('dave','davepw') dave_login,
       set_own_login_password('dave','hijack') second_set, verify_login('dave','hijack') hijack_login,
       set_own_login_password('nobody','x') unknown_user;
commit;
select substr(password_hash,1,7) cost_prefix from private.account_secrets where username='dave';

\echo '== 10. email verification round-trip + pending bob token from before migration'
begin; set local role anon;
select confirm_email_verification('tok-bob') bob_old_token;
select get_own_email_status('bob','bobpw') bob_status;
commit;
begin; set local role anon;
select request_email_verification('carol','x','c@example.com') carol_no_pw;
select (request_email_verification('dave','davepw','Dave@Example.com')->>'success') dave_req;
commit;
begin; set local role anon;
select request_email_verification('bob','bobpw','ALICE@example.com') dup_email_rejected;
commit;

\echo '== 11. reset code migrated from plain to hash; confirm works for service role only'
select has_function_privilege('anon','public.confirm_password_reset(text,text,text)','execute') anon_can_confirm;
select confirm_password_reset('alice','wrongcode','newpassword1') wrong_code;
select confirm_password_reset('alice','abcd2345','newpassword1') right_code_lower;
select verify_login('alice','newpassword1') alice_new_pw, verify_login('alice','alicepw') alice_old_pw;

\echo '== 12. owner edit of password_hash in SQL editor lands in private'
update public.usernames set password_hash = extensions.crypt('ownerset', extensions.gen_salt('bf',12)) where username = 'carol';
select password_hash from public.usernames where username='carol';
select verify_login('carol','ownerset') carol_login_after_owner_set;

\echo '== 13. storage policies gone, backend info'
select count(*) vault_policies from pg_policies where schemaname='storage';
select get_backend_info();

\echo '== 14. idempotency: re-run 0002 must not wipe anything'
