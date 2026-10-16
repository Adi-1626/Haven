export function profileImageSource(value?: string | null, allowServerIcon = false): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (allowServerIcon && /^\/api\/servers\/[a-f0-9-]+\/icon(?:\?v=[a-f0-9-]+)?$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function profileFallback(value: string | null | undefined, name: string) {
  if (value && !/^(?:[a-z]+:|\/)/i.test(value) && (Array.from(value).length <= 8 || value.length <= 64 && /\p{Extended_Pictographic}/u.test(value))) return value;
  return Array.from(name).slice(0, 2).join('').toUpperCase();
}
