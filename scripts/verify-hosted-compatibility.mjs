// Read-only deployment inventory. Never signs in, submits forms or opens production sockets.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { productionConfig } = createRequire(import.meta.url)('../apps/desktop/electron/release-config.cjs');
const output = path.resolve(process.argv[2] || 'output/haven-rebuild-20261024');
await mkdir(output, { recursive: true });
const get = async url => {
  // Only these read-only probes retry. A cold-start proxy can return HTML with HTTP 200.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      const text = await response.text();
      if (new URL(url).pathname.startsWith('/api/')) {
        try { JSON.parse(text); } catch { throw new Error(`${url}: API returned non-JSON HTTP ${response.status}`); }
      }
      return text;
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
};
const { backendUrl, webUrl } = productionConfig;
const [html, configText, healthText] = await Promise.all([get(webUrl), get(`${backendUrl}/api/config`), get(`${backendUrl}/api/health`)]);
const config = JSON.parse(configText);
const health = JSON.parse(healthText);
const deployedScript = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
const localHtml = await readFile('apps/web/dist/index.html', 'utf8');
const localScript = /<script[^>]+src="([^"]+)"/.exec(localHtml)?.[1];
if (!deployedScript || !localScript) throw new Error('Missing application entry script');
const [deployed, bundled] = await Promise.all([get(new URL(deployedScript, webUrl)), readFile(path.join('apps/web/dist', localScript), 'utf8')]);
const markers = ['orbital-canvas', 'streamSubscriptions', 'stream:watch', 'auth:refresh', 'getApiOrigin', 'profileCompleted', 'getAuthSession', 'sound:play'];
const describe = (script, content) => ({ script, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), markers: Object.fromEntries(markers.map(marker => [marker, content.includes(marker)])) });
const corsResponse = await fetch(`${backendUrl}/api/config`, { headers: { Origin: webUrl }, signal: AbortSignal.timeout(30000) });
const result = {
  checkedAt: new Date().toISOString(), requests: 'GET only; no production authentication/data writes',
  backendUrl, webUrl, health,
  config: { mode: config.mode, publicUrl: config.publicUrl, supabaseUrl: config.supabaseUrl, hasPublicAuthKey: Boolean(config.supabaseAnonKey), capabilities: config.capabilities || null },
  cors: { status: corsResponse.status, origin: corsResponse.headers.get('access-control-allow-origin'), credentials: corsResponse.headers.get('access-control-allow-credentials') },
  deployed: describe(deployedScript, deployed), bundled: describe(localScript, bundled),
  blockers: [],
};
if (result.deployed.sha256 !== result.bundled.sha256) result.blockers.push('Hosted loads a different/older deployed frontend; rebuilding Electron does not deploy the bundled frontend.');
if (!result.deployed.markers['orbital-canvas']) result.blockers.push('The bundled planetary authentication animation is absent from the deployed Hosted frontend.');
if (!config.capabilities?.streamSubscriptions) result.blockers.push('Deployed backend does not advertise streamSubscriptions v1; latest client opt-in stream sharing needs compatible backend acceptance.');
result.blockers.push('Authenticated production account/session/profile, multi-user voice, sharing, soundboard, and TURN acceptance require approved production revisions and test identities.');
await writeFile(path.join(output, 'hosted-compatibility.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
