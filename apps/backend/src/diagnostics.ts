import { createHmac, randomBytes } from 'node:crypto';

export type Severity = 'debug' | 'info' | 'warn' | 'error';
export interface DiagnosticEntry { ts: string; level: Severity; event: string; [field: string]: unknown }
export type DiagnosticSink = (entry: DiagnosticEntry) => void;
type Fields = Record<string, string | number | boolean | undefined | Record<string, number | boolean>>;

const rank: Record<Severity, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON object per line, so runtime logs (Voroa keeps stdout and stderr) stay searchable by field. */
export const consoleSink: DiagnosticSink = entry => {
  (entry.level === 'error' ? process.stderr : process.stdout).write(`${JSON.stringify(entry)}\n`);
};

export interface DiagnosticsOptions {
  sink?: DiagnosticSink;
  level?: Severity;
  /** Keys identifiers so they correlate across restarts; random per process otherwise. */
  salt?: string;
  /** Repeats of one key inside this window are counted and summarized instead of logged. */
  dedupeMs?: number;
  /** Lines per minute across all keys; a flood of distinct keys cannot flood the log either. */
  budget?: number;
  now?: () => number;
}

/**
 * Structured, deduplicated operational logs. Callers pass only enums, counts and identifiers:
 * the module never sees addresses, SDP, ICE credentials or tokens, and it pseudonymizes every
 * user and session identifier with a keyed hash before writing it.
 */
export function createDiagnostics({
  sink = consoleSink,
  level = (process.env.HAVEN_LOG_LEVEL as Severity) in rank ? process.env.HAVEN_LOG_LEVEL as Severity : 'info',
  salt = process.env.DIAGNOSTICS_SALT || randomBytes(16).toString('hex'),
  dedupeMs = 60_000,
  budget = 300,
  now = Date.now,
}: DiagnosticsOptions = {}) {
  const maxKeys = 2000;
  const recent = new Map<string, { level: Severity; event: string; fields: Fields; at: number; suppressed: number; lastAt: number }>();
  let tokens = budget, refilledAt = now(), dropped = 0;

  const write = (severity: Severity, event: string, fields: Fields, force = false) => {
    if (!force) {
      tokens = Math.min(budget, tokens + (now() - refilledAt) * budget / 60_000);
      refilledAt = now();
      if (tokens < 1) { dropped++; return; }
      tokens--;
    }
    const entry: DiagnosticEntry = { ts: new Date(now()).toISOString(), level: severity, event };
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) entry[key] = value;
    try { sink(entry); } catch { /* Logging never breaks the request it describes. */ }
  };
  const summarize = (key: string) => {
    const state = recent.get(key)!;
    recent.delete(key);
    if (state.suppressed) write(state.level, state.event, { ...state.fields, repeated: state.suppressed, firstAt: new Date(state.at).toISOString(), lastAt: new Date(state.lastAt).toISOString() });
  };
  const sweep = () => {
    for (const [key, state] of recent) if (now() - state.at >= dedupeMs) summarize(key);
    if (dropped) { write('warn', 'diagnostics.dropped', { dropped, budgetPerMinute: budget }, true); dropped = 0; }
  };
  const timer = setInterval(sweep, Math.max(1000, dedupeMs / 2));
  timer.unref();

  return {
    enabled: (severity: Severity) => rank[severity] >= rank[level],
    /** Stable pseudonym for an identifier; `u` for users, `s` for sockets and voice sessions. */
    anonymize(kind: 'u' | 's', value: string | undefined) {
      return value ? `${kind}_${createHmac('sha256', salt).update(`${kind}:${value}`).digest('hex').slice(0, 12)}` : undefined;
    },
    log(severity: Severity, event: string, fields: Fields = {}, dedupeKey?: string) {
      if (rank[severity] < rank[level]) return;
      const key = `${event}|${dedupeKey ?? ''}`;
      const state = recent.get(key);
      if (state && now() - state.at < dedupeMs) { state.suppressed++; state.lastAt = now(); return; }
      if (state) summarize(key);
      if (recent.size >= maxKeys) summarize(recent.keys().next().value!);
      recent.set(key, { level: severity, event, fields, at: now(), suppressed: 0, lastAt: now() });
      write(severity, event, fields);
    },
    sweep,
    close() { clearInterval(timer); for (const key of [...recent.keys()]) summarize(key); sweep(); },
  };
}
export type Diagnostics = ReturnType<typeof createDiagnostics>;
