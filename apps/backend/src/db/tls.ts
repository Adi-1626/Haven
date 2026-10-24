import fs from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';
import type pg from 'pg';

const bundledFingerprint = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA';

/** Normalize before pg parses URL SSL parameters, which otherwise replace its SSL object. */
export function databaseConnectionConfig(input: string | pg.PoolConfig): pg.PoolConfig {
  const config = typeof input === 'string' ? { connectionString: input } : { ...input };
  let url: URL | undefined;
  try { if (config.connectionString) url = new URL(config.connectionString); }
  catch { throw new Error('Invalid PostgreSQL connection URL'); }
  const host = (url?.hostname || config.host || process.env.PGHOST || '').toLowerCase();
  if (!host.endsWith('.supabase.co') && !host.endsWith('.pooler.supabase.com')) return config;
  if (url?.searchParams.has('host') && url.searchParams.get('host')?.toLowerCase() !== host) {
    throw new Error('Supabase PostgreSQL URL host overrides are forbidden');
  }

  const mode = url?.searchParams.get('sslmode');
  if (config.ssl === false || typeof config.ssl === 'string' && config.ssl !== 'true'
    || typeof config.ssl === 'object' && config.ssl?.rejectUnauthorized === false
    || mode && ['disable', 'allow', 'prefer', 'no-verify'].includes(mode)
    || ['false', '0'].includes(url?.searchParams.get('ssl') ?? '')) {
    throw new Error('Supabase PostgreSQL requires verified TLS; insecure SSL options are forbidden');
  }
  const override = process.env.HAVEN_DATABASE_CA_FILE;
  let ca: string;
  try {
    ca = fs.readFileSync(override || new URL('../../certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8');
    const certificate = new X509Certificate(ca);
    if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
    if (!override && certificate.fingerprint256.replaceAll(':', '') !== bundledFingerprint) throw new Error();
  } catch { throw new Error('Supabase PostgreSQL CA certificate is missing, invalid, expired or unexpected'); }
  if (url) {
    // No URL option may replace or weaken the verified SSL object below.
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('ssl') || key.toLowerCase() === 'uselibpqcompat') url.searchParams.delete(key);
    }
    config.connectionString = url.toString();
  }
  config.ssl = { ca, rejectUnauthorized: true, servername: host, checkServerIdentity };
  return config;
}
