export const emojiCatalog = [
  { value: '💜', name: 'Purple heart' },
  { value: '👍', name: 'Thumbs up' },
  { value: '🔥', name: 'Fire' },
  { value: '😂', name: 'Laughing' },
  { value: '🎉', name: 'Celebrate' },
  { value: '👀', name: 'Eyes' },
  { value: ':haven_wave:', name: 'Waving hello', animation: 'wave' },
  { value: ':haven_heart:', name: 'Heart beat', animation: 'heart' },
  { value: ':haven_fire:', name: 'Flame', animation: 'fire' },
  { value: ':haven_sparkle:', name: 'Sparkle', animation: 'sparkle' },
  { value: ':haven_bounce:', name: 'Happy bounce', animation: 'bounce' },
  { value: ':haven_blink:', name: 'Blinking eyes', animation: 'blink' },
] as const;

export type AnimatedEmoji = Extract<typeof emojiCatalog[number], { animation: string }>;
export type EmojiPart = { text: string; emoji: boolean };
const animatedTokens = new Set<string>(emojiCatalog.filter(emoji => 'animation' in emoji).map(emoji => emoji.value));
export const maxAnimatedEmoji = 24;

export function findAnimatedEmoji(value: string): AnimatedEmoji | undefined {
  return emojiCatalog.find(emoji => 'animation' in emoji && emoji.value === value) as AnimatedEmoji | undefined;
}

export function customEmojiToken(id: string): string { return `:hvn_${id}:`; }

export function splitEmojiText(text: string, customTokens: ReadonlySet<string> = new Set()): EmojiPart[] {
  const parts: EmojiPart[] = [];
  let previousEnd = 0;
  for (const match of text.matchAll(/:haven_[a-z]+:|:hvn_[a-f0-9-]{36}:/g)) {
    if (!animatedTokens.has(match[0]) && !customTokens.has(match[0])) continue;
    if (match.index > previousEnd) parts.push({ text: text.slice(previousEnd, match.index), emoji: false });
    parts.push({ text: match[0], emoji: true });
    previousEnd = match.index + match[0].length;
  }
  if (previousEnd < text.length) parts.push({ text: text.slice(previousEnd), emoji: false });
  return parts;
}

export function eligibleEmojiAnimations(entries: readonly { id: number; visible: boolean }[], limit = maxAnimatedEmoji): Set<number> {
  return new Set(entries.filter(entry => entry.visible).slice(0, Math.max(0, limit)).map(entry => entry.id));
}
