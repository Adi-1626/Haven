-- PREPARED ONLY. Hosted onboarding rollout: read-only postflight. Raises (and so fails under
-- ON_ERROR_STOP) unless the database is in the expected post-rollout state. Inputs, from the approved plan:
--   psql -X --set=ON_ERROR_STOP=on -v approved_id_1=... -v approved_id_2=... \
--     -v expected_missing_completion=<preflight missing_completion minus 2> \
--     -v expected_local_only_sha256=<preflight local_only_rows_sha256> -f rollout-postflight-readonly.sql
BEGIN READ ONLY;
-- psql does not interpolate inside dollar-quoted blocks, so inputs travel as transaction-local settings.
SELECT pg_catalog.set_config('haven_rollout.approved_1', :'approved_id_1'::uuid::text, true),
  pg_catalog.set_config('haven_rollout.approved_2', :'approved_id_2'::uuid::text, true),
  pg_catalog.set_config('haven_rollout.expected_missing', (:'expected_missing_completion')::integer::text, true),
  pg_catalog.set_config('haven_rollout.expected_local_only', :'expected_local_only_sha256', true);

DO $postflight$
DECLARE
  v_input record;
  v_proc pg_catalog.pg_proc;
BEGIN
  SELECT pg_catalog.current_setting('haven_rollout.approved_1') AS approved_1, pg_catalog.current_setting('haven_rollout.approved_2') AS approved_2,
    pg_catalog.current_setting('haven_rollout.expected_missing')::integer AS expected_missing,
    pg_catalog.current_setting('haven_rollout.expected_local_only') AS expected_local_only INTO v_input;

  -- Trusted onboarding trigger (20261018145338) is live and kept its identity.
  SELECT p.* INTO v_proc FROM pg_catalog.pg_proc p WHERE p.oid = 'haven.handle_new_auth_user()'::regprocedure;
  IF NOT v_proc.prosecdef OR pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR pg_catalog.strpos(v_proc.prosrc, '"profileCompleted":false') = 0
     OR pg_catalog.strpos(v_proc.prosrc, 'raw_user_meta_data') > 0 THEN
    RAISE EXCEPTION 'postflight: Auth trigger function is not the reviewed trusted-onboarding version';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created'
                 AND t.tgfoid = 'haven.handle_new_auth_user()'::regprocedure AND t.tgenabled IN ('O', 'A')) THEN
    RAISE EXCEPTION 'postflight: on_auth_user_created is missing, disabled or points elsewhere';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'haven.handle_new_auth_user()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'haven.handle_new_auth_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'postflight: browser roles can execute the Auth trigger function';
  END IF;

  -- Durable logout check (20261021180000): installed and executable only by the runtime role.
  IF pg_catalog.to_regprocedure('haven.auth_session_active(uuid,uuid)') IS NULL
     OR NOT pg_catalog.has_function_privilege('haven_app', 'haven.auth_session_active(uuid,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'haven.auth_session_active(uuid,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'haven.auth_session_active(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'postflight: haven.auth_session_active is missing or has the wrong grants';
  END IF;

  -- Exactly the two approved legacy accounts were completed; nothing else was classified.
  IF (SELECT pg_catalog.count(*) FROM haven.users WHERE id IN (v_input.approved_1, v_input.approved_2)
      AND settings->'profileCompleted' = 'true'::jsonb) <> 2 THEN
    RAISE EXCEPTION 'postflight: approved accounts are not both complete';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM haven.users WHERE NOT (settings ? 'profileCompleted')) <> v_input.expected_missing THEN
    RAISE EXCEPTION 'postflight: unexpected number of rows without a completion flag';
  END IF;
  IF EXISTS (SELECT 1 FROM haven.users WHERE settings ? 'profileCompleted' AND pg_catalog.jsonb_typeof(settings->'profileCompleted') <> 'boolean') THEN
    RAISE EXCEPTION 'postflight: malformed completion flag present';
  END IF;

  -- Local-only rows (no Auth account; legacy local-auth records, origin unverified) must be byte-for-byte unchanged.
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(u)::text, E'\n' ORDER BY u.id), ''), 'UTF8')), 'hex')
      FROM haven.users u WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id::text = u.id)) <> v_input.expected_local_only THEN
    RAISE EXCEPTION 'postflight: local-only rows changed';
  END IF;

  -- Security posture unchanged.
  IF pg_catalog.has_schema_privilege('anon', 'haven', 'USAGE') OR pg_catalog.has_schema_privilege('authenticated', 'haven', 'USAGE') THEN
    RAISE EXCEPTION 'postflight: browser roles can reach the haven schema';
  END IF;
  IF NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'haven_app') THEN
    RAISE EXCEPTION 'postflight: haven_app lost BYPASSRLS';
  END IF;
  RAISE NOTICE 'postflight: OK';
END;
$postflight$;

-- For manual comparison with preflight section 6 (must be identical).
SELECT (SELECT pg_catalog.count(*) FROM haven.servers) AS servers, (SELECT pg_catalog.count(*) FROM haven.members) AS members,
  (SELECT pg_catalog.count(*) FROM haven.messages) AS messages, (SELECT pg_catalog.count(*) FROM haven.attachments) AS attachments,
  (SELECT pg_catalog.count(*) FROM haven.conversations) AS conversations, (SELECT pg_catalog.count(*) FROM haven.friends) AS friends;
ROLLBACK;
