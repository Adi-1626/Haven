import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { customEmojiToken, eligibleEmojiAnimations, emojiCatalog, findAnimatedEmoji, splitEmojiText } from './emoji-data';
import type { ServerEmoji } from '@haven/shared/types';
import { resolveApiUrl } from './api';
import './emoji.css';

const EmojiMotion = createContext(true);
const emptyEmojis: ServerEmoji[] = [];
const CustomEmojis = createContext<{ emojis: ServerEmoji[]; byToken: Map<string, ServerEmoji>; serverId?: string }>({ emojis: emptyEmojis, byToken: new Map() });
type AnimationEntry = { id: number; visible: boolean; notify: (active: boolean) => void; active: boolean };
const animationEntries = new Map<Element, AnimationEntry>();
let observer: IntersectionObserver | null = null;
let nextAnimationId = 0;
let budgetScheduled = false;

function updateAnimationBudget() {
  const eligible = eligibleEmojiAnimations([...animationEntries.values()]);
  for (const entry of animationEntries.values()) {
    const active = eligible.has(entry.id);
    if (entry.active !== active) { entry.active = active; entry.notify(active); }
  }
}

function observeEmoji(element: Element, notify: (active: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  if (!observer) observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const animation = animationEntries.get(entry.target);
      if (animation) animation.visible = entry.isIntersecting;
    }
    updateAnimationBudget();
  });
  animationEntries.set(element, { id: nextAnimationId++, visible: false, notify, active: false });
  observer.observe(element);
  return () => {
    observer?.unobserve(element);
    animationEntries.delete(element);
    if (!animationEntries.size) { observer?.disconnect(); observer = null; }
    if (!budgetScheduled) {
      budgetScheduled = true;
      queueMicrotask(() => { budgetScheduled = false; updateAnimationBudget(); });
    }
  };
}

export function EmojiMotionProvider({ enabled = true, gamingMode = false, background = false, customEmojis = emptyEmojis, serverId, children }: { enabled?: boolean; gamingMode?: boolean; background?: boolean; customEmojis?: ServerEmoji[]; serverId?: string; children: ReactNode }) {
  const [available, setAvailable] = useState(() => !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAvailable(!document.hidden && !preference.matches);
    document.addEventListener('visibilitychange', update);
    preference.addEventListener('change', update);
    return () => { document.removeEventListener('visibilitychange', update); preference.removeEventListener('change', update); };
  }, []);
  const custom = useMemo(() => ({ emojis: customEmojis, byToken: new Map(customEmojis.map(emoji => [customEmojiToken(emoji.id), emoji])), serverId }), [customEmojis, serverId]);
  return <CustomEmojis.Provider value={custom}><EmojiMotion.Provider value={enabled && !gamingMode && !background && available}>{children}</EmojiMotion.Provider></CustomEmojis.Provider>;
}

function EmojiDrawing({ animation }: { animation: string }) {
  if (animation === 'heart') return <path fill="#ce86c4" d="M16 27 4 15C-3 6 9-1 16 8c7-9 19-2 12 7Z" />;
  if (animation === 'fire') return <><path fill="#efa064" d="M17 2C19 10 9 11 11 18c-4-1-5-4-5-4-8 13 9 20 18 12 10-10-1-18-1-18s2 8-4 10c4-8-2-16-2-16Z" /><path fill="#ffe6a0" d="M17 17c0 4-6 5-5 9 2 5 10 2 9-2 0-4-4-7-4-7Z" /></>;
  if (animation === 'sparkle') return <><path fill="#efcf78" d="m16 1 4 11 11 4-11 4-4 11-4-11L1 16l11-4Z" /><path fill="#fff2c7" d="m26 0 1.5 4.5L32 6l-4.5 1.5L26 12l-1.5-4.5L20 6l4.5-1.5Z" /></>;
  if (animation === 'wave') return <><path fill="#efc383" stroke="#b98455" strokeWidth="1.2" strokeLinejoin="round" d="m12 27-7-9c-2-3 1-5 3-3l3 3-6-11c-1-3 2-4 3-2l6 9L10 3c-1-3 3-3 4-1l4 11-2-10c0-3 3-3 4 0l3 12 1-7c1-3 4-2 4 0l-1 12c0 9-10 12-15 7Z" /><path fill="none" stroke="#b98455" strokeWidth="1.2" strokeLinecap="round" d="M12 19c0-3 6-5 9-1" /></>;
  if (animation === 'blink') return <><ellipse cx="10" cy="16" rx="8" ry="12" fill="#f3f0ec" /><ellipse cx="24" cy="16" rx="7" ry="12" fill="#f3f0ec" /><ellipse cx="12" cy="17" rx="3.5" ry="6" fill="#32324b" /><ellipse cx="26" cy="17" rx="3.5" ry="6" fill="#32324b" /></>;
  return <><circle cx="16" cy="16" r="14" fill="#e9c57e" /><circle cx="11" cy="12" r="1.8" fill="#493e49" /><circle cx="21" cy="12" r="1.8" fill="#493e49" /><path d="M8 18c2 11 14 11 16 0Z" fill="#493e49" /><path d="M12 25c2-3 6-3 8 0" fill="#e4969f" /></>;
}

export const Emoji = memo(function Emoji({ value }: { value: string }) {
  const animated = findAnimatedEmoji(value);
  const custom = useContext(CustomEmojis).byToken.get(value);
  const motion = useContext(EmojiMotion);
  const element = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    setActive(false);
    if (!motion || (!animated && !custom?.animated) || !element.current) return;
    return observeEmoji(element.current, setActive);
  }, [motion, animated, custom?.animated, custom?.id]);
  if (custom) return <span ref={element} className={`haven-emoji custom-emoji ${active ? 'is-animated' : ''}`} role="img" aria-label={custom.name} title={`:${custom.name}:`} data-emoji={value}><img src={resolveApiUrl(custom.animated && active ? custom.url : custom.staticUrl)} alt="" decoding="async" draggable={false} /></span>;
  if (!animated) return <>{value}</>;
  return <span ref={element} className={`haven-emoji ${active ? 'is-animated' : ''}`} role="img" aria-label={animated.name} title={`:${animated.name.toLowerCase().replaceAll(' ', '_')}:`} data-emoji={value}><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g className={`emoji-motion emoji-${animated.animation}`}><EmojiDrawing animation={animated.animation} /></g></svg></span>;
});

export const EmojiText = memo(function EmojiText({ text }: { text: string }) {
  const custom = useContext(CustomEmojis);
  const parts = useMemo(() => splitEmojiText(text, new Set(custom.byToken.keys())), [text, custom.byToken]);
  return <>{parts.map((part, index) => part.emoji ? <Emoji key={index} value={part.text} /> : part.text)}</>;
});

export function EmojiPicker({ onSelect, serverId: selectedServer }: { onSelect: (value: string) => void; serverId?: string }) {
  const custom = useContext(CustomEmojis);
  const serverId = selectedServer ?? custom.serverId;
  const [query, setQuery] = useState('');
  const matches = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const available = custom.emojis.filter(emoji => emoji.serverId === serverId && matches(emoji.name));
  return <div className="haven-emoji-picker" role="group" aria-label="Choose emoji"><input className="emoji-search" type="search" aria-label="Search emoji" placeholder="Search emoji" value={query} onChange={event => setQuery(event.target.value)} />{serverId && <><span>Server emoji · this server only</span><div>{available.map(emoji => <button key={emoji.id} type="button" aria-label={`:${emoji.name}:${emoji.animated ? ' (animated)' : ''}`} title={`:${emoji.name}:`} onClick={() => onSelect(customEmojiToken(emoji.id))}><Emoji value={customEmojiToken(emoji.id)} /></button>)}</div>{!available.length && <p className="emoji-empty">{query ? 'No matching server emoji.' : 'No custom emoji yet. Server managers can upload in server settings.'}</p>}</>}<span>Emoji</span><div>{emojiCatalog.filter(emoji => !('animation' in emoji) && matches(emoji.name)).map(emoji => <button key={emoji.value} type="button" aria-label={emoji.value} title={emoji.name} onClick={() => onSelect(emoji.value)}><Emoji value={emoji.value} /></button>)}</div><span>Animated · pauses in gaming mode</span><div>{emojiCatalog.filter(emoji => 'animation' in emoji && matches(emoji.name)).map(emoji => <button key={emoji.value} type="button" aria-label={`${emoji.name} (animated)`} title={`${emoji.name} (animated)`} onClick={() => onSelect(emoji.value)}><Emoji value={emoji.value} /></button>)}</div></div>;
}
