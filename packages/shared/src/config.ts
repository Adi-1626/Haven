export interface HavenPlatformConfig {
  apiUrl?: string;
  publicUrl?: string;
}

export function sanitizeUrl(url?: string | null): string {
  if (!url) return '';
  return url.trim().replace(/\/+$/, '');
}
