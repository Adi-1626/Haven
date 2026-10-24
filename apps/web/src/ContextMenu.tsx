import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuPosition { x: number; y: number }

export function ContextMenu({
  position,
  label,
  onClose,
  children,
  width,
}: {
  position: MenuPosition;
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(typeof document !== 'undefined' ? document.activeElement as HTMLElement : null);
  const [point, setPoint] = useState(position);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useLayoutEffect(() => {
    if (!mounted) return;
    const element = menu.current;
    if (!element) return;
    const rectangle = element.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rectangle.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rectangle.height - margin);
    const clampedX = Math.max(margin, Math.min(position.x, maxX));
    const clampedY = Math.max(margin, Math.min(position.y, maxY));
    setPoint({ x: clampedX, y: clampedY });
    const target = element.querySelector<HTMLElement>('[role=menuitem]:not(:disabled),input:not(:disabled)') ?? element;
    target.focus();
  }, [mounted, position.x, position.y]);
  useEffect(() => {
    const previous = previousFocus.current;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (previous?.isConnected && !document.querySelector('dialog[open]')) previous.focus();
    };
  }, [onClose]);
  const menuContent = (
    <div
      ref={menu}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      className="haven-context-menu zenith-context-menu"
      style={{ left: point.x, top: point.y, width: width ? `${width}px` : undefined }}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(event.target instanceof HTMLInputElement)) {
          event.preventDefault();
          const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled),input:not(:disabled)') ?? []);
          const current = items.indexOf(document.activeElement as HTMLElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }
      }}
    >
      {children}
    </div>
  );
  if (!mounted || typeof window === 'undefined' || typeof document === 'undefined') return menuContent;
  return createPortal(menuContent, document.querySelector('dialog[open]:last-of-type') ?? document.body);
}

export function MenuItem({
  children,
  icon,
  onClick,
  disabled = false,
  danger = false,
  active = false,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`zenith-menu-item ${danger ? 'danger-text danger' : ''} ${active ? 'focused-ring active' : ''}`}
      onClick={disabled ? undefined : onClick}
    >
      {icon && <span className="zenith-menu-item-icon" aria-hidden="true">{icon}</span>}
      <span className="zenith-menu-item-text">{children}</span>
    </button>
  );
}
