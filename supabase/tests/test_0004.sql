\set ON_ERROR_STOP on
set search_path = public, extensions;
update public.usernames set date_of_birth = '2012-06-01' where username = 'dave';   -- minor
update public.usernames set date_of_birth = '1990-01-01' where username = 'bob';    -- adult
update public.usernames set date_of_birth = null where username = 'eve';
begin; set local role anon;
select set_own_date_of_birth('dave','1980-01-01') change_existing_dob_refused,
       set_own_date_of_birth('eve','1999-02-02') fill_missing_ok,
       set_own_date_of_birth('eve','2000-01-01') second_change_refused,
       set_own_date_of_birth('frank','3000-01-01') future_refused;
select set_own_date_of_birth('dave','wrong','1980-01-01') pw_wrong,
       set_own_date_of_birth('dave','davepw','2011-01-01') pw_ok_change;
select set_own_mature_content_preference('dave', true) minor_on_refused,
       set_own_mature_content_preference('dave', false) minor_off_ok,
       set_own_mature_content_preference('bob', true) adult_on_ok,
       set_own_mature_content_preference('alice', true) admin_on_ok,
       set_own_mature_content_preference('bob','wrong', false) pw_wrong_refused,
       set_own_mature_content_preference('bob','bobpw', false) pw_ok;
commit;
select username, date_of_birth, show_mature_content from public.usernames where username in ('dave','eve','bob','alice') order by 1;
select get_backend_info();
