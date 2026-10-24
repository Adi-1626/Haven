-- PREPARED ONLY; separate approval required. Normally the additive completion flags are KEPT (see
-- docs/HOSTED-AUTH-ROLLOUT.md, "Backfill undo"). Use only before traffic reopens, with the SAME
-- approved ids and fingerprints that the backfill used. Removes only `profileCompleted: true` from the
-- two approved rows, and only if every other column still matches the approved fingerprint (which
-- excludes the completion key). Any other change, a missing row or a non-true flag aborts everything.
--   psql -X --set=ON_ERROR_STOP=on -v approved_id_1=... -v approved_profile_sha256_1=... \
--     -v approved_id_2=... -v approved_profile_sha256_2=... -f rollback-approved-legacy-profile-backfill.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE rollback_legacy_profiles (
  id uuid PRIMARY KEY,
  profile_sha256 text NOT NULL CHECK (profile_sha256 ~ '^[a-f0-9]{64}$')
) ON COMMIT DROP;
INSERT INTO rollback_legacy_profiles VALUES
  (:'approved_id_1'::uuid, :'approved_profile_sha256_1'),
  (:'approved_id_2'::uuid, :'approved_profile_sha256_2');

DO $undo$
DECLARE v_count integer;
BEGIN
  PERFORM u.id FROM haven.users u JOIN rollback_legacy_profiles r ON r.id::text = u.id FOR UPDATE OF u;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 2 THEN RAISE EXCEPTION 'Expected exactly two approved accounts'; END IF;

  IF EXISTS (
    SELECT 1 FROM haven.users u JOIN rollback_legacy_profiles r ON r.id::text = u.id
    WHERE u.settings->'profileCompleted' IS DISTINCT FROM 'true'::jsonb
      OR r.profile_sha256 <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        ((pg_catalog.to_jsonb(u) - 'settings') || pg_catalog.jsonb_build_object('settings', u.settings - 'profileCompleted'))::text,
        'UTF8')), 'hex')
  ) THEN RAISE EXCEPTION 'Approved account is not complete or changed since approval; undo refused'; END IF;

  UPDATE haven.users u SET settings = u.settings - 'profileCompleted'
  FROM rollback_legacy_profiles r WHERE u.id = r.id::text;

  IF (SELECT pg_catalog.count(*) FROM haven.users u JOIN rollback_legacy_profiles r ON r.id::text = u.id
      WHERE NOT (u.settings ? 'profileCompleted')) <> 2 THEN
    RAISE EXCEPTION 'Backfill undo postcondition failed';
  END IF;
END;
$undo$;
COMMIT;
