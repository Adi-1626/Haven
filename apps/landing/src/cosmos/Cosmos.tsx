import { useEffect, useRef, useState } from 'react';
import { STATIONS } from './camera';
import { CosmosEngine, type FrameInfo } from './engine';
import { cosmosNav, travelHandler } from './nav';
import { projectBody } from './projection';
import { DESTINATIONS } from '../destinations';

const LABEL_GAP = 10;
const COPY_REFRESH_MS = 250;

type Rect = { left: number; top: number; right: number; bottom: number };

const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * The fixed planetary layer behind the whole site: Haven's authentication scene, driven as a camera,
 * plus pointer waypoints riding on the real planet and moons.
 *
 * Hit testing is done by layering, not by guessing: waypoints sit beneath the page content, empty
 * page space lets pointer events through (see shell.css), and only real controls sit above. So a
 * body is clickable wherever it can be seen, and a link or button over it still wins. A body only
 * stops taking clicks when the planet hides it or its centre leaves the screen. Keyboard and
 * assistive technology use the hero's destination list, so the moving waypoints are hidden from them.
 */
export function Cosmos() {
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [fallback, setFallback] = useState(false);

  // Highlight (from the hero list or a hover) is applied directly, so the frame loop's classes survive.
  useEffect(() => cosmosNav.subscribe(() => {
    DESTINATIONS.forEach((destination, index) => {
      markerRefs.current[index]?.classList.toggle('is-highlighted', cosmosNav.highlight === destination.id);
    });
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    const layer = layerRef.current;
    if (!host || !layer) return;
    let copy: Rect[] = [];
    let headerBottom = 0;
    let copyAt = -Infinity;
    let layerVisible = true;
    const labelWidths: number[] = [];

    const readCopy = () => {
      copy = Array.from(document.querySelectorAll<HTMLElement>('[data-waypoint-avoid]')).map(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left - 8, top: box.top - 6, right: box.right + 8, bottom: box.bottom + 6 };
      });
      headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      markerRefs.current.forEach((marker, index) => {
        labelWidths[index] = marker?.querySelector<HTMLElement>('.waypoint-label')?.offsetWidth ?? 0;
      });
    };

    const onFrame = (info: FrameInfo) => {
      const presence = info.traveling ? 0 : Math.max(0, 1 - info.progress / 0.35);
      const visible = presence > 0.01;
      if (visible !== layerVisible) {
        layerVisible = visible;
        layer.classList.toggle('is-hidden', !visible);
      }
      layer.style.setProperty('--waypoint-presence', presence.toFixed(3));
      if (!visible) return;
      const now = performance.now();
      if (now - copyAt > COPY_REFRESH_MS) {
        readCopy();
        copyAt = now;
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      const planet = projectBody(DESTINATIONS[0].focus, info.time, info.pointer, info.layout);
      DESTINATIONS.forEach((destination, index) => {
        const marker = markerRefs.current[index];
        if (!marker) return;
        const body = index === 0 ? planet : projectBody(destination.focus, info.time, info.pointer, info.layout);
        const ring = Math.max(body.r + 9, 22);
        // Hidden only when it truly can't be seen: centre behind the planet's disk, or off screen.
        const behindPlanet = index > 0 && body.z < 0 && Math.hypot(body.x - planet.x, body.y - planet.y) < planet.r - body.r * 0.25;
        const offscreen = body.x < 0 || body.x > width || body.y < 0 || body.y > height;
        const left = body.x > width * 0.55;
        const labelWidth = labelWidths[index] ?? 0;
        const label: Rect = left
          ? { left: body.x - ring - LABEL_GAP - labelWidth, right: body.x - ring, top: body.y - 12, bottom: body.y + 12 }
          : { left: body.x + ring, right: body.x + ring + LABEL_GAP + labelWidth, top: body.y - 12, bottom: body.y + 12 };
        // Labels step aside for copy, the header and screen edges; the body itself stays clickable.
        const labelBlocked = label.left < 4 || label.right > width - 4 || label.top < headerBottom || copy.some(rect => overlaps(label, rect));
        const ringUnderCopy = copy.some(rect => body.x > rect.left && body.x < rect.right && body.y > rect.top && body.y < rect.bottom);
        marker.classList.toggle('is-hidden', behindPlanet || offscreen);
        marker.classList.toggle('is-quiet', labelBlocked);
        marker.classList.toggle('is-under-copy', ringUnderCopy);
        marker.classList.toggle('is-left', left);
        marker.dataset.depth = body.z < 0 ? 'back' : 'front';
        marker.style.transform = `translate3d(${body.x.toFixed(1)}px, ${body.y.toFixed(1)}px, 0)`;
        marker.style.setProperty('--ring', `${(ring * 2).toFixed(1)}px`);
      });
    };

    const engine = new CosmosEngine({
      host,
      sectionTops: () => STATIONS.map(station => {
        const section = document.getElementById(station.id);
        return section ? section.getBoundingClientRect().top + window.scrollY : 0;
      }),
      onFrame,
      onFallback: setFallback,
    });
    cosmosNav.attach(engine);
    if (!engine.available) setFallback(true);
    document.fonts?.ready.then(() => engine.measureLayout()).catch(() => {});
    return () => {
      cosmosNav.attach(null);
      engine.dispose();
    };
  }, []);

  return (
    <>
      <div className="cosmos" ref={hostRef} data-fallback={fallback || undefined} aria-hidden="true">
        {fallback && <img className="cosmos-fallback" src="/cosmos/orbital-still.webp" srcSet="/cosmos/orbital-still-small.webp 836w, /cosmos/orbital-still.webp 1672w" sizes="125vw" alt="" decoding="async" />}
        <div className="cosmos-vignette" />
      </div>
      <div className="waypoints" ref={layerRef} aria-hidden="true" hidden={fallback}>
        {DESTINATIONS.map((destination, index) => (
          <a
            key={destination.id}
            ref={element => { markerRefs.current[index] = element; }}
            className={`waypoint${index === 0 ? ' is-planet' : ''}`}
            href={`#${destination.id}`}
            tabIndex={-1}
            draggable={false}
            onClick={travelHandler(destination.id)}
            onPointerEnter={() => cosmosNav.setHighlight(destination.id)}
            onPointerLeave={() => cosmosNav.setHighlight(null)}
          >
            <span className="waypoint-hit" />
            <span className="waypoint-ring" />
            <span className="waypoint-label">
              <span className="waypoint-index">{destination.index}</span>
              <span className="waypoint-name">{destination.name}</span>
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
