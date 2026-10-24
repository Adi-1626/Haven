import { STATIONS, stationIndex } from './camera';
import type { CosmosEngine } from './engine';

type Listener = () => void;

/**
 * Choreographs travel between destinations. With motion, the copy steps aside, the camera flies to
 * the destination, the page moves underneath while nothing is visible, and the section settles in as
 * the camera arrives. Without motion (or WebGL) it is an ordinary jump to the section.
 */
class Navigator {
  private engine: CosmosEngine | null = null;
  private timers: number[] = [];
  private listeners = new Set<Listener>();
  private hovered: string | null = null;

  attach(engine: CosmosEngine | null): void {
    this.engine = engine;
  }

  /** The destination currently aimed at by a pointer or keyboard (for marker/list highlighting). */
  get highlight(): string | null {
    return this.hovered;
  }

  setHighlight(id: string | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.engine?.setHovering(id !== null);
    this.listeners.forEach(listener => listener());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Travels to a destination; `anchor` lands on a specific element inside its section instead of the top. */
  travelTo(id: string, anchor?: string): void {
    const index = stationIndex(id);
    const section = document.getElementById(id);
    if (index < 0 || !section) return;
    const anchorElement = anchor ? document.getElementById(anchor) : null;
    const scrollTarget = (base: number) => anchorElement
      ? Math.max(base, anchorElement.getBoundingClientRect().top + window.scrollY - 96)
      : base;
    this.timers.forEach(timer => window.clearTimeout(timer));
    this.timers = [];
    this.setHighlight(null);
    const root = document.documentElement;
    history.replaceState(null, '', id === STATIONS[0].id ? `${location.pathname}${location.search}` : `#${anchor ?? id}`);

    const engine = this.engine;
    if (!engine?.motion) {
      delete root.dataset.travel;
      window.scrollTo({ top: scrollTarget(engine ? engine.scrollTargetFor(index) : section.offsetTop), behavior: 'instant' });
      this.arrive(anchorElement ?? section);
      return;
    }

    const target = scrollTarget(engine.scrollTargetFor(index));
    const distance = Math.abs(window.scrollY - target) / Math.max(window.innerHeight, 1);
    const duration = Math.round(1500 + Math.min(distance, 4) * 140);
    root.dataset.travel = 'out';
    engine.setContentCalm(false);
    engine.flyTo(index, duration);
    const later = (fn: () => void, at: number) => this.timers.push(window.setTimeout(fn, at));
    later(() => window.scrollTo({ top: scrollTarget(engine.scrollTargetFor(index)), behavior: 'instant' }), duration * 0.42);
    later(() => {
      root.dataset.travel = 'in';
      engine.setContentCalm(true);
    }, duration * 0.6);
    later(() => {
      delete root.dataset.travel;
      this.arrive(anchorElement ?? section);
    }, duration);
  }

  /** Moves focus to the destination's heading so keyboard and screen-reader users arrive with it. */
  private arrive(section: HTMLElement): void {
    const heading = section.querySelector<HTMLElement>('[data-arrival]') ?? section;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

export const cosmosNav = new Navigator();

/** Click handler for in-page destination links: keeps the href for no-JS and new-tab use. */
export function travelHandler(id: string, anchor?: string) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    cosmosNav.travelTo(id, anchor);
  };
}
