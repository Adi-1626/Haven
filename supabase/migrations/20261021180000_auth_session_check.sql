-- PREPARED ONLY. No production SQL has been executed.
-- Durable hosted logout. Supabase access JWTs remain cryptographically valid until they expire, even
-- after sign-out; a signed-out session is identified by its JWT `session_id` no longer existing in
-- auth.sessions. This lets the backend runtime role ask exactly that question, and nothing else, without
-- any grant on the auth schema. Additive: no rows, roles, RLS policies or existing functions change.
-- Rollback: DROP FUNCTION haven.auth_session_active(uuid, uuid); the backend detects the missing
-- function and falls back to provider lookups plus its in-process denylist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'auth.sessions not found; review before proceeding';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid = 'auth.sessions'::regclass AND NOT attisdropped
        AND attname IN ('id', 'user_id', 'not_after')) <> 3 THEN
    RAISE EXCEPTION 'Unexpected auth.sessions shape; review before proceeding';
  END IF;
  -- The function runs with its owner's (this migration role's) privileges.
  IF NOT pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'SELECT') THEN
    RAISE EXCEPTION '% cannot read auth.sessions; the session check would always fail', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'haven_app') THEN
    RAISE EXCEPTION 'Runtime role haven_app not found; review before proceeding';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION haven.auth_session_active(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = p_session_id
      AND s.user_id = p_user_id
      AND (s.not_after IS NULL OR s.not_after > pg_catalog.now())
  );
$function$;

REVOKE ALL ON FUNCTION haven.auth_session_active(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION haven.auth_session_active(uuid, uuid) TO haven_app;
COMMIT;
