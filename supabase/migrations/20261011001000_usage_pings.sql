-- =============================================================================
-- 0010 · r2_usage_pings (opt-in, anonymous "how many PCs opened Riftgate")
-- -----------------------------------------------------------------------------
-- Purpose
--   Riftgate 2.0.2 (October 2026 update) can count, once a week, that it was opened on a PC, but only
--   when the person said yes (Settings → Help Riftgate grow). What is sent: a
--   random id made on that PC (no name, no account, no IP kept), the app
--   version and "win"/"mac". One row per PC per week, nothing else.
--   * public.r2_usage_pings: nobody can read or write it directly.
--   * r2_usage_ping(p_install, p_version, p_platform) -> boolean: records this
--     week's visit (a second call the same week changes nothing).
--   * r2_usage_weekly(username, password) -> jsonb: admins only, the last 26
--     weeks: PCs per week, and per version for the latest week.
--   Rows older than a year are deleted when a new week's first ping arrives.
-- Prerequisites: 0003 (verify_admin_login).
-- Old-client effect: none (only Riftgate 2.0.2's October update and later call it).
-- Verify:
--   select public.r2_usage_ping(repeat('a', 32), '2.1.0', 'win');   -- true
--   select count(*) from public.r2_usage_pings;
-- Rollback: rollback_20261011001000.sql
-- =============================================================================
begin;

create table if not exists public.r2_usage_pings (
  week      date not null,
  install   text not null check (install ~ '^[0-9a-f]{32}$'),
  version   text not null check (char_length(version) <= 20),
  platform  text not null check (platform in ('win', 'mac', 'linux')),
  primary key (week, install)
);
alter table public.r2_usage_pings enable row level security;
revoke all on table public.r2_usage_pings from public, anon, authenticated;

create or replace function public.r2_usage_ping(p_install text, p_version text, p_platform text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week date := date_trunc('week', now())::date;
begin
  if p_install is null or p_install !~ '^[0-9a-f]{32}$'
     or p_version is null or char_length(p_version) > 20 or p_version !~ '^[0-9A-Za-z.\-]+$'
     or p_platform is null or p_platform not in ('win', 'mac', 'linux') then
    return false;
  end if;
  -- the first ping of a week tidies away anything older than a year
  if not exists (select 1 from public.r2_usage_pings where week = v_week) then
    delete from public.r2_usage_pings where week < v_week - 365;
  end if;
  insert into public.r2_usage_pings (week, install, version, platform)
  values (v_week, p_install, p_version, p_platform)
  on conflict (week, install) do update set version = excluded.version;
  return true;
end;
$$;
revoke execute on function public.r2_usage_ping(text, text, text) from public;
grant execute on function public.r2_usage_ping(text, text, text) to anon, authenticated, service_role;

create or replace function public.r2_usage_weekly(input_username text, input_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_latest date;
begin
  if input_password is null or not public.verify_admin_login(input_username, input_password) then
    raise exception 'Not authorized';
  end if;
  select max(week) into v_latest from public.r2_usage_pings;
  return jsonb_build_object(
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('week', week, 'pcs', n) order by week desc)
                       from (select week, count(*) n from public.r2_usage_pings
                             where week > date_trunc('week', now())::date - 26 * 7
                             group by week) w), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', version, 'pcs', n) order by n desc)
                          from (select version, count(*) n from public.r2_usage_pings where week = v_latest group by version) v), '[]'::jsonb),
    'platforms', coalesce((select jsonb_object_agg(platform, n)
                           from (select platform, count(*) n from public.r2_usage_pings where week = v_latest group by platform) p), '{}'::jsonb));
end;
$$;
revoke execute on function public.r2_usage_weekly(text, text) from public;
grant execute on function public.r2_usage_weekly(text, text) to anon, authenticated, service_role;

commit;
