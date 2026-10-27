// Why does preferred_region=singapore return eu-central? Zero relay bandwidth: mints a few short-lived
// (2-9 minute) credentials and never uses them.
//
//   TURNIX_API_TOKEN=... node scripts/turnix-region-check.mjs
//
// Each variant sends a distinct ttl, so the returned expiresAt shows whether Turnix parsed that encoding
// at all. Prints status, effective TTL, relay hostnames and error bodies; never tokens or credentials.
const token = process.env.TURNIX_API_TOKEN?.trim();
if (!token) { console.error('Set TURNIX_API_TOKEN in this shell first.'); process.exit(2); }
const base = 'https://turnix.io/api/v1';
const scrub = text => text.split(token).join('[token]')
  .replace(/("(?:username|credential|password)"\s*:\s*)"[^"]*"/gi, '$1"[hidden]"').slice(0, 400);

const regions = await fetch(`${base}/regions`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
console.log(`GET /regions -> HTTP ${regions.status}`);
try { for (const r of await regions.json()) console.log(`  ${r.slug.padEnd(12)} ${String(r.city).padEnd(18)} online=${r.is_online} operational=${r.is_operational}`); } catch { console.log('  (unreadable)'); }

const variants = [
  { label: 'form  preferred_region=singapore (turnix-js SDK, Haven backend)', ttl: 120, enc: 'form', fields: { preferred_region: 'singapore' } },
  { label: 'json  preferred_region=singapore (turnix_dart SDK)', ttl: 180, enc: 'json', fields: { preferred_region: 'singapore' } },
  { label: 'form  fixed_region=singapore', ttl: 240, enc: 'form', fields: { fixed_region: 'singapore' } },
  { label: 'json  fixed_region=singapore', ttl: 300, enc: 'json', fields: { fixed_region: 'singapore' } },
  { label: 'query fixed_region=singapore', ttl: 360, enc: 'query', fields: { fixed_region: 'singapore' } },
  { label: 'form  preffered_region=singapore (typo in doc curl examples)', ttl: 420, enc: 'form', fields: { preffered_region: 'singapore' } },
  { label: 'form  fixed_region=eu-central (control)', ttl: 480, enc: 'form', fields: { fixed_region: 'eu-central' } },
  { label: 'form  no region (GeoIP baseline)', ttl: 540, enc: 'form', fields: {} },
];

for (const { label, ttl, enc, fields } of variants) {
  const params = { ttl, initiator_client: 'region-check', ...fields };
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let url = `${base}/credentials/ice`, body;
  if (enc === 'form') { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])); }
  if (enc === 'json') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(params); }
  if (enc === 'query') url += `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  const sentAt = Date.now();
  let response;
  try { response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) }); }
  catch (error) { console.log(`\n${label}\n  request failed: ${error.name}`); continue; }
  const text = await response.text();
  console.log(`\n${label}\n  sent ttl=${ttl}s -> HTTP ${response.status}`);
  let data;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || !data) { console.log(`  body: ${scrub(text) || '(empty)'}`); continue; }
  const extra = Object.keys(data).filter(key => key !== 'iceServers');
  if (extra.length) console.log(`  other top-level fields: ${extra.map(key => `${key}=${typeof data[key] === 'object' ? '[object]' : scrub(String(data[key]))}`).join(', ')}`);
  if (data.expiresAt) {
    const effective = Math.round((Date.parse(data.expiresAt) - sentAt) / 1000);
    console.log(`  effective ttl ~${effective}s -> ${Math.abs(effective - ttl) <= 15 ? 'ttl HONORED (body parsed)' : 'ttl NOT honored (body likely ignored)'}`);
  }
  const relays = (data.iceServers ?? []).flatMap(server => [server.urls].flat()).filter(u => /^turns?:/i.test(u));
  const hosts = [...new Set(relays.map(u => u.replace(/^turns?:/i, '').split(/[:?]/)[0]))];
  console.log(`  relay hosts: ${hosts.join(', ') || '(none)'}`);
  console.log(`  relay urls:  ${relays.join('  ') || '(none)'}`);
}
