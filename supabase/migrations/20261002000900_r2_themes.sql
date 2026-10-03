-- =============================================================================
-- 0009 · r2_themes (Riftgate 2 community theme gallery)
-- -----------------------------------------------------------------------------
-- Purpose
--   Lets Riftgate 2 users share the themes they make and use other people's.
--   * public.r2_themes: readable by everyone (it's a public gallery); nobody
--     can write to it directly.
--   * r2_publish_theme(username, token, name, theme, thumb, wallpaper)
--       -> {success, id}: checked against the caller's login session (0005),
--       at most 25 themes per account, same name = update.
--   * r2_delete_theme(username, token, id) -> boolean (own themes only)
--   * r2_use_theme(id) -> integer: public "used by" counter (+1 only).
--   Size limits: theme settings 16 KB, preview 60 KB, picture 700 KB
--   (the app shrinks pictures before sharing).
-- Prerequisites: 0005 (private.login_sessions, private.token_hash).
-- Old-client effect: none (only Riftgate 2 uses it).
-- Verify:
--   select count(*) from public.r2_themes;
--   select public.r2_use_theme(-1);   -- returns null, no error
-- Rollback: rollback_20261002000900.sql
-- =============================================================================
begin;

create table if not exists public.r2_themes (
  id          bigserial primary key,
  author      text not null references public.usernames (username) on update cascade on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  theme       jsonb not null check (pg_column_size(theme) <= 16384),
  thumb       text check (thumb is null or (char_length(thumb) <= 60000 and thumb like 'data:image/%')),
  wallpaper   text check (wallpaper is null or (char_length(wallpaper) <= 700000 and (wallpaper like 'data:image/%' or wallpaper like 'https://%'))),
  uses        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (author, name)
);
create index if not exists r2_themes_uses_idx on public.r2_themes (uses desc, created_at desc);
create index if not exists r2_themes_created_idx on public.r2_themes (created_at desc);

alter table public.r2_themes enable row level security;
drop policy if exists r2_themes_public_read on public.r2_themes;
create policy r2_themes_public_read on public.r2_themes for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on table public.r2_themes from public, anon, authenticated;
grant select on table public.r2_themes to anon, authenticated;
revoke all on sequence public.r2_themes_id_seq from public, anon, authenticated;

-- True when the token is a live session of this account (no expiry slide).
create or replace function private.r2_session_ok(p_username text, p_token text)
returns boolean
language sql
stable
security definer
set search_path = private, public, extensions
as $$
  select exists (
    select 1
    from private.login_sessions ls
    join private.account_secrets s on s.username = ls.username
    where ls.username = p_username
      and ls.token_hash = private.token_hash(p_token)
      and ls.expires_at > now()
      and s.password_hash is not null
      and not s.must_reset);
$$;
revoke execute on function private.r2_session_ok(text, text) from public, anon, authenticated;

create or replace function public.r2_publish_theme(
  input_username text, input_token text,
  p_name text, p_theme jsonb, p_thumb text, p_wallpaper text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id    bigint;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if input_username is null or input_token is null or not private.r2_session_ok(input_username, input_token) then
    return jsonb_build_object('success', false, 'error', 'Sign in again to share themes.');
  end if;
  if char_length(v_name) not between 1 and 40 then
    return jsonb_build_object('success', false, 'error', 'Give your theme a name (up to 40 characters).');
  end if;
  if p_theme is null or jsonb_typeof(p_theme) <> 'object' or pg_column_size(p_theme) > 16384 then
    return jsonb_build_object('success', false, 'error', 'This theme can''t be shared as it is.');
  end if;

  select id into v_id from public.r2_themes where author = input_username and name = v_name;
  if v_id is null then
    if (select count(*) from public.r2_themes where author = input_username) >= 25 then
      return jsonb_build_object('success', false, 'error', 'You''ve shared 25 themes already. Remove one to share another.');
    end if;
    insert into public.r2_themes (author, name, theme, thumb, wallpaper)
    values (input_username, v_name, p_theme, p_thumb, p_wallpaper)
    returning id into v_id;
  else
    update public.r2_themes
       set theme = p_theme, thumb = p_thumb, wallpaper = p_wallpaper, updated_at = now()
     where id = v_id;
  end if;
  return jsonb_build_object('success', true, 'id', v_id);
exception
  when check_violation then
    return jsonb_build_object('success', false, 'error', 'The picture must be an https link or an image under 700 KB.');
end;
$$;
revoke execute on function public.r2_publish_theme(text, text, text, jsonb, text, text) from public;
grant execute on function public.r2_publish_theme(text, text, text, jsonb, text, text) to anon, authenticated, service_role;

create or replace function public.r2_delete_theme(input_username text, input_token text, p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if input_username is null or input_token is null or not private.r2_session_ok(input_username, input_token) then
    return false;
  end if;
  delete from public.r2_themes where id = p_id and author = input_username;
  return found;
end;
$$;
revoke execute on function public.r2_delete_theme(text, text, bigint) from public;
grant execute on function public.r2_delete_theme(text, text, bigint) to anon, authenticated, service_role;

create or replace function public.r2_use_theme(p_id bigint)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.r2_themes set uses = uses + 1 where id = p_id returning uses;
$$;
revoke execute on function public.r2_use_theme(bigint) from public;
grant execute on function public.r2_use_theme(bigint) to anon, authenticated, service_role;

commit;
