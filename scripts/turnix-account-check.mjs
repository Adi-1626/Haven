// Zero-bandwidth check of Haven's Turnix account: plan, usage, overage status, regions, and one 60-second
// credential to see which region and TURN URLs are actually returned. Relays no traffic.
//
//   TURNIX_API_TOKEN=... node scripts/turnix-account-check.mjs [--region <slug>]   (default: Turnix selects)
//
// Prints only non-secret fields: never the token, TURN usernames or credentials.
const token = process.env.TURNIX_API_TOKEN?.trim();
if (!token) {
  console.error('Set TURNIX_API_TOKEN in this shell (never in a file in the repository).');
  process.exit(2);
}
const args = process.argv.slice(2);
const region = args.includes('--region') ? args[args.indexOf('--region') + 1] : undefined;
const call = async (method, path, body) => {
  const response = await fetch(`https://turnix.io/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => undefined);
  return { status: response.status, ok: response.ok, data };
};

const usage = await call('GET', '/usage/current');
console.log(`GET /usage/current -> HTTP ${usage.status}`);
if (usage.ok && usage.data && typeof usage.data === 'object') {
  for (const [key, value] of Object.entries(usage.data)) if (typeof value !== 'object') console.log(`  ${key}: ${value}`);
}

const regions = await call('GET', '/regions');
console.log(`\nGET /regions -> HTTP ${regions.status}`);
if (regions.ok && Array.isArray(regions.data)) {
  for (const entry of regions.data) console.log(`  ${entry.slug} (${entry.city}) online=${entry.is_online} operational=${entry.is_operational}`);
}

const minted = await call('POST', '/credentials/ice', new URLSearchParams({ ttl: '60', initiator_client: 'account-check', ...(region ? { preferred_region: region } : {}) }));
console.log(`\nPOST /credentials/ice (ttl 60, ${region ? `preferred_region ${region}` : 'no region hint'}) -> HTTP ${minted.status}`);
if (minted.data?.expiresAt) console.log(`  expiresAt: ${minted.data.expiresAt} (~${Math.round((Date.parse(minted.data.expiresAt) - Date.now()) / 1000)} s from now)`);
const servers = minted.ok && Array.isArray(minted.data?.iceServers) ? minted.data.iceServers : [];
for (const server of servers) {
  const kind = server.username && server.credential ? 'relay (credentials present, not shown)' : 'no credentials';
  console.log(`  ${kind}:`);
  for (const url of [server.urls].flat()) console.log(`    ${url}`);
  const extra = Object.keys(server).filter(key => !['urls', 'username', 'credential'].includes(key));
  if (extra.length) console.log(`    other fields: ${extra.join(', ')}`);
}
const relayUrls = servers.flatMap(server => [server.urls].flat()).filter(url => /^turns?:/i.test(url));
console.log(`\nRelay hosts selected: ${[...new Set(relayUrls.map(url => url.replace(/^turns?:/i, '').split(/[:?]/)[0]))].join(', ') || '(none)'}`);
console.log(`TURN/TLS (turns:) offered: ${relayUrls.some(url => /^turns:/i.test(url)) ? 'YES' : 'NO'}`);
process.exit(usage.ok && regions.ok && minted.ok ? 0 : 1);
