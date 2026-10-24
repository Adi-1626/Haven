const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// The legacy profile-global vault has no trustworthy owner. Never import it.
function createAuthVault(directory, safeStorage) {
  const volatile = new WeakMap();
  const file = scope => path.join(directory, 'auth-sessions', createHash('sha256').update(scope).digest('hex') + '.enc');
  const encryptionAvailable = () => safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  return {
    read(client, scope, persistent) {
      if (!persistent) return volatile.get(client)?.get(scope) ?? null;
      try { return encryptionAvailable() ? safeStorage.decryptString(fs.readFileSync(file(scope))) : null; } catch { return null; }
    },
    write(client, scope, persistent, value) {
      if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024) throw new Error('Invalid session payload');
      if (!persistent) {
        if (!volatile.has(client)) volatile.set(client, new Map());
        volatile.get(client).set(scope, value);
        return true;
      }
      if (!encryptionAvailable()) return false;
      try {
        fs.mkdirSync(path.dirname(file(scope)), { recursive: true });
        const temporary = file(scope) + '.tmp';
        fs.writeFileSync(temporary, safeStorage.encryptString(value));
        fs.renameSync(temporary, file(scope));
        return true;
      } catch { return false; }
    },
    clear(client, scope, persistent) {
      if (!persistent) { volatile.get(client)?.delete(scope); return true; }
      try { fs.rmSync(file(scope), { force: true }); return true; } catch { return false; }
    },
  };
}
module.exports = { createAuthVault };
