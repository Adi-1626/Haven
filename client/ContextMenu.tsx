import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuPosition { x: number; y: number }

export function ContextMenu({ position, label, onClose, children }: { position: MenuPosition; label: string; onClose: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement);
  const [point, setPoint] = useState(position);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rectangle = element.getBoundingClientRect();
    setPoint({ x: Math.max(8, Math.min(position.x, window.innerWidth - rectangle.width - 8)), y: Math.max(8, Math.min(position.y, window.innerHeight - rectangle.height - 8)) });
    element.querySelector<HTMLElement>('[role=menuitem]:not(:disabled),input')?.focus();
  }, [position.x, position.y]);
  useEffect(() => {
    const previous = previousFocus.current;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close); document.removeEventListener('scroll', scroll, true); if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus(); };
  }, []);
  return createPortal(<div ref={menu} role="menu" aria-label={label} className="haven-context-menu" style={{ left: point.x, top: point.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled),input:not(:disabled)') ?? []);
      const current = items.indexOf(document.activeElement as HTMLElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    }
  }}>{children}</div>, document.querySelector('dialog[open]:last-of-type') ?? document.body);
}

export function MenuItem({ children, onClick, disabled = false, danger = false }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" role="menuitem" disabled={disabled} className={danger ? 'danger-text' : ''} onClick={onClick}>{children}</button>;
}
