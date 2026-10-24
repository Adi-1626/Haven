import { PLANET } from './cosmos/projection';

export interface Destination {
  id: string;
  index: string;
  name: string;
  /** Short line shown beside the waypoint and in the index. */
  line: string;
  /** Body in the orbital scene that hosts this destination. */
  focus: number;
}

/** The four moons and the planet of the auth scene, each home to one part of the site. */
export const DESTINATIONS: Destination[] = [
  { id: 'product', index: '01', name: 'Haven', line: 'Chat, voice and sharing in one room', focus: PLANET },
  { id: 'communities', index: '02', name: 'Communities', line: 'Servers, roles, invites, emoji', focus: 0 },
  { id: 'desktop', index: '03', name: 'Windows app', line: 'Global shortcuts and download', focus: 2 },
  { id: 'how-it-works', index: '04', name: 'How it works', line: 'Where your data and calls go', focus: 1 },
  { id: 'faq', index: '05', name: 'Questions', line: 'Getting started, answered', focus: 3 },
];

export const NAV_LINKS: Array<{ id: string; label: string }> = [
  { id: 'product', label: 'Product' },
  { id: 'communities', label: 'Communities' },
  { id: 'desktop', label: 'Windows' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'faq', label: 'FAQ' },
];
