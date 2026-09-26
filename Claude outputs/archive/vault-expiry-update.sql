-- Vault expiry update
--
-- 1. Shared-file uploads: the app now offers 8/12/24 hour options
--    alongside the existing 1/2/4, but add_shared_file's 6-param overload
--    still rejects anything outside (1, 2, 4) server-side -- this widens
--    that allowed list to match.
-- 2. Shared links (WeTransfer/SendGB posts): previously defaulted to a
--    7-day expiry (via the shared_links table's own default on
--    expires_at). Per user request, these should stay listed for 90
--    days instead -- add_shared_link now sets that explicitly on insert
--    rather than relying on the table default, so this works regardless
--    of what that default currently is.
--
-- Run this in the Supabase SQL Editor for the Riftgate project.

drop function if exists public.add_shared_file(text, text, text, bigint, text, integer, text);

create or replace function public.add_shared_file(p_username text, p_filename text, p_storage_path text, p_file_size bigint, p_description text, p_expires_hours integer, p_password text default null::text)
 returns shared_files
 language plpgsql
 security definer
as $function$
DECLARE
    v_row shared_files;
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF p_expires_hours NOT IN (1, 2, 4, 8, 12, 24) THEN
        RAISE EXCEPTION 'Expiration must be 1, 2, 4, 8, 12, or 24 hours';
    END IF;
    INSERT INTO shared_files (filename, storage_path, file_size, description, uploader_username, expires_at)
    VALUES (p_filename, p_storage_path, p_file_size, p_description, p_username, now() + (p_expires_hours || ' hours')::interval)
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;

drop function if exists public.add_shared_link(text, text, text, text);

create or replace function public.add_shared_link(p_username text, p_url text, p_description text, p_password text default null::text)
 returns shared_links
 language plpgsql
 security definer
as $function$
DECLARE
    v_row shared_links;
BEGIN
    IF NOT check_share_access(p_username, p_password) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    INSERT INTO shared_links (url, description, poster_username, expires_at)
    VALUES (p_url, p_description, p_username, now() + interval '90 days')
    RETURNING * INTO v_row;
    RETURN v_row;
END;
$function$;
