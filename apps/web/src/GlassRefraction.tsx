import { useEffect, useRef } from 'react';
import { refractionMap, supportsGlassRefraction } from './glass-refraction';

const BEZEL = 22;
const MAP_SCALE = 3; // the map is generated at 1/3 resolution; the filter stretches it smoothly

/**
 * Supplies the edge-refraction filter the glass cards use in Chromium. It watches the card, regenerates the
 * displacement map when its size changes, and only switches the effect on when it is supported and the person
 * has not asked for reduced transparency. Everything else falls back to the lit-glass styling in auth.css.
 */
export function GlassRefraction() {
  const image = useRef<SVGFEImageElement>(null);
  useEffect(() => {
    const page = image.current?.closest<HTMLElement>('.auth-page');
    if (!page || !supportsGlassRefraction()) return;
    const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)');
    let observed: HTMLElement | null = null;
    let frame = 0;
    const render = () => {
      frame = 0;
      const card = page.querySelector<HTMLElement>('.auth-card');
      const feImage = image.current;
      if (!card || !feImage) return;
      const width = Math.round(card.offsetWidth);
      const height = Math.round(card.offsetHeight);
      if (width < 40 || height < 40) return;
      const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 26;
      const map = refractionMap(Math.ceil(width / MAP_SCALE), Math.ceil(height / MAP_SCALE), radius / MAP_SCALE, BEZEL / MAP_SCALE);
      const canvas = document.createElement('canvas');
      canvas.width = map.width;
      canvas.height = map.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.putImageData(new ImageData(map.data as unknown as Uint8ClampedArray<ArrayBuffer>, map.width, map.height), 0, 0);
      feImage.setAttribute('href', canvas.toDataURL('image/png'));
      feImage.setAttribute('width', String(width));
      feImage.setAttribute('height', String(height));
      page.dataset.glass = 'refract';
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
    const observer = new ResizeObserver(schedule);
    // The card element is replaced when switching between sign-in and registration; keep observing the current one.
    const watch = new MutationObserver(() => {
      const card = page.querySelector<HTMLElement>('.auth-card');
      if (card && card !== observed) { observer.disconnect(); observer.observe(card); observed = card; schedule(); }
    });
    watch.observe(page, { childList: true, subtree: true });
    const onPreference = () => { if (reduced.matches) delete page.dataset.glass; else schedule(); };
    reduced.addEventListener('change', onPreference);
    if (!reduced.matches) schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      watch.disconnect();
      reduced.removeEventListener('change', onPreference);
      delete page.dataset.glass;
    };
  }, []);
  return (
    <svg className="glass-refraction-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="haven-glass-refraction" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage ref={image} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="26" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
