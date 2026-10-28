// Official desktop update feed. Only a stable GitHub release that carries latest.yml can
// update installed copies; Hosted web deploys never touch this channel.
const updateFeed = Object.freeze({
  provider: 'github',
  owner: 'Adi-1626',
  repo: 'Haven',
  releaseType: 'release',
  // electron-builder names the installer cache after the root package ("haven-monorepo");
  // v1.0.0 installers already store installer.exe there for differential downloads.
  updaterCacheDirName: 'haven-monorepo-updater',
});

// resources/app-update.yml. Prepackaged electron-builder builds never write it, so packaging does.
function appUpdateYml(feed = updateFeed) {
  return ['provider', 'owner', 'repo', 'releaseType', 'updaterCacheDirName'].map(key => `${key}: ${feed[key]}`).join('\n') + '\n';
}

// Accepts only the flat file appUpdateYml writes; anything else fails closed.
function parseAppUpdateYml(text) {
  const config = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z]+): ?(.*)$/.exec(line);
    if (!match) throw new Error('Unsupported update configuration');
    config[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return config;
}

// The release feed must be the official repository. A generic feed is accepted only on this
// computer's loopback interface, which is how scripts/verify-auto-update.mjs serves a test release.
function trustedFeed(config) {
  if (config?.provider === 'github') return config.owner === updateFeed.owner && config.repo === updateFeed.repo && (config.releaseType ?? 'release') === 'release';
  if (config?.provider !== 'generic') return false;
  try {
    const url = new URL(config.url);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

module.exports = { updateFeed, appUpdateYml, parseAppUpdateYml, trustedFeed };
