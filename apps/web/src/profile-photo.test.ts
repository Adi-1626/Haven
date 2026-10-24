import test from 'node:test';
import assert from 'node:assert/strict';
import { centeredSquare, photoProblem } from './profile-photo';

test('profile photos are cropped to the centred square that fills a circle', () => {
  assert.deepEqual(centeredSquare(1000, 600), { x: 200, y: 0, size: 600 });
  assert.deepEqual(centeredSquare(400, 900), { x: 0, y: 250, size: 400 });
  assert.deepEqual(centeredSquare(512, 512), { x: 0, y: 0, size: 512 });
});

test('profile photo selection rejects unsupported and oversized files before any upload', () => {
  assert.equal(photoProblem({ type: 'image/png', size: 4096 }), null);
  assert.equal(photoProblem({ type: 'image/gif', size: 11 * 1024 * 1024 }), null);
  assert.match(photoProblem({ type: 'image/svg+xml', size: 10 }) ?? '', /PNG, JPEG, WebP or GIF/);
  assert.match(photoProblem({ type: 'application/pdf', size: 10 }) ?? '', /PNG, JPEG/);
  assert.match(photoProblem({ type: 'image/jpeg', size: 13 * 1024 * 1024 }) ?? '', /12 MB/);
});
