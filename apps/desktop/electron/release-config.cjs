// Public release defaults only. Never put credentials or personal settings here.
const productionConfig = Object.freeze({
  mode: 'hosted',
  backendUrl: 'https://haven-backend.getvoroa.com',
  webUrl: 'https://haven-ea6.pages.dev'
});

function validateReleaseConfig(config) {
  if (!config || Object.keys(config).sort().join(',') !== 'backendUrl,mode,webUrl' ||
      Object.keys(productionConfig).some(key => config[key] !== productionConfig[key])) {
    throw new Error('Invalid production release configuration; rebuild the Hosted installer');
  }
  return config;
}

function selectConnection({ args, env, savedServer, release }) {
  if (release) validateReleaseConfig(release);
  const local = args.includes('--local-mode');
  const explicit = args.find(argument => argument.startsWith('--server='))?.slice(9) || env.HAVEN_SERVER;
  if (local && (explicit || args.includes('--dev'))) throw new Error('Use --local-mode separately from --server or --dev');
  if (local) return { remote: undefined, webUrl: undefined };
  // A historical Local Mode connection must never override a public release's default.
  let saved = savedServer;
  if (release && saved) {
    try { const url = new URL(saved); if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) saved = undefined; }
    catch { saved = undefined; }
  }
  const remote = explicit || saved || release?.backendUrl;
  return { remote, webUrl: release && remote === release.backendUrl ? release.webUrl : undefined };
}

module.exports = { productionConfig, validateReleaseConfig, selectConnection };
