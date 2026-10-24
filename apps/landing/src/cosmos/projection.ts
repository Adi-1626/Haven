// CPU mirror of where the orbital scene draws its bodies. The scene (apps/web/src/orbital) evaluates
// the same orbit table per vertex on the GPU; the website needs the positions to hit-test moons,
// label them and point the camera at them. Kept free of DOM and GL so it can be tested.

import { BODIES, ORBITS } from '@orbital/config';
import { orbitPoint, perspective, solveKepler, type Vec3 } from '@orbital/orbit-math';
import type { SceneLayout } from '@orbital/layout';

/** Mirrors PERSPECTIVE_DISTANCE in orbital/scene.ts. */
export const PERSPECTIVE_DISTANCE = 45;
const TAU = Math.PI * 2;

/** Smoothed pointer parallax in [-1, 1] (y up), as returned by OrbitalScene.getPointer(). */
export interface Pointer {
  x: number;
  y: number;
}

/** Index of a solid moon in BODIES, or PLANET for the central world. */
export const PLANET = -1;
export type Focus = number;

/** The view rotation the scene derives from the pointer spring: Rx(pitch) * Ry(yaw). */
function rotate([x, y, z]: Vec3, pointer: Pointer): Vec3 {
  const yaw = -pointer.x * 0.075;
  const pitch = pointer.y * 0.05;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  return [cy * x + sy * z, sx * sy * x + cx * y - sx * cy * z, -cx * sy * x + sx * y + cx * cy * z];
}

/** View-space position of a body (planet radius = 1, y up, z towards the viewer). */
export function bodyView(index: number, time: number, pointer: Pointer): Vec3 {
  if (index === PLANET) return [0, 0, 0];
  const body = BODIES[index];
  const orbit = ORBITS[body.orbit];
  const M = body.mode === 0
    ? orbit.pulses[0].phase + orbit.pulses[0].speed * time
    : body.mode === 1
      ? orbit.pulses[1].phase + orbit.pulses[1].speed * time
      : body.phase + body.speed * time;
  const E = solveKepler(((M % TAU) + TAU) % TAU, orbit.e);
  return rotate(orbitPoint(orbit, E), pointer);
}

/** World radius of a body in planet radii. */
export function bodyRadius(index: number): number {
  return index === PLANET ? 1 : BODIES[index].radius;
}

export interface ScreenBody {
  /** Centre in CSS px, y down. */
  x: number;
  y: number;
  /** Drawn radius in CSS px. */
  r: number;
  /** View depth; negative is behind the planet's centre plane. */
  z: number;
  /** True while the planet hides the body. */
  occluded: boolean;
}

/** Where the scene draws a body for a given layout, including its pointer parallax shift. */
export function projectBody(index: number, time: number, pointer: Pointer, layout: SceneLayout): ScreenBody {
  const [x, y, z] = bodyView(index, time, pointer);
  const s = perspective(z, PERSPECTIVE_DISTANCE);
  const shiftX = pointer.x * 9;
  const shiftY = pointer.y * 6;
  const px = layout.cx + shiftX + x * layout.radius * s;
  const py = layout.cy - shiftY - y * layout.radius * s;
  const r = bodyRadius(index) * layout.radius * s;
  const behind = index !== PLANET && z < 0
    && Math.hypot(px - layout.cx - shiftX, py - layout.cy + shiftY) < layout.radius + r * 0.4;
  return { x: px, y: py, r, z, occluded: behind };
}
