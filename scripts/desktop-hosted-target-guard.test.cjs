const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The guard for `dev:hosted` / `desktop:hosted`. Fake project refs and hosts only; nothing connects anywhere.
const guardSource = path.join(__dirname, 'hosted-target-guard.mjs');
const ref = 'abcdefghijklmnopqrst';
const productionLike = {
  DATABASE_URL: `postgresql://haven_app.${ref}:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  SUPABASE_URL: `https://${ref}.supabase.co`,
};
const load = () => import(require('node:url').pathToFileURL(guardSource).href);

test('remote Supabase targets need an exact, deliberate confirmation', async () => {
  const { evaluateHostedTargets } = await load();
  const blocked = evaluateHostedTargets([productionLike], {});
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.confirmation, ref, 'pooler user name and project URL resolve to one project ref');
  assert.ok(!JSON.stringify(blocked).includes('secret'), 'credentials are never echoed');
  assert.equal(evaluateHostedTargets([productionLike], { HAVEN_HOSTED_TARGET: ref }).allowed, true);
  const stale = evaluateHostedTargets([productionLike], { HAVEN_HOSTED_TARGET: 'zyxwvutsrqponmlkjihg' });
  assert.equal(stale.allowed, false);
  assert.equal(stale.staleOverride, true);
});

test('loopback-only stacks start without confirmation; a remote API origin or shell value still counts', async () => {
  const { evaluateHostedTargets } = await load();
  const loopback = { DATABASE_URL: 'postgresql://postgres@127.0.0.1:55452/postgres', SUPABASE_URL: 'http://localhost:54321', VITE_API_URL: 'http://[::1]:3001' };
  assert.equal(evaluateHostedTargets([loopback], {}).allowed, true);
  const api = evaluateHostedTargets([loopback], { VITE_API_URL: 'https://haven.example-host.app' });
  assert.equal(api.allowed, false);
  assert.equal(api.confirmation, 'haven.example-host.app');
  // A remote target in any env file counts even if another source looks local.
  assert.equal(evaluateHostedTargets([loopback, productionLike], {}).confirmation, ref);
});

function fixture(envHosted) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haven-guard-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(guardSource, path.join(root, 'scripts', 'hosted-target-guard.mjs'));
  fs.writeFileSync(path.join(root, '.env.hosted'), Object.entries(envHosted).map(([key, value]) => `${key}=${value}`).join('\n'));
  fs.writeFileSync(path.join(root, 'child.cjs'), "require('fs').writeFileSync(process.argv[2], process.env.HAVEN_HOSTED_TARGET || 'none');");
  const marker = path.join(root, 'started.txt');
  const run = (env = {}) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|DATABASE_URL|HAVEN_ENV_FILE|HAVEN_HOSTED_TARGET|VITE_API_URL/.test(key)));
    // stdin is not a terminal here, so the guard cannot prompt: it must refuse or use the override.
    return spawnSync(process.execPath, [path.join(root, 'scripts', 'hosted-target-guard.mjs'), '--', 'node', path.join(root, 'child.cjs'), marker], { cwd: root, env: { ...clean, ...env }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 });
  };
  return { root, marker, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('dev:hosted against a production-like target refuses without confirmation and starts nothing', () => {
  const { marker, run, cleanup } = fixture(productionLike);
  try {
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.existsSync(marker), false, 'the command was not started');
    assert.match(result.stderr, /PRODUCTION/);
    assert.match(result.stderr, new RegExp(`HAVEN_HOSTED_TARGET=${ref}`));
    assert.doesNotMatch(result.stderr, /secret/);
  } finally { cleanup(); }
});

test('an explicit override for the exact target starts the command and passes the confirmation to nested scripts', () => {
  const { marker, run, cleanup } = fixture(productionLike);
  try {
    assert.equal(run({ HAVEN_HOSTED_TARGET: 'zyxwvutsrqponmlkjihg' }).status, 1, 'an override for another project does not apply');
    assert.equal(fs.existsSync(marker), false);
    const result = run({ HAVEN_HOSTED_TARGET: ref });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(marker, 'utf8'), ref);
  } finally { cleanup(); }
});

test('a loopback hosted stack starts without any prompt or override', () => {
  const { marker, run, cleanup } = fixture({ DATABASE_URL: 'postgresql://postgres@127.0.0.1:55452/postgres', SUPABASE_URL: 'http://127.0.0.1:54321' });
  try {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'none');
  } finally { cleanup(); }
});
