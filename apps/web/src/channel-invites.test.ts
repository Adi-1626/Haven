import test from 'node:test';
import assert from 'node:assert/strict';

test('Channel name validation requires non-empty trimmed name within 80 characters', () => {
  const validateChannelName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Channel name is required');
    if (trimmed.length > 80) throw new Error('Channel name must be 80 characters or less');
    return trimmed;
  };

  assert.equal(validateChannelName('  tactical-chat  '), 'tactical-chat');
  assert.throws(() => validateChannelName('   '), /Channel name is required/);
  assert.throws(() => validateChannelName('a'.repeat(81)), /80 characters or less/);
  assert.equal(validateChannelName('general').length, 7);
});

test('Channel type defaults and switching support text and voice types', () => {
  const allowedTypes = ['text', 'voice'] as const;
  type ChannelType = (typeof allowedTypes)[number];

  const resolveType = (selected?: string): ChannelType => {
    return selected === 'voice' ? 'voice' : 'text';
  };

  assert.equal(resolveType('text'), 'text');
  assert.equal(resolveType('voice'), 'voice');
  assert.equal(resolveType(undefined), 'text');
  assert.equal(resolveType('invalid'), 'text');
});

test('Invite expiration values convert correctly to hours and null for never expire', () => {
  const parseExpireHours = (value: string): number | null => {
    if (value === 'never') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 168; // default 7 days
    return num;
  };

  assert.equal(parseExpireHours('24'), 24);
  assert.equal(parseExpireHours('168'), 168);
  assert.equal(parseExpireHours('720'), 720);
  assert.equal(parseExpireHours('never'), null);
});

test('Active invitations filter out revoked and expired invites', () => {
  const now = Date.now();
  const invites = [
    { code: 'active-1', createdAt: now - 1000, expiresAt: now + 3600000, revokedAt: null },
    { code: 'active-never', createdAt: now - 2000, expiresAt: null, revokedAt: null },
    { code: 'expired-1', createdAt: now - 10000, expiresAt: now - 1000, revokedAt: null },
    { code: 'revoked-1', createdAt: now - 1000, expiresAt: now + 3600000, revokedAt: now - 500 },
  ];

  const active = invites.filter(
    item => !item.revokedAt && (!item.expiresAt || item.expiresAt > now)
  );

  assert.equal(active.length, 2);
  assert.equal(active[0].code, 'active-1');
  assert.equal(active[1].code, 'active-never');
});
