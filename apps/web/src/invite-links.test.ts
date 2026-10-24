import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationHost, isCurrentInvitation, parseInvitation } from './invite-links';

test('split-origin invitations recognize both the frontend and API without treating a foreign host as local', () => {
  const frontend = 'https://haven.pages.dev';
  const api = 'https://haven-backend.example';
  for (const host of [frontend, api]) {
    const invite = parseInvitation(`${host}/invite/abcdef123`, api);
    assert.ok(isCurrentInvitation(invite.origin, frontend, api));
  }
  assert.equal(isCurrentInvitation('https://someone-else.example', frontend, api), false);
  assert.equal(invitationHost(frontend), frontend);
  assert.equal(invitationHost(frontend, 'https://community.example/'), 'https://community.example');
});
