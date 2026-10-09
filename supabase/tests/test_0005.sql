\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== sessions'
-- give frank a cost-6 hash to exercise rehash-without-logout
update private.account_secrets set password_hash = extensions.crypt('frankpw', extensions.gen_salt('bf', 6)) where username='frank';
begin; set local role anon;
select (create_login_session('frank','wrong'))->>'success' wrong_pw;
commit;
begin; set local role anon;
create temp table t1 as select (create_login_session('frank','frankpw'))->>'token' tok;
commit;
select count(*) sessions_after_first from private.login_sessions where username='frank';
begin; set local role anon;
create temp table t2 as select (create_login_session('frank','frankpw'))->>'token' tok;  -- hash now cost 12; rehash already done
select redeem_login_session('frank', (select tok from t1)) first_token_still_valid,
       redeem_login_session('frank', (select tok from t2)) second_valid,
       redeem_login_session('frank', 'garbage') garbage,
       redeem_login_session('bob', (select tok from t2)) wrong_user;
commit;
select left(password_hash,7) frank_hash from private.account_secrets where username='frank';
\echo '== revoke'
begin; set local role anon;
select revoke_login_session('frank', (select tok from t1)) revoked, redeem_login_session('frank', (select tok from t1)) after_revoke;
commit;
\echo '== real password change drops sessions; must_reset refuses'
update private.account_secrets set password_hash = extensions.crypt('newfrank1', extensions.gen_salt('bf', 12)) where username='frank';
select redeem_login_session('frank', (select tok from t2)) after_pw_change;
select (create_login_session('frank','newfrank1'))->>'token' is not null new_session;
update private.account_secrets set must_reset = true where username='frank';
select count(*) > 0 has_sessions, bool_or(true) from private.login_sessions where username='frank';
create temp table t3 as select tok from (select (create_login_session('frank','newfrank1'))->>'token' tok) x;
select redeem_login_session('frank', (select tok from t3)) must_reset_refused;
update private.account_secrets set must_reset = false where username='frank';
\echo '== cap 10'
select count(*) from (select create_login_session('frank','newfrank1') from generate_series(1,15)) x;
select count(*) sessions_capped from private.login_sessions where username='frank';
select has_table_privilege('anon','private.login_sessions','select') anon_can_read, get_backend_info();
\echo '== automatic hash upgrade does not sign sessions out'
create temp table s as select (create_login_session('gina','ginapass1'))->>'token' tok;
select set_config('riftgate.rehash','1',false);
update private.account_secrets set password_hash = extensions.crypt('ginapass1', extensions.gen_salt('bf', 6)) where username='gina';
select set_config('riftgate.rehash','',false);
select verify_login('gina','ginapass1') login_rehashes;
select left(password_hash,7) gina_hash_after from private.account_secrets where username='gina';
select redeem_login_session('gina',(select tok from s)) session_survives_rehash;
