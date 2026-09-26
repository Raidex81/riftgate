-- Riftgate: fix "date of birth keeps getting asked again"
-- Run this once in the Supabase SQL Editor.
--
-- What was wrong: saving your date of birth (and the mature-content
-- toggle) was written as a direct PATCH against the "usernames" table
-- using the app's anon key. Every other write in this app that touches
-- the usernames table goes through a security-definer RPC function
-- instead — on purpose, since Row Level Security on that table has no
-- UPDATE policy for the anon key. That direct PATCH was silently doing
-- nothing: Supabase returned a normal success status either way, so the
-- app had no way to tell the update hadn't actually happened — the date
-- of birth was never really saved, so it looked missing again on every
-- next login and the app asked for it again.
--
-- This adds two small RPC functions (matching the same pattern already
-- used for set_own_login_password) so these two fields can actually be
-- written, and updates the app's code to call them instead of the
-- direct PATCH.

create or replace function public.set_own_date_of_birth(input_username text, new_dob date)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.usernames
    set date_of_birth = new_dob
    where username = input_username
    returning true;
$$;

create or replace function public.set_own_mature_content_preference(input_username text, new_value boolean)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
    update public.usernames
    set show_mature_content = new_value
    where username = input_username
    returning true;
$$;
