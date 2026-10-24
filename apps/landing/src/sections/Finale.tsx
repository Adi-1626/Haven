import { ArrowUpRight } from 'lucide-react';
import { APP_URL, RELEASES_URL, REPOSITORY_URL } from '../config';
import { NAV_LINKS } from '../destinations';
import { travelHandler } from '../cosmos/nav';
import { Brand, ExternalLink } from '../components/primitives';
import { DownloadButton } from '../components/DownloadButton';

export function Finale() {
  return (
    <section id="home" className="station finale" aria-labelledby="finale-title">
      <div className="finale-copy" data-calm="0.75">
        <h2 id="finale-title" className="finale-title reveal" data-arrival>Make yourself at home.</h2>
        <p className="section-lede reveal">Your people are one link away.</p>
        <div className="hero-actions finale-actions reveal">
          <a className="button button-primary button-large" href={APP_URL}>
            Open Haven
            <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.75} />
          </a>
          <DownloadButton className="button button-quiet button-large" />
        </div>
      </div>

      <footer className="site-footer" data-calm="0.85">
        <div className="footer-brand">
          <Brand />
          <p>A little space. A lot of connection.</p>
        </div>
        <nav className="footer-col" aria-label="Explore">
          <p className="footer-heading">Explore</p>
          <ul>
            {NAV_LINKS.map(link => (
              <li key={link.id}><a href={`#${link.id}`} onClick={travelHandler(link.id)}>{link.label}</a></li>
            ))}
          </ul>
        </nav>
        <nav className="footer-col" aria-label="Get Haven">
          <p className="footer-heading">Get Haven</p>
          <ul>
            <li><a href={APP_URL}>Open in your browser</a></li>
            <li><a href="#download" onClick={travelHandler('desktop', 'download')}>Windows app</a></li>
            <li><ExternalLink href={RELEASES_URL} className="">Releases</ExternalLink></li>
          </ul>
        </nav>
        <nav className="footer-col" aria-label="Project">
          <p className="footer-heading">Project</p>
          <ul>
            <li><ExternalLink href={REPOSITORY_URL} className="">Source on GitHub</ExternalLink></li>
            <li><ExternalLink href={`${REPOSITORY_URL}/issues`} className="">Report a problem</ExternalLink></li>
          </ul>
        </nav>
        <p className="footer-base">
          <span>© 2026 Haven</span>
          <span>Make yourself at home.</span>
        </p>
      </footer>
    </section>
  );
}
