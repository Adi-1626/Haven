import { useEffect, useRef, useState } from 'react';
import { OrbitalScene, STATIC_TIME, type MaskRect } from './orbital/scene';
import { computeLayout, lowerTier, pickInitialTier } from './orbital/layout';
import { getAppActivitySnapshot, subscribeAppActivity } from './app-activity';

// The auth screen's compact breakpoint (see auth.css): the hero column is hidden and the card is centred.
const COMPACT_QUERY = '(max-width: 840px), (max-height: 640px)';
// Protection behind the glass card: light normally, firmer when the OS asks for less transparency.
const CARD_STRENGTH = 0.5;
const CARD_STRENGTH_REDUCED_TRANSPARENCY = 0.8;
// Copy and controls the animation must stay calm behind. Strength 1 would hide the scene entirely.
const MASK_TARGETS: Array<{ selector: string; strength: number }> = [
  { selector: '.auth-hero-center', strength: 0.72 },
  { selector: '.auth-card, .auth-onboarding-card', strength: CARD_STRENGTH },
  { selector: '.auth-compact-header', strength: 0.5 },
  { selector: '.auth-hero-footer', strength: 0.95 },
  { selector: '.auth-privacy-note', strength: 0.9 },
];
const FRAME_MS = 1000 / 60;
const TYPING_FRAME_MS = 1000 / 30;
const REFRESH_SAMPLES = 24;
const POINTER_IDLE_MS = 4500;
const MEASURE_INTERVAL_MS = 500;
const GLASS_EPSILON = 0.004;

function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
}

type Box = Record<'left' | 'top' | 'right' | 'bottom', number>;

/**
 * Animated orbital environment for the authentication screens: a single WebGL2 scene (planet, rings,
 * moons, light nodes, dust). When WebGL is unavailable the approved still artwork is shown instead.
 * The render loop never touches React state; state changes only when the fallback toggles.
 */
export function OrbitalBackground() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const host = wrap;
    const page = host.parentElement ?? host;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compactQuery = window.matchMedia(COMPACT_QUERY);
    const transparencyQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
    let unmounted = false;
    let current: (() => void) | null = null;

    /** Builds the canvas, scene, loop and listeners. Returns a teardown, or null when WebGL2 is unavailable. */
    const setup = (): (() => void) | null => {
      const canvas = document.createElement('canvas');
      canvas.className = 'orbital-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      host.prepend(canvas);

      let scene: OrbitalScene;
      try {
        scene = new OrbitalScene(canvas);
      } catch {
        canvas.remove();
        return null;
      }

      let tier = pickInitialTier({
        softwareRenderer: scene.softwareRenderer,
        hardwareConcurrency: navigator.hardwareConcurrency || 4,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
        smallScreen: Math.min(window.innerWidth, window.innerHeight) < 700,
      });
      scene.setQuality(tier);

      let reduced = reducedQuery.matches;
      scene.setReducedMotion(reduced);

      let raf = 0;
      let running = false;
      let lastFrame = 0;
      // Display refresh interval, measured from rAF cadence, so 120/144 Hz screens render every 2nd/3rd tick
      // instead of burning power on a decorative scene (and without the uneven cadence a time threshold gives).
      let lastTick = 0;
      let refreshMs = 0;
      let sinceRender = 0;
      const refreshSamples: number[] = [];
      let simTime = 0;
      let typing = false;
      let lastPointerMove = 0;
      let measuredAt = -Infinity;
      let cardTop = 0;
      let textRight = 0;
      let cardLeft = 0;
      let stopped = false;
      const smoothed: Array<Box | undefined> = [];
      // The glass card leans its highlight with the same spring as the scene. Written only while it moves.
      let glassCard: HTMLElement | null = null;
      let glassX = 0;
      let glassY = 0;
      page.dataset.orbitalQuality = tier;

      // Frame pacing: if frames take consistently longer than the display's best-case interval, step quality down.
      let paceFrames = 0;
      let paceSum = 0;
      let paceMin = Infinity;
      let slowWindows = 0;
      const resetPacing = () => {
        paceFrames = 0;
        paceSum = 0;
        paceMin = Infinity;
      };

      const measure = (now: number, snap: boolean) => {
        const origin = host.getBoundingClientRect();
        const rects: MaskRect[] = [];
        cardTop = 0;
        textRight = 0;
        cardLeft = 0;
        MASK_TARGETS.forEach(({ selector, strength }, index) => {
          const box = page.querySelector(selector)?.getBoundingClientRect();
          if (!box || box.width < 2 || box.height < 2) {
            smoothed[index] = undefined;
            return;
          }
          const target: Box = { left: box.left - origin.left, top: box.top - origin.top, right: box.right - origin.left, bottom: box.bottom - origin.top };
          const prev = smoothed[index];
          // Ease towards new rects so switching between sign-in / register does not pop the protection zones.
          const next: Box = snap || !prev
            ? target
            : {
                left: prev.left + (target.left - prev.left) * 0.35,
                top: prev.top + (target.top - prev.top) * 0.35,
                right: prev.right + (target.right - prev.right) * 0.35,
                bottom: prev.bottom + (target.bottom - prev.bottom) * 0.35,
              };
          smoothed[index] = next;
          const isCard = strength === CARD_STRENGTH;
          rects.push({ ...next, strength: isCard && transparencyQuery.matches ? CARD_STRENGTH_REDUCED_TRANSPARENCY : strength });
          if (selector.includes('auth-card')) {
            glassCard = page.querySelector<HTMLElement>(selector);
            cardTop = target.top;
            cardLeft = target.left;
          }
          if (selector === '.auth-hero-center') textRight = target.right;
        });
        scene.setMasks(rects);
        measuredAt = now;
      };

      const relayout = (snap: boolean) => {
        const rect = host.getBoundingClientRect();
        const width = rect.width || window.innerWidth;
        const height = rect.height || window.innerHeight;
        scene.resize(width, height, window.devicePixelRatio || 1);
        measure(performance.now(), snap);
        scene.setLayout(computeLayout({ width, height, compact: compactQuery.matches, cardTop, textRight, cardLeft }));
      };

      const drawStatic = () => {
        if (!stopped) scene.render(STATIC_TIME, 0);
      };

      const tick = (now: number) => {
        if (!running) return;
        raf = requestAnimationFrame(tick);
        const raw = now - lastTick;
        lastTick = now;
        if (!refreshMs && raw > 2 && raw < 50) {
          refreshSamples.push(raw);
          if (refreshSamples.length >= REFRESH_SAMPLES) refreshMs = refreshSamples.sort((a, b) => a - b)[REFRESH_SAMPLES >> 1];
        }
        // 60 fps target; half-rate while someone is entering credentials so typing stays instant.
        const every = refreshMs ? Math.max(1, Math.round((typing ? TYPING_FRAME_MS : FRAME_MS) / refreshMs)) : 1;
        if (++sinceRender < every) return;
        sinceRender = 0;
        const elapsed = now - lastFrame;
        lastFrame = now;
        const dt = Math.min(elapsed / 1000, 0.1);
        simTime += dt;

        if (now - lastPointerMove > POINTER_IDLE_MS) scene.setPointerTarget(0, 0);
        if (now - measuredAt > MEASURE_INTERVAL_MS) {
          measure(now, false);
          scene.setLayout(computeLayout({ width: canvas.clientWidth, height: canvas.clientHeight, compact: compactQuery.matches, cardTop, textRight, cardLeft }));
        }
        scene.render(simTime, dt);
        if (glassCard) {
          const pointer = scene.getPointer();
          if (Math.abs(pointer.x - glassX) > GLASS_EPSILON || Math.abs(pointer.y - glassY) > GLASS_EPSILON) {
            glassX = pointer.x;
            glassY = pointer.y;
            glassCard.style.setProperty('--glass-px', glassX.toFixed(3));
            glassCard.style.setProperty('--glass-py', glassY.toFixed(3));
          }
        }

        if (typing || dt <= 0) return;
        paceFrames++;
        paceSum += dt;
        paceMin = Math.min(paceMin, dt);
        if (paceFrames < 120) return;
        // Only react when the best frame time looks like a real refresh interval and the average sits well above it.
        const average = paceSum / paceFrames;
        slowWindows = paceMin > 0.006 && average > paceMin * 1.45 && tier !== 'minimal' ? slowWindows + 1 : 0;
        if (slowWindows >= 2) {
          tier = lowerTier(tier);
          page.dataset.orbitalQuality = tier;
          scene.setQuality(tier);
          scene.applyResolution();
          slowWindows = 0;
        }
        resetPacing();
      };

      const start = () => {
        if (running || stopped || reduced || document.hidden || !getAppActivitySnapshot()
          || document.documentElement.dataset.gaming === 'true' || scene.isContextLost()) return;
        running = true;
        lastFrame = lastTick = performance.now();
        sinceRender = 0;
        refreshMs = 0;
        refreshSamples.length = 0;
        raf = requestAnimationFrame(tick);
      };
      const stop = () => {
        running = false;
        cancelAnimationFrame(raf);
        raf = 0;
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!running || reduced || event.pointerType === 'touch') return;
        lastPointerMove = performance.now();
        scene.setPointerTarget((event.clientX / window.innerWidth) * 2 - 1, 1 - (event.clientY / window.innerHeight) * 2);
      };
      const onPointerLeave = (event: MouseEvent) => {
        if (!event.relatedTarget) scene.setPointerTarget(0, 0);
      };
      const onFocusIn = (event: FocusEvent) => {
        typing = isTextEntry(event.target);
        resetPacing();
      };
      const onFocusOut = () => {
        typing = false;
      };
      const onActivity = () => {
        const gaming = document.documentElement.dataset.gaming === 'true';
        scene.setReducedMotion(reduced || gaming);
        if (document.hidden || !getAppActivitySnapshot()) { stop(); return; }
        if (reduced || gaming) { stop(); drawStatic(); }
        else start();
      };
      const onVisibility = onActivity;
      const onReducedChange = () => {
        reduced = reducedQuery.matches;
        onActivity();
      };
      const onLost = (event: Event) => {
        // Keep the canvas so a restore event can arrive; meanwhile show the still artwork.
        event.preventDefault();
        stop();
        if (!unmounted) setFallback(true);
      };
      const onRestored = () => {
        if (unmounted) return;
        // GPU resources are gone after a loss: rebuild everything on a fresh canvas.
        current?.();
        current = setup();
        setFallback(current === null);
      };

      relayout(true);
      const resizeObserver = new ResizeObserver(() => {
        relayout(false);
        if (!running && !document.hidden && getAppActivitySnapshot()) drawStatic();
      });
      resizeObserver.observe(host);
      const stopActivity = subscribeAppActivity(onActivity);
      const gamingObserver = new MutationObserver(onActivity);
      gamingObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gaming'] });

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.documentElement.addEventListener('mouseleave', onPointerLeave);
      window.addEventListener('focusin', onFocusIn);
      window.addEventListener('focusout', onFocusOut);
      document.addEventListener('visibilitychange', onVisibility);
      reducedQuery.addEventListener('change', onReducedChange);
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);

      onActivity();

      return () => {
        stopped = true;
        stop();
        stopActivity();
        gamingObserver.disconnect();
        resizeObserver.disconnect();
        window.removeEventListener('pointermove', onPointerMove);
        document.documentElement.removeEventListener('mouseleave', onPointerLeave);
        window.removeEventListener('focusin', onFocusIn);
        window.removeEventListener('focusout', onFocusOut);
        document.removeEventListener('visibilitychange', onVisibility);
        reducedQuery.removeEventListener('change', onReducedChange);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        delete page.dataset.orbitalQuality;
        glassCard?.style.removeProperty('--glass-px');
        glassCard?.style.removeProperty('--glass-py');
        scene.dispose();
        canvas.remove();
      };
    };

    current = setup();
    if (!current) setFallback(true);

    return () => {
      unmounted = true;
      current?.();
      current = null;
    };
  }, []);

  return (
    <div className="orbital-bg-wrap" ref={wrapRef} aria-hidden="true">
      {fallback && <img src="/Reference_auth_BG.png" alt="" className="orbital-fallback-image" loading="eager" />}
      <div className="orbital-vignette" />
    </div>
  );
}
export default OrbitalBackground;
