import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFallback, profileImageSource } from './profile-images';

test('profile images use original HTTPS URLs and scoped uploaded server icons, without unsafe schemes', () => {
  assert.equal(profileImageSource(' https://example.com/original.png?v=2 '), 'https://example.com/original.png?v=2');
  for (const value of ['http://example.com/avatar.png', 'https://name:password@example.com/a', 'javascript:alert(1)', 'data:image/svg+xml,x', '//example.com/a']) assert.equal(profileImageSource(value), null);
  assert.equal(profileImageSource('/api/servers/123abc/icon?v=abc', true), '/api/servers/123abc/icon?v=abc');
  assert.equal(profileImageSource('/api/servers/123abc/icon?v=abc'), null);
  assert.equal(profileImageSource('/api/users/a1b2-c3/avatar?v=ab12-cd.png'), '/api/users/a1b2-c3/avatar?v=ab12-cd.png');
  for (const value of ['/api/users/a1b2/avatar?v=ab.svg', '/api/users/../servers/x/avatar?v=ab.png', '/api/users/a1b2/avatar', '/api/users/a/avatar?v=ab.png&x=1']) assert.equal(profileImageSource(value), null);
  assert.equal(profileFallback('/api/users/a1b2/avatar?v=ab.png', 'Alice'), 'AL');
  assert.equal(profileFallback('https://example.com/broken.png', 'Alice'), 'AL');
  assert.equal(profileFallback('🌱', 'Alice'), '🌱');
  assert.equal(profileFallback('👨‍👩‍👧‍👦', 'Alice'), '👨‍👩‍👧‍👦');
});
