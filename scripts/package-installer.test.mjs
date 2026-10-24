import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstallerPaths } from './package-installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('installer rejects escaped output and missing output arguments', () => {
  assert.throws(() => resolveInstallerPaths(root, '0.4.1', ['--output', '../outside']), /inside release/);
  assert.throws(() => resolveInstallerPaths(root, '0.4.1', ['--output']), /Usage/);
});

test('installer rejects stale preload code before creating an output or invoking NSIS', { skip: process.platform !== 'win32' }, async () => {
  const portable = await mkdtemp(path.join(os.tmpdir(), 'haven-stale-preload-'));
  const output = path.join(root, 'release', `stale-preload-must-not-exist-${Date.now()}`);
  try {
    const app = path.join(portable, 'resources/app');
    await mkdir(app, { recursive: true });
    await cp(path.join(root, 'apps/desktop/electron'), path.join(app, 'electron'), { recursive: true });
    await writeFile(path.join(app, 'electron/preload.cjs'), '// stale desktop bridge');
    const { productionConfig } = await import('../apps/desktop/electron/release-config.cjs');
    const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    await writeFile(path.join(app, 'release-config.json'), JSON.stringify(productionConfig));
    await writeFile(path.join(portable, 'PACKAGE-INFO.json'), JSON.stringify({ version }));
    await writeFile(path.join(portable, 'Haven.exe'), 'fixture');
    await writeFile(path.join(portable, 'PACKAGING-COMPLETE.txt'), 'fixture');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/package-installer.mjs'), '--portable', portable, '--output', output], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Stale desktop release payload: preload\.cjs/);
    assert.equal(existsSync(output), false);
  } finally {
    await rm(portable, { recursive: true, force: true });
  }
});
