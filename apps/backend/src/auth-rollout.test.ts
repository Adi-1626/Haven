import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Static scope safeguards, NOT PL/pgSQL execution or staging certification.
const read = (file: string) => fs.readFileSync(new URL(`../../../supabase/${file}`, import.meta.url), 'utf8').replace(/--[^\n]*/g, '');

test('prepared trigger migration never backfills users or changes runtime roles/RLS', () => {
  const sql = read('migrations/20261018145338_trusted_profile_onboarding.sql');
  assert.match(sql, /BEGIN;[\s\S]+COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:ALTER ROLE|CREATE ROLE|GRANT|REVOKE|CREATE POLICY|ALTER POLICY|DELETE FROM|UPDATE haven\.users)\b/i);
  assert.doesNotMatch(sql, /raw_user_meta_data|profileCompleted"\s*:\s*true/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(sql, /SET search_path = ''/);
});

test('manual backfill stays outside automatic migrations and writes only the approved users completion key', () => {
  const sql = read('manual/approved-legacy-profile-backfill.sql');
  assert.equal((sql.match(/\bUPDATE haven\.users\b/g) ?? []).length, 1);
  assert.match(sql, /WHERE u\.id = approved\.id::text AND NOT \(u\.settings \? 'profileCompleted'\)/);
  assert.match(sql, /IF v_count <> 2 THEN RAISE EXCEPTION/);
  assert.match(sql, /FOR UPDATE OF u, a/);
  assert.match(sql, /a\.email_confirmed_at IS NOT NULL AND a\.created_at = approved\.auth_created_at AND u\.password = ''/);
  assert.match(sql, /profile_sha256/);
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|ALTER ROLE|CREATE POLICY|GRANT|REVOKE)\b/i);
  for (const field of ['id', 'auth_created_at', 'profile_sha256']) {
    for (const number of [1, 2]) assert.ok(sql.includes(`:'approved_${field}_${number}'`));
  }
});

test('rollout pre/postflight scripts are read-only and select no personal data', () => {
  for (const file of ['manual/rollout-preflight-readonly.sql', 'manual/rollout-postflight-readonly.sql']) {
    const sql = read(file);
    assert.match(sql, /^\s*BEGIN READ ONLY;/);
    assert.match(sql, /ROLLBACK;\s*$/);
    assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COMMIT)\b/i);
    assert.doesNotMatch(sql, /CREATE (?!OR REPLACE)\w/i);
    // The postflight names raw_user_meta_data only as a quoted literal, to assert the trigger no longer reads it.
    assert.doesNotMatch(sql, /(?<!')raw_user_meta_data|\b\w+\.email\b/i);
  }
});

test('rollback scripts are scoped to the change they undo', () => {
  const backfill = read('manual/rollback-approved-legacy-profile-backfill.sql');
  assert.equal((backfill.match(/\bUPDATE haven\.users\b/g) ?? []).length, 1);
  assert.match(backfill, /SET settings = u\.settings - 'profileCompleted'/);
  assert.match(backfill, /IF v_count <> 2 THEN RAISE EXCEPTION/);
  assert.doesNotMatch(backfill.replace('ON COMMIT DROP', ''), /\b(?:DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE)\b/i);
  const trigger = read('manual/rollback-auth-trigger-function.sql');
  assert.match(trigger, /\\i :capture_file/);
  assert.match(trigger, /expected_md5/);
  assert.doesNotMatch(trigger, /\b(?:UPDATE|INSERT|DELETE|DROP|GRANT|REVOKE)\b/i);
  const session = read('manual/rollback-auth-session-check.sql');
  assert.match(session, /DROP FUNCTION IF EXISTS haven\.auth_session_active\(uuid, uuid\);/);
  assert.equal((session.match(/\bDROP\b/g) ?? []).length, 1);
});

test('session-check migration is additive and grants only the runtime role', () => {
  const sql = read('migrations/20261021180000_auth_session_check.sql');
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /REVOKE ALL ON FUNCTION haven\.auth_session_active\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION haven\.auth_session_active\(uuid, uuid\) TO haven_app;/);
  assert.doesNotMatch(sql, /\b(?:ALTER ROLE|CREATE ROLE|CREATE POLICY|ALTER POLICY|UPDATE|DELETE|INSERT|DROP)\b/i);
});

test('prepared legacy preflight is read-only and does not select emails or metadata for classification', () => {
  const sql = read('manual/legacy-profile-preflight.sql');
  assert.match(sql, /BEGIN READ ONLY;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE|COMMIT)\b/i);
  assert.doesNotMatch(sql, /raw_user_meta_data|SELECT[^;]*\bu\.email\b/i);
  // Local Mode rows (password hashes) are never Hosted backfill candidates.
  assert.match(sql, /u\.password = ''/);
});
