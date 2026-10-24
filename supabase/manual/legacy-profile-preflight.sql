-- PREPARED ONLY. Run only after approval in the correct project, as an audit/admin connection.
-- Review these two UUIDs manually; do not automatically feed results to the backfill.
-- Only genuine Hosted accounts are listed: a verified Auth account and no Local Mode password.
-- Rows without an Auth account (legacy local-auth records, origin unverified) are never candidates.
BEGIN READ ONLY;
SELECT u.id AS candidate_id, a.created_at AS auth_created_at,
  u.settings->'profileCompleted' AS existing_completion,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    ((pg_catalog.to_jsonb(u) - 'settings') || pg_catalog.jsonb_build_object('settings', u.settings - 'profileCompleted'))::text,
    'UTF8')), 'hex') AS profile_sha256
FROM haven.users u JOIN auth.users a ON a.id::text = u.id
WHERE a.email_confirmed_at IS NOT NULL AND u.password = ''
ORDER BY u.id;
-- Recheck index, trigger, role and out-of-scope row counts using the approved read-only audit.
ROLLBACK;
