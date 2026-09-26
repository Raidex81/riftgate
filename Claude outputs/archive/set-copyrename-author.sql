-- Sets the display name for Copy-Rename's author to "Fausto", as you
-- described it. Run this once in the Supabase SQL Editor (after
-- community-apps-author-update.sql, if you haven't already).

update public.community_apps
set author = 'Fausto'
where url = 'https://github.com/RicFausto/Copy-Rename';
