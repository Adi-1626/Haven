import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
const suites = requested.length ? [requested] : readdirSync(path.join(root, 'e2e')).filter(name => name.endsWith('.spec.ts')).sort().map(name => [`e2e/${name}`]);
for (const suite of suites) {
  const label = suite.join(' ');
  process.stdout.write(`\nHaven isolated E2E: ${label}\n`);
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...suite, '--output', path.join('test-results', path.basename(suite[0], '.spec.ts'))], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
