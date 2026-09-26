# Local test for migrations 0001-0006 against a throwaway Postgres 16 with pgcrypto.
# Usage (from repo root): PGHOST=/tmp PGPORT=5433 bash supabase/tests/run.sh   (never point it at production)
set -e
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists rgtest" ; $P -c "create database rgtest"
$P -d rgtest -f supabase/tests/mock_supabase.sql
$P -d rgtest -f supabase/migrations/20260925000100_backend_info_and_p0_codify.sql
$P -d rgtest -f supabase/migrations/20260925000200_private_account_secrets.sql
$P -d rgtest -f supabase/tests/test_0002.sql
$P -d rgtest -f supabase/migrations/20260925000300_auth_hardening.sql
$P -d rgtest -f supabase/tests/test_0003.sql
$P -d rgtest -f supabase/migrations/20260925000100_backend_info_and_p0_codify.sql
$P -d rgtest -f supabase/migrations/20260925000200_private_account_secrets.sql
$P -d rgtest -c "select username, password_hash is not null has_pw, email, email_verified, device_id from private.account_secrets order by 1" 
$P -d rgtest -c "select verify_login('alice','newpassword1') still_ok, verify_login('dave','davepw') dave_ok"
$P -d rgtest -f supabase/migrations/20260925000400_profile_rpcs.sql
$P -d rgtest -f supabase/tests/test_0004.sql
$P -d rgtest -f supabase/migrations/20260925000500_login_sessions.sql
$P -d rgtest -f supabase/tests/test_0005.sql
$P -d rgtest -f supabase/migrations/20260925000600_account_email_server_side.sql
$P -d rgtest -f supabase/tests/test_0006.sql
$P -d rgtest -f supabase/migrations/20260926000700_vault_function.sql
$P -d rgtest -f supabase/tests/test_0007.sql
$P -d rgtest -f supabase/migrations/20260926000800_vault_clean_fix.sql
$P -d rgtest -f supabase/tests/test_0008.sql
