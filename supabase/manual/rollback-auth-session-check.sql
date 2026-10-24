-- PREPARED ONLY; separate approval required. Removes the durable logout check added by
-- 20261021180000_auth_session_check.sql. Running backends detect the missing function on their next
-- check and fall back to provider lookups plus their in-process denylist (logout is then no longer
-- durable across restarts or shared across instances). No data changes.
--   psql -X --set=ON_ERROR_STOP=on -f rollback-auth-session-check.sql
-- If the migration was recorded, also mark it reverted:
--   supabase migration repair --status reverted 20261021180000
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS haven.auth_session_active(uuid, uuid);
COMMIT;
