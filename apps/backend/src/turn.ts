import type { Fields, Severity } from './diagnostics.js';

/** The subset of RTCIceServer the browser needs; anything else Turnix returns is dropped. */
export interface IceServer { urls: string | string[]; username?: string; credential?: string }

export type Report = (severity: Severity, event: string, fields: Fields, dedupeKey?: string) => void;

export interface TurnOptions {
  /** Turnix project API token. Stays on the server; only the temporary credentials it mints reach clients. */
  apiToken?: string;
  /** `preferred_region` falls back to the nearest available region; `fixed_region` fails instead. Set one. */
  preferredRegion?: string;
  fixedRegion?: string;
  /** Lifetime of a minted credential. Turnix defaults to 30 seconds when none is sent. */
  ttlSeconds?: number;
  /** How long one user's credential is handed out again; every credential served has at least ttl - reuse left. */
  reuseMs?: number;
  /** After a failed mint, joins skip Turnix for this long instead of each waiting for it. */
  backoffMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export const TURNIX_ICE_URL = 'https://turnix.io/api/v1/credentials/ice';

/**
 * Reads TURNIX_API_TOKEN, TURNIX_FIXED_REGION and TURNIX_PREFERRED_REGION. Without either region no hint
 * is sent and Turnix picks the relay region itself.
 */
export function turnOptionsFromEnv(env: NodeJS.ProcessEnv): TurnOptions {
  const fixedRegion = env.TURNIX_FIXED_REGION?.trim() || undefined;
  return {
    apiToken: env.TURNIX_API_TOKEN?.trim() || undefined,
    fixedRegion,
    preferredRegion: fixedRegion ? undefined : env.TURNIX_PREFERRED_REGION?.trim() || undefined,
  };
}

export type TurnFailure = 'timeout' | 'network' | 'http_error' | 'invalid_response';
class TurnError extends Error {
  constructor(readonly type: TurnFailure, readonly status?: number) { super(type); }
}

const scheme = /^(stun|turns?):/i;
// Browsers block port 53, so such URLs would only add a gathering timeout.
const blockedPort = /:53(\?|$)/;

/** Keeps well-formed STUN/TURN entries, and only if at least one authenticated relay survives. */
function sanitize(value: unknown): IceServer[] | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { iceServers?: unknown }).iceServers)) return;
  const servers: IceServer[] = [];
  for (const entry of (value as { iceServers: unknown[] }).iceServers) {
    if (!entry || typeof entry !== 'object') continue;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const list = (Array.isArray(urls) ? urls : [urls]).filter((url): url is string => typeof url === 'string' && scheme.test(url) && !blockedPort.test(url));
    if (!list.length) continue;
    const relay = list.some(url => /^turns?:/i.test(url));
    if (relay && (typeof username !== 'string' || !username || typeof credential !== 'string' || !credential)) continue;
    servers.push(relay ? { urls: list, username: username as string, credential: credential as string } : { urls: list });
  }
  return servers.some(server => server.credential) ? servers : undefined;
}

/** Relay URLs without credentials, e.g. `turns:singapore.turnix.io:443?transport=tcp`, so logs show region and transports. */
const relayUrls = (servers: IceServer[]) => [...new Set(servers.flatMap(server => server.credential ? [server.urls].flat() : []))].sort().join(' ');

/**
 * Mints per-user Turnix TURN credentials, tagged with the caller's pseudonym so usage can be traced in
 * the Turnix Console. Never throws: on any failure it reports a category (never a response body,
 * username or credential) and returns no servers, leaving the caller's STUN list in place.
 */
export function createTurnCredentials({
  apiToken, preferredRegion, fixedRegion,
  // Must outlast the browser's 6h ICE refresh plus reuse, so a long session always holds a valid credential.
  ttlSeconds = 43_200,
  reuseMs = 3_600_000,
  backoffMs = 30_000,
  timeoutMs = 5_000,
  fetch: request = fetch,
  now = Date.now,
}: TurnOptions, report: Report) {
  const cache = new Map<string, { servers: IceServer[]; until: number }>();
  const pending = new Map<string, Promise<IceServer[]>>();
  let failedUntil = 0;

  const mint = async (identifier: string) => {
    const body = new URLSearchParams({ ttl: String(ttlSeconds), initiator_client: identifier });
    if (fixedRegion) body.set('fixed_region', fixedRegion);
    else if (preferredRegion) body.set('preferred_region', preferredRegion);
    let response: Response;
    try {
      response = await request(TURNIX_ICE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new TurnError((error as Error)?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (!response.ok) throw new TurnError('http_error', response.status);
    const payload: unknown = await response.json().catch(() => undefined);
    const servers = sanitize(payload);
    if (!servers) throw new TurnError('invalid_response');
    const relays = relayUrls(servers);
    report('info', 'rtc.turn_servers', { relays }, relays);
    // A preferred region falls back silently (for example when the plan does not include it).
    const region = fixedRegion || preferredRegion;
    if (region && !relays.split(' ').every(url => url.replace(/^turns?:/i, '').toLowerCase().startsWith(`${region.toLowerCase()}.`))) {
      report('warn', 'rtc.turn_region_fallback', { requested: region, relays }, relays);
    }
    // Turnix reports the real expiry; never hand out a credential past it, and flag one too short to
    // survive until the browser's next refresh.
    const expiresAt = Date.parse(String((payload as { expiresAt?: unknown }).expiresAt));
    let until = now() + reuseMs;
    if (Number.isFinite(expiresAt)) {
      const lifetimeMs = expiresAt - now();
      if (lifetimeMs < ttlSeconds * 1000 - 60_000) report('warn', 'rtc.turn_short_ttl', { requestedSeconds: ttlSeconds, effectiveSeconds: Math.round(lifetimeMs / 1000) }, 'short_ttl');
      until = Math.min(until, expiresAt - (ttlSeconds * 1000 - reuseMs));
    }
    for (const [key, entry] of cache) if (entry.until <= now()) cache.delete(key);
    if (until > now()) cache.set(identifier, { servers, until });
    return servers;
  };

  return {
    enabled: Boolean(apiToken),
    async servers(identifier: string): Promise<IceServer[]> {
      if (!apiToken) return [];
      const cached = cache.get(identifier);
      if (cached && cached.until > now()) return cached.servers;
      if (failedUntil > now()) return [];
      let flight = pending.get(identifier);
      if (!flight) {
        flight = mint(identifier).finally(() => pending.delete(identifier));
        pending.set(identifier, flight);
      }
      try {
        return await flight;
      } catch (error) {
        failedUntil = now() + backoffMs;
        const failure = error instanceof TurnError ? error : new TurnError('network');
        report('error', 'rtc.turn_unavailable', { errorType: failure.type, status: failure.status }, `${failure.type}:${failure.status ?? ''}`);
        return [];
      }
    },
  };
}
