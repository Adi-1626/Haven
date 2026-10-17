import { getAccessToken } from './supabase.js';

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
  if (typeof window !== 'undefined' && window.__HAVEN_CONFIG__?.apiUrl) {
    return window.__HAVEN_CONFIG__.apiUrl.replace(/\/+$/, '');
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

export async function api<Type = Record<string, unknown>>(path: string, method = 'GET', body?: unknown): Promise<Type> {
  const base = getApiBaseUrl();
  const endpoint = `${base}/api${path}`;
  const token = await getAccessToken().catch(() => null);
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
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as Type;
}
