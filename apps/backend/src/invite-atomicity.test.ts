import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { PostgresAdapter } from './db/postgres.js';
import { InviteUnavailableError } from './db/invites.js';

test('HTTP joins revalidate inside the SQLite transaction after revocation or expiry; duplicate joins preserve roles', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'haven-invite-race-'));
  const app = createApp({ dataDir: directory, supabaseVerifier: null });
  await new Promise<void>(resolve => app.httpServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.httpServer.address() as { port: number }).port}/api`;
  const req = async (route: string, cookie: string, body: unknown = {}, method = 'POST') => {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  try {
    const owner = await req('/auth/register', '', { username: 'atomic-owner', password: 'Strong-password-123' });
    const guest = await req('/auth/register', '', { username: 'atomic-guest', password: 'Strong-password-123' });
    const created = await req('/servers', owner.cookie, { name: 'Atomic invitations' });
    const serverId = created.data.server.id;
    const original = app.adapter.joinInvite.bind(app.adapter);
    for (const scenario of ['revoke', 'expire'] as const) {
      const code = `atomic-${scenario}`;
      await app.adapter.createInvite({ code, serverId, createdAt: Date.now(), expiresAt: scenario === 'expire' ? Date.now() + 40 : null });
      let entered!: () => void, resume!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { resume = resolve; });
      app.adapter.joinInvite = async (code, userId) => { entered(); await gate; return original(code, userId); };
      const pending = req(`/invites/${code}/join`, guest.cookie);
      await waiting;
      if (scenario === 'revoke') assert.equal((await req(`/invites/${code}`, owner.cookie, {}, 'DELETE')).status, 200);
      else await new Promise(resolve => setTimeout(resolve, 60));
      resume();
      assert.equal((await pending).status, scenario === 'revoke' ? 404 : 410);
      assert.equal(await app.adapter.getMember(serverId, guest.data.user.id), undefined);
      app.adapter.joinInvite = original;
    }
    const invitation = await req(`/servers/${serverId}/invites`, owner.cookie, { expiresInHours: null });
    const code = invitation.data.code;
    const joined = await Promise.all([req(`/invites/${code}/join`, guest.cookie), req(`/invites/${code}/join`, guest.cookie)]);
    assert.deepEqual(joined.map(result => result.status), [200, 200]);
    await req(`/servers/${serverId}/members/${guest.data.user.id}`, owner.cookie, { role: 'admin' }, 'PATCH');
    await req(`/invites/${code}/join`, guest.cookie);
    await req(`/invites/${code}/join`, owner.cookie);
    assert.equal((await app.adapter.getMember(serverId, guest.data.user.id))?.role, 'admin');
    assert.equal((await app.adapter.getMember(serverId, owner.data.user.id))?.role, 'owner');
    assert.equal((await app.adapter.getServerMembers(serverId)).length, 2);
    await Promise.all([
      app.adapter.updateChannel(created.data.channel.id, { name: 'Concurrent rename' }),
      app.adapter.updateChannel(created.data.channel.id, { topic: 'Concurrent topic' }),
    ]);
    const channel = await app.adapter.getChannel(created.data.channel.id);
    assert.equal(channel?.name, 'Concurrent rename');
    assert.equal(channel?.topic, 'Concurrent topic');
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('real Postgres adapter locks before validating, rolls back invalid joins and releases its connection', async () => {
  // Driver-boundary regression; real SQL concurrency is covered by the isolated
  // Postgres harness when local binaries are available.
  const db = new PostgresAdapter('postgres://unused:unused@127.0.0.1:1/unused');
  await db.close();
  for (const scenario of ['valid', 'revoked', 'expired', 'missing']) {
    const calls: string[] = []; let released = false;
    (db as any).pool = { connect: async () => ({ query: async (sql: string) => {
      calls.push(sql);
      return { rows: scenario === 'missing' ? [] : [{ code: 'atomic', server_id: 'server', created_at: '1', expires_at: scenario === 'expired' ? '1' : null, revoked_at: scenario === 'revoked' ? '1' : null }] };
    }, release: () => { released = true; } }) };
    if (scenario === 'valid') assert.equal((await db.joinInvite('atomic', 'guest')).serverId, 'server');
    else await assert.rejects(db.joinInvite('atomic', 'guest'), InviteUnavailableError);
    assert.equal(calls[0], 'BEGIN');
    assert.match(calls[1], /FOR UPDATE$/);
    assert.equal(calls.some(sql => sql.includes('INSERT INTO haven.members')), scenario === 'valid');
    assert.equal(calls.at(-1), scenario === 'valid' ? 'COMMIT' : 'ROLLBACK');
    assert.equal(released, true);
  }
});
