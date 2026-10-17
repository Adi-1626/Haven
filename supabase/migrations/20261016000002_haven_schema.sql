-- Haven Cloud PostgreSQL Migration: haven schema, tables, indexes, RLS, storage buckets and auth trigger
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create haven schema
CREATE SCHEMA IF NOT EXISTS haven;

GRANT USAGE ON SCHEMA haven TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA haven GRANT SELECT ON TABLES TO anon;

-- 2. Users table
CREATE TABLE IF NOT EXISTS haven.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  password TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'idle', 'dnd', 'offline')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON haven.users (LOWER(username));
CREATE INDEX IF NOT EXISTS users_email_idx ON haven.users (LOWER(email)) WHERE email IS NOT NULL;

-- 3. Sessions (for backwards compatibility with local and hosted session tokens)
CREATE TABLE IF NOT EXISTS haven.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON haven.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON haven.sessions (expires_at);

-- 4. Servers (Communities)
CREATE TABLE IF NOT EXISTS haven.servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS servers_owner_id_idx ON haven.servers (owner_id);

-- 5. Server Members
CREATE TABLE IF NOT EXISTS haven.members (
  server_id TEXT NOT NULL REFERENCES haven.servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  server_muted BOOLEAN NOT NULL DEFAULT FALSE,
  server_deafened BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user_id_idx ON haven.members (user_id);
CREATE INDEX IF NOT EXISTS members_server_id_idx ON haven.members (server_id);

-- 6. Channels
CREATE TABLE IF NOT EXISTS haven.channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES haven.servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
  topic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS channels_server_id_idx ON haven.channels (server_id, position);

-- 7. Invites
CREATE TABLE IF NOT EXISTS haven.invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES haven.servers(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS invites_server_id_idx ON haven.invites (server_id);

-- 8. Direct Conversations & Members
CREATE TABLE IF NOT EXISTS haven.conversations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS haven.conversation_members (
  conversation_id TEXT NOT NULL REFERENCES haven.conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON haven.conversation_members (user_id);
CREATE INDEX IF NOT EXISTS conversation_members_conv_id_idx ON haven.conversation_members (conversation_id);

-- 9. Messages
CREATE TABLE IF NOT EXISTS haven.messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES haven.channels(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES haven.conversations(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  reply_to TEXT REFERENCES haven.messages(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  edited_at BIGINT,
  CONSTRAINT message_destination_check CHECK (
    (channel_id IS NOT NULL AND conversation_id IS NULL) OR
    (channel_id IS NULL AND conversation_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON haven.messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON haven.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON haven.messages (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_author_idx ON haven.messages (author_id);

-- 10. Attachments
CREATE TABLE IF NOT EXISTS haven.attachments (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES haven.channels(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES haven.conversations(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES haven.messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  disk_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message_id_idx ON haven.attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_channel_id_idx ON haven.attachments (channel_id);
CREATE INDEX IF NOT EXISTS attachments_conversation_id_idx ON haven.attachments (conversation_id);

-- 11. Reactions
CREATE TABLE IF NOT EXISTS haven.reactions (
  message_id TEXT NOT NULL REFERENCES haven.messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS reactions_user_idx ON haven.reactions (user_id);

-- 12. Friend Requests & Friendships
CREATE TABLE IF NOT EXISTS haven.friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CONSTRAINT unique_friend_request UNIQUE (from_id, to_id),
  CONSTRAINT different_users_check CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_to_id_idx ON haven.friend_requests (to_id);
CREATE INDEX IF NOT EXISTS friend_requests_from_id_idx ON haven.friend_requests (from_id);

CREATE TABLE IF NOT EXISTS haven.friends (
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT friends_different_users CHECK (user_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS friends_friend_id_idx ON haven.friends (friend_id);

-- 13. Blocks
CREATE TABLE IF NOT EXISTS haven.blocks (
  user_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, blocked_id),
  CONSTRAINT blocks_different_users CHECK (user_id <> blocked_id)
);

-- 14. Soundboard
CREATE TABLE IF NOT EXISTS haven.sounds (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES haven.servers(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  disk_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sounds_server_id_idx ON haven.sounds (server_id);

-- 15. Server Emojis
CREATE TABLE IF NOT EXISTS haven.server_emojis (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES haven.servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  animated BOOLEAN NOT NULL DEFAULT FALSE,
  mime TEXT NOT NULL,
  disk_name TEXT NOT NULL,
  static_disk_name TEXT NOT NULL,
  uploader_id TEXT NOT NULL REFERENCES haven.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CONSTRAINT unique_server_emoji_name UNIQUE (server_id, name)
);
CREATE INDEX IF NOT EXISTS server_emojis_server_id_idx ON haven.server_emojis (server_id);

-- 16. Server Icons
CREATE TABLE IF NOT EXISTS haven.server_icons (
  server_id TEXT PRIMARY KEY REFERENCES haven.servers(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  disk_name TEXT NOT NULL
);

-- 17. Enable Row Level Security on all haven tables
ALTER TABLE haven.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.sounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.server_emojis ENABLE ROW LEVEL SECURITY;
ALTER TABLE haven.server_icons ENABLE ROW LEVEL SECURITY;

-- 18. RLS Policies
CREATE POLICY users_select ON haven.users FOR SELECT TO authenticated USING (true);
CREATE POLICY users_insert ON haven.users FOR INSERT TO authenticated WITH CHECK ((select auth.uid()::text) = id);
CREATE POLICY users_update ON haven.users FOR UPDATE TO authenticated USING ((select auth.uid()::text) = id) WITH CHECK ((select auth.uid()::text) = id);

CREATE POLICY sessions_all ON haven.sessions FOR ALL TO authenticated USING ((select auth.uid()::text) = user_id) WITH CHECK ((select auth.uid()::text) = user_id);

CREATE POLICY servers_select ON haven.servers FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY servers_insert ON haven.servers FOR INSERT TO authenticated WITH CHECK ((select auth.uid()::text) = owner_id);
CREATE POLICY servers_update ON haven.servers FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY servers_delete ON haven.servers FOR DELETE TO authenticated USING ((select auth.uid()::text) = owner_id);

CREATE POLICY members_select ON haven.members FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.members.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY members_insert ON haven.members FOR INSERT TO authenticated WITH CHECK ((select auth.uid()::text) = user_id);
CREATE POLICY members_update ON haven.members FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.members.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.members.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY members_delete ON haven.members FOR DELETE TO authenticated USING (
  (select auth.uid()::text) = user_id OR
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.members.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

CREATE POLICY channels_select ON haven.channels FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY channels_modify ON haven.channels FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

CREATE POLICY invites_select ON haven.invites FOR SELECT TO authenticated USING (true);
CREATE POLICY invites_modify ON haven.invites FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

CREATE POLICY conversations_all ON haven.conversations FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.conversation_members cm WHERE cm.conversation_id = id AND cm.user_id = (select auth.uid()::text))
) WITH CHECK (true);

CREATE POLICY conv_members_select ON haven.conversation_members FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.conversation_members cm WHERE cm.conversation_id = haven.conversation_members.conversation_id AND cm.user_id = (select auth.uid()::text))
);
CREATE POLICY conv_members_modify ON haven.conversation_members FOR ALL TO authenticated USING (
  user_id = (select auth.uid()::text)
) WITH CHECK (true);

CREATE POLICY messages_select ON haven.messages FOR SELECT TO authenticated USING (
  (channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.channels c JOIN haven.members m ON m.server_id = c.server_id WHERE c.id = channel_id AND m.user_id = (select auth.uid()::text))) OR
  (conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.conversation_members cm WHERE cm.conversation_id = haven.messages.conversation_id AND cm.user_id = (select auth.uid()::text)))
);
CREATE POLICY messages_insert ON haven.messages FOR INSERT TO authenticated WITH CHECK (
  author_id = (select auth.uid()::text) AND (
    (channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.channels c JOIN haven.members m ON m.server_id = c.server_id WHERE c.id = channel_id AND m.user_id = (select auth.uid()::text))) OR
    (conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.conversation_members cm WHERE cm.conversation_id = haven.messages.conversation_id AND cm.user_id = (select auth.uid()::text)))
  )
);
CREATE POLICY messages_update ON haven.messages FOR UPDATE TO authenticated USING (
  author_id = (select auth.uid()::text)
) WITH CHECK (
  author_id = (select auth.uid()::text)
);
CREATE POLICY messages_delete ON haven.messages FOR DELETE TO authenticated USING (
  author_id = (select auth.uid()::text) OR (
    channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.channels c JOIN haven.members m ON m.server_id = c.server_id WHERE c.id = channel_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
  )
);

CREATE POLICY attachments_select ON haven.attachments FOR SELECT TO authenticated USING (
  (channel_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.channels c JOIN haven.members m ON m.server_id = c.server_id WHERE c.id = channel_id AND m.user_id = (select auth.uid()::text))) OR
  (conversation_id IS NOT NULL AND EXISTS (SELECT 1 FROM haven.conversation_members cm WHERE cm.conversation_id = haven.attachments.conversation_id AND cm.user_id = (select auth.uid()::text)))
);
CREATE POLICY attachments_insert ON haven.attachments FOR INSERT TO authenticated WITH CHECK (uploader_id = (select auth.uid()::text));
CREATE POLICY attachments_delete ON haven.attachments FOR DELETE TO authenticated USING (uploader_id = (select auth.uid()::text));

CREATE POLICY reactions_select ON haven.reactions FOR SELECT TO authenticated USING (true);
CREATE POLICY reactions_insert ON haven.reactions FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()::text));
CREATE POLICY reactions_delete ON haven.reactions FOR DELETE TO authenticated USING (user_id = (select auth.uid()::text));

CREATE POLICY friends_all ON haven.friends FOR ALL TO authenticated USING (user_id = (select auth.uid()::text) OR friend_id = (select auth.uid()::text)) WITH CHECK (user_id = (select auth.uid()::text));
CREATE POLICY friend_requests_all ON haven.friend_requests FOR ALL TO authenticated USING (from_id = (select auth.uid()::text) OR to_id = (select auth.uid()::text)) WITH CHECK (from_id = (select auth.uid()::text));
CREATE POLICY blocks_all ON haven.blocks FOR ALL TO authenticated USING (user_id = (select auth.uid()::text)) WITH CHECK (user_id = (select auth.uid()::text));

CREATE POLICY sounds_select ON haven.sounds FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.sounds.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY sounds_insert ON haven.sounds FOR INSERT TO authenticated WITH CHECK (
  uploader_id = (select auth.uid()::text) AND EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.sounds.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY sounds_delete ON haven.sounds FOR DELETE TO authenticated USING (
  uploader_id = (select auth.uid()::text) OR EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.sounds.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

CREATE POLICY emojis_select ON haven.server_emojis FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY emojis_modify ON haven.server_emojis FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

CREATE POLICY icons_select ON haven.server_icons FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = (select auth.uid()::text))
);
CREATE POLICY icons_modify ON haven.server_icons FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = (select auth.uid()::text) AND m.role IN ('owner', 'admin'))
);

-- 19. Automatic auth.users -> haven.users sync trigger
CREATE OR REPLACE FUNCTION haven.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = haven, auth, public
AS $$
DECLARE
  v_username text;
  v_display_name text;
BEGIN
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    v_username
  );

  IF EXISTS (SELECT 1 FROM haven.users WHERE LOWER(username) = LOWER(v_username)) THEN
    v_username := v_username || '_' || substr(NEW.id::text, 1, 6);
  END IF;

  INSERT INTO haven.users (
    id,
    username,
    display_name,
    email,
    password,
    bio,
    avatar,
    status,
    settings,
    created_at
  ) VALUES (
    NEW.id::text,
    v_username,
    v_display_name,
    NEW.email,
    '',
    '',
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    'offline',
    '{}'::jsonb,
    COALESCE(ROUND(EXTRACT(EPOCH FROM NEW.created_at) * 1000)::bigint, ROUND(EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    avatar = CASE WHEN haven.users.avatar = '' THEN EXCLUDED.avatar ELSE haven.users.avatar END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION haven.handle_new_auth_user();

-- 20. Provision Private Storage Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('attachments', 'attachments', false, 26214400, NULL),
  ('avatars', 'avatars', false, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('server-icons', 'server-icons', false, 1048576, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('emojis', 'emojis', false, 262144, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  ('sounds', 'sounds', false, 5242880, ARRAY['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/flac', 'audio/mp4'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 21. Storage Policies for Private Buckets
CREATE POLICY "Haven authenticated storage upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id IN ('attachments', 'avatars', 'server-icons', 'emojis', 'sounds')
);

CREATE POLICY "Haven authenticated storage select"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id IN ('attachments', 'avatars', 'server-icons', 'emojis', 'sounds')
);

CREATE POLICY "Haven owner storage update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  (select auth.uid()::text) = owner_id
)
WITH CHECK (
  (select auth.uid()::text) = owner_id
);

CREATE POLICY "Haven owner storage delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  (select auth.uid()::text) = owner_id
);
