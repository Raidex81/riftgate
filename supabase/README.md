# Riftgate 2 backend additions (Supabase)

Riftgate 2 uses the same Supabase project as Riftgate (accounts, sessions,
community apps, suggestions). It adds one migration on top of Riftgate's
`0001`–`0008` (see `C:\Riftgate\supabase\README.md`).

| # | File | Summary |
|---|---|---|
| 0009 | `migrations/20261002000900_r2_themes.sql` | Community theme gallery: `public.r2_themes` (public read only), `r2_publish_theme` / `r2_delete_theme` checked against the login session, `r2_use_theme` counter |

**Apply:** Supabase dashboard → SQL Editor → paste the file → Run.
It is safe to run twice. Undo with `rollback/rollback_20261002000900.sql`.

**Verify:** `select count(*) from public.r2_themes;`

Until it is applied, Riftgate 2's Community tab says the gallery opens soon,
and themes are still shared as `.riftgate-theme` files.

Tested against Riftgate's `tests/mock_supabase.sql` plus every migration:
publish, update by name, wrong or someone else's token refused, 16 KB theme
limit, picture must be https or an image data URL, 25 themes per account,
only your own themes can be removed, anonymous users can read but never write.
