// Audits a packaged Haven directory (portable bundle or an installed copy) for what must and must not ship.
// Usage: node scripts/package-audit.mjs <bundle-directory>
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { validateReleaseConfig } = createRequire(import.meta.url)('../apps/desktop/electron/release-config.cjs');
const { appUpdateYml } = createRequire(import.meta.url)('../apps/desktop/electron/update-config.cjs');

export function validateElectronRuntime(expected, installed, binary) {
  if (!/^\d+\.\d+\.\d+$/.test(expected || '') || installed !== expected || binary?.trim().replace(/^v/, '') !== expected) {
    throw new Error('Electron runtime does not match the pinned release dependency. Run npm ci before building a fresh portable bundle.');
  }
  return expected;
}

export const requiredFiles = [
  'Haven.exe',
  'resources/node/node.exe',
  'resources/app/package.json',
  'resources/app/electron/main.cjs',
  'resources/app/electron/release-config.cjs',
  'resources/app/electron/updater.cjs',
  'resources/app/electron/update-config.cjs',
  'resources/app-update.yml',
  'resources/app/node_modules/electron-updater/package.json',
  'resources/app/release-config.json',
  'resources/app/electron/preload.cjs',
  'resources/app/electron/capture-preload.cjs',
  'resources/app/electron/capture.html',
  'resources/app/electron/HavenHotkeys.exe',
  'resources/app/build/index.js',
  'resources/app/dist/index.html',
  'resources/app/public/haven.ico',
  'resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  'resources/app/node_modules/@haven/shared/dist/index.js',
  'resources/app/node_modules/express/package.json',
  'resources/app/node_modules/socket.io/package.json',
  'resources/app/node_modules/pg/package.json',
  'resources/app/node_modules/@supabase/supabase-js/package.json',
];

// Build-time, test or frontend-only packages that the runtime never loads.
export const forbiddenPackages = ['@playwright', 'playwright', 'playwright-core', 'electron', 'electron-builder', 'typescript', 'vite', 'tsx', '@types', 'react', 'react-dom', 'lucide-react', '@fontsource', '@haven/landing', '@haven/web', 'socket.io-client'];
const forbiddenSegments = new Set(['test-results', 'playwright-report', 'scratch', 'output', 'artifacts', 'e2e', 'measurements', '.hosted-profile', 'landing', 'test-artifacts', 'screenshots']);
const forbiddenOwnFile = /(\.map|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.tsbuildinfo|\.log|\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?|\.trace|\.webm|\.zip)$/i;
const secretFile = /^\.env(\..*)?$/i;

async function walk(directory, base = directory, out = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, base, out);
    else out.push({ relative: path.relative(base, full).split(path.sep).join('/'), bytes: (await stat(full)).size });
  }
  return out;
}

export async function auditBundle(bundle) {
  const files = await walk(bundle);
  const problems = [];
  const notes = [];
  try { validateReleaseConfig(JSON.parse(await readFile(path.join(bundle, 'resources/app/release-config.json'), 'utf8'))); }
  catch { problems.push('missing or invalid Hosted production release configuration'); }
  if (await readFile(path.join(bundle, 'resources/app-update.yml'), 'utf8').catch(() => null) !== appUpdateYml()) problems.push('missing or unofficial update feed in resources/app-update.yml');
  for (const required of requiredFiles) if (!existsSync(path.join(bundle, required))) problems.push(`missing required runtime file: ${required}`);
  let upstreamDebugFiles = 0;
  for (const { relative, bytes } of files) {
    const segments = relative.split('/');
    const name = segments.at(-1);
    if (/\.(?:pem|pfx|p12|key)$/i.test(name) || /^(?:credentials|auth-vault|connection)\.json$/i.test(name)) problems.push(`private credential/profile file: ${relative}`);
    if (bytes < 8 * 1024 * 1024 && /\.(?:[cm]?js|json|html|txt|ya?ml|toml)$/i.test(name)) {
      const content = await readFile(path.join(bundle, relative), 'utf8');
      if (/\bsb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/.test(content)) problems.push(`private credential content: ${relative}`);
      for (const token of content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
        try { if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role') problems.push(`service-role token: ${relative}`); } catch {}
      }
    }
    if (secretFile.test(name)) problems.push(`environment/secret file: ${relative}`);
    const moduleIndex = segments.indexOf('node_modules');
    if (moduleIndex === -1) {
      if (segments.some(segment => forbiddenSegments.has(segment))) problems.push(`development artifact path: ${relative}`);
      else if (forbiddenOwnFile.test(name)) problems.push(`debug/test file in Haven payload: ${relative}`);
    } else {
      const scope = segments[moduleIndex + 1];
      const packageName = scope?.startsWith('@') ? `${scope}/${segments[moduleIndex + 2]}` : scope;
      if (forbiddenPackages.includes(packageName) || forbiddenPackages.includes(scope)) problems.push(`development-only package: ${segments.slice(0, moduleIndex + (scope?.startsWith('@') ? 3 : 2)).join('/')}`);
      else if (/\.(db|sqlite3?|log)$/i.test(name)) problems.push(`data/log file inside dependency: ${relative}`);
      else if (/\.map$|\/tests?\//.test(`/${relative}`)) upstreamDebugFiles += 1;
    }
  }
  if (upstreamDebugFiles) notes.push(`${upstreamDebugFiles} upstream source-map/test files ship unmodified inside third-party packages`);
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    appBytes: files.filter(file => file.relative.startsWith('resources/app/')).reduce((sum, file) => sum + file.bytes, 0),
    problems: [...new Set(problems)],
    notes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !existsSync(path.join(bundle, 'Haven.exe'))) throw new Error('Usage: node scripts/package-audit.mjs <directory containing Haven.exe>');
  const result = await auditBundle(bundle);
  console.log(JSON.stringify(result, null, 2));
  if (result.problems.length) process.exitCode = 1;
}
