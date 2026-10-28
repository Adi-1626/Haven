import test from 'node:test';
import assert from 'node:assert/strict';
import { bitrateBits, captureDimensions, qualityForSource, senderScale, shareOptionsBeforeCapture, shareOptionsFor, targetDimensions } from './media-quality';

test('quality options never advertise a resolution above the captured source', () => {
  for (const source of [[1280, 720], [1920, 1080], [3440, 1440], [1024, 768], [800, 1600], [319, 199]]) {
    for (const option of shareOptionsFor(source[0], source[1])) {
      const target = targetDimensions(source[0], source[1], option.height);
      assert.ok(target.width <= source[0]);
      assert.ok(target.height <= source[1]);
      assert.ok(Math.abs(target.width / target.height - source[0] / source[1]) < 0.01);
    }
  }
});

test('native selection preserves source dimensions and larger requests are capped', () => {
  assert.deepEqual(targetDimensions(3440, 1440, 'native'), { width: 3440, height: 1440 });
  assert.deepEqual(targetDimensions(1280, 720, 2160), { width: 1280, height: 720 });
  assert.deepEqual(targetDimensions(3440, 1440, 720), { width: 1720, height: 720 });
  assert.deepEqual(targetDimensions(1920, 1080, Number.NaN), { width: 1920, height: 1080 });
});

test('sender scaling handles source constraints without accidental second downscaling', () => {
  assert.equal(senderScale(1920, 1080, 1280, 720), 1.5);
  assert.equal(senderScale(1280, 720, 1280, 720), 1);
  assert.equal(senderScale(640, 360, 1280, 720), 1);
});

test('invalid dimensions and bitrates remain bounded', () => {
  assert.deepEqual(captureDimensions(Number.NaN, -10), { width: 1, height: 1 });
  assert.equal(bitrateBits(Number.NaN), 8_000_000);
  assert.equal(bitrateBits(-1), 250_000);
  assert.equal(bitrateBits(1000), 50_000_000);
});

test('changing sources rebuilds native targets without upscaling a smaller capture', () => {
  for (const requestedHeight of ['native', 2160, 1080, 720] as const) {
    for (const [width, height] of [[3840, 2160], [1920, 1080], [801, 503], [1080, 1920], [2560, 1440]]) {
      const next = qualityForSource(width, height, requestedHeight);
      assert.equal(next.nativeWidth, width);
      assert.equal(next.nativeHeight, height);
      assert.ok(next.width <= width);
      assert.ok(next.height <= height);
      assert.ok(senderScale(width, height, next.width, next.height) >= 1);
      if (requestedHeight === 'native') assert.deepEqual({ width: next.width, height: next.height }, { width, height });
    }
  }
});

test('Native names the measured source size; before capture no size is claimed', () => {
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160], [1920, 1032], [1080, 1920]]) {
    assert.equal(shareOptionsFor(width, height)[0].label, `Native (${width} × ${height})`);
  }
  // Manual heights stay available below the source; nothing above it is offered.
  assert.deepEqual(shareOptionsFor(2560, 1440).map(option => option.label), ['Native (2560 × 1440)', '1080p', '720p', '480p']);
  assert.deepEqual(shareOptionsFor(3840, 2160).map(option => option.height), ['native', 1440, 1080, 720, 480]);
  const before = shareOptionsBeforeCapture();
  assert.equal(before[0].height, 'native');
  assert.doesNotMatch(before[0].label, /\d/);
  assert.deepEqual(before.slice(1).map(option => option.label), ['2160p', '1440p', '1080p', '720p', '480p']);
});
