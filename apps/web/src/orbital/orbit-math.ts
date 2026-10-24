// CPU-side mirror of the orbit maths in shaders.ts. The shader evaluates orbits per vertex; the CPU
// needs the same geometry only to build arc-length-uniform ribbon meshes and for unit tests.

export interface OrbitShape {
  /** Semi-major axis in planet radii. The planet sits at the focus. */
  a: number;
  e: number;
  /** Rotation about the view axis (radians). */
  roll: number;
  /** Tilt about the horizontal axis (radians). Negative brings the lower arc towards the viewer. */
  incl: number;
}

export type Vec3 = [number, number, number];

export function solveKepler(meanAnomaly: number, e: number): number {
  let E = meanAnomaly + e * Math.sin(meanAnomaly) * (1 + e * Math.cos(meanAnomaly));
  for (let k = 0; k < 3; k++) E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  return E;
}

export function orbitPoint(o: OrbitShape, E: number): Vec3 {
  const b = o.a * Math.sqrt(1 - o.e * o.e);
  const px = o.a * (Math.cos(E) - o.e);
  const py = b * Math.sin(E);
  const qy = py * Math.cos(o.incl);
  const qz = py * Math.sin(o.incl);
  const cr = Math.cos(o.roll);
  const sr = Math.sin(o.roll);
  return [px * cr - qy * sr, px * sr + qy * cr, qz];
}

/** Perspective factor used by the shaders: nearer points (z > 0) are drawn larger. */
export function perspective(z: number, distance: number): number {
  return distance / (distance - z);
}

export interface ArcTable {
  /** Eccentric anomaly of each vertex, evenly spaced along the projected arc. */
  anomalies: Float32Array;
  /** Cumulative projected arc length in planet radii at each vertex. */
  lengths: Float32Array;
  total: number;
}

/**
 * Samples the projected (rest pose) ellipse and returns `segments + 1` vertices spaced evenly in
 * arc length so that dotted ribbons keep a constant spacing and tessellation follows the curve.
 */
export function buildArcTable(o: OrbitShape, distance: number, segments: number): ArcTable {
  const samples = 4096;
  const cumulative = new Float64Array(samples + 1);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i <= samples; i++) {
    const [x, y, z] = orbitPoint(o, (i / samples) * Math.PI * 2);
    const s = perspective(z, distance);
    const sx = x * s;
    const sy = y * s;
    if (i > 0) cumulative[i] = cumulative[i - 1] + Math.hypot(sx - prevX, sy - prevY);
    prevX = sx;
    prevY = sy;
  }
  const total = cumulative[samples];
  const anomalies = new Float32Array(segments + 1);
  const lengths = new Float32Array(segments + 1);
  let cursor = 0;
  for (let k = 0; k <= segments; k++) {
    const target = (k / segments) * total;
    while (cursor < samples - 1 && cumulative[cursor + 1] < target) cursor++;
    const span = cumulative[cursor + 1] - cumulative[cursor];
    const frac = span > 0 ? (target - cumulative[cursor]) / span : 0;
    anomalies[k] = ((cursor + Math.min(Math.max(frac, 0), 1)) / samples) * Math.PI * 2;
    lengths[k] = target;
  }
  return { anomalies, lengths, total };
}

/** Small deterministic PRNG so the scene is identical between runs (reproducible screenshots). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
