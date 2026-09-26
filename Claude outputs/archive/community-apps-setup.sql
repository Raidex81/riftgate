-- Community Apps: brings back a real "Applications" section — a public,
-- browsable list of third-party apps recommended by admins (GitHub links
-- or otherwise). Reads are open to everyone, like Free Games or Theatre;
-- adding an app, editing its description, or removing it requires valid
-- admin credentials, checked the exact same way every other admin-gated
-- action in this app already works: via verify_admin_login (from
-- unified-login-step-a.sql), which accepts any row in "admins" — so this
-- works for regular admins and super admins alike with no extra logic.
--
-- Run this once in the Supabase SQL Editor.

-- ============================================================
-- Table
-- ============================================================
create table if not exists public.community_apps (
    id bigint generated always as identity primary key,
    name text not null,
    url text not null,
    description text,
    added_by text not null,
    created_at timestamptz not null default now()
);

alter table public.community_apps enable row level security;

-- Public read — this is browsable content for everyone, not gated like
-- The Vault. All writes go through the security-definer RPCs below
-- instead of direct table access, so no anon insert/update/delete
-- policy is needed.
drop policy if exists "community_apps anon select" on public.community_apps;
create policy "community_apps anon select"
on public.community_apps
for select
to anon
using (true);

-- ============================================================
-- Add an app (admin or super admin)
-- ============================================================
create or replace function public.add_community_app(
    p_admin_username text,
    p_admin_password text,
    p_name text,
    p_url text,
    p_description text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_is_admin boolean;
    v_new_id bigint;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.community_apps (name, url, description, added_by)
    VALUES (p_name, p_url, p_description, p_admin_username)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

-- ============================================================
-- Edit an app's description (admin or super admin) — the auto-fetched
-- GitHub description, or a manual one, either way editable any time.
-- ============================================================
create or replace function public.update_community_app_description(
    p_admin_username text,
    p_admin_password text,
    p_app_id bigint,
    p_description text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN false;
    END IF;

    UPDATE public.community_apps
    SET description = p_description
    WHERE id = p_app_id;

    RETURN FOUND;
END;
$function$;

-- ============================================================
-- Remove an app (admin or super admin)
-- ============================================================
create or replace function public.delete_community_app(
    p_admin_username text,
    p_admin_password text,
    p_app_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_is_admin boolean;
BEGIN
    SELECT verify_admin_login(p_admin_username, p_admin_password) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN false;
    END IF;

    DELETE FROM public.community_apps WHERE id = p_app_id;

    RETURN FOUND;
END;
$function$;

-- ============================================================
-- Seed the first entry: your friend's app
-- ============================================================
insert into public.community_apps (name, url, description, added_by)
values (
    'Copy-Rename',
    'https://github.com/RicFausto/Copy-Rename',
    'A small desktop app for batch-copying files with custom names and automatic folder organization. The app runs standalone with no internet connection or external accounts needed.',
    'Raidex81'
);
