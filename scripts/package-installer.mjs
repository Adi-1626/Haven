// Wraps the verified portable bundle from scripts/package-windows.mjs in an NSIS installer (Haven-Setup.exe).
// Usage: node scripts/package-installer.mjs [--portable release/Haven-<version>-win32-x64] [--output release/Haven-<version>-installer]
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditBundle, validateElectronRuntime } from './package-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(root, 'release');
const require = createRequire(import.meta.url);
const { validateReleaseConfig } = require('../apps/desktop/electron/release-config.cjs');
const { appUpdateYml, updateFeed } = require('../apps/desktop/electron/update-config.cjs');
const contained = (parent, child) => { const relative = path.relative(parent, child); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

export function resolveInstallerPaths(projectRoot, version, args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--portable', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('Usage: node scripts/package-installer.mjs [--portable <bundle>] [--output release/<NewDirectory>]');
    options[args[index].slice(2)] = path.resolve(projectRoot, args[index + 1]);
  }
  const releases = path.join(projectRoot, 'release');
  const portable = options.portable || path.join(releases, `Haven-${version}-win32-x64`);
  const output = options.output || path.join(releases, `Haven-${version}-installer`);
  if (!contained(releases, output)) throw new Error('Installer output must be a new directory inside release');
  return { portable, output };
}

const fileHash = (file, algorithm, encoding) => new Promise((resolve, reject) => {
  const hash = createHash(algorithm);
  createReadStream(file).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest(encoding)));
});
const sha256 = file => fileHash(file, 'sha256', 'hex');

// electron-updater trusts latest.yml for the version, file name, size and sha512 it verifies after downloading.
export function validateUpdateMetadata(metadata, { version, installer, bytes, sha512 }) {
  const [file] = Array.isArray(metadata?.files) ? metadata.files : [];
  const problems = [];
  if (metadata?.version !== version) problems.push(`version ${metadata?.version} is not ${version}`);
  if (metadata?.files?.length !== 1 || file?.url !== installer || metadata.path !== installer) problems.push(`it must list exactly ${installer}`);
  if (file?.sha512 !== sha512 || metadata.sha512 !== sha512) problems.push('its sha512 does not match the installer');
  if (file?.size !== bytes) problems.push(`its size ${file?.size} is not ${bytes}`);
  if (file?.isAdminRightsRequired) problems.push('a per-user installer must not require administrator rights');
  if (problems.length) throw new Error(`Invalid latest.yml: ${problems.join('; ')}`);
  return metadata;
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the installer on Windows x64.');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { portable, output } = resolveInstallerPaths(root, manifest.version, process.argv.slice(2));
  for (const required of ['Haven.exe', 'PACKAGE-INFO.json', 'PACKAGING-COMPLETE.txt']) {
    if (!existsSync(path.join(portable, required))) throw new Error(`${path.join(portable, required)} is missing. Run npm run package:win:portable first.`);
  }
  const packageInfo = JSON.parse(await readFile(path.join(portable, 'PACKAGE-INFO.json'), 'utf8'));
  if (packageInfo.version !== manifest.version) throw new Error(`Portable bundle is version ${packageInfo.version}, but package.json is ${manifest.version}`);
  const releaseConfig = validateReleaseConfig(JSON.parse(await readFile(path.join(portable, 'resources/app/release-config.json'), 'utf8')));
  // Every desktop bridge/helper matters: checking only main/config allowed stale PTT/preload code.
  for (const name of await readdir(path.join(root, 'apps/desktop/electron'))) {
    if (!(await stat(path.join(root, 'apps/desktop/electron', name))).isFile()) continue;
    const source = await readFile(path.join(root, 'apps/desktop/electron', name));
    const bundled = await readFile(path.join(portable, 'resources/app/electron', name));
    if (!source.equals(bundled)) throw new Error(`Stale desktop release payload: ${name}. Rebuild the portable bundle.`);
  }
  const updateConfig = await readFile(path.join(portable, 'resources/app-update.yml'), 'utf8').catch(() => null);
  if (updateConfig !== appUpdateYml()) throw new Error('The portable bundle has a missing or unofficial resources/app-update.yml. Rebuild the portable bundle.');

  validateElectronRuntime(manifest.devDependencies?.electron, packageInfo.electron, await readFile(path.join(portable, 'version'), 'utf8'));

  const audit = await auditBundle(portable);
  if (audit.problems.length) throw new Error(`Portable bundle failed the payload audit:\n  ${audit.problems.join('\n  ')}`);

  await mkdir(releaseRoot, { recursive: true });
  if (!contained(await realpath(releaseRoot), path.join(await realpath(path.dirname(output)), path.basename(output)))) throw new Error('Installer output resolves outside release');
  try { await mkdir(output); } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Installer directory already exists: ${output}. Move it aside first; packaging never deletes an existing build.`);
    throw error;
  }

  // Stage a copy without the portable-only marker, so installed copies do not claim to be portable builds.
  const staging = path.join(output, 'payload');
  await cp(portable, staging, { recursive: true, filter: source => path.basename(source) !== 'PACKAGING-COMPLETE.txt' });

  const { build, Platform, Arch } = require('electron-builder');
  const config = { ...require(path.join(root, 'apps', 'desktop', 'installer', 'electron-builder.config.cjs')), directories: { output } };
  config.extraMetadata = { version: manifest.version, author: { name: 'Haven' } };
  await build({ projectDir: root, prepackaged: staging, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), config, publish: 'never' });

  if (contained(output, staging)) await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const installer = path.join(output, config.nsis.artifactName);
  const { size } = await stat(installer);
  const digest = await sha256(installer);
  await writeFile(`${installer}.sha256`, `${digest}  ${path.basename(installer)}\n`);
  const sha512 = await fileHash(installer, 'sha512', 'base64');
  validateUpdateMetadata(require('js-yaml').load(await readFile(path.join(output, 'latest.yml'), 'utf8')), { version: manifest.version, installer: path.basename(installer), bytes: size, sha512 });
  const blockmap = `${installer}.blockmap`;
  if (!existsSync(blockmap)) throw new Error(`${blockmap} is missing; differential updates need it.`);
  const update = { feed: `https://github.com/${updateFeed.owner}/${updateFeed.repo}/releases (stable only)`, sha512, releaseAssets: [path.basename(installer), path.basename(blockmap), 'latest.yml'] };
  const metadata = { installer: path.basename(installer), version: manifest.version, releaseStatus: 'unpublished-candidate', publicReleaseApproved: false, releaseConfig, bytes: size, sha256: digest, update, portableSource: path.relative(root, portable), payloadFiles: audit.files, payloadBytes: audit.bytes, unsigned: true, builtAt: new Date().toISOString() };
  await writeFile(path.join(output, 'INSTALLER-INFO.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ output, ...metadata, notes: audit.notes, contents: await readdir(output) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`Installer packaging failed: ${error.message}`); process.exitCode = 1; });
