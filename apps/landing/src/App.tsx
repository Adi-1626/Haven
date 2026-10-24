import { useEffect, useState } from 'react';
import { Cosmos } from './cosmos/Cosmos';
import { STATIONS } from './cosmos/camera';
import { travelHandler } from './cosmos/nav';
import { Header } from './components/Header';
import { Hero } from './sections/Hero';
import { Product } from './sections/Product';
import { Communities } from './sections/Communities';
import { Desktop } from './sections/Desktop';
import { HowItWorks } from './sections/HowItWorks';
import { Faq } from './sections/Faq';
import { Finale } from './sections/Finale';

const RAIL_LABELS: Record<string, string> = {
  top: 'Start',
  product: 'Haven',
  communities: 'Communities',
  desktop: 'Windows app',
  'how-it-works': 'How it works',
  faq: 'Questions',
  home: 'Home',
};

/** Tracks which destination occupies the middle of the viewport. */
function useActiveStation(): string {
  const [active, setActive] = useState(STATIONS[0].id);
  useEffect(() => {
    const sections = STATIONS.map(station => document.getElementById(station.id)).filter((s): s is HTMLElement => !!s);
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.isIntersecting && setActive(entry.target.id));
    }, { rootMargin: '-45% 0px -54% 0px' });
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return active;
}

/** Copy settles in as it arrives. Without JavaScript or with reduced motion everything is simply visible. */
function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    root.classList.add('has-reveal');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
    items.forEach(item => observer.observe(item));
    return () => {
      observer.disconnect();
      root.classList.remove('has-reveal');
    };
  }, []);
}

function StationRail({ active }: { active: string }) {
  return (
    <nav className="station-rail" aria-label="Position in the system">
      <ol>
        {STATIONS.map(station => (
          <li key={station.id}>
            <a href={station.id === 'top' ? '#top' : `#${station.id}`} onClick={travelHandler(station.id)} aria-current={active === station.id ? 'location' : undefined}>
              <span className="rail-label">{RAIL_LABELS[station.id]}</span>
              <span className="rail-tick" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function App() {
  const active = useActiveStation();
  useReveal();

  return (
    <>
      <a className="skip-link" href="#product">Skip to the product</a>
      <Cosmos />
      <Header active={active} />
      <main className="site-main">
        <Hero />
        <Product />
        <Communities />
        <Desktop />
        <HowItWorks />
        <Faq />
        <Finale />
      </main>
      <StationRail active={active} />
    </>
  );
}
