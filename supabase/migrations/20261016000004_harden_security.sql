-- Haven Database and Storage Security Hardening Migration

-- 1. Restricted backend runtime role
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'haven_app') THEN 
    CREATE ROLE haven_app WITH LOGIN NOINHERIT; 
  END IF; 
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

-- 6. Restrict redundant permissive modify policies to service_role
ALTER POLICY channels_modify ON haven.channels TO service_role;
ALTER POLICY invites_modify ON haven.invites TO service_role;
ALTER POLICY conv_members_modify ON haven.conversation_members TO service_role;
ALTER POLICY emojis_modify ON haven.server_emojis TO service_role;
ALTER POLICY icons_modify ON haven.server_icons TO service_role;
