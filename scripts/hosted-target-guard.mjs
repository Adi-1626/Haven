// Guards the local `dev:hosted` / `desktop:hosted` commands against silently connecting a development
// process to a real (production) Supabase project or hosted API. Production deployments never run these
// npm scripts (they start `node build/index.js` / ship a `vite build`), so they are not affected.
//
//   node scripts/hosted-target-guard.mjs -- <command> [args...]
//
// Every target the command would use (database, Supabase Auth/Storage, API origin) is read from the same
// env files those commands load plus the shell environment. Loopback-only targets start without
// questions. Anything else needs a deliberate confirmation: either type the target's name when asked, or
// set HAVEN_HOSTED_TARGET to exactly that name for non-interactive use. The confirmed name is passed to
// the child command, so nested dev:hosted scripts do not ask again.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const targetVariables = ['DATABASE_URL', 'SUPABASE_DATABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL', 'VITE_API_URL'];

/** The env files `dev:hosted` loads: the backend's HAVEN_ENV_FILE/.env.hosted and Vite's hosted mode files. */
export function hostedEnvFiles(env = process.env, root = repoRoot, cwd = process.cwd()) {
  // The backend resolves HAVEN_ENV_FILE against its working directory first, then the repository root.
  const custom = env.HAVEN_ENV_FILE ? [path.resolve(cwd, env.HAVEN_ENV_FILE), path.resolve(root, env.HAVEN_ENV_FILE)] : [];
  return [...new Set([...custom, ...['.env.hosted', '.env.hosted.local'].map(file => path.resolve(root, file))])];
}

/** Names a target without exposing credentials: the Supabase project ref when known, otherwise the host. */
function targetName(variable, value) {
  let url;
  try { url = new URL(value); } catch { return { variable, name: 'unparseable value', remote: true }; }
  const host = url.hostname.toLowerCase();
  if (loopbackHosts.has(host)) return { variable, name: host, remote: false };
  const supabaseRef = /^([a-z0-9]{20})\.supabase\.(?:co|in)$/.exec(host)?.[1];
  // Supabase pooler hosts are shared; the project is in the user name (`role.projectref`).
  const poolerRef = /\.pooler\.supabase\.com$/.test(host) ? /\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username))?.[1] : undefined;
  return { variable, name: supabaseRef ?? poolerRef ?? host, remote: true };
}

/**
 * Pure decision used by the CLI and tests. `fileSources` are the parsed env files and `env` the shell.
 * The backend and Vite read different subsets of these, so a target found in ANY source counts.
 */
export function evaluateHostedTargets(fileSources, env) {
  const targets = [...fileSources, env].flatMap(values =>
    targetVariables.filter(variable => values[variable]).map(variable => targetName(variable, values[variable])));
  const remoteNames = [...new Set(targets.filter(target => target.remote).map(target => target.name))].sort();
  const confirmation = remoteNames.join(',');
  if (!remoteNames.length) return { allowed: true, targets, remoteNames, confirmation };
  const override = env.HAVEN_HOSTED_TARGET?.trim();
  if (override === confirmation) return { allowed: true, targets, remoteNames, confirmation, via: 'override' };
  return { allowed: false, targets, remoteNames, confirmation, staleOverride: Boolean(override) };
}

const readEnvFiles = files => files.filter(file => existsSync(file)).map(file => parseEnv(readFileSync(file, 'utf8')));

const quote = argument => /[\s"&|<>^()]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;

async function main() {
  const separator = process.argv.indexOf('--');
  const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
  if (!command.length) {
    console.error('Usage: node scripts/hosted-target-guard.mjs -- <command> [args...]');
    process.exit(2);
  }
  const decision = evaluateHostedTargets(readEnvFiles(hostedEnvFiles()), process.env);
  let confirmed = decision.allowed;

  if (!confirmed) {
    const lines = decision.targets.filter(target => target.remote).map(target => `  ${target.variable.padEnd(22)} ${target.name}`);
    console.error([
      '',
      'WARNING: this dev:hosted command would connect to a real hosted target (treated as PRODUCTION):',
      ...lines,
      '',
      'Accounts, messages and uploads created here are real production data.',
      ...(decision.staleOverride ? [`HAVEN_HOSTED_TARGET is set, but not to "${decision.confirmation}"; it does not apply to these targets.`] : []),
    ].join('\n'));
    if (process.stdin.isTTY && process.stderr.isTTY) {
      const prompt = createInterface({ input: process.stdin, output: process.stderr });
      const answer = (await prompt.question(`Type "${decision.confirmation}" to continue, or press Enter to cancel: `)).trim();
      prompt.close();
      confirmed = answer === decision.confirmation;
    }
    if (!confirmed) {
      console.error([
        'Cancelled: nothing was started.',
        `To proceed deliberately without a prompt, set HAVEN_HOSTED_TARGET=${decision.confirmation}.`,
        'For private testing, use Local Mode (npm run dev / npm run desktop) or point .env.hosted at a loopback stack.',
      ].join('\n'));
      process.exit(1);
    }
  }

  const child = spawn(command.map(quote).join(' '), {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(decision.remoteNames.length ? { HAVEN_HOSTED_TARGET: decision.confirmation } : {}) },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
