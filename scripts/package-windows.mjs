import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandExecutable } from './windows-branding.mjs';
import { validateElectronRuntime } from './package-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');
const packageVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageVersion)) throw new Error('Invalid release version');
const output = resolveOutput(root, packageVersion, process.argv.slice(2));
const appDirectory = path.join(output, 'resources', 'app');
const require = createRequire(import.meta.url);
const { productionConfig } = require('../apps/desktop/electron/release-config.cjs');

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

// Electron ships with its own icon; stamp Haven's multi-size .ico into the renamed executable.
async function applyExecutableIcon(executable, icon) {
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'haven-icon-'));
  try {
    const tool = path.join(scratch, 'windows-icon.exe');
    const build = spawnSync(compiler, ['/nologo', '/optimize+', '/target:exe', `/out:${tool}`, path.join(root, 'scripts', 'windows-icon.cs')], { encoding: 'utf8', windowsHide: true });
    if (build.error || build.status !== 0) throw new Error(`Executable icon tool build failed: ${build.error?.message || build.stdout || build.stderr}`);
    const applied = spawnSync(tool, [executable, icon], { encoding: 'utf8', windowsHide: true });
    if (applied.error || applied.status !== 0) throw new Error(`Executable icon update failed: ${applied.error?.message || applied.stderr || applied.stdout}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function resolveOutput(projectRoot, version, args) {
  if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('Usage: node scripts/package-windows.mjs [--output release/NewBundle]');
  const releases = path.join(projectRoot, 'release');
  const candidate = args.length ? path.resolve(projectRoot, args[1]) : path.join(releases, `Haven-${version}-win32-x64`);
  if (!contained(releases, candidate)) throw new Error('Release output must be a new directory inside release');
  return candidate;
}

export async function dependencyPlan(projectRoot, manifest, dependencies) {
  const workspaces = new Map();
  for (const pattern of manifest.workspaces || []) {
    if (typeof pattern !== 'string' || !/^[\w./-]+(?:\/\*)?$/.test(pattern)) throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const base = path.resolve(projectRoot, pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern);
    if (!contained(projectRoot, base)) throw new Error(`Workspace outside project: ${pattern}`);
    const directories = pattern.endsWith('/*') ? (await readdir(base, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(base, entry.name)) : [base];
    for (const directory of directories) {
      const physical = await realpath(directory);
      if (!contained(await realpath(projectRoot), physical)) throw new Error(`Workspace resolves outside project: ${directory}`);
      const workspace = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      workspaces.set(physical, { directory, name: workspace.name });
    }
  }
  const plan = [];
  const seen = new Set();
  for (const dependency of dependencies) {
    const physical = await realpath(dependency);
    const workspace = workspaces.get(physical);
    if (workspace) {
      if (['@haven/backend', '@haven/web', '@haven/desktop', '@haven/landing'].includes(workspace.name)) continue;
      if (workspace.name !== '@haven/shared') throw new Error(`No runtime packaging rule for workspace: ${workspace.name}`);
      if (seen.has(workspace.name)) continue;
      await requireFile(path.join(workspace.directory, 'dist', 'index.js'));
      plan.push({ source: workspace.directory, relative: path.join('node_modules', '@haven', 'shared'), workspace: true });
      seen.add(workspace.name);
    } else {
      // Type declarations are compile-time only, even when a workspace lists them under dependencies.
      if (path.relative(path.join(projectRoot, 'node_modules'), dependency).split(path.sep)[0] === '@types') continue;
      if (!contained(path.join(projectRoot, 'node_modules'), dependency) || !contained(await realpath(path.join(projectRoot, 'node_modules')), physical)) throw new Error(`Dependency is outside local node_modules or declared workspaces: ${dependency}`);
      await requireFile(path.join(dependency, 'package.json'));
      plan.push({ source: dependency, relative: path.relative(projectRoot, dependency), workspace: false });
    }
  }
  return plan;
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
  if (!contained(releaseRoot, output) || !contained(root, releaseRoot)) throw new Error('Release output is outside the expected workspace directory');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof manifest.main !== 'string' || !contained(root, path.resolve(root, manifest.main))) throw new Error('The application main entry must be a relative file within this project');
  await requireFile(path.resolve(root, manifest.main));
  const electronDirectory = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
  const electronVersion = validateElectronRuntime(manifest.devDependencies?.electron, require('electron/package.json').version, await readFile(path.join(electronDirectory, 'version'), 'utf8'));
  const electronDir = [path.join(root, 'apps', 'desktop', 'electron'), path.join(root, 'electron')].find(candidate => existsSync(candidate));
  const backendDir = [path.join(root, 'apps', 'backend', 'build'), path.join(root, 'build')].find(candidate => existsSync(candidate));
  const webDir = [path.join(root, 'apps', 'web', 'dist'), path.join(root, 'dist')].find(candidate => existsSync(candidate));
  const iconPath = [path.join(root, 'apps', 'web', 'public', 'haven.ico'), path.join(root, 'public', 'haven.ico')].find(candidate => existsSync(candidate));
  if (!electronDir || !backendDir || !webDir || !iconPath) throw new Error('Missing build outputs. Run npm run build first.');
  await requireFile(path.join(electronDir, 'main.cjs'));
  await requireFile(path.join(webDir, 'index.html'));
  await requireFile(iconPath);
  const sqliteProbe = spawnSync(process.execPath, ['--input-type=commonjs', '-e', "const Database = require('better-sqlite3'); const database = new Database(':memory:'); database.prepare('select 1').get(); database.close();"], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (sqliteProbe.error || sqliteProbe.status !== 0) throw new Error(`better-sqlite3 does not load with the bundled Node runtime: ${sqliteProbe.error?.message || sqliteProbe.stderr}`);
  // Only the backend's runtime closure ships: Electron main uses Node built-ins, and the web client is already bundled into dist/.
  const dependencyProbe = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ls --omit=dev --all --parseable --workspace=@haven/backend'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (dependencyProbe.error || dependencyProbe.status !== 0) throw new Error(`Production dependency inventory failed: ${dependencyProbe.error?.message || dependencyProbe.stderr}`);
  const dependencies = [...new Set(dependencyProbe.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(directory => path.resolve(directory)).filter(directory => directory !== root))];
  const packages = await dependencyPlan(root, manifest, dependencies);
  const license = await nodeLicense();
  await mkdir(releaseRoot, { recursive: true });
  // Reject junction/symlink ancestors before creating the output directory.
  if (!contained(await realpath(releaseRoot), path.join(await realpath(path.dirname(output)), path.basename(output)))) throw new Error('Release output resolves outside release');
  try { await mkdir(output); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Release directory already exists: ${output}. Move it aside before creating a new release; packaging never deletes an existing bundle.`);
    throw error;
  }
  console.log(`Packaging ${manifest.name} ${manifest.version} into ${output}`);
  await writeFile(path.join(output, 'PACKAGING-INCOMPLETE.txt'), 'This directory is incomplete until packaging finishes successfully.\n');
  for (const entry of await readdir(electronDirectory)) await cp(path.join(electronDirectory, entry), path.join(output, entry), { recursive: true, force: false, errorOnExist: true });
  await rename(path.join(output, 'electron.exe'), path.join(output, 'Haven.exe'));
  await applyExecutableIcon(path.join(output, 'Haven.exe'), iconPath);
  await brandExecutable(path.join(output, 'Haven.exe'), packageVersion);
  await mkdir(appDirectory, { recursive: true });
  await writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify({ name: manifest.name, version: manifest.version, private: true, type: manifest.type, main: 'electron/main.cjs', dependencies: manifest.dependencies }, null, 2)}\n`);
  await cp(electronDir, path.join(appDirectory, 'electron'), { recursive: true, force: false, errorOnExist: true });
  await writeFile(path.join(appDirectory, 'release-config.json'), `${JSON.stringify(productionConfig, null, 2)}\n`);
  const withoutSourceMaps = source => !source.endsWith('.map');
  await cp(backendDir, path.join(appDirectory, 'build'), { recursive: true, force: false, errorOnExist: true, filter: withoutSourceMaps });
  await cp(webDir, path.join(appDirectory, 'dist'), { recursive: true, force: false, errorOnExist: true, filter: withoutSourceMaps });
  const hotkeyCompiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const hotkeyBuild = spawnSync(hotkeyCompiler, ['/nologo', '/optimize+', '/target:exe', `/out:${path.join(appDirectory, 'electron', 'HavenHotkeys.exe')}`, path.join(appDirectory, 'electron', 'HavenHotkeys.cs')], { encoding: 'utf8', windowsHide: true });
  if (hotkeyBuild.error || hotkeyBuild.status !== 0) throw new Error(`Native keyboard helper build failed: ${hotkeyBuild.error?.message || hotkeyBuild.stdout || hotkeyBuild.stderr}`);
  await mkdir(path.join(appDirectory, 'public'), { recursive: true });
  await cp(iconPath, path.join(appDirectory, 'public', 'haven.ico'));
  const notices = ['Haven third-party runtime notices', '', 'Electron license: LICENSE', 'Chromium and bundled libraries: LICENSES.chromium.html', 'Node.js and its bundled dependencies: resources/node/LICENSE', '', 'Application dependencies retain their complete upstream package files, including license and notice files, at the following relative package paths:', ''];
  for (const packagedDependency of packages) {
    const { source: dependency, relative, workspace } = packagedDependency;
    const destination = path.join(appDirectory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    if (workspace) {
      await mkdir(destination, { recursive: true });
      await cp(path.join(dependency, 'package.json'), path.join(destination, 'package.json'));
      await cp(path.join(dependency, 'dist'), path.join(destination, 'dist'), { recursive: true, force: false, errorOnExist: true });
    } else {
      await cp(dependency, destination, { recursive: true, force: false, errorOnExist: true, filter: source => !path.relative(dependency, source).split(path.sep).includes('node_modules') });
    }
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
  await requireFile(path.join(appDirectory, 'electron', 'main.cjs'));
  await requireFile(path.join(appDirectory, 'node_modules', 'express', 'package.json'));
  const metadata = { name: manifest.name, version: manifest.version, electron: electronVersion, platform: process.platform, architecture: process.arch, node: process.version, nodeAbi: process.versions.modules, nodeSha256: createHash('sha256').update(await readFile(path.join(runtimeDirectory, 'node.exe'))).digest('hex'), nodeLicenseSource: license.source, productionPackageCount: packages.length, nativeProbe: JSON.parse(copiedProbe.stdout.trim()), builtAt: new Date().toISOString(), unsigned: true };
  await writeFile(path.join(output, 'PACKAGE-INFO.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(path.join(output, 'PACKAGING-INCOMPLETE.txt'), path.join(output, 'PACKAGING-COMPLETE.txt'));
  await writeFile(path.join(output, 'PACKAGING-COMPLETE.txt'), 'Packaging completed. Start Haven.exe. Keep the complete directory together. This is an unsigned portable build.\n');
  console.log(JSON.stringify({ output, bytes: await treeSize(output), ...metadata }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`Packaging failed: ${error.message}`); process.exitCode = 1; });
