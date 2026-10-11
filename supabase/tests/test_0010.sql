\set ON_ERROR_STOP 1
set role anon;
select public.r2_usage_ping(repeat('a', 32), '2.1.0', 'win') as ok_first;
select public.r2_usage_ping(repeat('a', 32), '2.1.0', 'win') as ok_again;
select public.r2_usage_ping(repeat('b', 32), '2.0.2', 'mac') as ok_other;
select public.r2_usage_ping('not-hex', '2.1.0', 'win') as bad_id;
select public.r2_usage_ping(repeat('c', 32), '2.1.0; drop', 'win') as bad_version;
select public.r2_usage_ping(repeat('c', 32), '2.1.0', 'amiga') as bad_platform;
do $$ begin perform count(*) from public.r2_usage_pings; raise exception 'anon could read the table'; exception when insufficient_privilege then raise notice 'anon cannot read: ok'; end $$;
do $$ begin perform public.r2_usage_weekly('alice', 'wrong'); raise exception 'non-admin got stats'; exception when raise_exception then if sqlerrm <> 'Not authorized' then raise; end if; raise notice 'non-admin refused: ok'; end $$;
reset role;
select count(*) as rows_this_week from public.r2_usage_pings;
-- an admin sees the weekly numbers
insert into public.usernames (username, device_id) values ('boss', 'd') on conflict do nothing;
insert into private.account_secrets (username, password_hash) select 'boss', extensions.crypt('pw-boss', extensions.gen_salt('bf')) where exists (select 1 from information_schema.tables where table_schema = 'private' and table_name = 'account_secrets') on conflict do nothing;
insert into public.admins (username) values ('boss') on conflict do nothing;
select public.r2_usage_weekly('boss', 'pw-boss') as admin_view;
