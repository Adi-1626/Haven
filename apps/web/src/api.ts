import { getAccessToken } from './supabase.js';
import { readApiJson } from './json-response.js';

declare global {
  interface Window {
    __HAVEN_CONFIG__?: {
      apiUrl?: string;
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const desktopOrigin = window.haven?.getApiOrigin?.();
    if (desktopOrigin) return desktopOrigin;
    if (window.__HAVEN_CONFIG__?.apiUrl) {
      return window.__HAVEN_CONFIG__.apiUrl.replace(/\/+$/, '');
    }
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local')) {
      return '';
    }
  }
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return '';
}

export function resolveApiUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  const base = getApiBaseUrl();
  if (base && url.startsWith('/api')) {
    return `${base}${url}`;
  }
  return url;
}

// Credentials belong only to this installation's API, never arbitrary image hosts.
export function isApiResource(url: string): boolean {
  const base = getApiBaseUrl() || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  try {
    const target = new URL(url, base);
    const api = new URL(base);
    return target.origin === api.origin && target.pathname.startsWith(`${api.pathname.replace(/\/+$/, '')}/api/`);
  } catch { return false; }
}

export async function fetchResource(url: string, init: RequestInit = {}): Promise<Response> {
  const endpoint = resolveApiUrl(url);
  const headers = new Headers(init.headers);
  const privateResource = isApiResource(endpoint);
  if (privateResource) {
    const token = await getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(endpoint, { ...init, headers, credentials: privateResource ? 'include' : 'omit' });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return response;
}

export async function downloadAttachment(url: string, name: string): Promise<void> {
  const response = await fetchResource(url);
  const objectUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start consuming the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function api<Type = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<Type> {
  const base = getApiBaseUrl();
  const endpoint = `${base}/api${path}`;
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(endpoint, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const result = await readApiJson(response);
  return result as Type;
}
