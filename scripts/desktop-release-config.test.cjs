const test = require('node:test');
const assert = require('node:assert/strict');
const { productionConfig, validateReleaseConfig, selectConnection } = require('../apps/desktop/electron/release-config.cjs');

test('public builds default to production even with a historical localhost selection', () => {
  for (const savedServer of [undefined, 'http://localhost:3001', 'http://127.0.0.1:42990', 'https://localhost:3001', 'https://[::1]:3001', 'invalid saved value']) {
    assert.deepEqual(selectConnection({ args: [], env: {}, savedServer, release: productionConfig }), {
      remote: 'https://haven-backend.getvoroa.com', webUrl: 'https://haven-ea6.pages.dev'
    });
  }
});
test('Local Mode is explicit, ignores saved hosted selection and conflicts with remote overrides', () => {
  assert.equal(selectConnection({ args: ['--local-mode'], env: {}, savedServer: productionConfig.backendUrl, release: productionConfig }).remote, undefined);
  for (const args of [['--local-mode', '--server=http://localhost:3001'], ['--local-mode', '--dev']]) {
    assert.throws(() => selectConnection({ args, env: {}, release: productionConfig }), /separately/);
  }
  assert.equal(selectConnection({ args: [], env: {} }).remote, undefined);
});
test('public config rejects endpoint substitution and extra secret fields', () => {
  for (const config of [null, {}, { ...productionConfig, backendUrl: 'http://localhost:3001' },
    { ...productionConfig, webUrl: 'https://other.example' }, { ...productionConfig, serviceRoleKey: 'never-package' }]) {
    assert.throws(() => validateReleaseConfig(config), /Invalid production/);
  }
  assert.equal(validateReleaseConfig(productionConfig), productionConfig);
});
test('deliberate development server selection retains the existing discovery path', () => {
  assert.deepEqual(selectConnection({ args: ['--server=http://127.0.0.1:3001'], env: {}, release: productionConfig }),
    { remote: 'http://127.0.0.1:3001', webUrl: undefined });
});
