import type { Bootstrap, Channel, Conversation, FriendRequest, Message, Server, ServerEmoji, Sound, User, VoicePeer } from '@haven/shared/types';

export interface MockDatabase {
  me: User;
  users: Map<string, User>;
  servers: Map<string, Server>;
  channels: Map<string, Channel>;
  conversations: Map<string, Conversation>;
  friends: Set<string>;
  requests: Map<string, FriendRequest>;
  blocked: Set<string>;
  voice: Map<string, VoicePeer>;
  serverEmojis: ServerEmoji[];
  messages: Message[];
  sounds: Map<string, Sound>;
  attachments: Map<string, { id: string; name: string; mime: string; size: number; url: string; data: Buffer }>;
  authSessionActive: boolean;
}

export function createInitialMockDatabase(): MockDatabase {
  const me: User = {
    id: 'usr-test-alex',
    username: 'alex_zenith',
    displayName: 'Alex Mercer',
    bio: 'Designing Haven 1.0 Zenith · Minimal UI & Pure Focus',
    avatar: '✨',
    status: 'online',
    createdAt: 1704067200000,
    settings: {
      theme: 'dark',
      compactMode: false,
    },
  };

  const usersList: User[] = [
    me,
    {
      id: 'usr-elena',
      username: 'elena_r',
      displayName: 'Elena Rostova',
      bio: 'Sound design, spatial audio & acoustics.',
      avatar: '🎧',
      status: 'online',
      createdAt: 1704153600000,
    },
    {
      id: 'usr-marcus',
      username: 'marcus_v',
      displayName: 'Marcus Vance',
      bio: 'Systems architect. Always testing edge cases.',
      avatar: '🛰️',
      status: 'dnd',
      createdAt: 1704240000000,
    },
    {
      id: 'usr-sarah',
      username: 'sarah_chen',
      displayName: 'Sarah Chen',
      bio: 'Product lead & typography enthusiast.',
      avatar: '🌿',
      status: 'idle',
      createdAt: 1704326400000,
    },
    {
      id: 'usr-devon',
      username: 'devon_k',
      displayName: 'Devon Knox',
      bio: 'Frontend animations & micro-interactions.',
      avatar: '🌊',
      status: 'offline',
      createdAt: 1704412800000,
    },
    {
      id: 'usr-kai',
      username: 'kai_t',
      displayName: 'Kai Tanaka',
      bio: 'Community moderator & weekend gamer.',
      avatar: '🎮',
      status: 'online',
      createdAt: 1704499200000,
    },
    {
      id: 'usr-maya',
      username: 'maya_l',
      displayName: 'Maya Lin',
      bio: 'Design systems and accessibility.',
      avatar: '🌸',
      status: 'online',
      createdAt: 1704505000000,
    },
    {
      id: 'usr-liam',
      username: 'liam_v',
      displayName: 'Liam Vance',
      bio: 'Infra and real-time audio pipeline.',
      avatar: '⚡',
      status: 'idle',
      createdAt: 1704515000000,
    },
  ];

  const serversList: Server[] = [
    {
      id: 'srv-zenith',
      name: 'Zenith Design Lab',
      icon: '🎨',
      description: 'Haven 1.0 Zenith UI design, tokens & frontend feedback',
      ownerId: me.id,
      role: 'owner',
      createdAt: 1704100000000,
    },
    {
      id: 'srv-eng',
      name: 'Haven Core Engineering',
      icon: '⚡',
      description: 'Architecture, performance benchmarks and testing',
      ownerId: 'usr-marcus',
      role: 'admin',
      createdAt: 1704200000000,
    },
    {
      id: 'srv-lounge',
      name: 'Night Owl Lounge',
      icon: '🌙',
      description: 'Cozy late-night conversations and screen shares',
      ownerId: 'usr-elena',
      role: 'member',
      createdAt: 1704300000000,
    },
  ];

  const channelsList: Channel[] = [
    // Zenith Design Lab channels
    {
      id: 'chn-design-tokens',
      serverId: 'srv-zenith',
      name: 'design-tokens',
      type: 'text',
      topic: 'Design tokens, color calibration & typography hierarchy',
      position: 0,
    },
    {
      id: 'chn-feedback',
      serverId: 'srv-zenith',
      name: 'feedback',
      type: 'text',
      topic: 'Visual review and usability critique',
      position: 1,
    },
    {
      id: 'chn-announcements',
      serverId: 'srv-zenith',
      name: 'announcements',
      type: 'text',
      topic: 'Zenith milestone updates and changelogs',
      position: 2,
    },
    {
      id: 'chn-studio-voice',
      serverId: 'srv-zenith',
      name: 'Studio Room',
      type: 'voice',
      topic: 'Live audio, screen share & design critiques',
      position: 3,
    },
    {
      id: 'chn-lounge-voice',
      serverId: 'srv-zenith',
      name: 'Design Lounge',
      type: 'voice',
      topic: 'Casual co-working & background music',
      position: 4,
    },

    // Haven Core Engineering channels
    {
      id: 'chn-general-dev',
      serverId: 'srv-eng',
      name: 'general-dev',
      type: 'text',
      topic: 'Core protocol discussions and code reviews',
      position: 0,
    },
    {
      id: 'chn-audio-pipeline',
      serverId: 'srv-eng',
      name: 'audio-pipeline',
      type: 'text',
      topic: 'Opus, RNNoise and WebRTC signaling discussions',
      position: 1,
    },
    {
      id: 'chn-eng-voice',
      serverId: 'srv-eng',
      name: 'Engineering Voice',
      type: 'voice',
      topic: 'Architecture sync and debugging',
      position: 2,
    },

    // Night Owl Lounge channels
    {
      id: 'chn-campfire',
      serverId: 'srv-lounge',
      name: 'campfire',
      type: 'text',
      topic: 'Casual chat, music recommendations and chill conversations',
      position: 0,
    },
    {
      id: 'chn-chill-voice',
      serverId: 'srv-lounge',
      name: 'Chill Voice',
      type: 'voice',
      topic: 'Hangout room',
      position: 1,
    },
  ];

  const conversationsList: Conversation[] = [
    {
      id: 'dm-elena',
      name: '',
      memberIds: [me.id, 'usr-elena'],
      createdAt: 1704500000000,
    },
    {
      id: 'dm-sarah',
      name: '',
      memberIds: [me.id, 'usr-sarah'],
      createdAt: 1704510000000,
    },
    {
      id: 'grp-design',
      name: 'Design System Working Group',
      memberIds: [me.id, 'usr-sarah', 'usr-devon'],
      createdAt: 1704520000000,
    },
  ];

  const messagesList: Message[] = [
    // #design-tokens messages
    {
      id: 'msg-dt-1',
      channelId: 'chn-design-tokens',
      conversationId: null,
      authorId: 'usr-sarah',
      content: 'Welcome to the Haven 1.0 Zenith design review. We have calibrated the typography pairing: Space Grotesk for display headers and Inter for crisp UI readability.',
      replyTo: null,
      createdAt: 1704600000000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '✨', userIds: [me.id, 'usr-elena', 'usr-marcus'] },
        { emoji: '👍', userIds: ['usr-devon'] },
      ],
    },
    {
      id: 'msg-dt-2',
      channelId: 'chn-design-tokens',
      conversationId: null,
      authorId: 'usr-marcus',
      content: 'Contrast ratios verify at WCAG AAA standards across all dark-mode palettes. The surface layers use subtle optical elevation rather than heavy drop shadows.',
      replyTo: null,
      createdAt: 1704600600000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '💯', userIds: [me.id] },
      ],
    },
    {
      id: 'msg-dt-3',
      channelId: 'chn-design-tokens',
      conversationId: null,
      authorId: me.id,
      content: 'Checked the voice room tile hierarchy and composer micro-interactions. The layout stays clean and focused without unnecessary visual noise.',
      replyTo: 'msg-dt-1',
      createdAt: 1704601200000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '🔥', userIds: ['usr-sarah', 'usr-elena'] },
      ],
    },

    // #feedback messages
    {
      id: 'msg-fb-1',
      channelId: 'chn-feedback',
      conversationId: null,
      authorId: 'usr-elena',
      content: 'I verified the 390×844 mobile viewport. The navigation drawer transitions smoothly and there is zero unwanted horizontal overflow.',
      replyTo: null,
      createdAt: 1704602000000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '📱', userIds: [me.id] },
      ],
    },
    {
      id: 'msg-fb-2',
      channelId: 'chn-feedback',
      conversationId: null,
      authorId: 'usr-devon',
      content: 'Here is the exported token palette and Zenith specification document for inspection.',
      replyTo: null,
      createdAt: 1704602600000,
      editedAt: null,
      attachments: [
        {
          id: 'att-zenith-spec',
          name: 'zenith-ui-spec.pdf',
          mime: 'application/pdf',
          size: 145200,
          url: '/api/attachments/att-zenith-spec',
        },
        {
          id: 'att-zenith-palette',
          name: 'zenith-color-tokens.png',
          mime: 'image/png',
          size: 89600,
          url: '/api/attachments/att-zenith-palette',
        },
      ],
      reactions: [
        { emoji: '❤️', userIds: [me.id, 'usr-sarah'] },
      ],
    },

    // #announcements
    {
      id: 'msg-anc-1',
      channelId: 'chn-announcements',
      conversationId: null,
      authorId: me.id,
      content: 'Milestone 1 completed. Local UI Testing Mode is now ready for functional validation across desktop, tablet, and mobile breakpoints.',
      replyTo: null,
      createdAt: 1704603000000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '🎉', userIds: ['usr-elena', 'usr-marcus', 'usr-sarah', 'usr-devon', 'usr-kai'] },
      ],
    },

    // DM with Elena
    {
      id: 'msg-dm-elena-1',
      channelId: null,
      conversationId: 'dm-elena',
      authorId: 'usr-elena',
      content: 'Hey Alex! The audio pipeline spatial mix is ready. Join the Studio Room whenever you want to test the screen-sharing layout.',
      replyTo: null,
      createdAt: 1704604000000,
      editedAt: null,
      attachments: [],
      reactions: [],
    },
    {
      id: 'msg-dm-elena-2',
      channelId: null,
      conversationId: 'dm-elena',
      authorId: me.id,
      content: 'Sounds great! I am jumping in now to verify the live video viewer.',
      replyTo: null,
      createdAt: 1704604300000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '🎧', userIds: ['usr-elena'] },
      ],
    },

    // Group DM
    {
      id: 'msg-grp-1',
      channelId: null,
      conversationId: 'grp-design',
      authorId: 'usr-sarah',
      content: 'Testing responsive layout between 500×550 (Electron min) and 1920×1080 (Full HD).',
      replyTo: null,
      createdAt: 1704605000000,
      editedAt: null,
      attachments: [],
      reactions: [],
    },
    {
      id: 'msg-grp-2',
      channelId: null,
      conversationId: 'grp-design',
      authorId: 'usr-devon',
      content: 'Grid scales proportionally, sidebars collapse nicely on mobile, and tap targets stay comfortable.',
      replyTo: null,
      createdAt: 1704605400000,
      editedAt: null,
      attachments: [],
      reactions: [
        { emoji: '✨', userIds: [me.id] },
      ],
    },
  ];

  const voiceList: VoicePeer[] = [
    // ── Studio Room: Connected Participants, 1 Sharing (Elena) ──
    {
      socketId: 'sock-studio-elena',
      user: usersList.find(u => u.id === 'usr-elena')!,
      channelId: 'chn-studio-voice',
      muted: false,
      deafened: false,
      sharing: true, // Elena is streaming live!
      speaking: true,
      streamProtocol: 1,
      broadcastId: 'broadcast-studio-elena',
    },
    {
      socketId: 'sock-studio-sarah',
      user: usersList.find(u => u.id === 'usr-sarah')!,
      channelId: 'chn-studio-voice',
      muted: false,
      deafened: false,
      sharing: false,
      speaking: false,
    },
    {
      socketId: 'sock-studio-devon',
      user: usersList.find(u => u.id === 'usr-devon')!,
      channelId: 'chn-studio-voice',
      muted: false,
      deafened: false,
      sharing: false,
      speaking: false,
    },

    // ── Design Lounge: Casual Room ────────
    {
      socketId: 'sock-lounge-kai',
      user: usersList.find(u => u.id === 'usr-kai')!,
      channelId: 'chn-lounge-voice',
      muted: false,
      deafened: false,
      sharing: false,
      speaking: false,
    },
  ];

  const serverEmojisList: ServerEmoji[] = [
    {
      id: 'emj-zenith',
      serverId: 'srv-zenith',
      name: 'zenith',
      animated: false,
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%236366f1"><circle cx="12" cy="12" r="10"/></svg>',
      staticUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%236366f1"><circle cx="12" cy="12" r="10"/></svg>',
      uploaderId: me.id,
      createdAt: 1704100000000,
    },
    {
      id: 'emj-spark',
      serverId: 'srv-zenith',
      name: 'spark',
      animated: false,
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%23ec4899"><polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/></svg>',
      staticUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%23ec4899"><polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9"/></svg>',
      uploaderId: me.id,
      createdAt: 1704100000000,
    },
  ];

  const soundsList: Sound[] = [
    { id: 'snd-chime', serverId: 'srv-zenith', name: 'Zenith Chime', url: '/api/sounds/snd-chime/audio', uploaderId: me.id },
    { id: 'snd-pop', serverId: 'srv-zenith', name: 'Bubble Pop', url: '/api/sounds/snd-pop/audio', uploaderId: 'usr-elena' },
    { id: 'snd-tada', serverId: 'srv-zenith', name: 'Victory Tada', url: '/api/sounds/snd-tada/audio', uploaderId: 'usr-devon' },
    { id: 'snd-laser', serverId: 'srv-eng', name: 'Core Synth Pulse', url: '/api/sounds/snd-laser/audio', uploaderId: 'usr-marcus' },
    { id: 'snd-owl', serverId: 'srv-lounge', name: 'Night Owl Ambient', url: '/api/sounds/snd-owl/audio', uploaderId: 'usr-elena' },
  ];

  const requestsMap = new Map<string, FriendRequest>();
  requestsMap.set('req-kai', {
    id: 'req-kai',
    fromId: 'usr-kai',
    toId: me.id,
    createdAt: 1704550000000,
  });

  return {
    me,
    users: new Map(usersList.map(u => [u.id, u])),
    servers: new Map(serversList.map(s => [s.id, s])),
    channels: new Map(channelsList.map(c => [c.id, c])),
    conversations: new Map(conversationsList.map(c => [c.id, c])),
    friends: new Set(['usr-elena', 'usr-marcus', 'usr-sarah', 'usr-devon']),
    requests: requestsMap,
    blocked: new Set<string>(),
    voice: new Map(voiceList.map(v => [v.socketId, v])),
    serverEmojis: serverEmojisList,
    messages: messagesList,
    sounds: new Map(soundsList.map(s => [s.id, s])),
    attachments: new Map(),
    authSessionActive: true,
  };
}

export function buildBootstrapPayload(db: MockDatabase): Bootstrap {
  return {
    user: db.me,
    users: Array.from(db.users.values()),
    servers: Array.from(db.servers.values()),
    channels: Array.from(db.channels.values()),
    conversations: Array.from(db.conversations.values()),
    friends: Array.from(db.friends),
    requests: Array.from(db.requests.values()),
    blocked: Array.from(db.blocked),
    voice: Array.from(db.voice.values()),
    serverEmojis: db.serverEmojis,
  };
}
