-- Suggestions auto-fix, Step 1 (SQL): the review/approve mechanics.
--
-- Adds a status to each suggestion (new / applied / rejected), and two
-- super-admin-only functions to set it. Only a super-admin can approve or
-- reject — verified here in the database (admins.is_super_admin = true,
-- plus the account's own login password), not just by what the app
-- happens to show, so this can't be bypassed by calling the API directly.
--
-- Approving a suggestion does NOT make the code change itself — it just
-- records that you signed off on it. A separate scheduled check-in
-- (outside this app) picks up approved suggestions and makes the actual
-- edit to your Riftgate folder, then calls mark_suggestion_fix_applied
-- below to record that it's done. That function needs no admin
-- credentials on purpose: its WHERE clause means it can only ever mark
-- an ALREADY-approved suggestion as code-applied — it has no path to
-- approve anything itself, so there's nothing to abuse it into.

alter table public.suggestions
    add column if not exists status text not null default 'new',
    add column if not exists resolved_at timestamptz,
    add column if not exists code_change_done boolean not null default false,
    add column if not exists fix_notes text;

create or replace function public.apply_suggestion(input_username text, input_password text, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_is_super_admin boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM admins WHERE username = input_username AND is_super_admin = true
    ) INTO v_is_super_admin;

    IF NOT v_is_super_admin OR NOT verify_admin_login(input_username, input_password) THEN
        RETURN false;
    END IF;

    UPDATE suggestions
    SET status = 'applied', resolved_at = now()
    WHERE id = target_id AND status = 'new';

    RETURN FOUND;
END;
$function$;

create or replace function public.reject_suggestion(input_username text, input_password text, target_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
DECLARE
    v_is_super_admin boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM admins WHERE username = input_username AND is_super_admin = true
    ) INTO v_is_super_admin;

    IF NOT v_is_super_admin OR NOT verify_admin_login(input_username, input_password) THEN
        RETURN false;
    END IF;

    -- Nothing left to do for a rejected suggestion, so it's marked
    -- code_change_done immediately — the scheduled check-in only ever
    -- looks at status = 'applied', so this keeps rejected ones out of
    -- its way without needing a separate check.
    UPDATE suggestions
    SET status = 'rejected', resolved_at = now(), code_change_done = true
    WHERE id = target_id AND status = 'new';

    RETURN FOUND;
END;
$function$;

create or replace function public.mark_suggestion_fix_applied(target_id uuid, notes text default null::text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.suggestions
    set code_change_done = true,
        fix_notes = notes
    where id = target_id
      and status = 'applied'
      and code_change_done = false
    returning true;
$$;
