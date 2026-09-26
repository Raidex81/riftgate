# Archive — superseded scripts

These SQL scripts and Edge Function drafts were written and applied one at
a time while Riftgate's backend was being built (up to v1.5.2). They are
kept only as history — **don't run them again**: several of them would
undo later security fixes.

The current, complete source of truth for the backend is
[`supabase/`](../../supabase/) (migrations, rollback scripts, tests and
Edge Function source) — see `supabase/README.md`.

`send-verification-email.ts` is the source of an old Edge Function that is
still deployed only for app versions before 1.6.0; it will be switched
off once everyone has updated.
