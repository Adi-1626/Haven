import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { APP_URL } from '../config';
import { NAV_LINKS } from '../destinations';
import { cosmosNav, travelHandler } from '../cosmos/nav';
import { Brand } from './primitives';

export function Header({ active }: { active: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // A drawer left open across a resize to desktop width would otherwise trap focus invisibly.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1100px)');
    const onChange = () => wide.matches && setOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);

  const go = (id: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    setOpen(false);
    cosmosNav.travelTo(id);
  };

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="header-inner">
        <a className="header-brand" href="#top" onClick={travelHandler('top')} aria-label="Haven — back to the top">
          <Brand />
        </a>
        <nav className="header-nav" aria-label="Primary">
          {NAV_LINKS.map(link => (
            <a key={link.id} href={`#${link.id}`} onClick={travelHandler(link.id)} aria-current={active === link.id ? 'location' : undefined}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="button button-primary button-compact" href={APP_URL}>
            Open Haven
            <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.75} />
          </a>
          <button
            ref={triggerRef}
            className="menu-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" size={20} strokeWidth={1.75} />
            <span className="sr-only">Open menu</span>
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="menu-dialog"
        aria-label="Site menu"
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={event => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="menu-panel">
          <div className="menu-top">
            <Brand />
            <button className="menu-close" type="button" onClick={() => setOpen(false)} autoFocus>
              <X aria-hidden="true" size={20} strokeWidth={1.75} />
              <span className="sr-only">Close menu</span>
            </button>
          </div>
          <nav aria-label="Destinations">
            <ol className="menu-list">
              {NAV_LINKS.map((link, index) => (
                <li key={link.id}>
                  <a href={`#${link.id}`} onClick={go(link.id)} aria-current={active === link.id ? 'location' : undefined}>
                    <span className="menu-index">{String(index + 1).padStart(2, '0')}</span>
                    {link.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="menu-actions">
            <a className="button button-primary" href={APP_URL}>
              Open Haven
              <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.75} />
            </a>
            <a className="button button-quiet" href="#download" onClick={go('desktop')}>
              Windows app
            </a>
          </div>
        </div>
      </dialog>
    </header>
  );
}
