const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const electronDir = fs.existsSync(path.resolve(__dirname, '../apps/desktop/electron')) ? path.resolve(__dirname, '../apps/desktop/electron') : path.resolve(__dirname, '../electron');
const { permissionAllowed } = require(path.join(electronDir, 'permissions.cjs'));

test('device permissions normalize Chromium origin URLs while restricting trusted main-frame capabilities', () => {
  const origin = 'http://127.0.0.1:43127';
  assert.equal(permissionAllowed(true, 'media', `${origin}/`, origin), true);
  assert.equal(permissionAllowed(true, 'speaker-selection', `${origin}/invite/code`, origin), true);
  assert.equal(permissionAllowed(false, 'media', origin, origin), false);
  assert.equal(permissionAllowed(true, 'media', origin, origin, false), false);
  for (const address of ['http://127.0.0.1:43128/', 'https://example.com/', 'null', `${origin}.example.com`]) assert.equal(permissionAllowed(true, 'media', address, origin), false);
  assert.equal(permissionAllowed(true, 'background-sync', origin, origin), false);
});
