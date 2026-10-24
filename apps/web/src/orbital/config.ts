// Art direction for the orbital system. Everything the scene draws – rings, light pulses, nodes,
// moons and dust – is derived from this one table of orbits, so every moving element belongs to the
// same geometry. Units: planet radius = 1. Angles are authored in degrees.

import { mulberry32, type OrbitShape } from './orbit-math';

const deg = (v: number) => (v * Math.PI) / 180;

export interface Pulse {
  /** Mean anomaly at t = 0 (radians). */
  phase: number;
  /** Mean motion (radians / second, signed). 0 disables the pulse slot. */
  speed: number;
}

export interface OrbitDef extends OrbitShape {
  /** Ring line width in CSS px. */
  width: number;
  brightness: number;
  /** 0 = solid line, 1 = fully dotted – for the half of the ring behind / in front of the planet. */
  dotBack: number;
  dotFront: number;
  /** Dot pitch in CSS px. */
  spacing: number;
  /** Mean motion of the orbit's dust and moons (radians / second, signed). */
  motion: number;
  /** Length of the light trail behind a pulse head, in radians of eccentric anomaly. */
  trail: number;
  /** How much a passing pulse brightens the ring. */
  gain: number;
  /** Brightness multiplier for the half of the ring behind the planet (1 = no dimming). */
  backDim: number;
  pulses: [Pulse, Pulse];
  /** Relative share of the dust particles. */
  dust: number;
  /** 0 spreads dust evenly, 1 gathers it into drifting streams (as in the reference ribbons). */
  clustering: number;
}

const off: Pulse = { phase: 0, speed: 0 };

export const ORBITS: OrbitDef[] = [
  // 0 – main bright ring, the one the reference lights most strongly.
  {
    a: 2.0, e: 0.03, roll: deg(-29), incl: deg(-52), width: 1.5, brightness: 1.15, dotBack: 1, dotFront: 0, spacing: 5.2,
    motion: 0.085, trail: 0.95, gain: 1.5, backDim: 0.5, dust: 150, clustering: 0.2,
    pulses: [{ phase: 1.05, speed: 0.082 }, { phase: 4.04, speed: 0.067 }],
  },
  // 1 – moon ring, upper right to lower left.
  {
    a: 2.95, e: 0.07, roll: deg(-23), incl: deg(-57), width: 1, brightness: 0.52, dotBack: 0.8, dotFront: 0.35, spacing: 6,
    motion: -0.052, trail: 0.7, gain: 1.8, backDim: 0.45, dust: 120, clustering: 0.1,
    pulses: [{ phase: 1.34, speed: -0.058 }, off],
  },
  // 2 – wide moon ring.
  {
    a: 3.7, e: 0.1, roll: deg(-17), incl: deg(-68), width: 0.9, brightness: 0.4, dotBack: 0.8, dotFront: 0.15, spacing: 6.5,
    motion: 0.038, trail: 0.6, gain: 1.6, backDim: 0.45, dust: 110, clustering: 0.1,
    pulses: [{ phase: 4.66, speed: 0.04 }, off],
  },
  // 3 – steep ring cutting across the others.
  {
    a: 3.05, e: 0.05, roll: deg(48), incl: deg(-60), width: 0.9, brightness: 0.4, dotBack: 0.8, dotFront: 0.2, spacing: 5.5,
    motion: -0.05, trail: 0.7, gain: 1.7, backDim: 0.45, dust: 90, clustering: 0.1,
    pulses: [{ phase: 0.76, speed: -0.056 }, off],
  },
  // 4 – inner halo ring hugging the planet.
  {
    a: 1.72, e: 0.02, roll: deg(-28), incl: deg(-55), width: 0.85, brightness: 0.32, dotBack: 1, dotFront: 1, spacing: 4.5,
    motion: 0.115, trail: 0.5, gain: 1.2, backDim: 0.5, dust: 40, clustering: 0,
    pulses: [off, off],
  },
  // 5 – great ribbon sweeping under the whole scene (the bright arc along the bottom of the reference).
  {
    a: 7.9, e: 0.05, roll: deg(3), incl: deg(-64), width: 1.35, brightness: 1.05, dotBack: 0.2, dotFront: 0, spacing: 7,
    motion: 0.02, trail: 0.85, gain: 1.15, backDim: 0.1, dust: 470, clustering: 0.75,
    pulses: [{ phase: 5.29, speed: 0.052 }, { phase: 4.17, speed: 0.044 }],
  },
  // 6 – far ribbon arcing over the upper right.
  {
    a: 9.6, e: 0.1, roll: deg(7), incl: deg(-74), width: 1, brightness: 0.26, dotBack: 1, dotFront: 0.5, spacing: 7,
    motion: -0.016, trail: 0.5, gain: 1.4, backDim: 0.6, dust: 240, clustering: 0.6,
    pulses: [{ phase: 5.9, speed: -0.04 }, off],
  },
  // 7 – faint intermediate ellipse.
  {
    a: 4.6, e: 0.12, roll: deg(-12), incl: deg(-52), width: 0.8, brightness: 0.26, dotBack: 0.5, dotFront: 0.2, spacing: 6.5,
    motion: 0.03, trail: 0.5, gain: 1.2, backDim: 0.45, dust: 70, clustering: 0,
    pulses: [off, off],
  },
  // 8 – faint hairline ellipse, opposite tilt.
  {
    a: 3.3, e: 0.06, roll: deg(-38), incl: deg(-61), width: 0.8, brightness: 0.22, dotBack: 0.3, dotFront: 0, spacing: 6,
    motion: -0.034, trail: 0.5, gain: 1, backDim: 0.5, dust: 45, clustering: 0,
    pulses: [off, off],
  },
  // 9 – faint hairline ellipse hugging the main ring.
  {
    a: 2.45, e: 0.05, roll: deg(-9), incl: deg(-47), width: 0.8, brightness: 0.26, dotBack: 0.9, dotFront: 0.6, spacing: 5.5,
    motion: 0.06, trail: 0.5, gain: 1, backDim: 0.5, dust: 45, clustering: 0,
    pulses: [off, off],
  },
];

export const ORBIT_COUNT = ORBITS.length;

export interface BodyDef {
  orbit: number;
  /** 0/1 ride the orbit's pulse slot (a light-pulse head), 2 moves on its own. */
  mode: 0 | 1 | 2;
  phase: number;
  speed: number;
  /** World radius of a solid moon; 0 for a pure light node. */
  radius: number;
  /** Glow half-size in CSS px for nodes (moons derive theirs from the radius). */
  glow: number;
  intensity: number;
}

// Moons first: the sphere pass draws only the first MOON_COUNT instances, the glow pass draws all.
export const BODIES: BodyDef[] = [
  { orbit: 7, mode: 2, phase: 1.01, speed: 0.03, radius: 0.2, glow: 0, intensity: 0.55 },
  { orbit: 2, mode: 2, phase: 4.35, speed: 0.038, radius: 0.17, glow: 0, intensity: 0.5 },
  { orbit: 3, mode: 2, phase: 3.10, speed: -0.05, radius: 0.2, glow: 0, intensity: 0.5 },
  { orbit: 6, mode: 2, phase: 0.12, speed: -0.016, radius: 0.09, glow: 0, intensity: 0.45 },
  { orbit: 0, mode: 0, phase: 0, speed: 0, radius: 0, glow: 22, intensity: 1 },
  { orbit: 0, mode: 1, phase: 0, speed: 0, radius: 0, glow: 18, intensity: 0.95 },
  { orbit: 0, mode: 2, phase: 2.38, speed: 0.085, radius: 0, glow: 14, intensity: 0.8 },
  { orbit: 0, mode: 2, phase: 5.32, speed: 0.085, radius: 0, glow: 14, intensity: 0.8 },
  { orbit: 1, mode: 0, phase: 0, speed: 0, radius: 0, glow: 17, intensity: 0.85 },
  { orbit: 2, mode: 0, phase: 0, speed: 0, radius: 0, glow: 16, intensity: 0.8 },
  { orbit: 3, mode: 0, phase: 0, speed: 0, radius: 0, glow: 16, intensity: 0.8 },
  { orbit: 5, mode: 0, phase: 0, speed: 0, radius: 0, glow: 20, intensity: 1 },
  { orbit: 5, mode: 1, phase: 0, speed: 0, radius: 0, glow: 15, intensity: 0.8 },
  { orbit: 6, mode: 0, phase: 0, speed: 0, radius: 0, glow: 14, intensity: 0.65 },
];

export const MOON_COUNT = BODIES.filter(body => body.radius > 0).length;

export const MAX_PARTICLES = 1500;
export const STAR_COUNT = 520;
export const DUST_COUNT = 70;

/** Floats per body instance: [orbit, mode, phase, speed, radius, glow, intensity, seed]. */
export const BODY_STRIDE = 8;

export function buildBodyData(): Float32Array {
  const rng = mulberry32(7);
  const data = new Float32Array(BODIES.length * BODY_STRIDE);
  BODIES.forEach((body, i) => {
    data.set([body.orbit, body.mode, body.phase, body.speed, body.radius, body.glow, body.intensity, rng()], i * BODY_STRIDE);
  });
  return data;
}

/** Floats per dust particle: [orbit, phase, speedScale, radialJitter, lift, size, brightness, seed]. */
export const PARTICLE_STRIDE = 8;

export function buildParticleData(): Float32Array {
  const rng = mulberry32(20261018);
  const totalWeight = ORBITS.reduce((sum, orbit) => sum + orbit.dust, 0);
  const particles: number[][] = [];
  ORBITS.forEach((orbit, index) => {
    const count = Math.round((orbit.dust / totalWeight) * MAX_PARTICLES);
    // Streams are anchored to a few places on the ring and drift together (speed scale stays near 1).
    const anchors = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
    for (let k = 0; k < count; k++) {
      const clustered = rng() < orbit.clustering;
      const anchor = anchors[Math.floor(rng() * anchors.length)];
      const spread = clustered ? (rng() + rng() + rng() - 1.5) * 1.15 : 0;
      const phase = clustered ? anchor + spread : rng() * Math.PI * 2;
      const wide = orbit.a > 6;
      particles.push([
        index,
        phase,
        clustered ? 0.985 + rng() * 0.03 : 0.8 + rng() * 0.4,
        (rng() + rng() - 1) * (wide ? 0.045 : 0.028),
        (rng() - 0.5) * (wide ? 0.34 : 0.12),
        0.8 + Math.pow(rng(), 2.2) * 1.9,
        0.28 + rng() * 0.72,
        rng(),
      ]);
    }
  });
  // Shuffle so any prefix of the buffer is a fair sample of the whole system (quality scaling draws a prefix).
  for (let i = particles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [particles[i], particles[j]] = [particles[j], particles[i]];
  }
  const data = new Float32Array(MAX_PARTICLES * PARTICLE_STRIDE);
  particles.slice(0, MAX_PARTICLES).forEach((p, i) => data.set(p, i * PARTICLE_STRIDE));
  return data;
}

/** Floats per star: [u, v, layer, size, phase, brightness, rate, kind]. kind 0 = star, 1 = dust mote. */
export const STAR_STRIDE = 8;

export function buildStarData(): Float32Array {
  const rng = mulberry32(424242);
  const data = new Float32Array((STAR_COUNT + DUST_COUNT) * STAR_STRIDE);
  for (let i = 0; i < STAR_COUNT; i++) {
    const layer = 0.25 + rng() * 0.75;
    const bright = Math.pow(rng(), 3.2);
    data.set([rng(), rng(), layer, 1 + bright * 1.8, rng() * 6.283, 0.25 + bright * 0.75, 0.25 + rng() * 0.9, 0], i * STAR_STRIDE);
  }
  for (let i = 0; i < DUST_COUNT; i++) {
    data.set([rng(), rng(), 1.4 + rng() * 1.2, 3 + rng() * 8, rng() * 6.283, 0.25 + rng() * 0.5, 0.05 + rng() * 0.08, 1], (STAR_COUNT + i) * STAR_STRIDE);
  }
  return data;
}
