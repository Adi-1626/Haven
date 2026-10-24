const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuthVault } = require('../apps/desktop/electron/auth-vault.cjs');

test('vault isolates clients and origins, ignores legacy data and fails closed without encryption', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-vault-'));
  try {
    fs.writeFileSync(path.join(directory, 'auth-session.enc'), 'unowned-legacy-token');
    const crypto = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${value}`), decryptString: buffer => {
      if (!buffer.toString().startsWith('encrypted:')) throw new Error('invalid ciphertext');
      return buffer.toString().slice(10);
    } };
    const vault = createAuthVault(directory, crypto); const main = {}, other = {};
    assert.equal(vault.read(main, 'backend-a', true), null);
    assert.equal(vault.write(main, 'backend-a', true, 'main-token'), true);
    assert.equal(vault.read(main, 'backend-b', true), null);
    assert.equal(vault.read(other, 'backend-a', false), null);
    vault.write(other, 'backend-a', false, 'other-token'); vault.clear(other, 'backend-a', false);
    assert.equal(vault.read(main, 'backend-a', true), 'main-token');
    crypto.isEncryptionAvailable = () => false;
    assert.equal(vault.write(main, 'backend-b', true, 'must-not-be-plaintext'), false);
    assert.equal(vault.read(main, 'backend-a', true), null);
    assert.equal(fs.readdirSync(path.join(directory, 'auth-sessions')).length, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
