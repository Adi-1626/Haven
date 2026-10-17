-- Haven PostgreSQL Initial Schema (Prepared for Supabase Migration)
-- Note: This is part of the planned Supabase integration.
-- Local SQLite databases are preserved and not migrated during this structural refactor.

-- Enable pgcrypto / uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users table (maps cleanly to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'idle', 'dnd', 'offline')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

-- Case-insensitive lookup index on username
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON public.users (LOWER(username));

-- 2. Sessions (for backwards compatibility with session-token authentication)
CREATE TABLE IF NOT EXISTS public.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON public.sessions (expires_at);

-- 3. Servers (Communities)
CREATE TABLE IF NOT EXISTS public.servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);

-- 4. Server Members
CREATE TABLE IF NOT EXISTS public.members (
  server_id TEXT NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  server_muted BOOLEAN NOT NULL DEFAULT FALSE,
  server_deafened BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (server_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user_id_idx ON public.members (user_id);

-- 5. Channels
CREATE TABLE IF NOT EXISTS public.channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
  topic TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS channels_server_id_idx ON public.channels (server_id, position);

-- 6. Invites
CREATE TABLE IF NOT EXISTS public.invites (
  code TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX IF NOT EXISTS invites_server_id_idx ON public.invites (server_id);

-- 7. Direct Conversations & Members
CREATE TABLE IF NOT EXISTS public.conversations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON public.conversation_members (user_id);

-- 8. Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES public.channels(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES public.conversations(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  reply_to TEXT REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  edited_at BIGINT,
  CONSTRAINT message_destination_check CHECK (
    (channel_id IS NOT NULL AND conversation_id IS NULL) OR
    (channel_id IS NULL AND conversation_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON public.messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);

-- 9. Attachments
CREATE TABLE IF NOT EXISTS public.attachments (
  id TEXT PRIMARY KEY,
  channel_id TEXT REFERENCES public.channels(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES public.conversations(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES public.messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  disk_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message_id_idx ON public.attachments (message_id);

-- 10. Reactions
CREATE TABLE IF NOT EXISTS public.reactions (
  message_id TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

-- 11. Friend Requests & Friendships
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CONSTRAINT unique_friend_request UNIQUE (from_id, to_id),
  CONSTRAINT different_users_check CHECK (from_id <> to_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_to_id_idx ON public.friend_requests (to_id);

CREATE TABLE IF NOT EXISTS public.friends (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT friends_different_users CHECK (user_id <> friend_id)
);

-- 12. Blocks
CREATE TABLE IF NOT EXISTS public.blocks (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, blocked_id),
  CONSTRAINT blocks_different_users CHECK (user_id <> blocked_id)
);

-- 13. Soundboard
CREATE TABLE IF NOT EXISTS public.sounds (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  disk_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sounds_server_id_idx ON public.sounds (server_id);

-- 14. Server Emojis
CREATE TABLE IF NOT EXISTS public.server_emojis (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  animated BOOLEAN NOT NULL DEFAULT FALSE,
  mime TEXT NOT NULL,
  disk_name TEXT NOT NULL,
  static_disk_name TEXT NOT NULL,
  uploader_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CONSTRAINT unique_server_emoji_name UNIQUE (server_id, name)
);

-- 15. Server Icons
CREATE TABLE IF NOT EXISTS public.server_icons (
  server_id TEXT PRIMARY KEY REFERENCES public.servers(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  disk_name TEXT NOT NULL
);
