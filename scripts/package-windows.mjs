import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');
const packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageVersion)) throw new Error('Invalid release version');
const output = path.join(releaseRoot, `Haven-${packageVersion}-win32-x64`);
const appDirectory = path.join(output, 'resources', 'app');
const require = createRequire(import.meta.url);

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function requireFile(candidate) {
  if (!(await stat(candidate)).isFile()) throw new Error(`Required file is missing: ${candidate}`);
}

async function treeSize(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await treeSize(entryPath) : (await stat(entryPath)).size;
  }
  return bytes;
}

async function nodeLicense() {
  const candidates = [process.env.HAVEN_NODE_LICENSE, ...['LICENSE', 'LICENSE.txt', 'LICENSE.md'].map(name => path.join(path.dirname(process.execPath), name))].filter(Boolean);
  for (const candidate of candidates) {
    try { return { text: await readFile(candidate, 'utf8'), source: candidate }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const source = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot obtain Node ${process.version} license (${response.status}). Set HAVEN_NODE_LICENSE to its matching LICENSE file.`);
  const text = await response.text();
  if (!text.includes('Node.js') || text.length < 1000) throw new Error('The downloaded Node license is invalid');
  return { text, source };
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Package on Windows x64 using the same Node runtime that installed better-sqlite3.');
  if (process.argv.length > 2) throw new Error('Usage: node scripts/package-windows.mjs');
  if (!contained(releaseRoot, output) || !contained(root, releaseRoot)) throw new Error('Release output is outside the expected workspace directory');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof manifest.main !== 'string' || !contained(root, path.resolve(root, manifest.main))) throw new Error('The application main entry must be a relative file within this project');
  await requireFile(path.resolve(root, manifest.main));
  const electronDirectory = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
  await Promise.all(['electron.exe', 'LICENSE', 'LICENSES.chromium.html'].map(name => requireFile(path.join(electronDirectory, name))));
  await Promise.all(['electron/main.cjs', 'build/server/index.js', 'dist/index.html', 'public/haven.svg'].map(name => requireFile(path.join(root, name))));
  const sqliteProbe = spawnSync(process.execPath, ['--input-type=commonjs', '-e', "const Database = require('better-sqlite3'); const database = new Database(':memory:'); database.prepare('select 1').get(); database.close();"], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (sqliteProbe.error || sqliteProbe.status !== 0) throw new Error(`better-sqlite3 does not load with the bundled Node runtime: ${sqliteProbe.error?.message || sqliteProbe.stderr}`);
  const dependencyProbe = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ls --omit=dev --all --parseable'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (dependencyProbe.error || dependencyProbe.status !== 0) throw new Error(`Production dependency inventory failed: ${dependencyProbe.error?.message || dependencyProbe.stderr}`);
  const dependencies = [...new Set(dependencyProbe.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(directory => path.resolve(directory)).filter(directory => directory !== root))];
  for (const dependency of dependencies) {
    if (!contained(path.join(root, 'node_modules'), dependency)) throw new Error(`Dependency is outside local node_modules: ${dependency}`);
    await requireFile(path.join(dependency, 'package.json'));
  }
  const license = await nodeLicense();
  await mkdir(releaseRoot, { recursive: true });
  try { await mkdir(output); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Release directory already exists: ${output}. Move it aside before creating a new release; packaging never deletes an existing bundle.`);
    throw error;
  }
  console.log(`Packaging ${manifest.name} ${manifest.version} into ${output}`);
  await writeFile(path.join(output, 'PACKAGING-INCOMPLETE.txt'), 'This directory is incomplete until packaging finishes successfully.\n');
  for (const entry of await readdir(electronDirectory)) await cp(path.join(electronDirectory, entry), path.join(output, entry), { recursive: true, force: false, errorOnExist: true });
  await rename(path.join(output, 'electron.exe'), path.join(output, 'Haven.exe'));
  await mkdir(appDirectory, { recursive: true });
  await writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify({ name: manifest.name, version: manifest.version, private: true, type: manifest.type, main: manifest.main, dependencies: manifest.dependencies }, null, 2)}\n`);
  for (const directory of ['electron', 'build', 'dist']) await cp(path.join(root, directory), path.join(appDirectory, directory), { recursive: true, force: false, errorOnExist: true });
  const hotkeyCompiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const hotkeyBuild = spawnSync(hotkeyCompiler, ['/nologo', '/optimize+', '/target:exe', `/out:${path.join(appDirectory, 'electron', 'HavenHotkeys.exe')}`, path.join(appDirectory, 'electron', 'HavenHotkeys.cs')], { encoding: 'utf8', windowsHide: true });
  if (hotkeyBuild.error || hotkeyBuild.status !== 0) throw new Error(`Native keyboard helper build failed: ${hotkeyBuild.error?.message || hotkeyBuild.stdout || hotkeyBuild.stderr}`);
  await mkdir(path.join(appDirectory, 'public'), { recursive: true });
  await cp(path.join(root, 'public', 'haven.svg'), path.join(appDirectory, 'public', 'haven.svg'));
  const notices = ['Haven third-party runtime notices', '', 'Electron license: LICENSE', 'Chromium and bundled libraries: LICENSES.chromium.html', 'Node.js and its bundled dependencies: resources/node/LICENSE', '', 'Application dependencies retain their complete upstream package files, including license and notice files, at the following relative package paths:', ''];
  for (const dependency of dependencies) {
    const relative = path.relative(root, dependency);
    const destination = path.join(appDirectory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(dependency, destination, { recursive: true, force: false, errorOnExist: true, filter: source => !path.relative(dependency, source).split(path.sep).includes('node_modules') });
    const dependencyManifest = JSON.parse(await readFile(path.join(dependency, 'package.json'), 'utf8'));
    notices.push(`${dependencyManifest.name}@${dependencyManifest.version} | ${typeof dependencyManifest.license === 'string' ? dependencyManifest.license : JSON.stringify(dependencyManifest.license ?? 'see package files')} | resources/app/${relative.split(path.sep).join('/')}`);
  }
  const runtimeDirectory = path.join(output, 'resources', 'node');
  await mkdir(runtimeDirectory, { recursive: true });
  await cp(process.execPath, path.join(runtimeDirectory, 'node.exe'));
  await writeFile(path.join(runtimeDirectory, 'LICENSE'), license.text);
  await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\n')}\n`);
  const copiedProbe = spawnSync(path.join(runtimeDirectory, 'node.exe'), ['--input-type=commonjs', '-e', "const Database = require('better-sqlite3'); const database = new Database(':memory:'); console.log(JSON.stringify({node: process.version, abi: process.versions.modules, sqlite: database.prepare('select sqlite_version() as version').get().version})); database.close();"], { cwd: appDirectory, encoding: 'utf8', windowsHide: true });
  if (copiedProbe.error || copiedProbe.status !== 0) throw new Error(`Packaged native binding verification failed: ${copiedProbe.error?.message || copiedProbe.stderr}`);
  await requireFile(path.join(output, 'Haven.exe'));
  await requireFile(path.resolve(appDirectory, manifest.main));
  await requireFile(path.join(appDirectory, 'node_modules', 'express', 'package.json'));
  const metadata = { name: manifest.name, version: manifest.version, platform: process.platform, architecture: process.arch, node: process.version, nodeAbi: process.versions.modules, nodeSha256: createHash('sha256').update(await readFile(path.join(runtimeDirectory, 'node.exe'))).digest('hex'), nodeLicenseSource: license.source, productionPackageCount: dependencies.length, nativeProbe: JSON.parse(copiedProbe.stdout.trim()), builtAt: new Date().toISOString(), unsigned: true };
  await writeFile(path.join(output, 'PACKAGE-INFO.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(path.join(output, 'PACKAGING-INCOMPLETE.txt'), path.join(output, 'PACKAGING-COMPLETE.txt'));
  await writeFile(path.join(output, 'PACKAGING-COMPLETE.txt'), 'Packaging completed. Start Haven.exe. Keep the complete directory together. This is an unsigned portable build.\n');
  console.log(JSON.stringify({ output, bytes: await treeSize(output), ...metadata }, null, 2));
}

main().catch(error => { console.error(`Packaging failed: ${error.message}`); process.exitCode = 1; });
