// Camera model for the website. The orbital scene positions everything from one planet centre and
// radius (its SceneLayout), so a camera move is a change of layout: zooming is a larger radius and
// panning moves the centre. A station keeps one body (the planet or a moon) at a chosen point on
// screen at a chosen size; flights interpolate between stations in log-zoom space.

import type { SceneLayout } from '@orbital/layout';
import { bodyRadius, bodyView, PERSPECTIVE_DISTANCE, PLANET, type Focus, type Pointer } from './projection';
import { perspective } from '@orbital/orbit-math';

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  /** Where the focused body sits, CSS px (y down). */
  x: number;
  y: number;
  /** Drawn radius of the focused body, CSS px. */
  size: number;
}

export interface Station {
  id: string;
  focus: Focus;
  place(view: Viewport): Placement;
}

/** A resolved camera: focus point (planet radii, screen-aligned, y down), its anchor on screen and log zoom. */
export interface CameraKey {
  fx: number;
  fy: number;
  ax: number;
  ay: number;
  logR: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type Breakpoint = 'narrow' | 'medium' | 'wide';

export function breakpoint({ width, height }: Viewport): Breakpoint {
  if (width < 760 || (width < 1000 && height > width * 1.15)) return 'narrow';
  return width < 1100 ? 'medium' : 'wide';
}

const MOON = { communities: 0, voice: 1, desktop: 2, faq: 3 } as const;

/**
 * The tour, in page order. Each destination is a real body in the auth scene: the planet itself,
 * then its four moons. Placements leave the copy column clear for every breakpoint.
 */
export const STATIONS: Station[] = [
  {
    id: 'top',
    focus: PLANET,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      if (bp === 'narrow') return { x: w * 0.5, y: h * 0.25, size: clamp(Math.min(w * 0.13, h * 0.075), 34, 70) };
      if (bp === 'medium') return { x: w * 0.68, y: h * 0.48, size: clamp(Math.min(h * 0.11, w * 0.085), 50, 110) };
      return { x: clamp(w * 0.67, 0, w - 380), y: h * 0.5, size: clamp(Math.min(h * 0.128, w * 0.08), 60, 150) };
    },
  },
  {
    id: 'product',
    focus: PLANET,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      // Arrive at Haven: the planet becomes a horizon under the product.
      const size = bp === 'narrow' ? Math.max(h * 0.75, w * 1.1) : Math.max(w * 0.62, h * 0.95);
      return { x: w * 0.5, y: h + size * (bp === 'narrow' ? 0.74 : 0.66), size };
    },
  },
  {
    id: 'communities',
    focus: MOON.communities,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      if (bp === 'narrow') return { x: w * 0.8, y: h * 0.15, size: clamp(w * 0.17, 44, 90) };
      // Medium layouts move the copy to the right column, so the moon crosses to the left.
      if (bp === 'medium') return { x: w * 0.12, y: h * 0.42, size: clamp(Math.min(w, h) * 0.15, 70, 140) };
      return { x: w * 0.79, y: h * 0.42, size: clamp(Math.min(w, h) * 0.2, 90, 210) };
    },
  },
  {
    id: 'desktop',
    focus: MOON.desktop,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      if (bp === 'narrow') return { x: w * 0.2, y: h * 0.14, size: clamp(w * 0.16, 42, 86) };
      // Medium layouts leave a narrow left column, so the moon sits smaller and further out.
      if (bp === 'medium') return { x: w * 0.12, y: h * 0.48, size: clamp(Math.min(w, h) * 0.15, 70, 140) };
      return { x: w * 0.19, y: h * 0.48, size: clamp(Math.min(w, h) * 0.19, 84, 200) };
    },
  },
  {
    id: 'how-it-works',
    focus: MOON.voice,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      if (bp === 'narrow') return { x: w * 0.8, y: h * 0.13, size: clamp(w * 0.14, 38, 76) };
      return { x: w * 0.83, y: h * 0.27, size: clamp(Math.min(w, h) * 0.13, 60, 140) };
    },
  },
  {
    id: 'faq',
    focus: MOON.faq,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      if (bp === 'narrow') return { x: w * 0.18, y: h * 0.12, size: clamp(w * 0.11, 30, 60) };
      return { x: w * 0.15, y: h * 0.3, size: clamp(Math.min(w, h) * 0.1, 46, 110) };
    },
  },
  {
    id: 'home',
    focus: PLANET,
    place(view) {
      const { width: w, height: h } = view;
      const bp = breakpoint(view);
      // Pull all the way back: the whole system, small and calm, above the closing call to action.
      if (bp === 'narrow') return { x: w * 0.5, y: h * 0.24, size: clamp(w * 0.085, 26, 44) };
      return { x: w * 0.5, y: h * 0.3, size: clamp(h * 0.062, 32, 70) };
    },
  },
];

export function stationIndex(id: string): number {
  return STATIONS.findIndex(station => station.id === id);
}

/** Resolves a station into a camera for the current scene time and pointer pose. */
export function resolveStation(station: Station, time: number, pointer: Pointer, view: Viewport): CameraKey {
  const place = station.place(view);
  if (station.focus === PLANET) return { fx: 0, fy: 0, ax: place.x, ay: place.y, logR: Math.log(place.size) };
  const [x, y, z] = bodyView(station.focus, time, pointer);
  const s = perspective(z, PERSPECTIVE_DISTANCE);
  const radius = place.size / (bodyRadius(station.focus) * s);
  return { fx: x * s, fy: -y * s, ax: place.x, ay: place.y, logR: Math.log(radius) };
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Interpolates two cameras. When the two focus points are far apart at the closer zoom, the camera
 * pulls back mid-flight so both ends stay in view (a gentle arc instead of a whip pan).
 */
export function interpolate(a: CameraKey, b: CameraKey, t: number, view: Viewport): CameraKey {
  const e = clamp(t, 0, 1);
  const distance = Math.hypot(b.fx - a.fx, b.fy - a.fy);
  let dip = 0;
  if (distance > 1e-4) {
    const fit = Math.log((0.62 * Math.hypot(view.width, view.height)) / distance);
    dip = Math.max(0, (a.logR + b.logR) / 2 - fit) * 0.85;
  }
  return {
    fx: lerp(a.fx, b.fx, e),
    fy: lerp(a.fy, b.fy, e),
    ax: lerp(a.ax, b.ax, e),
    ay: lerp(a.ay, b.ay, e),
    logR: lerp(a.logR, b.logR, e) - dip * Math.sin(Math.PI * e),
  };
}

export function toLayout(key: CameraKey): SceneLayout {
  const radius = Math.exp(key.logR);
  return { cx: key.ax - key.fx * radius, cy: key.ay - key.fy * radius, radius };
}
