import type { User, Message, VoicePeer, ServerEmoji } from '@haven/shared/types';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  password?: string;
  bio: string;
  avatar: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  settings: string;
  createdAt: number;
}

export interface ServerRow {
  id: string;
  name: string;
  icon: string;
  description: string;
  ownerId: string;
  createdAt: number;
  role?: string;
}

export interface MemberRow {
  serverId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  serverMuted: boolean;
  serverDeafened: boolean;
}

export interface ChannelRow {
  id: string;
  serverId: string;
  name: string;
  type: 'text' | 'voice';
  topic: string;
  position: number;
}

export interface InviteRow {
  code: string;
  serverId: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

export interface ConversationRow {
  id: string;
  name: string;
  createdAt: number;
  memberIds?: string[];
}

export interface MessageRow {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  authorId: string;
  content: string;
  replyTo: string | null;
  createdAt: number;
  editedAt: number | null;
}

export interface AttachmentRow {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  uploaderId: string;
  messageId: string | null;
  name: string;
  mime: string;
  size: number;
  diskName: string;
}

export interface ReactionRow {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface FriendRequestRow {
  id: string;
  fromId: string;
  toId: string;
  createdAt: number;
}

export interface SoundRow {
  id: string;
  serverId: string;
  uploaderId: string;
  name: string;
  mime: string;
  size: number;
  diskName: string;
}

export interface ServerEmojiRow {
  id: string;
  serverId: string;
  name: string;
  animated: boolean;
  mime: string;
  diskName: string;
  staticDiskName: string;
  uploaderId: string;
  createdAt: number;
}

export interface ServerIconRow {
  serverId: string;
  mime: string;
  diskName: string;
}

export interface MessageAttachmentRow { messageId: string; id: string; name: string; mime: string; size: number }
export interface MessageReactionRow { messageId: string; emoji: string; userId: string }

/** An attachment was already claimed, belongs to someone else or to another destination. Rolls back the message. */
export class AttachmentClaimError extends Error {
  status = 403 as const;
  constructor() { super('Attachment permission denied'); }
}

/** Either direction of a friend request already exists (detected under the pair lock). */
export class FriendRequestConflictError extends Error {
  status = 409 as const;
  constructor(public incoming: boolean) {
    super(incoming ? 'This person already sent you a request. Accept it in Incoming requests.' : 'You already sent this person a friend request');
  }
}

export interface DatabaseAdapter {
  isPostgres: boolean;
  close(): Promise<void>;
  /** Cheap round trip used by startup and the readiness probe. */
  checkConnection(): Promise<void>;
  /**
   * Hosted only: whether a Supabase Auth session (JWT `session_id`) still exists. `undefined` means the
   * check is unavailable in this database (function not installed or not granted), never "revoked".
   */
  isAuthSessionActive?(sessionId: string, userId: string): Promise<boolean | undefined>;

  // Users
  getUser(userId: string): Promise<UserRow | undefined>;
  getUserByUsername(username: string): Promise<UserRow | undefined>;
  /** Batch lookup; missing ids are omitted. Order is unspecified. */
  getUsers(userIds: string[]): Promise<UserRow[]>;
  createUser(user: { id: string; username: string; displayName: string; password?: string; settings?: string; createdAt: number }): Promise<void>;
  /** Changes the username; resolves false when another account already uses it (case-insensitive). */
  setUsername(userId: string, username: string): Promise<boolean>;
  completeUserProfile(userId: string, username: string, displayName: string): Promise<'completed' | 'unavailable' | 'already-complete'>;
  updateUser(userId: string, patch: { displayName?: string; bio?: string; avatar?: string; status?: string; settings?: string }): Promise<void>;
  getVisibleUsers(userId: string): Promise<string[]>;

  // Sessions
  createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>;
  getSessionUserId(tokenHash: string, now: number): Promise<string | undefined>;
  hasValidSession(tokenHash: string, now: number): Promise<boolean>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;

  // Servers
  getUserServers(userId: string): Promise<ServerRow[]>;
  getServer(serverId: string): Promise<ServerRow | undefined>;
  createServer(server: { id: string; name: string; icon: string; description: string; ownerId: string; createdAt: number }, initialChannelId: string, voiceChannelId: string): Promise<void>;
  updateServer(serverId: string, patch: { name?: string; icon?: string; description?: string }): Promise<void>;
  deleteServer(serverId: string): Promise<{ diskNames: string[] }>;

  // Members
  getMember(serverId: string, userId: string): Promise<MemberRow | undefined>;
  getServerMembers(serverId: string): Promise<MemberRow[]>;
  getServerAudience(serverId: string): Promise<string[]>;
  addMember(serverId: string, userId: string, role?: 'owner' | 'admin' | 'member'): Promise<void>;
  updateMemberRole(serverId: string, userId: string, role: 'admin' | 'member'): Promise<void>;
  updateMemberVoice(serverId: string, userId: string, patch: { serverMuted?: boolean; serverDeafened?: boolean }): Promise<void>;
  removeMember(serverId: string, userId: string): Promise<void>;

  // Channels
  getUserChannels(userId: string): Promise<ChannelRow[]>;
  getChannel(channelId: string): Promise<ChannelRow | undefined>;
  getNextChannelPosition(serverId: string): Promise<number>;
  createChannel(channel: { id: string; serverId: string; name: string; type: 'text' | 'voice'; topic: string; position: number }): Promise<void>;
  updateChannel(channelId: string, patch: { name?: string; topic?: string; position?: number }): Promise<void>;
  deleteChannel(channelId: string): Promise<{ diskNames: string[] }>;

  // Invites
  getInvite(code: string): Promise<InviteRow | undefined>;
  getServerInvites(serverId: string): Promise<InviteRow[]>;
  createInvite(invite: { code: string; serverId: string; createdAt: number; expiresAt: number | null }): Promise<void>;
  revokeInvite(code: string, now: number): Promise<void>;
  joinInvite(code: string, userId: string): Promise<InviteRow>;

  // Conversations
  getUserConversations(userId: string): Promise<ConversationRow[]>;
  getConversation(conversationId: string): Promise<ConversationRow | undefined>;
  getConversationMemberIds(conversationId: string): Promise<string[]>;
  isConversationMember(conversationId: string, userId: string): Promise<boolean>;
  findDirectConversation(user1: string, user2: string): Promise<string | undefined>;
  createConversation(conversationId: string, name: string, memberIds: string[], createdAt: number): Promise<void>;
  updateConversation(conversationId: string, name: string): Promise<void>;
  removeConversationMember(conversationId: string, userId: string): Promise<void>;

  // Messages
  /** Newest first. `beforeId` breaks ties for messages sharing the `before` timestamp. */
  getMessages(target: { channelId?: string; conversationId?: string }, before: number, query: string, limit: number, beforeId?: string): Promise<string[]>;
  getMessage(messageId: string): Promise<MessageRow | undefined>;
  getMessagesByIds(messageIds: string[]): Promise<MessageRow[]>;
  getAttachmentsForMessages(messageIds: string[]): Promise<MessageAttachmentRow[]>;
  getReactionsForMessages(messageIds: string[]): Promise<MessageReactionRow[]>;
  /** Claims every attachment atomically (unclaimed, same uploader and destination) or throws AttachmentClaimError. */
  createMessage(message: { id: string; channelId?: string | null; conversationId?: string | null; authorId: string; content: string; replyTo?: string | null; attachmentIds: string[] }): Promise<number>;
  updateMessage(messageId: string, content: string, editedAt: number): Promise<void>;
  deleteMessage(messageId: string): Promise<{ diskNames: string[] }>;

  // Attachments
  getAttachment(id: string): Promise<AttachmentRow | undefined>;
  getMessageAttachments(messageId: string): Promise<Array<{ id: string; name: string; mime: string; size: number }>>;
  createAttachment(attachment: { id: string; channelId?: string | null; conversationId?: string | null; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void>;

  // Reactions
  getMessageReactions(messageId: string): Promise<Array<{ emoji: string; userId: string }>>;
  toggleReaction(messageId: string, userId: string, emoji: string): Promise<boolean>;

  // Friends & Blocks
  getFriends(userId: string): Promise<string[]>;
  isFriend(userId: string, targetId: string): Promise<boolean>;
  getFriendRequests(userId: string): Promise<FriendRequestRow[]>;
  getFriendRequest(id: string): Promise<FriendRequestRow | undefined>;
  findPendingFriendRequest(user1: string, user2: string): Promise<FriendRequestRow | undefined>;
  /** Throws FriendRequestConflictError when a request already exists in either direction. */
  createFriendRequest(id: string, fromId: string, toId: string, createdAt: number): Promise<void>;
  acceptFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string }>;
  deleteFriendRequest(id: string, userId: string): Promise<{ fromId: string; toId: string } | undefined>;
  removeFriend(userId: string, friendId: string): Promise<void>;
  getBlocked(userId: string): Promise<string[]>;
  isBlockedPair(user1: string, user2: string): Promise<boolean>;
  addBlock(userId: string, targetId: string, createdAt: number): Promise<void>;
  removeBlock(userId: string, targetId: string): Promise<void>;

  // Sounds
  getServerSounds(serverId: string): Promise<SoundRow[]>;
  getSound(id: string): Promise<SoundRow | undefined>;
  createSound(sound: { id: string; serverId: string; uploaderId: string; name: string; mime: string; size: number; diskName: string }): Promise<void>;
  deleteSound(id: string): Promise<{ diskName: string }>;

  // Server Emojis
  getUserServerEmojis(userId: string): Promise<ServerEmojiRow[]>;
  getServerEmojis(serverId: string): Promise<ServerEmojiRow[]>;
  getServerEmoji(id: string): Promise<ServerEmojiRow | undefined>;
  getServerEmojiByName(serverId: string, name: string): Promise<ServerEmojiRow | undefined>;
  getServerEmojiCount(serverId: string): Promise<number>;
  createServerEmoji(emoji: { id: string; serverId: string; name: string; animated: boolean; mime: string; diskName: string; staticDiskName: string; uploaderId: string; createdAt: number }): Promise<void>;
  updateServerEmojiName(id: string, name: string): Promise<void>;
  deleteServerEmoji(id: string): Promise<{ diskName: string; staticDiskName: string }>;

  // Server Icons
  getServerIcon(serverId: string): Promise<ServerIconRow | undefined>;
  upsertServerIcon(serverId: string, mime: string, diskName: string, iconUrl: string): Promise<{ previousDiskName?: string }>;
  deleteServerIcon(serverId: string): Promise<{ diskName?: string }>;
}
