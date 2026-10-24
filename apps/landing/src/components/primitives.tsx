import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';

export function Brand({ mark = false, className = '' }: { mark?: boolean; className?: string }) {
  return (
    <img
      className={`brand-image ${className}`}
      src={mark ? '/brand/mark.webp' : '/brand/haven.webp'}
      srcSet={mark ? '/brand/mark.webp 1x, /brand/mark@2x.webp 2x' : '/brand/haven.webp 1x, /brand/haven@2x.webp 2x'}
      alt={mark ? '' : 'Haven'}
      width={mark ? 64 : 132}
      height={mark ? 64 : 36}
    />
  );
}

export function ExternalLink({ href, children, className = 'text-link' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.75} />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Section eyebrow: orbital index, a hairline and the destination name. */
export function Coordinate({ index, children }: { index: string; children: ReactNode }) {
  return (
    <p className="coordinate">
      <span className="coordinate-index">{index}</span>
      <span className="coordinate-line" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
