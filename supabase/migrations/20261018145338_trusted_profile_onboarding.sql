-- PREPARED ONLY. No production SQL has been executed.
-- Schema change only: no existing Haven/Auth rows, roles, grants or RLS policies are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Refuse an unexpected installation instead of silently leaving an unrelated trigger active.
DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
      AND t.tgtype = 5 AND t.tgqual IS NULL AND t.tgnargs = 0
      AND t.tgenabled IN ('O', 'A') AND fn.nspname = 'haven'
      AND p.proname = 'handle_new_auth_user' AND p.pronargs = 0 AND p.prosecdef
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'Unexpected Auth trigger installation; review before proceeding';
  END IF;
END;
$preflight$;

-- Preserve the existing function identity, owner and ACL. SECURITY DEFINER is retained
-- because the Auth insert must mirror into the private haven schema. All table references
-- are qualified and the search path is empty. Editable metadata is never consulted.
CREATE OR REPLACE FUNCTION haven.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_username text;
  v_attempt integer;
  v_constraint text;
BEGIN
  FOR v_attempt IN 0..15 LOOP
    IF v_attempt = 0 THEN
      v_username := 'user_' || pg_catalog.substr(pg_catalog.replace(NEW.id::text, '-', ''), 1, 10);
    ELSE
      -- Only a non-secret neutral identity. MD5 here is not a credential or security token.
      v_username := 'user_' || pg_catalog.substr(pg_catalog.md5(NEW.id::text || ':' || v_attempt::text), 1, 10);
    END IF;
    BEGIN
      INSERT INTO haven.users (id, username, display_name, email, password, bio, avatar, status, settings, created_at)
      VALUES (NEW.id::text, v_username, v_username, NEW.email, '', '', '', 'offline',
        '{"profileCompleted":false}'::jsonb,
        COALESCE(pg_catalog.round(EXTRACT(EPOCH FROM NEW.created_at) * 1000)::bigint,
                 pg_catalog.round(EXTRACT(EPOCH FROM pg_catalog.now()) * 1000)::bigint))
      ON CONFLICT (id) DO NOTHING;
      -- A repeated id must never reset a completed profile, avatar, or relationships.
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint NOT IN ('users_username_key', 'users_username_lower_idx') THEN
        RAISE;
      END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Neutral profile identity allocation exhausted' USING ERRCODE = '23505';
END;
$function$;
COMMIT;
