-- Fixes super_trigger_password_reset so it actually forces a password
-- reset in the current unified-login system.
--
-- The old version only set admins.must_reset_password = true, a column
-- nothing in the app ever reads, and only worked when the target already
-- had a row in the admins table. This version clears the target's real
-- login password (usernames.password_hash) for ANY user, admin or not —
-- that's what login_needs_password_setup checks, which is what makes
-- Riftgate show the "set a new password" popup and (within a few minutes,
-- or immediately on their next launch) logs the target out of any
-- session they currently have open.
--
-- Caller verification is unchanged in spirit (verify_admin_login, which
-- already correctly checks the caller's real, current password) but now
-- also requires the caller to be a super admin specifically, matching
-- every other super_* function and the "only I can do this" model you
-- described for admin actions.

create or replace function public.super_trigger_password_reset(super_username text, super_password text, target_username text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
    v_is_super boolean;
    v_rows int;
begin
    select ad.is_super_admin
      into v_is_super
      from public.admins ad
     where ad.username = super_username
       and public.verify_admin_login(super_username, super_password);

    if v_is_super is not true then
        return false;
    end if;

    update public.usernames
       set password_hash = null
     where username = target_username;

    get diagnostics v_rows = row_count;
    return v_rows > 0;
end;
$function$;
