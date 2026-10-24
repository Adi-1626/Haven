export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type Role = 'owner' | 'admin' | 'member';
export interface User { id: string; username: string; displayName: string; bio: string; avatar: string; status: Presence; createdAt: number; settings?: Record<string, unknown> }
export interface Server { id: string; name: string; icon: string; description: string; ownerId: string; role: Role; createdAt: number }
export interface ServerEmoji { id: string; serverId: string; name: string; animated: boolean; url: string; staticUrl: string; uploaderId: string; createdAt: number }
export interface Channel { id: string; serverId: string; name: string; type: 'text' | 'voice'; topic: string; position: number }
export interface Attachment { id: string; name: string; mime: string; size: number; url: string }
export interface Message { id: string; channelId: string | null; conversationId: string | null; authorId: string; content: string; replyTo: string | null; createdAt: number; editedAt: number | null; attachments: Attachment[]; reactions: { emoji: string; userIds: string[] }[] }
export interface Conversation { id: string; name: string; memberIds: string[]; createdAt: number }
export interface FriendRequest { id: string; fromId: string; toId: string; createdAt: number }
export interface Sound { id: string; serverId: string; name: string; url: string; uploaderId: string }
export interface VoicePeer { socketId: string; user: User; channelId: string; muted: boolean; deafened: boolean; sharing: boolean; speaking?: boolean; serverMuted?: boolean; serverDeafened?: boolean; streamProtocol?: number; broadcastId?: string; signaling?: number }
export interface Bootstrap { user: User; users: User[]; servers: Server[]; channels: Channel[]; conversations: Conversation[]; friends: string[]; requests: FriendRequest[]; blocked: string[]; voice: VoicePeer[]; serverEmojis: ServerEmoji[] }
