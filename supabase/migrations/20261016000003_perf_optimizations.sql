-- Haven Performance Optimizations: Covering foreign key indexes and RLS initplan optimizations

-- 1. Covering foreign key indexes
CREATE INDEX IF NOT EXISTS attachments_uploader_id_idx ON haven.attachments (uploader_id);
CREATE INDEX IF NOT EXISTS blocks_blocked_id_idx ON haven.blocks (blocked_id);
CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON haven.messages (reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS server_emojis_uploader_id_idx ON haven.server_emojis (uploader_id);
CREATE INDEX IF NOT EXISTS sounds_uploader_id_idx ON haven.sounds (uploader_id);

-- 2. Adjust overlapping policies by replacing with specific actions and (select auth.uid()) initplan
-- Channels
DROP POLICY IF EXISTS channels_modify ON haven.channels;
CREATE POLICY channels_insert ON haven.channels FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY channels_update ON haven.channels FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY channels_delete ON haven.channels FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.channels.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);

-- Invites
DROP POLICY IF EXISTS invites_modify ON haven.invites;
CREATE POLICY invites_insert ON haven.invites FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY invites_update ON haven.invites FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY invites_delete ON haven.invites FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.invites.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);

-- Conversation Members
DROP POLICY IF EXISTS conv_members_modify ON haven.conversation_members;
CREATE POLICY conv_members_insert ON haven.conversation_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY conv_members_delete ON haven.conversation_members FOR DELETE TO authenticated USING (
  user_id = ((select auth.uid())::text)
);

-- Server Emojis
DROP POLICY IF EXISTS emojis_modify ON haven.server_emojis;
CREATE POLICY emojis_insert ON haven.server_emojis FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY emojis_update ON haven.server_emojis FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY emojis_delete ON haven.server_emojis FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_emojis.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);

-- Server Icons
DROP POLICY IF EXISTS icons_modify ON haven.server_icons;
CREATE POLICY icons_insert ON haven.server_icons FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY icons_update ON haven.server_icons FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
CREATE POLICY icons_delete ON haven.server_icons FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM haven.members m WHERE m.server_id = haven.server_icons.server_id AND m.user_id = ((select auth.uid())::text) AND m.role IN ('owner', 'admin'))
);
