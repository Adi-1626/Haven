import { fetchResource, isApiResource } from './api';
import { isHostedAuth } from './supabase';

export const ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS = 600;

export function openInNewTab(url: string) {
  if (typeof document === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export interface OpenOriginalImageOptions {
  source: string;
  resolved: string;
  isHostedAuth?: () => boolean;
  isApiResource?: (url: string) => boolean;
  fetchResource?: (url: string) => Promise<{ ok: boolean; status: number; statusText: string; blob: () => Promise<Blob> }>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  scheduleRevoke?: (revoke: () => void, delayMs: number) => unknown;
  openTab?: (url: string) => void;
  onOpeningChange?: (opening: boolean) => void;
  openingRef: { current: boolean };
  lastOpenTimeRef: { current: number };
  now?: () => number;
}

export async function openOriginalImage({
  source,
  resolved,
  isHostedAuth: checkHostedAuth = isHostedAuth,
  isApiResource: checkApiResource = isApiResource,
  fetchResource: doFetchResource = fetchResource,
  createObjectURL = (blob: Blob) => URL.createObjectURL(blob),
  revokeObjectURL = (url: string) => URL.revokeObjectURL(url),
  scheduleRevoke = (revoke, delay) => setTimeout(revoke, delay),
  openTab = openInNewTab,
  onOpeningChange,
  openingRef,
  lastOpenTimeRef,
  now = Date.now,
}: OpenOriginalImageOptions): Promise<boolean> {
  const currentTime = now();
  if (openingRef.current || (currentTime - lastOpenTimeRef.current < ORIGINAL_IMAGE_SUPPRESSION_WINDOW_MS)) {
    return false;
  }
  lastOpenTimeRef.current = currentTime;

  const isProtected = checkHostedAuth() && checkApiResource(resolved);
  if (!isProtected) {
    openTab(resolved);
    return true;
  }

  openingRef.current = true;
  onOpeningChange?.(true);
  try {
    const response = await doFetchResource(source);
    if (!response.ok) {
      throw new Error(`Failed to fetch original image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const blobUrl = createObjectURL(blob);
    openTab(blobUrl);
    lastOpenTimeRef.current = now();
    const timer = scheduleRevoke(() => revokeObjectURL(blobUrl), 60_000);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    return true;
  } catch (err) {
    console.error('Failed to open protected original image:', err);
    return false;
  } finally {
    openingRef.current = false;
    onOpeningChange?.(false);
  }
}

export function profileImageSource(value?: string | null, allowServerIcon = false): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Uploaded profile pictures are private API resources, rendered through AuthenticatedImage.
  if (/^\/api\/users\/[A-Za-z0-9-]+\/avatar\?v=[a-f0-9-]+\.(?:png|jpg|webp|gif)$/i.test(trimmed)) return trimmed;
  if (allowServerIcon &&/^\/api\/servers\/[a-f0-9-]+\/icon(?:\?v=[a-f0-9-]+)?$/i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function profileFallback(value: string | null | undefined, name: string) {
  if (value && !/^(?:[a-z]+:|\/)/i.test(value) && (Array.from(value).length <= 8 || value.length <= 64 && /\p{Extended_Pictographic}/u.test(value))) return value;
  return Array.from(name).slice(0, 2).join('').toUpperCase();
}
