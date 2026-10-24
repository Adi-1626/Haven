-- PREPARED ONLY. Hosted onboarding rollout, step 1: read-only preflight. Run as the reviewed admin
-- connection (direct/session port, not the transaction pooler) with:
--   psql -X --set=ON_ERROR_STOP=on -f supabase/manual/rollout-preflight-readonly.sql > preflight-<UTC>.txt
-- Outputs aggregates plus the current Auth trigger function definition (needed for rollback). It
-- selects no emails, names or metadata. Candidate ids/fingerprints come from legacy-profile-preflight.sql.
BEGIN READ ONLY;

-- 1. Where am I? Confirm project, role and read-only mode before reading anything else.
SELECT current_database() AS database, current_user AS role, pg_catalog.current_setting('transaction_read_only') AS read_only,
  pg_catalog.current_setting('server_version') AS server_version, pg_catalog.now() AS observed_at;

-- 2. Migration history. Expect 20261016000001..04 recorded and 20261018145338/20261021180000 absent.
DO $history$
DECLARE v_versions text;
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'migration_history: NONE (no supabase_migrations.schema_migrations table)';
  ELSE
    EXECUTE 'SELECT pg_catalog.string_agg(version::text, '','' ORDER BY version) FROM supabase_migrations.schema_migrations' INTO v_versions;
    RAISE NOTICE 'migration_history: %', COALESCE(v_versions, '(empty)');
  END IF;
END;
$history$;

-- 3. Roles and privileges the migrations rely on.
SELECT rolname, rolcanlogin, rolinherit, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname IN ('haven_app', current_user) ORDER BY rolname;
SELECT pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'SELECT') AS can_read_auth_sessions,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute WHERE attrelid = 'auth.sessions'::regclass AND NOT attisdropped
     AND attname IN ('id', 'user_id', 'not_after')) = 3 AS auth_sessions_shape_ok,
  pg_catalog.to_regprocedure('haven.auth_session_active(uuid,uuid)') IS NOT NULL AS session_check_installed;

-- 4. Auth trigger identity. Save the definition column verbatim as the rollback capture file.
SELECT t.tgname, t.tgenabled, t.tgtype, pg_catalog.pg_get_userbyid(p.proowner) AS function_owner, p.prosecdef,
  p.proconfig, p.proacl::text AS function_acl, pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
  pg_catalog.strpos(p.prosrc, '"profileCompleted":false') > 0 AS already_trusted_onboarding
FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;
SELECT pg_catalog.pg_get_functiondef('haven.handle_new_auth_user()'::regprocedure) || ';' AS rollback_capture_definition;

-- 5. Profile and session state (aggregates only). Re-review if any count differs from the approved plan.
SELECT pg_catalog.count(*) AS haven_users,
  pg_catalog.count(*) FILTER (WHERE pg_catalog.jsonb_typeof(u.settings->'profileCompleted') = 'boolean') AS boolean_completion,
  pg_catalog.count(*) FILTER (WHERE u.settings->'profileCompleted' = 'true'::jsonb) AS complete,
  pg_catalog.count(*) FILTER (WHERE u.settings->'profileCompleted' = 'false'::jsonb) AS incomplete,
  pg_catalog.count(*) FILTER (WHERE NOT (u.settings ? 'profileCompleted')) AS missing_completion,
  pg_catalog.count(*) FILTER (WHERE u.settings ? 'profileCompleted' AND pg_catalog.jsonb_typeof(u.settings->'profileCompleted') <> 'boolean') AS malformed_completion,
  pg_catalog.count(*) FILTER (WHERE a.id IS NOT NULL AND a.email_confirmed_at IS NOT NULL) AS auth_linked_verified,
  pg_catalog.count(*) FILTER (WHERE a.id IS NOT NULL AND a.email_confirmed_at IS NULL) AS auth_linked_unverified,
  pg_catalog.count(*) FILTER (WHERE a.id IS NULL) AS without_auth_account,
  pg_catalog.count(*) FILTER (WHERE u.password <> '') AS with_local_password
FROM haven.users u LEFT JOIN auth.users a ON a.id::text = u.id;
SELECT (SELECT pg_catalog.count(*) FROM haven.sessions) AS local_sessions,
  (SELECT pg_catalog.count(*) FROM haven.sessions WHERE expires_at > (EXTRACT(EPOCH FROM pg_catalog.now()) * 1000)::bigint) AS live_local_sessions,
  (SELECT pg_catalog.count(*) FROM auth.users) AS auth_users,
  (SELECT pg_catalog.count(*) FROM auth.users a WHERE NOT EXISTS (SELECT 1 FROM haven.users u WHERE u.id = a.id::text)) AS auth_users_without_haven_row;

-- 5b. Local-only rows (no Auth account; legacy local-auth records, origin unverified): never migrated, completed or deleted.
-- Record local_only_rows_sha256; the postflight requires these rows to be byte-for-byte unchanged.
SELECT pg_catalog.count(*) AS local_only_rows,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(u)::text, E'\n' ORDER BY u.id), ''), 'UTF8')), 'hex') AS local_only_rows_sha256
FROM haven.users u WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id::text = u.id);

-- 6. Relationship counts to compare in postflight (must be unchanged by the rollout).
SELECT (SELECT pg_catalog.count(*) FROM haven.servers) AS servers, (SELECT pg_catalog.count(*) FROM haven.members) AS members,
  (SELECT pg_catalog.count(*) FROM haven.messages) AS messages, (SELECT pg_catalog.count(*) FROM haven.attachments) AS attachments,
  (SELECT pg_catalog.count(*) FROM haven.conversations) AS conversations, (SELECT pg_catalog.count(*) FROM haven.friends) AS friends;

-- 7. Constraints/security the new code relies on.
SELECT i.indisvalid AS username_lower_index_valid FROM pg_catalog.pg_index i WHERE i.indexrelid = 'haven.users_username_lower_idx'::regclass;
SELECT (SELECT pg_catalog.count(*) FROM (SELECT LOWER(username) FROM haven.users GROUP BY 1 HAVING pg_catalog.count(*) > 1) d) AS duplicate_usernames,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'haven' AND policyname LIKE '%\_modify') AS legacy_modify_policies,
  pg_catalog.has_schema_privilege('anon', 'haven', 'USAGE') OR pg_catalog.has_schema_privilege('authenticated', 'haven', 'USAGE') AS browser_roles_reach_haven;
ROLLBACK;
