-- PREPARED ONLY; separate approval required. Restores the Auth trigger function exactly as captured by
-- rollout-preflight-readonly.sql (its `rollback_capture_definition` column, saved verbatim to a file).
-- WARNING: the captured legacy function trusts editable signup metadata (username, display name, avatar)
-- and creates rows without a completion flag, which the current backend answers with HTTP 503. Keep
-- signups paused while it is live and prefer a reviewed forward fix. CREATE OR REPLACE keeps the
-- function's owner, ACL and trigger attachment.
--   psql -X --set=ON_ERROR_STOP=on -v capture_file=<saved capture .sql> \
--     -v expected_definition_md5=<preflight definition_md5> -f rollback-auth-trigger-function.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
\i :capture_file
SELECT pg_catalog.set_config('haven_rollout.expected_md5', :'expected_definition_md5', true);

DO $verify$
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef('haven.handle_new_auth_user()'::regprocedure))
     <> pg_catalog.current_setting('haven_rollout.expected_md5') THEN
    RAISE EXCEPTION 'Restored definition differs from the preflight capture; rolled back';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created'
                 AND t.tgfoid = 'haven.handle_new_auth_user()'::regprocedure AND t.tgenabled IN ('O', 'A')) THEN
    RAISE EXCEPTION 'on_auth_user_created is missing or disabled; rolled back';
  END IF;
END;
$verify$;
COMMIT;
