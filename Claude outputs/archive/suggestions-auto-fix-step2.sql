-- Suggestions auto-fix, Step 2: track WHEN a fix actually completed, so
-- the Review New popup can show "Processing" until then and "Applied"
-- for exactly one hour afterward before it drops off that list (it may
-- still show in the main Suggestions list under the existing 24-hour
-- rule there — that one is unchanged).

alter table public.suggestions
    add column if not exists fix_applied_at timestamptz;

create or replace function public.mark_suggestion_fix_applied(target_id uuid, notes text default null::text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.suggestions
    set code_change_done = true,
        fix_notes = notes,
        fix_applied_at = now()
    where id = target_id
      and status = 'applied'
      and code_change_done = false
    returning true;
$$;
