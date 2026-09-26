-- Minimal stand-in for the Supabase environment + production schema, reconstructed from
-- _private/audit (1-settings.csv, 2-functions.sql). TEST ONLY — never applied to production.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema extensions; create extension pgcrypto schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
set search_path = public, extensions;

create table public.usernames (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  device_id text not null,
  created_at timestamptz default now(),
  password_hash text,
  date_of_birth date,
  show_mature_content boolean not null default false,
  email text,
  email_verified boolean not null default false,
  email_verification_token text,
  email_verification_expires_at timestamptz,
  email_verification_sent_at timestamptz,
  password_reset_token text,
  password_reset_expires_at timestamptz,
  password_reset_sent_at timestamptz,
  password_reset_attempts integer not null default 0
);
create unique index usernames_email_unique_idx on public.usernames (lower(email)) where email is not null;
create table public.admins (username text primary key, is_super_admin boolean default false, added_at timestamptz default now(), password_hash text, must_reset_password boolean default false);
create table public.admin_config (id int primary key, password_hash text, password_changed boolean default false);
create table public.share_allowlist (username text primary key, added_by text, added_at timestamptz default now(), password_hash text);
create table public.share_access_requests (username text primary key, requested_at timestamptz default now());
create table public.shared_files (id bigserial primary key, filename text, storage_path text, file_size bigint, description text, uploader_username text, uploaded_at timestamptz default now(), expires_at timestamptz default now() + interval '24 hours', download_count bigint default 0);
create table public.shared_links (id bigserial primary key, url text, description text, poster_username text, posted_at timestamptz default now(), expires_at timestamptz, open_count bigint default 0);
create table public.suggestions (id uuid primary key default gen_random_uuid(), text text, status text not null default 'new', resolved_at timestamptz, code_change_done boolean not null default false, fix_notes text, fix_applied_at timestamptz);
create table public.suggestion_replies (id uuid primary key default gen_random_uuid(), suggestion_id uuid, reply_text text);

alter table public.usernames enable row level security;
alter table public.admins enable row level security;
alter table public.share_allowlist enable row level security;
alter table public.shared_files enable row level security;
create policy "Allow public insert" on public.usernames for insert to public with check (true);
create policy "Allow public read" on public.usernames for select to public using (true);

-- Production function bodies relevant to 0002 (from _private/audit/2-functions.sql)
create or replace function public.verify_login(input_username text, input_password text) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  select exists (select 1 from public.usernames where username = input_username and password_hash is not null and password_hash = crypt(input_password, password_hash)); $$;
create or replace function public.verify_admin_login(input_username text, input_password text) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  select exists (select 1 from public.admins ad join public.usernames u on u.username = ad.username where ad.username = input_username and u.password_hash is not null and u.password_hash = crypt(input_password, u.password_hash)); $$;
create or replace function public.login_needs_password_setup(input_username text) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  select exists (select 1 from public.usernames where username = input_username and password_hash is null); $$;
create or replace function public.set_own_login_password(input_username text, new_password text) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  update public.usernames set password_hash = crypt(new_password, gen_salt('bf')) where username = input_username and password_hash is null returning true; $$;

-- Seed data
insert into public.usernames (username, device_id, password_hash, email, email_verified) values
  ('alice', 'dev-alice', extensions.crypt('alicepw', extensions.gen_salt('bf')), 'alice@example.com', true),
  ('bob',   'dev-bob',   extensions.crypt('bobpw', extensions.gen_salt('bf')), null, false),
  ('carol', 'dev-carol', null, null, false);
update public.usernames set email_verification_token = 'tok-bob', email_verification_expires_at = now() + interval '1 hour' where username = 'bob';
update public.usernames set password_reset_token = 'ABCD2345', password_reset_expires_at = now() + interval '30 minutes' where username = 'alice';
insert into public.admins (username, is_super_admin) values ('alice', true);
insert into public.share_allowlist (username) values ('bob');
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create policy "riftgate-shares anon select" on storage.objects for select to anon using (bucket_id = 'riftgate-shares');
create policy "riftgate_shares_upload_only" on storage.objects for insert to anon with check (bucket_id = 'riftgate-shares');
-- functions that 0001 revokes, as stand-ins
create or replace function public.request_password_reset(input_username text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create or replace function public.confirm_password_reset(input_username text, input_code text, input_new_password text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create or replace function public.super_trigger_password_reset(super_username text, super_password text, target_username text) returns boolean language sql as $$ select false $$;
create or replace function public.set_own_admin_password(input_username text, new_password text) returns boolean language sql as $$ select false $$;
-- functions 0003 rewrites (production bodies, from _private/audit/2-functions.sql)
create or replace function public.add_admin_reply(input_username text, input_password text, target_suggestion_id uuid, reply_text text)
 returns boolean language plpgsql security definer as $function$
declare stored_hash text;
begin
  select password_hash into stored_hash from admins where username = input_username;
  if stored_hash is null or stored_hash != crypt(input_password, stored_hash) then return false; end if;
  insert into suggestion_replies (suggestion_id, reply_text) values (target_suggestion_id, reply_text);
  return true;
end; $function$;
create or replace function public.delete_reply(input_username text, input_password text, target_id uuid)
 returns boolean language plpgsql security definer as $function$
declare stored_hash text;
begin
  select password_hash into stored_hash from admins where username = input_username;
  if stored_hash is null or stored_hash != crypt(input_password, stored_hash) then return false; end if;
  delete from suggestion_replies where id = target_id;
  return true;
end; $function$;
create or replace function public.delete_suggestion(input_username text, input_password text, target_id uuid)
 returns boolean language plpgsql security definer as $function$
declare stored_hash text;
begin
  select password_hash into stored_hash from admins where username = input_username;
  if stored_hash is null or stored_hash != crypt(input_password, stored_hash) then return false; end if;
  delete from suggestions where id = target_id;
  return true;
end; $function$;
create or replace function public.super_remove_admin(super_username text, super_password text, target_username text)
 returns boolean language plpgsql security definer as $function$
DECLARE v_is_admin BOOLEAN;
BEGIN
    IF target_username = 'Raidex_Adm' THEN RETURN false; END IF;
    SELECT verify_admin_login(super_username, super_password) INTO v_is_admin;
    IF NOT v_is_admin THEN RETURN false; END IF;
    DELETE FROM admins WHERE username = target_username;
    RETURN true;
END; $function$;
create or replace function public.set_own_date_of_birth(input_username text, new_dob date) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  update public.usernames set date_of_birth = new_dob where username = input_username returning true; $$;
create or replace function public.set_own_mature_content_preference(input_username text, new_value boolean) returns boolean language sql security definer set search_path to 'public','extensions' as $$
  update public.usernames set show_mature_content = new_value where username = input_username returning true; $$;
create or replace function public.get_own_email_status(input_username text, input_password text) returns jsonb language sql as $$ select '{}'::jsonb $$;
-- Vault pieces used by 0007 (production bodies, from _private/audit/2-functions.sql)
alter table storage.objects add column metadata jsonb, add column created_at timestamptz default now();
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
insert into storage.buckets (id, name, public) values ('riftgate-shares', 'riftgate-shares', false);
create or replace function public.delete_shared_file(p_username text, p_file_id bigint, p_admin_password text default null::text, p_password text default null::text)
 returns boolean language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_uploader text; v_is_admin boolean := false; v_owner_verified boolean := false;
begin
    select uploader_username into v_uploader from shared_files where id = p_file_id;
    if v_uploader is null then return false; end if;
    if v_uploader = p_username then
        select verify_login(p_username, p_password) into v_owner_verified;
        if v_owner_verified then delete from shared_files where id = p_file_id; return true; end if;
    end if;
    if p_admin_password is not null then
        select verify_admin_login(p_username, p_admin_password) into v_is_admin;
        if v_is_admin then delete from shared_files where id = p_file_id; return true; end if;
    end if;
    return false;
end; $function$;
create or replace function public.cleanup_expired_shared_files(p_username text, p_password text default null::text)
 returns setof shared_files language plpgsql security definer as $function$
begin
    if not check_share_access(p_username, p_password) then raise exception 'Not authorized'; end if;
    return query delete from shared_files where expires_at <= now() returning *;
end; $function$;
create or replace function public.add_shared_file(p_username text, p_filename text, p_storage_path text, p_file_size bigint, p_description text, p_expires_hours integer, p_password text default null::text)
 returns shared_files language plpgsql security definer as $function$
declare v_row shared_files;
begin
    if not check_share_access(p_username, p_password) then raise exception 'Not authorized'; end if;
    insert into shared_files (filename, storage_path, file_size, description, uploader_username, expires_at)
    values (p_filename, p_storage_path, p_file_size, p_description, p_username, now() + (p_expires_hours || ' hours')::interval) returning * into v_row;
    return v_row;
end; $function$;
