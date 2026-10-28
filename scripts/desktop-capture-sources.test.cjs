const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const electronDir = fs.existsSync(path.resolve(__dirname, '../apps/desktop/electron')) ? path.resolve(__dirname, '../apps/desktop/electron') : path.resolve(__dirname, '../electron');
const { describeSources } = require(path.join(electronDir, 'capture-sources.cjs'));

const thumbnail = { toDataURL: () => 'data:image/png;base64,AA==' };
const screen = (id, displayId, name = `Screen ${id}`) => ({ id: `screen:${id}:0`, display_id: displayId, name, thumbnail });

test('each display reports its own native size in physical pixels, not the primary monitor', () => {
  const displays = [
    { id: 101, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
    // 2560 × 1440 at 125% Windows scaling: Electron reports 2048 × 1152 logical.
    { id: 202, size: { width: 2048, height: 1152 }, scaleFactor: 1.25 },
    // 3840 × 2160 at 150%.
    { id: 303, size: { width: 2560, height: 1440 }, scaleFactor: 1.5 },
  ];
  const described = describeSources([screen(1, '202'), screen(0, '101'), screen(2, '303')], displays);
  assert.deepEqual(described.map(({ id, width, height, display }) => ({ id, width, height, display })), [
    { id: 'screen:1:0', width: 2560, height: 1440, display: true },
    { id: 'screen:0:0', width: 1920, height: 1080, display: true },
    { id: 'screen:2:0', width: 3840, height: 2160, display: true },
  ]);
  assert.equal(described[0].thumbnail, 'data:image/png;base64,AA==');
});

test('windows and unmatched displays claim no size instead of borrowing a monitor\'s', () => {
  const displays = [{ id: 101, size: { width: 1920, height: 1080 }, scaleFactor: 1 }];
  const described = describeSources([
    { id: 'window:42:0', display_id: '', name: 'Editor', thumbnail },
    screen(9, ''),
    screen(8, '999'),
  ], displays);
  for (const source of described) {
    assert.equal(source.width, undefined);
    assert.equal(source.height, undefined);
  }
  assert.deepEqual(described.map(source => source.display), [false, true, true]);
});
