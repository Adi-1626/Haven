import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dependencyPlan, resolveOutput } from './package-windows.mjs';
import { validateElectronRuntime } from './package-audit.mjs';

test('packaging refuses stale Electron packages or binaries and requires an exact version pin', () => {
  assert.equal(validateElectronRuntime('44.9.1', '44.9.1', 'v44.9.1\n'), '44.9.1');
  for (const versions of [['44.9.1', '44.7.2', '44.7.2'], ['44.9.1', '44.9.1', '44.7.2'], ['^44.9.1', '44.9.1', '44.9.1'], ['44.9.1', undefined, '44.9.1']]) {
    assert.throws(() => validateElectronRuntime(...versions), /runtime does not match/);
  }
});

test('output accepts a separate release bundle and rejects escape or malformed flags', () => {
  const root = path.resolve('fixture');
  assert.equal(resolveOutput(root, '1.0.0', ['--output', 'release/review']), path.join(root, 'release', 'review'));
  assert.equal(resolveOutput(root, '1.0.0', []), path.join(root, 'release', 'Haven-1.0.0-win32-x64'));
  for (const args of [['--output', '../escape'], ['--output', 'release'], ['--output', 'release/../escape'], ['--overwrite'], ['--output']]) assert.throws(() => resolveOutput(root, '1.0.0', args));
});

test('monorepo inventory packages shared runtime and excludes application source workspaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'haven-package-plan-'));
  try {
    const manifests = [['apps/backend', '@haven/backend'], ['apps/web', '@haven/web'], ['apps/desktop', '@haven/desktop'], ['apps/landing', '@haven/landing'], ['packages/shared', '@haven/shared'], ['node_modules/example', 'example'], ['node_modules/@types/node', '@types/node']];
    for (const [directory, name] of manifests) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, 'package.json'), JSON.stringify({ name }));
    }
    await mkdir(path.join(root, 'packages/shared/dist'));
    await writeFile(path.join(root, 'packages/shared/dist/index.js'), 'export {};');
    const plan = await dependencyPlan(root, { workspaces: ['apps/*', 'packages/*'] }, manifests.map(([directory]) => path.join(root, directory)));
    assert.deepEqual(plan.map(({ relative, workspace }) => ({ relative, workspace })), [
      { relative: path.join('node_modules', '@haven', 'shared'), workspace: true },
      { relative: path.join('node_modules', 'example'), workspace: false },
    ]);
    await assert.rejects(dependencyPlan(root, { workspaces: [] }, [path.join(root, 'apps/backend')]), /outside/);
    await assert.rejects(dependencyPlan(root, { workspaces: ['../outside'] }, []), /outside/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
