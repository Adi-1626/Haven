import test from 'node:test';
import assert from 'node:assert/strict';
import { refractionMap, supportsGlassRefraction } from './glass-refraction';

const at = (map: ReturnType<typeof refractionMap>, x: number, y: number) => { const i = (y * map.width + x) * 4; return [map.data[i], map.data[i + 1], map.data[i + 2], map.data[i + 3]]; };

test('refraction is confined to the bevel: the interior stays neutral so text is never displaced', () => {
  const map = refractionMap(120, 90, 10, 8);
  assert.deepEqual(at(map, 60, 45), [128, 128, 128, 255]);
  assert.deepEqual(at(map, 30, 45), [128, 128, 128, 255]);
  assert.deepEqual(at(map, 60, 30), [128, 128, 128, 255]);
});

test('edge pixels sample the backdrop from inside the card, with symmetric left/right and top/bottom bends', () => {
  const map = refractionMap(120, 90, 10, 8);
  const [leftR, leftG] = at(map, 0, 45);
  const [rightR, rightG] = at(map, 119, 45);
  const [topR, topG] = at(map, 60, 0);
  const [bottomR, bottomG] = at(map, 60, 89);
  assert.ok(leftR > 200 && leftG === 128, 'left edge samples from the right (inside)');
  assert.ok(rightR < 56 && rightG === 128, 'right edge samples from the left (inside)');
  assert.ok(topG > 200 && topR === 128, 'top edge samples from below');
  assert.ok(bottomG < 56 && bottomR === 128, 'bottom edge samples from above');
  assert.equal(leftR - 128, 128 - rightR);
  assert.equal(topG - 128, 128 - bottomG);
});

test('corners bend diagonally and strength falls off smoothly towards the interior', () => {
  const map = refractionMap(120, 90, 16, 12);
  const [cornerR, cornerG] = at(map, 6, 6);
  assert.ok(cornerR > 128 && cornerG > 128, 'top-left corner samples towards the card centre');
  assert.deepEqual(at(map, 1, 1), [128, 128, 128, 255], 'pixels outside the rounded corner are untouched');
  const strengths = [0, 2, 4, 8, 11].map(x => at(map, x, 45)[0] - 128);
  for (let index = 1; index < strengths.length; index++) assert.ok(strengths[index] <= strengths[index - 1]);
  assert.ok(strengths[strengths.length - 1] >= 0);
});

test('only desktop Chromium engines enable SVG backdrop refraction', () => {
  assert.equal(supportsGlassRefraction({ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }], mobile: false } }), true);
  assert.equal(supportsGlassRefraction({ userAgentData: { brands: [{ brand: 'Chromium' }], mobile: true } }), false);
  assert.equal(supportsGlassRefraction({}), false);
});
