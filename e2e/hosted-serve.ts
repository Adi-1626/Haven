import express from 'express';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createApp } from '../apps/backend/src/app.js';
import { SupabaseAuthVerifier } from '../apps/backend/src/auth/supabase.js';
import { LocalStorageService, type StorageService } from '../apps/backend/src/storage/index.js';

// Exercise the hosted browser boundary using disposable local storage. No real
// Supabase accounts, storage buckets, production databases or microphones are used.
const directory = mkdtempSync(path.join(tmpdir(), 'haven-hosted-e2e-'));
// The backend runs its real Supabase token path (SupabaseAuthVerifier -> ensureHavenUser -> profile onboarding). Only the
// remote lookup of a JWT is simulated: "hosted-jwt:<email>" is an email-only account, "hosted-jwt-legacy:<email>" one that
// registered with a username and display name before profile onboarding existed. No real Supabase project is contacted.
const verifier = new SupabaseAuthVerifier('https://haven-hosted-test.supabase.co', 'test-service-key');
const accountId = (email: string) => { const hex = createHash('sha1').update(email).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };
let fixtureDb: ReturnType<typeof createApp>['adapter'];
(verifier as any).client = { auth: { getUser: async (token: string) => {
  const match = /^hosted-jwt(-legacy)?:([^#]+)(?:#\d+)?$/.exec(token);
  if (!match) return { data: { user: null }, error: new Error('invalid token') };
  const email = match[2];
  // Simulates the separately approved legacy backfill in this disposable database.
  // Seed once; a later token lookup must never overwrite a persisted profile.
  if (match[1] && !await fixtureDb.getUser(accountId(email))) {
    await fixtureDb.createUser({ id: accountId(email), username: email.split('@')[0].replace(/[^a-z0-9_]/gi, '_'), displayName: 'Existing Member', settings: '{"profileCompleted":true}', createdAt: Date.now() });
  }
  return { data: { user: { id: accountId(email), email, email_confirmed_at: new Date().toISOString(), user_metadata: match[1] ? { username: email.split('@')[0].replace(/[^a-z0-9_]/gi, '_'), displayName: 'Existing Member' } : {} } }, error: null };
} } };
// Private files behave like Supabase Storage: the API answers with a redirect to a short-lived
// signed URL on another origin, which allows any origin (`*`) but never credentials.
const storageOrigin = 'http://127.0.0.1:3112';
const files = new LocalStorageService(path.join(directory, 'uploads'));
const signature = (bucket: string, diskName: string) => createHmac('sha256', 'hosted-e2e-storage').update(`${bucket}/${diskName}`).digest('hex');
const signedStorage: StorageService = {
  isSupabase: true,
  upload: (bucket, diskName, buffer, mime) => files.upload(bucket, diskName, buffer, mime),
  remove: (bucket, diskName) => files.remove(bucket, diskName),
  async getDownloadInfo(bucket, diskName, filename) {
    const query = new URLSearchParams({ token: signature(bucket, diskName), ...(filename ? { download: filename } : {}) });
    return { type: 'redirect', url: `${storageOrigin}/storage/v1/object/sign/${bucket}/${encodeURIComponent(diskName)}?${query}` };
  },
};
const storageServer = express();
storageServer.use((_request, response, next) => { response.setHeader('Access-Control-Allow-Origin', '*'); next(); });
storageServer.get('/storage/v1/object/sign/:bucket/:diskName', async (request, response) => {
  const { bucket, diskName } = request.params;
  if (request.query.token !== signature(bucket, diskName)) return response.status(400).json({ error: 'InvalidSignature' });
  if (typeof request.query.download === 'string') response.attachment(request.query.download);
  response.sendFile((await files.getDownloadInfo(bucket, diskName)).filePath!);
});
const storageListener = storageServer.listen(3112, '127.0.0.1');
const instance = createApp({ dataDir: directory, origins: ['http://127.0.0.1:3111'], supabaseVerifier: verifier, storage: signedStorage });
fixtureDb = instance.adapter;
instance.httpServer.listen(3110, '127.0.0.1');
const frontend = express();
const html = readFileSync(path.resolve('apps/web/dist/index.html'), 'utf8').replace('<head>', '<head><script>window.__HAVEN_CONFIG__={apiUrl:"http://127.0.0.1:3110",supabaseUrl:"https://haven-hosted-test.supabase.co",supabaseAnonKey:"test-publishable-key"}</script>');
frontend.get('/', (_request, response) => response.type('html').send(html));
frontend.use(express.static(path.resolve('apps/web/dist')));
frontend.get('/{*path}', (_request, response) => response.type('html').send(html));
const server = frontend.listen(3111, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close();
  storageListener.close();
  void instance.close().then(() => { rmSync(directory, { recursive: true, force: true }); process.exit(0); });
});
