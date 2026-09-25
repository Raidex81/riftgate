-- Rollback for 0004 · profile_rpcs. Restores the pre-0004 (username-only) behaviour.
-- Only use if 0004 broke the date-of-birth prompt or the mature toggle.
begin;
drop function if exists public.set_own_date_of_birth(text, text, date);
drop function if exists public.set_own_mature_content_preference(text, text, boolean);
create or replace function public.set_own_date_of_birth(input_username text, new_dob date)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.usernames set date_of_birth = new_dob where username = input_username;
  if found then return true; end if; return null;
end; $$;
create or replace function public.set_own_mature_content_preference(input_username text, new_value boolean)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.usernames set show_mature_content = new_value where username = input_username;
  if found then return true; end if; return null;
end; $$;
create or replace function public.get_backend_info()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('schema_version', 3, 'min_client_version', '1.5.2');
$$;
commit;
notify pgrst, 'reload schema';
