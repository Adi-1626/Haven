import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstallerPaths, validateUpdateMetadata } from './package-installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('latest.yml must describe exactly the built installer', () => {
  const expected = { version: '1.0.1', installer: 'Haven-Setup.exe', bytes: 130, sha512: 'abc==' };
  const valid = { version: '1.0.1', files: [{ url: 'Haven-Setup.exe', sha512: 'abc==', size: 130 }], path: 'Haven-Setup.exe', sha512: 'abc==', releaseDate: '2026-11-01T00:00:00.000Z' };
  assert.equal(validateUpdateMetadata(valid, expected), valid);
  assert.throws(() => validateUpdateMetadata({ ...valid, version: '1.0.0' }, expected), /version 1.0.0 is not 1.0.1/);
  assert.throws(() => validateUpdateMetadata({ ...valid, sha512: 'other' }, expected), /sha512/);
  assert.throws(() => validateUpdateMetadata({ ...valid, files: [{ ...valid.files[0], size: 1 }] }, expected), /size/);
  assert.throws(() => validateUpdateMetadata({ ...valid, files: [{ ...valid.files[0], url: 'Haven-Setup-1.0.1.exe' }] }, expected), /exactly Haven-Setup.exe/);
  assert.throws(() => validateUpdateMetadata({ ...valid, files: [{ ...valid.files[0], isAdminRightsRequired: true }] }, expected), /administrator/);
  assert.throws(() => validateUpdateMetadata(undefined, expected), /Invalid latest.yml/);
});

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
