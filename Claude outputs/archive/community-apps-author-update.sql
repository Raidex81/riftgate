-- Adds an "author" field to Applications — the actual developer of the
-- app (e.g. "RicFausto" for Copy-Rename), separate from "added_by" (the
-- Riftgate admin who added the listing, which visitors don't need to
-- see). Run this once, AFTER community-apps-setup.sql.

alter table public.community_apps
    add column if not exists author text;

-- Backfill the app you already seeded.
update public.community_apps
set author = 'RicFausto'
where url = 'https://github.com/RicFausto/Copy-Rename'
  and author is null;

-- ============================================================
-- add_community_app now also takes an author
-- ============================================================
drop function if exists public.add_community_app(text, text, text, text, text);

create or replace function public.add_community_app(
    p_admin_username text,
    p_admin_password text,
    p_name text,
    p_url text,
    p_author text default null,
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

    INSERT INTO public.community_apps (name, url, author, description, added_by)
    VALUES (p_name, p_url, p_author, p_description, p_admin_username)
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$function$;

-- ============================================================
-- Replaces update_community_app_description — now edits author and
-- description together in one call (one "Edit Details" modal in the app
-- instead of two separate ones).
-- ============================================================
drop function if exists public.update_community_app_description(text, text, bigint, text);

create or replace function public.update_community_app_details(
    p_admin_username text,
    p_admin_password text,
    p_app_id bigint,
    p_author text,
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
    SET author = p_author,
        description = p_description
    WHERE id = p_app_id;

    RETURN FOUND;
END;
$function$;
