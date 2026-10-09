\set ON_ERROR_STOP on
set search_path = public, extensions;
\echo '== 0006'
select has_function_privilege('anon','public.issue_password_reset(text)','execute') anon_issue,
       has_function_privilege('anon','public.issue_email_verification(text,text,text)','execute') anon_issue_email,
       has_function_privilege('anon','public.confirm_password_reset(text,text,text)','execute') anon_confirm,
       has_function_privilege('service_role','public.issue_password_reset(text)','execute') service_issue;
update private.account_secrets set email='bob@example.com', email_verified=true, reset_sent_at=null where username='bob';
begin; set local role service_role;
create temp table r as select issue_password_reset('bob') j;
select (j->>'send') send, j->>'email' email, length(j->>'code') code_len from r;
select j->>'code' as reset_code from r \gset
select issue_password_reset('bob')->>'send' throttled_second_call, issue_password_reset('carol')->>'send' no_email_account;
commit;
select (select count(*) from generate_series(1,500) where length(private.random_reset_code()) = 8) codes_all_len8;
begin; set local role anon;
select confirm_password_reset('bob', lower(:'reset_code'), 'brandnewpw1')->>'success' confirm_ok;
select verify_login('bob','brandnewpw1') bob_new_login;
commit;
update private.account_secrets set email_verification_sent_at = null where username='dave';
begin; set local role service_role;
select issue_email_verification('dave','davepw','dave2@example.com')->>'success' verify_issue_ok,
       issue_email_verification('dave','wrong','x@example.com')->>'error' wrong_pw;
commit;
select get_backend_info();
