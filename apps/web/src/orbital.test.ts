import assert from 'node:assert/strict';
import test from 'node:test';
import { BODIES, MAX_PARTICLES, MOON_COUNT, ORBITS, PARTICLE_STRIDE, buildBodyData, buildParticleData, buildStarData } from './orbital/config';
import { QUALITY, computeLayout, lowerTier, pickInitialTier, resolveScale } from './orbital/layout';
import { buildArcTable, mulberry32, orbitPoint, solveKepler } from './orbital/orbit-math';
import { PointerSpring } from './orbital/spring';

test('Kepler solver inverts the equation for the orbits in use', () => {
  for (const e of [0, 0.03, 0.1, 0.25]) {
    for (let m = -7; m <= 7; m += 0.37) {
      const E = solveKepler(m, e);
      assert.ok(Math.abs(E - e * Math.sin(E) - m) < 1e-6, `e=${e} M=${m}`);
    }
  }
});

test('the planet sits at the focus of every orbit and orbits close', () => {
  for (const orbit of ORBITS) {
    const radius = (E: number) => Math.hypot(...orbitPoint(orbit, E));
    assert.ok(Math.abs(radius(0) - orbit.a * (1 - orbit.e)) < 1e-9);
    assert.ok(Math.abs(radius(Math.PI) - orbit.a * (1 + orbit.e)) < 1e-9);
    const start = orbitPoint(orbit, 0);
    const end = orbitPoint(orbit, Math.PI * 2);
    start.forEach((value, axis) => assert.ok(Math.abs(value - end[axis]) < 1e-9));
  }
});

test('ribbon vertices are evenly spaced along the projected arc', () => {
  for (const orbit of ORBITS) {
    const segments = 240;
    const table = buildArcTable(orbit, 45, segments);
    assert.equal(table.anomalies.length, segments + 1);
    assert.ok(Math.abs(table.anomalies[0]) < 1e-6);
    assert.ok(Math.abs(table.anomalies[segments] - Math.PI * 2) < 1e-3);
    const step = table.total / segments;
    for (let k = 1; k <= segments; k++) {
      assert.ok(table.anomalies[k] >= table.anomalies[k - 1], 'anomaly must not run backwards');
      assert.ok(Math.abs(table.lengths[k] - table.lengths[k - 1] - step) < step * 0.02);
    }
  }
});

test('pointer spring settles without overshoot and is frame-rate independent', () => {
  const settle = (fps: number, seconds: number) => {
    const spring = new PointerSpring();
    let peak = 0;
    for (let i = 0; i < fps * seconds; i++) {
      spring.step(1, -1, 1 / fps);
      peak = Math.max(peak, spring.x);
    }
    return { x: spring.x, y: spring.y, peak };
  };
  const at60 = settle(60, 2.5);
  const at144 = settle(144, 2.5);
  assert.ok(at60.x > 0.99 && at60.y < -0.99, 'reaches the target within 2.5s');
  assert.ok(at60.peak <= 1.02, 'no visible overshoot');
  assert.ok(Math.abs(at60.x - at144.x) < 0.01, 'same result at 60 and 144 fps');

  const spring = new PointerSpring();
  for (let i = 0; i < 30; i++) spring.step(1, 1, 1 / 60);
  const midway = spring.x;
  for (let i = 0; i < 600; i++) spring.step(0, 0, 1 / 60);
  assert.ok(midway > 0.1 && Math.abs(spring.x) < 0.001, 'returns to rest when the target returns');

  // A stalled frame (tab throttling) must not fling the scene.
  const jumpy = new PointerSpring();
  jumpy.step(1, 1, 5);
  assert.ok(jumpy.x < 0.8);
});

test('desktop layout reproduces the approved reference composition', () => {
  const layout = computeLayout({ width: 1672, height: 941, compact: false });
  assert.ok(Math.abs(layout.cx - 790) < 2);
  assert.ok(Math.abs(layout.cy - 465) < 2);
  assert.ok(Math.abs(layout.radius - 115) < 1);
  // Wide windows keep the reference position; a narrow one nudges the planet clear of the copy column.
  assert.equal(computeLayout({ width: 1920, height: 1080, compact: false, textRight: 604 }).cx, 1920 * 0.472);
  const narrow = computeLayout({ width: 1280, height: 720, compact: false, textRight: 591 });
  assert.ok(narrow.cx > 1280 * 0.472, 'planet moves right of the reference position');
  assert.ok(Math.abs(narrow.cx - (591 + narrow.radius * 0.4)) < 1e-9, 'planet limb sits inside the copy box, past the wrapped text');
  assert.ok(narrow.cx + narrow.radius * 1.3 < 753, 'and still stays left of the card');
  // Centred single card (onboarding): the planet moves beside the card instead of hiding behind it.
  const solo = computeLayout({ width: 1366, height: 768, compact: false, cardLeft: 453 });
  assert.ok(solo.cx + solo.radius < 453, 'planet sits left of the card');
  assert.ok(solo.cx - solo.radius > 0, 'and fully on screen');
  const wide = computeLayout({ width: 2560, height: 800, compact: false });
  assert.ok(wide.radius <= 0.122 * 800 + 1e-9, 'short windows keep the planet inside the frame');
});

test('compact layout parks the planet above the form and never leaves the screen', () => {
  for (const [width, height, cardTop] of [[390, 844, 218], [768, 1024, 300], [500, 550, 62]] as const) {
    const { cx, cy, radius } = computeLayout({ width, height, compact: true, cardTop });
    assert.equal(cx, width / 2);
    assert.ok(radius >= 30 && radius <= width * 0.25);
    assert.ok(cy - radius >= -1 && cy + radius <= height, `${width}x${height} planet stays on screen`);
  }
});

test('quality tiers cap the drawing buffer and degrade monotonically', () => {
  assert.equal(resolveScale(1366, 768, 1, QUALITY.high), 1);
  const uhd = resolveScale(3840, 2160, 2, QUALITY.high);
  assert.ok(3840 * 2160 * uhd * uhd <= QUALITY.high.maxPixels * 1.001);
  assert.ok(resolveScale(1920, 1080, 2, QUALITY.low) <= 1);
  assert.ok(1366 * 768 * resolveScale(1366, 768, 1, QUALITY.minimal) ** 2 <= QUALITY.minimal.maxPixels * 1.01, 'minimal tier renders well under a megapixel');
  assert.equal(lowerTier('high'), 'medium');
  assert.equal(lowerTier('medium'), 'low');
  assert.equal(lowerTier('low'), 'minimal');
  assert.equal(lowerTier('minimal'), 'minimal');
  assert.ok(QUALITY.high.particles > QUALITY.medium.particles && QUALITY.medium.particles > QUALITY.low.particles && QUALITY.low.particles > QUALITY.minimal.particles);
  assert.equal(pickInitialTier({ softwareRenderer: true, hardwareConcurrency: 16, smallScreen: false }), 'minimal');
  assert.equal(pickInitialTier({ softwareRenderer: false, hardwareConcurrency: 4, smallScreen: false }), 'medium');
  assert.equal(pickInitialTier({ softwareRenderer: false, hardwareConcurrency: 12, smallScreen: false }), 'high');
});

test('orbit table is consistent: every body belongs to a real orbit and pulses are wired', () => {
  assert.ok(ORBITS.every(orbit => orbit.e >= 0 && orbit.e < 0.5 && orbit.width > 0 && orbit.backDim >= 0 && orbit.backDim <= 1));
  BODIES.forEach((body, index) => {
    const orbit = ORBITS[body.orbit];
    assert.ok(orbit, `body ${index} references orbit ${body.orbit}`);
    if (body.mode !== 2) assert.notEqual(orbit.pulses[body.mode].speed, 0, `body ${index} rides a pulse slot that is switched off`);
    assert.equal(body.radius > 0, index < MOON_COUNT, 'moons must come first (the sphere pass draws a prefix)');
  });
});

test('generated buffers are finite, deterministic and reference valid orbits', () => {
  const particles = buildParticleData();
  assert.equal(particles.length, MAX_PARTICLES * PARTICLE_STRIDE);
  assert.ok(particles.every(Number.isFinite));
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const orbit = particles[i * PARTICLE_STRIDE];
    assert.ok(Number.isInteger(orbit) && orbit >= 0 && orbit < ORBITS.length);
  }
  assert.deepEqual(buildParticleData(), particles);
  assert.ok(buildStarData().every(Number.isFinite));
  assert.ok(buildBodyData().every(Number.isFinite));
  const rng = mulberry32(1);
  const again = mulberry32(1);
  assert.equal(rng(), again());
});
