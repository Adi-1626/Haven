import { OrbitalScene, STATIC_TIME, type MaskRect } from '@orbital/scene';
import { lowerTier, pickInitialTier, type QualityTier, type SceneLayout } from '@orbital/layout';
import { breakpoint, interpolate, resolveStation, STATIONS, toLayout, type CameraKey, type Viewport } from './camera';
import { PLANET, type Pointer } from './projection';

const FRAME_MS = 1000 / 60;
const IDLE_FRAME_MS = 1000 / 30;
const IDLE_AFTER_MS = 2500;
const REFRESH_SAMPLES = 24;
const POINTER_IDLE_MS = 4500;
const MASK_SLOTS = 6;
const MASK_INTERVAL_MS = 400;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
function readStartTime(): number {
  const value = Number(new URLSearchParams(window.location.search).get('orbit'));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100_000) : STATIC_TIME;
}
const clampIndex = (i: number) => Math.min(Math.max(Number.isFinite(i) ? i : 0, 0), STATIONS.length - 1);

/**
 * Maps the scroll position to a continuous station index. Each section is a resting place for the
 * camera; the flight to the next station happens while that section's top rises through the viewport.
 */
export function scrollProgress(scrollY: number, tops: number[], viewportHeight: number, maxScroll: number): number {
  if (tops.length < 2) return 0;
  const effective = stationScrollTargets(tops, maxScroll);
  for (let i = 0; i < effective.length - 1; i++) {
    const next = effective[i + 1];
    const start = Math.max(next - viewportHeight * 0.72, effective[i]);
    const end = Math.max(next - viewportHeight * 0.08, start + 1);
    if (scrollY < start) return i;
    if (scrollY < end) return i + smoothstep((scrollY - start) / (end - start));
  }
  return effective.length - 1;
}

/** Scroll offsets at which each station is fully arrived (clamped to what the document can scroll). */
export function stationScrollTargets(tops: number[], maxScroll: number): number[] {
  const out: number[] = [];
  tops.forEach((top, i) => {
    const value = Math.min(Math.max(top, 0), Math.max(maxScroll, 0));
    out.push(i === 0 ? value : Math.max(value, out[i - 1] + 1));
  });
  return out;
}

export interface FrameInfo {
  time: number;
  layout: SceneLayout;
  pointer: Pointer;
  /** Continuous station index the camera is showing. */
  progress: number;
  traveling: boolean;
}

export interface EngineOptions {
  host: HTMLElement;
  /** Document offsets of each station's section, in STATIONS order. */
  sectionTops(): number[];
  onFrame?(info: FrameInfo): void;
  onFallback?(fallback: boolean): void;
}

interface Travel {
  from: CameraKey;
  to: number;
  start: number;
  duration: number;
}

/**
 * Drives the authentication screen's orbital scene as the website's camera. The render loop never
 * touches React state; markers and copy read positions through onFrame.
 */
export class CosmosEngine {
  private scene: OrbitalScene | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private teardown: Array<() => void> = [];
  private readonly reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private reduced = this.reducedQuery.matches;
  private tier: QualityTier = 'high';
  private running = false;
  private disposed = false;
  private raf = 0;

  private view: Viewport = { width: 1, height: 1 };
  private tops: number[] = [];
  private targets: number[] = [];
  private maxScroll = 0;

  /** Starting orbital phase. `?orbit=<seconds>` reproduces any arrangement for QA and screenshots. */
  private readonly startTime = readStartTime();
  private simTime = this.startTime;
  private timeScale = 1;
  private timeScaleTarget = 1;
  private progress = 0;
  private progressVelocity = 0;
  private progressTarget = 0;
  private travel: Travel | null = null;
  private camera: CameraKey | null = null;
  private lastStatic = -1;

  private lastTick = 0;
  private lastFrame = 0;
  private refreshMs = 0;
  private sinceRender = 0;
  private readonly refreshSamples: number[] = [];
  private lastActivity = 0;
  private lastPointerMove = 0;
  private pointerX = 0;
  private pointerY = 0;
  private masksAt = -Infinity;
  private masksDirty = true;
  private calmContent = true;

  private paceFrames = 0;
  private paceSum = 0;
  private paceMin = Infinity;
  private slowWindows = 0;

  constructor(private readonly options: EngineOptions) {
    this.build();
    const onReduced = () => {
      this.reduced = this.reducedQuery.matches;
      this.scene?.setReducedMotion(this.reduced);
      this.travel = null;
      this.syncRunning();
    };
    const onScroll = () => {
      this.lastActivity = performance.now();
      this.masksDirty = true;
      this.progressTarget = this.readProgress();
      if (!this.running) this.scheduleStatic();
    };
    const onResize = () => this.measureLayout();
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      this.lastActivity = this.lastPointerMove = performance.now();
      this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      this.pointerY = 1 - (event.clientY / window.innerHeight) * 2;
    };
    const onVisibility = () => this.syncRunning();
    this.reducedQuery.addEventListener('change', onReduced);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const bodyObserver = new ResizeObserver(() => this.measureLayout());
    bodyObserver.observe(document.body);
    this.teardown.push(() => {
      this.reducedQuery.removeEventListener('change', onReduced);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      bodyObserver.disconnect();
    });
    this.measureLayout();
    this.progress = this.progressTarget = this.readProgress();
    this.syncRunning();
  }

  get available(): boolean {
    return this.scene !== null;
  }

  get motion(): boolean {
    return this.scene !== null && !this.reduced;
  }

  /** Scroll offset at which a station is fully in view. */
  scrollTargetFor(index: number): number {
    this.measureLayout();
    return this.targets[index] ?? 0;
  }

  /** Flies from wherever the camera is now to a station. */
  flyTo(index: number, duration: number): void {
    if (!this.motion || !this.camera) return;
    this.lastActivity = performance.now();
    this.travel = { from: this.camera, to: index, start: performance.now(), duration };
  }

  /** Copy fades out during flights; the protective calm behind it follows. */
  setContentCalm(calm: boolean): void {
    this.calmContent = calm;
    this.masksDirty = true;
  }

  /** Slows the system while a destination is being aimed at, so moving moons are easy to pick. */
  setHovering(hovering: boolean): void {
    this.timeScaleTarget = hovering ? 0.12 : 1;
  }

  /** Re-reads layout (after fonts load, content expands or the viewport changes). */
  measureLayout(): void {
    if (this.disposed) return;
    const host = this.options.host.getBoundingClientRect();
    this.view = { width: host.width || window.innerWidth, height: host.height || window.innerHeight };
    this.tops = this.options.sectionTops();
    this.maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
    this.targets = stationScrollTargets(this.tops, this.maxScroll);
    this.progressTarget = this.readProgress();
    this.masksDirty = true;
    if (this.scene && this.canvas) {
      this.scene.resize(this.view.width, this.view.height, window.devicePixelRatio || 1);
      if (!this.running) this.drawStatic(true);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.teardown.forEach(fn => fn());
    this.teardown = [];
    this.destroyScene();
  }

  // -----------------------------------------------------------------------------------------

  private build(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'cosmos-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    this.options.host.prepend(canvas);
    let scene: OrbitalScene;
    try {
      scene = new OrbitalScene(canvas);
    } catch {
      canvas.remove();
      this.options.onFallback?.(true);
      return;
    }
    this.canvas = canvas;
    this.scene = scene;
    this.tier = pickInitialTier({
      softwareRenderer: scene.softwareRenderer,
      hardwareConcurrency: navigator.hardwareConcurrency || 4,
      deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      smallScreen: Math.min(window.innerWidth, window.innerHeight) < 700,
    });
    scene.setQuality(this.tier);
    scene.setReducedMotion(this.reduced);
    document.documentElement.dataset.cosmosQuality = this.tier;

    const onLost = (event: Event) => {
      event.preventDefault();
      this.stop();
      this.options.onFallback?.(true);
    };
    const onRestored = () => {
      if (this.disposed) return;
      this.destroyScene();
      this.build();
      this.measureLayout();
      if (this.scene) this.options.onFallback?.(false);
      this.syncRunning();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.destroyCanvasListeners = () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }

  private destroyCanvasListeners: () => void = () => {};

  private destroyScene(): void {
    this.destroyCanvasListeners();
    this.scene?.dispose();
    this.canvas?.remove();
    this.scene = null;
    this.canvas = null;
    delete document.documentElement.dataset.cosmosQuality;
  }

  private readProgress(): number {
    return scrollProgress(window.scrollY, this.tops, window.innerHeight, this.maxScroll);
  }

  private syncRunning(): void {
    if (!this.scene || document.hidden || this.reduced || this.scene.isContextLost()) {
      this.stop();
      this.drawStatic(true);
      return;
    }
    if (this.running) return;
    this.running = true;
    this.lastFrame = this.lastTick = performance.now();
    this.sinceRender = 0;
    this.refreshMs = 0;
    this.refreshSamples.length = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    cancelAnimationFrame(this.staticRaf);
    this.staticRaf = 0;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private staticRaf = 0;

  /** Coalesces still-frame redraws while scrolling with reduced motion (the calm areas follow the copy). */
  private scheduleStatic(): void {
    if (this.staticRaf) return;
    this.staticRaf = requestAnimationFrame(() => {
      this.staticRaf = 0;
      if (!this.running) this.drawStatic(true);
    });
  }

  /** Reduced motion: a still frame at the nearest station. The camera jumps; nothing animates. */
  private drawStatic(force = false): void {
    const scene = this.scene;
    if (!scene || this.disposed || document.hidden) return;
    const index = clampIndex(Math.round(this.readProgress()));
    if (!force && index === this.lastStatic) return;
    this.lastStatic = index;
    this.progress = this.progressTarget = index;
    const pointer = { x: 0, y: 0 };
    const key = resolveStation(STATIONS[index], this.startTime, pointer, this.view);
    this.camera = key;
    const layout = toLayout(key);
    scene.setLayout(layout);
    this.updateMasks(performance.now(), true);
    scene.render(this.startTime, 0);
    this.options.onFrame?.({ time: this.startTime, layout, pointer, progress: index, traveling: false });
  }

  private readonly tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const scene = this.scene;
    if (!scene) return;

    const raw = now - this.lastTick;
    this.lastTick = now;
    if (!this.refreshMs && raw > 2 && raw < 50) {
      this.refreshSamples.push(raw);
      if (this.refreshSamples.length >= REFRESH_SAMPLES) this.refreshMs = this.refreshSamples.sort((a, b) => a - b)[REFRESH_SAMPLES >> 1];
    }
    // 60 fps while something moves; 30 fps once the page has been still for a moment.
    const idle = !this.travel && now - this.lastActivity > IDLE_AFTER_MS && Math.abs(this.progress - this.progressTarget) < 1e-3;
    const every = this.refreshMs ? Math.max(1, Math.round((idle ? IDLE_FRAME_MS : FRAME_MS) / this.refreshMs)) : 1;
    if (++this.sinceRender < every) return;
    this.sinceRender = 0;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.timeScale += (this.timeScaleTarget - this.timeScale) * Math.min(1, dt * 5);
    this.simTime += dt * this.timeScale;

    // Critically damped follow of the scroll position, so wheel steps glide.
    const omega = 7.5;
    const accel = omega * omega * (this.progressTarget - this.progress) - 2 * omega * this.progressVelocity;
    this.progressVelocity += accel * dt;
    this.progress += this.progressVelocity * dt;
    // A long frame (resize, tab switch) can overshoot the integrator; keep it inside the tour.
    if (!Number.isFinite(this.progress)) this.progress = this.progressTarget;
    this.progress = Math.min(Math.max(this.progress, 0), STATIONS.length - 1);
    if (Math.abs(this.progressTarget - this.progress) < 1e-4 && Math.abs(this.progressVelocity) < 1e-3) {
      this.progress = this.progressTarget;
      this.progressVelocity = 0;
    }

    const pointer = scene.getPointer();
    let key: CameraKey;
    let lean = 0;
    let leanX = 0;
    let leanY = 0;
    let shown = this.progress;
    if (this.travel) {
      const travel = this.travel;
      const t = Math.min((now - travel.start) / travel.duration, 1);
      const to = resolveStation(STATIONS[travel.to], this.simTime, pointer, this.view);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      key = interpolate(travel.from, to, eased, this.view);
      // Lean into the turn: a little yaw/pitch towards the destination makes the rings swing in depth.
      lean = Math.sin(Math.PI * eased);
      const dx = to.ax - travel.from.ax + (to.fx - travel.from.fx) * 60;
      const dy = to.ay - travel.from.ay + (to.fy - travel.from.fy) * 60;
      const len = Math.hypot(dx, dy) || 1;
      leanX = (dx / len) * 0.75;
      leanY = (-dy / len) * 0.6;
      shown = travel.to;
      if (t >= 1) {
        this.travel = null;
        this.progressTarget = this.readProgress();
        this.progress = travel.to;
        this.progressVelocity = 0;
      }
    } else {
      const i = clampIndex(Math.floor(this.progress));
      const frac = this.progress - i;
      const a = resolveStation(STATIONS[i], this.simTime, pointer, this.view);
      key = frac > 1e-4 && i + 1 < STATIONS.length
        ? interpolate(a, resolveStation(STATIONS[i + 1], this.simTime, pointer, this.view), frac, this.view)
        : a;
      // On narrow screens the copy runs full width under a moon pinned near the top. Let the moon
      // rise away as the section is read, and settle back as the camera leaves for the next station.
      if (STATIONS[i].focus !== PLANET && breakpoint(this.view) === 'narrow') {
        const read = Math.min(Math.max(window.scrollY - (this.targets[i] ?? 0), 0), this.view.height * 0.5);
        key = { ...key, ay: key.ay - read * 0.7 * (1 - frac) };
      }
    }
    this.camera = key;

    const pointerActive = now - this.lastPointerMove < POINTER_IDLE_MS;
    scene.setPointerTarget((pointerActive ? this.pointerX : 0) * (1 - lean) + leanX * lean, (pointerActive ? this.pointerY : 0) * (1 - lean) + leanY * lean);
    const layout = toLayout(key);
    scene.setLayout(layout);
    this.updateMasks(now, false);
    scene.render(this.simTime, dt);
    // The scene steps its parallax spring while rendering; project waypoints with the pose just drawn.
    this.options.onFrame?.({ time: this.simTime, layout, pointer: scene.getPointer(), progress: shown, traveling: this.travel !== null });
    this.pace(dt, idle);
  };

  private paceIdle = false;

  private pace(dt: number, idle: boolean): void {
    if (dt <= 0 || !this.scene) return;
    // The deliberate 30 fps idle cadence is not slowness: start a fresh window whenever it toggles.
    if (idle !== this.paceIdle) {
      this.paceIdle = idle;
      this.paceFrames = 0;
      this.paceSum = 0;
      this.paceMin = Infinity;
      return;
    }
    this.paceFrames++;
    this.paceSum += dt;
    this.paceMin = Math.min(this.paceMin, dt);
    if (this.paceFrames < 120) return;
    const average = this.paceSum / this.paceFrames;
    this.slowWindows = this.paceMin > 0.006 && average > this.paceMin * 1.45 && this.tier !== 'minimal' ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.tier = lowerTier(this.tier);
      document.documentElement.dataset.cosmosQuality = this.tier;
      this.scene.setQuality(this.tier);
      this.scene.applyResolution();
      this.slowWindows = 0;
    }
    this.paceFrames = 0;
    this.paceSum = 0;
    this.paceMin = Infinity;
  }

  /** Calms the scene behind visible copy. Elements opt in with data-calm="<strength 0..1>". */
  private updateMasks(now: number, force: boolean): void {
    const scene = this.scene;
    if (!scene) return;
    if (!force && !this.masksDirty && now - this.masksAt < MASK_INTERVAL_MS) return;
    this.masksDirty = false;
    this.masksAt = now;
    if (!this.calmContent) {
      scene.setMasks([]);
      return;
    }
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const candidates: Array<MaskRect & { area: number }> = [];
    document.querySelectorAll<HTMLElement>('[data-calm]').forEach(element => {
      const box = element.getBoundingClientRect();
      if (box.bottom < -40 || box.top > vh + 40 || box.width < 2 || box.height < 2) return;
      const strength = Number(element.dataset.calm) || 0.6;
      const visible = (Math.min(box.bottom, vh) - Math.max(box.top, 0)) * (Math.min(box.right, vw) - Math.max(box.left, 0));
      candidates.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom, strength, area: visible });
    });
    candidates.sort((a, b) => b.area - a.area);
    scene.setMasks(candidates.slice(0, MASK_SLOTS));
  }
}
