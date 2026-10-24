import { useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { APP_URL } from '../config';
import { DESTINATIONS } from '../destinations';
import { cosmosNav, travelHandler } from '../cosmos/nav';
import { DownloadButton } from '../components/DownloadButton';

export function Hero() {
  const highlight = useSyncExternalStore(
    listener => cosmosNav.subscribe(listener),
    () => cosmosNav.highlight,
    () => null,
  );

  return (
    <section id="top" className="station hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="hero-copy-inner" data-calm="0.72" data-waypoint-avoid>
          <h1 id="hero-title" className="hero-title reveal" data-arrival>
            A little space.
            <br />
            A lot of <span className="accent-word">connection.</span>
          </h1>
          <p className="hero-lede reveal">
            Haven brings text channels, voice rooms and screen sharing together in one calm place for your friends and communities.
          </p>
          <div className="hero-actions reveal">
            <a className="button button-primary button-large" href={APP_URL}>
              Open Haven
              <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.75} />
            </a>
            <DownloadButton className="button button-quiet button-large" />
          </div>
          <p className="hero-note reveal">Runs in your browser. Nothing to install.</p>
        </div>
      </div>

      <nav className="hero-index reveal" aria-label="Explore Haven" data-waypoint-avoid>
        <p className="hero-index-title">
          <span className="hero-index-hint-pointer">Select a world, or scroll to travel</span>
          <span className="hero-index-hint-touch">Explore the system</span>
        </p>
        <ol data-calm="0.6">
          {DESTINATIONS.map(destination => (
            <li key={destination.id}>
              <a
                href={`#${destination.id}`}
                className={highlight === destination.id ? 'is-highlighted' : undefined}
                onClick={travelHandler(destination.id)}
                onPointerEnter={() => cosmosNav.setHighlight(destination.id)}
                onPointerLeave={() => cosmosNav.setHighlight(null)}
                onFocus={() => cosmosNav.setHighlight(destination.id)}
                onBlur={() => cosmosNav.setHighlight(null)}
              >
                <span className="hero-index-number">{destination.index}</span>
                <span className="hero-index-name">{destination.name}</span>
                <span className="hero-index-line">{destination.line}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <a className="scroll-cue" href="#product" onClick={travelHandler('product')} aria-label="Travel to the product">
        <span className="scroll-cue-track" aria-hidden="true" />
        <ArrowDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </a>
    </section>
  );
}
