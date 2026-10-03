-- Undoes 0009 (r2_themes): removes the Riftgate 2 theme gallery and every shared theme.
begin;
drop function if exists public.r2_use_theme(bigint);
drop function if exists public.r2_delete_theme(text, text, bigint);
drop function if exists public.r2_publish_theme(text, text, text, jsonb, text, text);
drop function if exists private.r2_session_ok(text, text);
drop table if exists public.r2_themes;
commit;
