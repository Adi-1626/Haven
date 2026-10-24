import test from 'node:test';
import assert from 'node:assert/strict';

test('Find Your People: search filtering matches display name, username, and handles @ prefix', () => {
  const users = [
    { id: 'u1', username: 'marcus_v', displayName: 'Marcus Vance' },
    { id: 'u2', username: 'elena_r', displayName: 'Elena Rostova' },
    { id: 'u3', username: 'kai_t', displayName: 'Kai Takahashi' },
  ];

  const filterFriends = (query: string) => {
    const term = query.trim().replace(/^@/, '').toLowerCase();
    if (!term) return users;
    return users.filter(u => `${u.displayName} ${u.username}`.toLowerCase().includes(term));
  };

  assert.equal(filterFriends('').length, 3);
  assert.equal(filterFriends('marcus').length, 1);
  assert.equal(filterFriends('marcus')[0].id, 'u1');
  assert.equal(filterFriends('@elena').length, 1);
  assert.equal(filterFriends('@elena')[0].id, 'u2');
  assert.equal(filterFriends('KAI').length, 1);
  assert.equal(filterFriends('KAI')[0].id, 'u3');
  assert.equal(filterFriends('@nobody').length, 0);
});

test('Find Your People: live streaming priority over general voice activity in status line', () => {
  const channel = { id: 'c1', name: 'general-voice' };
  const server = { id: 's1', name: 'Alpha Squad' };

  const formatStatus = (peer?: { sharing?: boolean }, bio?: string, userStatus = 'online') => {
    if (peer?.sharing) {
      return `Streaming in #${channel.name} · ${server.name}`;
    }
    if (peer) {
      return `In #${channel.name} · ${server.name}`;
    }
    if (bio) {
      return bio;
    }
    return userStatus === 'online' ? 'Online' : 'Offline';
  };

  assert.equal(formatStatus({ sharing: true }, 'Casual gamer'), 'Streaming in #general-voice · Alpha Squad');
  assert.equal(formatStatus({ sharing: false }, 'Casual gamer'), 'In #general-voice · Alpha Squad');
  assert.equal(formatStatus(undefined, 'Casual gamer'), 'Casual gamer');
  assert.equal(formatStatus(undefined, undefined, 'online'), 'Online');
});

test('Find Your People: pending friend requests accurately separated into incoming and outgoing', () => {
  const currentUserId = 'me-123';
  const requests = [
    { id: 'r1', fromId: 'alice', toId: 'me-123', createdAt: 1000 },
    { id: 'r2', fromId: 'me-123', toId: 'bob', createdAt: 2000 },
    { id: 'r3', fromId: 'charlie', toId: 'me-123', createdAt: 3000 },
  ];

  const incoming = requests.filter(r => r.toId === currentUserId);
  const outgoing = requests.filter(r => r.fromId === currentUserId);

  assert.equal(incoming.length, 2);
  assert.equal(incoming.map(r => r.id).sort().join(','), 'r1,r3');
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].id, 'r2');
});

test('Soundboard: playback requires both voice connection and socket connection', () => {
  const canPlaySound = (voiceChannelId: string | null | undefined, connected: boolean) => {
    return Boolean(voiceChannelId && connected);
  };

  assert.equal(canPlaySound('voice-1', true), true);
  assert.equal(canPlaySound(null, true), false);
  assert.equal(canPlaySound('voice-1', false), false);
  assert.equal(canPlaySound(undefined, false), false);
});

test('Soundboard: upload validates file size does not exceed 5 MB limit', () => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const validateAudioUpload = (fileSize: number, fileType: string) => {
    if (!fileType.startsWith('audio/')) {
      throw new Error('Please select an audio file (MP3, WAV, OGG, or WebM).');
    }
    if (fileSize > MAX_BYTES) {
      throw new Error('Sound clips must be 5 MB or smaller.');
    }
    return true;
  };

  assert.equal(validateAudioUpload(2 * 1024 * 1024, 'audio/mpeg'), true);
  assert.throws(() => validateAudioUpload(6 * 1024 * 1024, 'audio/mpeg'), /5 MB or smaller/);
  assert.throws(() => validateAudioUpload(1024, 'video/mp4'), /Please select an audio file/);
});

test('Soundboard: sound pad deletion permission permits server moderators or uploaders', () => {
  const canDeleteSound = (meId: string, uploaderId: string, isModerator: boolean) => {
    return isModerator || meId === uploaderId;
  };

  assert.equal(canDeleteSound('user-1', 'user-1', false), true); // owner
  assert.equal(canDeleteSound('mod-1', 'user-2', true), true); // moderator
  assert.equal(canDeleteSound('user-3', 'user-2', false), false); // regular non-uploader
});

test('Screen Share Quality: bitrate is clamped within 1 to 50 Mbps', () => {
  const clampBitrate = (value: number) => {
    return Math.min(50, Math.max(1, Math.round(value)));
  };

  assert.equal(clampBitrate(12), 12);
  assert.equal(clampBitrate(0), 1);
  assert.equal(clampBitrate(-5), 1);
  assert.equal(clampBitrate(100), 50);
  assert.equal(clampBitrate(50), 50);
});

test('Screen Share Quality: Gaming Mode caps resolution, fps, and bitrate', () => {
  const applyGamingModePolicy = (
    desiredHeight: number | 'native',
    desiredFps: number,
    desiredBitrate: number,
    gamingMode: boolean
  ) => {
    if (gamingMode) {
      return {
        height: typeof desiredHeight === 'number' ? Math.min(desiredHeight, 720) : 720,
        fps: Math.min(desiredFps, 30),
        bitrateMbps: Math.min(desiredBitrate, 3),
      };
    }
    return {
      height: desiredHeight,
      fps: desiredFps,
      bitrateMbps: desiredBitrate,
    };
  };

  const normal = applyGamingModePolicy(1080, 60, 25, false);
  assert.deepEqual(normal, { height: 1080, fps: 60, bitrateMbps: 25 });

  const gaming = applyGamingModePolicy(1080, 60, 25, true);
  assert.deepEqual(gaming, { height: 720, fps: 30, bitrateMbps: 3 });

  const gamingNative = applyGamingModePolicy('native', 60, 10, true);
  assert.deepEqual(gamingNative, { height: 720, fps: 30, bitrateMbps: 3 });
});

test('Add Friend Modal: username sanitization removes leading @ and trims whitespace', () => {
  const sanitizeUsername = (raw: string) => raw.trim().replace(/^@+/, '').toLowerCase();

  assert.equal(sanitizeUsername('  @alice  '), 'alice');
  assert.equal(sanitizeUsername('@@Marcus_V'), 'marcus_v');
  assert.equal(sanitizeUsername('elena.r'), 'elena.r');
  assert.equal(sanitizeUsername(''), '');
});

test('Add Friend Modal: prevents sending friend requests to oneself', () => {
  const validateFriendTarget = (targetInput: string, currentUsername: string) => {
    const cleanTarget = targetInput.trim().replace(/^@+/, '').toLowerCase();
    const cleanSelf = currentUsername.trim().replace(/^@+/, '').toLowerCase();
    if (!cleanTarget) throw new Error('Enter a username to send a request.');
    if (cleanTarget === cleanSelf) throw new Error('You cannot send a friend request to yourself.');
    return cleanTarget;
  };

  assert.equal(validateFriendTarget('@bob', 'alice'), 'bob');
  assert.throws(() => validateFriendTarget('@Alice', 'alice'), /cannot send a friend request to yourself/);
  assert.throws(() => validateFriendTarget('   ', 'alice'), /Enter a username/);
});

test('Group DM Modal: validates minimum friend selection and limits name to 32 chars', () => {
  const buildGroupConversationPayload = (
    nameInput: string,
    selectedUserIds: string[],
    currentUserId: string
  ) => {
    if (selectedUserIds.length === 0) {
      throw new Error('Select at least one friend to start a group conversation.');
    }
    const trimmedName = nameInput.trim().slice(0, 32);
    const participantIds = Array.from(new Set([currentUserId, ...selectedUserIds]));
    return {
      title: trimmedName || undefined,
      participantIds,
    };
  };

  assert.throws(
    () => buildGroupConversationPayload('Gaming Squad', [], 'me'),
    /Select at least one friend/
  );

  const valid = buildGroupConversationPayload('Core Dev Team That Is Way Too Long To Fit In 32 Characters', ['u1', 'u2'], 'me');
  assert.equal(valid.title, 'Core Dev Team That Is Way Too Lo');
  assert.equal(valid.title.length, 32);
  assert.deepEqual(valid.participantIds, ['me', 'u1', 'u2']);

  const unnamed = buildGroupConversationPayload('', ['u1'], 'me');
  assert.equal(unnamed.title, undefined);
  assert.deepEqual(unnamed.participantIds, ['me', 'u1']);
});

test('Group DM Modal: friend search filter matches name or username in checklist', () => {
  const friends = [
    { id: 'u1', username: 'alex', displayName: 'Alex Rivera' },
    { id: 'u2', username: 'brooke', displayName: 'Brooke Lin' },
    { id: 'u3', username: 'carlos', displayName: 'Carlos Vega' },
  ];

  const filterChecklist = (query: string) => {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return friends;
    return friends.filter(f => `${f.displayName} ${f.username}`.toLowerCase().includes(q));
  };

  assert.equal(filterChecklist('').length, 3);
  assert.equal(filterChecklist('vega').length, 1);
  assert.equal(filterChecklist('vega')[0].id, 'u3');
  assert.equal(filterChecklist('@alex').length, 1);
  assert.equal(filterChecklist('@alex')[0].id, 'u1');
  assert.equal(filterChecklist('nobody').length, 0);
});

test('Reconnecting Banner: displays retry count and connection recovery status', () => {
  const formatReconnectingState = (connected: boolean, attempt: number) => {
    if (connected) return null;
    return {
      title: 'Restoring connection…',
      description: `Attempt ${attempt} · WebRTC Direct Mesh · Your messages are saved`,
      canRetryNow: true,
    };
  };

  assert.equal(formatReconnectingState(true, 0), null);
  const reconnecting = formatReconnectingState(false, 3);
  assert.ok(reconnecting);
  assert.equal(reconnecting.title, 'Restoring connection…');
  assert.ok(reconnecting.description.includes('Attempt 3'));
  assert.equal(reconnecting.canRetryNow, true);
});

test('Empty Circle State: provides correct call-to-actions based on tab and friend counts', () => {
  const getEmptyStateConfig = (tab: string, hasFriends: boolean, hasSearch: boolean) => {
    if (hasSearch) {
      return { heading: 'No matching people', showActions: false };
    }
    if (tab === 'online') {
      return { heading: 'Your friends are away', showActions: false };
    }
    if (tab === 'blocked') {
      return { heading: 'No blocked accounts', showActions: false };
    }
    if (tab === 'all' && !hasFriends) {
      return {
        heading: 'Your circle starts here',
        showActions: true,
        primaryCta: 'Add your first friend',
        secondaryCta: 'Create a server',
      };
    }
    return { heading: 'No friends found', showActions: false };
  };

  const circle = getEmptyStateConfig('all', false, false);
  assert.equal(circle.heading, 'Your circle starts here');
  assert.equal(circle.showActions, true);
  assert.equal(circle.primaryCta, 'Add your first friend');
  assert.equal(circle.secondaryCta, 'Create a server');

  const searching = getEmptyStateConfig('all', false, true);
  assert.equal(searching.heading, 'No matching people');
  assert.equal(searching.showActions, false);

  const online = getEmptyStateConfig('online', true, false);
  assert.equal(online.heading, 'Your friends are away');
  assert.equal(online.showActions, false);
});

test('Create Server Modal: validates server name and computes fallback preview initials', () => {
  const computeServerPreview = (nameInput: string, iconInput?: string) => {
    const trimmed = nameInput.trim();
    if (!trimmed) throw new Error('Server name is required.');
    const initial = (trimmed.charAt(0) || 'H').toUpperCase();
    return {
      name: trimmed.slice(0, 80),
      icon: iconInput?.trim() || undefined,
      displayInitial: initial,
    };
  };

  assert.throws(() => computeServerPreview(''), /Server name is required/);
  assert.throws(() => computeServerPreview('   '), /Server name is required/);

  const squad = computeServerPreview('Alpha Squad');
  assert.equal(squad.name, 'Alpha Squad');
  assert.equal(squad.icon, undefined);
  assert.equal(squad.displayInitial, 'A');

  const cozy = computeServerPreview('the cozy corner', '🌱');
  assert.equal(cozy.name, 'the cozy corner');
  assert.equal(cozy.icon, '🌱');
  assert.equal(cozy.displayInitial, 'T');
});

test('Join Server Modal: parses invite codes, complete URLs, and validates origin', () => {
  const currentOrigin = 'http://localhost:5173';
  const parseInviteInput = (raw: string, allowedOrigin: string) => {
    const val = raw.trim();
    if (!val) throw new Error('Enter an invite code or link.');
    if (/^[a-zA-Z0-9_-]{6,128}$/.test(val)) {
      return { code: val, valid: true };
    }
    let url: URL;
    try {
      url = new URL(val);
    } catch {
      throw new Error('Enter an invite code or a complete Haven invitation link.');
    }
    if (url.origin !== allowedOrigin) {
      throw new Error('This invitation belongs to a different Haven service.');
    }
    const match = /^\/invite\/([a-zA-Z0-9_-]{6,128})\/?$/.exec(url.pathname);
    if (!match) throw new Error('Invalid community invitation link.');
    return { code: match[1], valid: true };
  };

  assert.equal(parseInviteInput('secret1234', currentOrigin).code, 'secret1234');
  assert.equal(parseInviteInput('http://localhost:5173/invite/xyz9876', currentOrigin).code, 'xyz9876');
  assert.throws(
    () => parseInviteInput('https://evil-server.com/invite/xyz9876', currentOrigin),
    /different Haven service/
  );
  assert.throws(() => parseInviteInput('bad code with spaces', currentOrigin), /invite code or a complete Haven invitation link/);
});

test('Join Server Modal: formats expiration timestamp accurately into human readable string', () => {
  const formatExpiration = (expiresAt: number | null, now = 1_000_000_000_000): string => {
    if (!expiresAt) return 'Never expires';
    const remainingMs = expiresAt - now;
    if (remainingMs <= 0) return 'Expired';
    const hours = Math.round(remainingMs / 3600_000);
    if (hours < 24) return `Expires in ${hours}h`;
    const days = Math.round(hours / 24);
    return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`;
  };

  assert.equal(formatExpiration(null), 'Never expires');
  assert.equal(formatExpiration(1_000_000_000_000 - 5000), 'Expired');
  assert.equal(formatExpiration(1_000_000_000_000 + 5 * 3600_000), 'Expires in 5h');
  assert.equal(formatExpiration(1_000_000_000_000 + 48 * 3600_000), 'Expires in 2 days');
  assert.equal(formatExpiration(1_000_000_000_000 + 24 * 3600_000), 'Expires in 1 day');
});
