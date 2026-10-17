# Haven Supabase Architecture & Migration Guide

This directory contains the database schema and configurations prepared for Haven's planned Supabase PostgreSQL, Auth, and Storage migration.

> [!IMPORTANT]
> As part of the monorepo restructuring, local SQLite databases (`data/relay.sqlite`), local file uploads (`data/uploads`), and existing user settings are preserved. This schema is the blueprint for the upcoming database/auth migration phase.

---

## 1. Directory Structure

```
supabase/
├── config.toml                              # Local Supabase CLI configuration
├── migrations/
│   └── 20261016000001_initial_schema.sql    # Clean PostgreSQL DDL for Haven
└── README.md                                # Migration and deployment notes
```

---

## 2. PostgreSQL Data Model vs. SQLite Schema

| SQLite Table | PostgreSQL Table | Primary Key | Notes |
| :--- | :--- | :--- | :--- |
| `users` | `public.users` | `id TEXT` | Compatible with Supabase `auth.users(id)` |
| `sessions` | `public.sessions` | `token TEXT` | Legacy session fallback; replaced by Supabase JWT |
| `servers` | `public.servers` | `id TEXT` | Communities |
| `members` | `public.members` | `(server_id, user_id)` | Role-based access (`owner`, `admin`, `member`) |
| `channels` | `public.channels` | `id TEXT` | `text` or `voice` channels |
| `invites` | `public.invites` | `code TEXT` | Base64URL codes with expiry and revocation |
| `conversations` | `public.conversations` | `id TEXT` | Group/Direct messaging threads |
| `conversationMembers` | `public.conversation_members`| `(conversation_id, user_id)` | Conversation membership |
| `messages` | `public.messages` | `id TEXT` | Indexed by channel/conversation and timestamp |
| `attachments` | `public.attachments` | `id TEXT` | Attachment metadata |
| `reactions` | `public.reactions` | `(message_id, user_id, emoji)`| Emoji reactions |
| `friendRequests` | `public.friend_requests` | `id TEXT` | Mutual friend requests with deduplication |
| `friends` | `public.friends` | `(user_id, friend_id)` | Bidirectional friendship links |
| `blocks` | `public.blocks` | `(user_id, blocked_id)` | User blocklist |
| `sounds` | `public.sounds` | `id TEXT` | Soundboard clips (up to 5 MB) |
| `serverEmojis` | `public.server_emojis` | `id TEXT` | Custom animated & static server emojis |
| `serverIcons` | `public.server_icons` | `server_id TEXT` | Server icons |

---

## 3. Storage Buckets for Planned Migration

When migrating to Supabase Storage, four storage buckets should be provisioned:

1. **`attachments`** (private):
   - Max file size: 25 MB
   - Access: Authenticated channel/conversation members.
2. **`avatars`** (public):
   - Max file size: 1 MB
   - Access: Public read, owner write.
3. **`server-icons`** (public):
   - Max file size: 1 MB
   - Access: Public read, server admin/owner write.
4. **`sounds`** (private):
   - Max file size: 5 MB
   - Allowed MIME: `audio/*`
   - Access: Authenticated server members.

---

## 4. Applying Migrations with Supabase CLI

```bash
# 1. Install Supabase CLI (if not already installed)
npm install -g supabase

# 2. Link your Supabase project
supabase link --project-ref <your-project-ref>

# 3. Push schema to Supabase cloud
supabase db push
```
