-- Haven Database and Storage Security Hardening Migration
--
-- Replay safety (21 Oct 2026): this file must apply cleanly after 20261016000003, which drops the
-- five *_modify policies. Step 6 is therefore conditional. Databases that already recorded this
-- version (production) are unaffected: the end state below matches the observed production catalog
-- (no *_modify policies, service_role-only storage policies, haven_app with BYPASSRLS).

-- 1. Backend runtime role. The backend is the row-authorization boundary (it connects as one role
-- for all users), so like the production role it bypasses RLS; browser roles get no haven access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'haven_app') THEN
    CREATE ROLE haven_app WITH LOGIN NOINHERIT;
  END IF;
  ALTER ROLE haven_app BYPASSRLS;
END $$;

-- 2. Revoke all privileges on haven schema and its objects from anon and authenticated
REVOKE ALL ON ALL TABLES IN SCHEMA haven FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA haven FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA haven FROM anon, authenticated, PUBLIC;
REVOKE USAGE ON SCHEMA haven FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA haven REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven REVOKE ALL ON ROUTINES FROM anon, authenticated;

-- Revoke execute on handle_new_auth_user from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION haven.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

-- 3. Grant least-privilege runtime access to haven_app
GRANT USAGE ON SCHEMA haven TO haven_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA haven TO haven_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA haven TO haven_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO haven_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven GRANT USAGE, SELECT ON SEQUENCES TO haven_app;

-- 4. Foreign key covering indexes for high query performance
CREATE INDEX IF NOT EXISTS attachments_uploader_id_idx ON haven.attachments (uploader_id);
CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx ON haven.blocks (blocked_id);
CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON haven.messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS server_emojis_uploader_id_idx ON haven.server_emojis (uploader_id);
CREATE INDEX IF NOT EXISTS sounds_uploader_id_idx ON haven.sounds (uploader_id);

-- 5. Restrict storage policies to service_role (preventing unauthorized client storage access)
ALTER POLICY "Haven authenticated storage upload" ON storage.objects TO service_role;
ALTER POLICY "Haven authenticated storage select" ON storage.objects TO service_role;
ALTER POLICY "Haven owner storage update" ON storage.objects TO service_role;
ALTER POLICY "Haven owner storage delete" ON storage.objects TO service_role;

-- 6. Restrict redundant permissive modify policies to service_role, where they still exist
-- (20261016000003 replaces them with per-command policies, so on a clean replay this is a no-op).
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT p.policyname, p.tablename FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'haven'
      AND (p.tablename, p.policyname) IN (('channels', 'channels_modify'), ('invites', 'invites_modify'),
        ('conversation_members', 'conv_members_modify'), ('server_emojis', 'emojis_modify'), ('server_icons', 'icons_modify'))
  LOOP
    EXECUTE pg_catalog.format('ALTER POLICY %I ON haven.%I TO service_role', v_policy.policyname, v_policy.tablename);
  END LOOP;
END $$;
