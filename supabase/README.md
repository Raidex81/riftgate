# Riftgate backend (Supabase)

Everything Riftgate runs on Supabase, kept as code. Production project:
`hblndwtdksnxlzlhiqir` ("Raidex81's Project").

## Current state (Riftgate 1.6.x)

- **Database:** schema version **7** — migrations `0001`–`0008` below are
  all applied. `select public.get_backend_info();` shows the live version;
  the app reads it to decide which server features it can use.
- **Edge Functions deployed:**

  | Function | What it does | "Verify JWT" |
  |---|---|---|
  | `media-proxy` | Calls TMDB/RAWG/SteamGridDB/YouTube/Steam with keys stored as secrets; only allowlisted endpoints | On |
  | `account-email` | Creates password-reset codes and email-confirmation links and emails them via Resend | On |
  | `verify-email` | Landing page for the email-confirmation link (plain text) | **Off** (opened from an email) |
  | `vault` | All Vault file transfers: password check, signed upload/download links, deletes and clean-ups | On |
  | `send-password-reset-email`, `send-verification-email` | Old versions, only used by app versions before 1.6.0 — to be switched off once everyone has updated | — |

- **Secrets** (Edge Functions → Secrets): `TMDB_API_KEY`, `RAWG_API_KEY`,
  `YOUTUBE_API_KEY`, `STEAMGRIDDB_API_KEY`, `STEAM_API_KEY`,
  `RESEND_API_KEY`, optional `RESEND_FROM`. Never commit their values.
- **Storage:** bucket `riftgate-shares` is private, 50 MB per file, with no
  public storage rules — only the `vault` function touches it.

## Folders

- `migrations/` — apply in filename order, each in the Supabase SQL
  Editor. The header of each file says what it does, how it affects older
  app versions, how to verify it, and which rollback file undoes it.

  | # | File | Summary |
  |---|---|---|
  | 0001 | `20260925000100_backend_info_and_p0_codify.sql` | `get_backend_info()`, removes public storage rules and legacy access |
  | 0002 | `20260925000200_private_account_secrets.sql` | Moves password hashes, emails and tokens into the private schema |
  | 0003 | `20260925000300_auth_hardening.sql` | Lockout after wrong passwords, bcrypt cost 12, safer admin checks |
  | 0004 | `20260925000400_profile_rpcs.sql` | Date of birth / mature-content settings through checked functions |
  | 0005 | `20260925000500_login_sessions.sql` | Revocable login sessions (tokens) instead of stored passwords |
  | 0006 | `20260925000600_account_email_server_side.sql` | Reset codes / confirmation tokens only visible to `account-email` |
  | 0007 | `20260926000700_vault_function.sql` | Vault through the `vault` function, bucket private + 50 MB |
  | 0008 | `20260926000800_vault_clean_fix.sql` | "Clean Vault now" passes Supabase's safe-delete check |

- `rollback/` — one undo script per migration (0008 needs none).
- `tests/` — `run.sh` applies every migration to a throwaway local
  Postgres (with a stand-in for Supabase's own setup) and checks the
  results. Never point it at production.
- `functions/<name>/index.ts` — source of each Edge Function. To update
  one: Supabase → Edge Functions → the function → **Code**, paste the
  file, **Deploy updates**.
