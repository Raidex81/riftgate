-- Undo 0010 (r2_usage_pings): removes the counter and its two functions.
begin;
drop function if exists public.r2_usage_weekly(text, text);
drop function if exists public.r2_usage_ping(text, text, text);
drop table if exists public.r2_usage_pings;
commit;
