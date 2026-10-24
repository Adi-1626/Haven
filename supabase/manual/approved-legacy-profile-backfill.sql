-- PREPARED ONLY; separate from migrations. Requires explicit owner approval.
-- Execute with psql only after filling two reviewed UUIDs, Auth creation timestamps,
-- and preflight SHA-256 fingerprints. No metadata-based or email-based matching.
-- Hosted accounts only: a row with a Local Mode password is never completed or linked here.
-- Missing psql inputs cause a syntax error, never a broad update.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE approved_legacy_profiles (
  id uuid PRIMARY KEY,
  auth_created_at timestamptz NOT NULL,
  profile_sha256 text NOT NULL CHECK (profile_sha256 ~ '^[a-f0-9]{64}$')
) ON COMMIT DROP;
INSERT INTO approved_legacy_profiles VALUES
  (:'approved_id_1'::uuid, :'approved_auth_created_at_1'::timestamptz, :'approved_profile_sha256_1'),
  (:'approved_id_2'::uuid, :'approved_auth_created_at_2'::timestamptz, :'approved_profile_sha256_2');

DO $backfill$
DECLARE v_count integer;
BEGIN
  -- Row locks cover only the two approved accounts. A deleted, unconfirmed, replaced, Local Mode,
  -- explicitly incomplete or changed account aborts the entire transaction.
  PERFORM u.id FROM haven.users u
  JOIN approved_legacy_profiles approved ON approved.id::text = u.id
  JOIN auth.users a ON a.id = approved.id
  WHERE a.email_confirmed_at IS NOT NULL AND a.created_at = approved.auth_created_at AND u.password = ''
  FOR UPDATE OF u, a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected exactly two approved verified Auth-linked Hosted accounts'; END IF;

  IF EXISTS (
    SELECT 1 FROM haven.users u JOIN approved_legacy_profiles approved ON approved.id::text = u.id
    WHERE pg_catalog.jsonb_typeof(u.settings) <> 'object'
      OR (u.settings ? 'profileCompleted' AND u.settings->'profileCompleted' <> 'true'::jsonb)
      OR (NOT (u.settings ? 'profileCompleted') AND approved.profile_sha256 <>
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          ((pg_catalog.to_jsonb(u) - 'settings') || pg_catalog.jsonb_build_object('settings', u.settings - 'profileCompleted'))::text,
          'UTF8')), 'hex'))
  ) THEN RAISE EXCEPTION 'Approved legacy snapshot/state changed; re-review required'; END IF;

  UPDATE haven.users u
  SET settings = pg_catalog.jsonb_set(u.settings, '{profileCompleted}', 'true'::jsonb)
  FROM approved_legacy_profiles approved
  WHERE u.id = approved.id::text AND NOT (u.settings ? 'profileCompleted');
  -- Re-running already-complete approved IDs is a no-op. No flag is overwritten.
  IF (SELECT count(*) FROM haven.users u JOIN approved_legacy_profiles approved ON approved.id::text = u.id
      WHERE u.settings->'profileCompleted' = 'true'::jsonb) <> 2 THEN
    RAISE EXCEPTION 'Legacy completion postcondition failed';
  END IF;
END;
$backfill$;
COMMIT;
