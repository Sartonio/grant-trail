const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Sync a local config file → the matching GitHub Environment.
//
// Single source of truth = GitHub Environments. You pick a STAGE — `ci`,
// `staging`, or `production` — and this script:
//   (a) targets the GitHub Environment of the same name,
//   (b) reads `.deploy/<stage>.env` (git-ignored), scaffolded from the committed
//       template `deploy/<stage>.env.example`,
//   (c) pushes that stage's key set as Secrets / Variables.
//
// For `staging`/`production` it auto-fetches everything it safely can (Supabase
// URL + publishable key, Vercel ids), validates required values, and refuses if
// the Basic/Pro prices collide. The Stripe webhook secret is set once by hand at
// setup time (Stripe only reveals it at creation) — see docs/how_to/prod_setup.md. For `ci` it only handles
// the three Stripe *_TEST secrets — no auto-fetch, no preflight CLIs beyond gh.
//
// Incremental by design: you only need to fill the keys you want to add/replace.
// Any required key left blank locally is checked against the target GitHub
// environment — if it's already stored there, we keep it (no re-fetch, no
// re-push, and no preflight CLI demanded for it). We only error on keys missing
// from BOTH the local file and the environment.
//
// The matching GitHub workflow is the ONLY consumer of these values.
//
//   npm run deploy:secrets                  → production
//   npm run deploy:secrets:staging          → staging
//   npm run deploy:secrets:ci               → ci
//   node scripts/deploy_secrets.js --env staging
//   ... -- --keep              keep the local .deploy/<stage>.env afterward
//   ... -- --dry-run           show what would happen, change nothing
// ─────────────────────────────────────────────────────────────────────────────

// Silence the Supabase CLI's PostHog telemetry. Without this it can hang on
// shutdown and exit non-zero in restricted-network environments, making a valid
// SUPABASE_ACCESS_TOKEN look invalid during preflight. Inherited by all children.
process.env.DO_NOT_TRACK = '1';

const REPO_ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(REPO_ROOT, '.deploy');
const VERCEL_PROJECT_JSON = path.join(REPO_ROOT, '.vercel', 'project.json');

// ── Stage definitions ────────────────────────────────────────────────────────
// Each stage names its GitHub-Actions secret + variable key sets, plus the keys
// allowed to be blank after auto-fetch. `staging`/`production` share an identical
// schema (same key names, different values); `ci` is secrets-only.
const STAGES = {
  ci: {
    secrets: ['STRIPE_SECRET_KEY_TEST', 'STRIPE_PRICE_BASIC_TEST', 'STRIPE_PRICE_FISCAL_AGENT_TEST'],
    variables: [],
    optional: [],
    autoFetch: false,
  },
  staging: {
    secrets: [
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_DB_PASSWORD',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'VERCEL_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
      'RESEND_API_KEY',
    ],
    variables: [
      'SUPABASE_PROJECT_REF',
      'STRIPE_PRICE_BASIC',
      'STRIPE_PRICE_FISCAL_AGENT',
      'STRIPE_PRODUCT_BASIC',
      'STRIPE_PRODUCT_FISCAL_AGENT',
      'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
      'APP_URL',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_KEY',
      'VITE_SENTRY_DSN',
      'EMAIL_FROM',
    ],
    optional: [
      // Only needed where the deploy identity lacks CREATEROLE on the DB (i.e.
      // projects you don't own at the postgres level, typically production).
      // Blank → CLI falls back to the login-role path (staging's default).
      'SUPABASE_DB_PASSWORD',
      'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
      'VITE_SENTRY_DSN',
    ],
    autoFetch: true,
  },
};
// production shares staging's schema exactly.
STAGES.production = { ...STAGES.staging };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keep = args.includes('--keep');

// Target stage → GitHub Environment name + local config file + key set.
// Defaults to `production`; override with `--env ci|staging|production`.
const envIdx = args.indexOf('--env');
const STAGE = envIdx !== -1 && args[envIdx + 1] ? args[envIdx + 1] : 'production';

if (!STAGES[STAGE]) {
  console.error(`❌ Unknown stage "${STAGE}". Use --env ci|staging|production.`);
  process.exit(1);
}

const STAGE_DEF = STAGES[STAGE];
const SECRETS = new Set(STAGE_DEF.secrets);
const VARIABLES = new Set(STAGE_DEF.variables);
const OPTIONAL = new Set(STAGE_DEF.optional);
const ENV_NAME = STAGE; // GitHub Environment name == stage name.
const ENV_FILE = path.join(DEPLOY_DIR, `${STAGE}.env`);
const EXAMPLE_FILE = path.join(REPO_ROOT, 'deploy', `${STAGE}.env.example`);

const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { encoding: 'utf8', ...opts });

// What the target GitHub environment already holds. Populated by preflight once
// `gh` is verified, so the rest of the run can keep values the user didn't
// re-supply locally. Empty until then (and when the environment doesn't exist).
let remoteSecrets = new Set();
let remoteVariables = new Set();
// True when KEY is already stored in the environment (checked against the right
// kind). Reads the live Sets, so it reflects whatever preflight loaded.
const remoteHas = (key) => (SECRETS.has(key) ? remoteSecrets : remoteVariables).has(key);

// List the names (not values) of an environment's secrets or variables. Returns
// an empty Set when the environment doesn't exist yet or the call fails.
function listRemote(kind, envName) {
  const res = run('gh', [kind, 'list', '--env', envName, '--json', 'name']);
  if (res.status !== 0) return new Set();
  try {
    return new Set((JSON.parse(res.stdout) || []).map((e) => e.name));
  } catch (_) {
    return new Set();
  }
}

// Minimal .env parser: KEY=VALUE per line; skips blanks/comments; strips a
// trailing " # comment" on unquoted values and surrounding quotes on quoted ones.
function parseEnvFile(file) {
  const map = {};
  for (let line of fs.readFileSync(file, 'utf8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (/^["']/.test(val)) {
      const quote = val[0];
      const end = val.indexOf(quote, 1);
      val = end !== -1 ? val.slice(1, end) : val.slice(1);
    } else {
      val = val.replace(/\s+#.*$/, '').trim();
    }
    map[key] = val;
  }
  return map;
}

// Update KEY= lines in place so the template's comments are preserved.
function writeBack(file, updates) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(updates)) {
    if (!v) continue;
    const re = new RegExp(`^(\\s*${k}\\s*=).*$`, 'm');
    if (re.test(text)) text = text.replace(re, (_m, p1) => p1 + v);
    else text += `\n${k}=${v}\n`;
  }
  fs.writeFileSync(file, text, { mode: 0o600 });
}

function mask(value) {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

// ── Auto-fetch helpers ───────────────────────────────────────────────────────
// Each is best-effort: on failure it warns and leaves the value blank, so the
// validation step gives the user a clear "fill this in" message.

function fetchVercelIds(vars, fetched) {
  // VERCEL_PROJECT_ID is environment-specific (staging vs prod differ) — must be
  // set explicitly in the env file. Never auto-fill it from .vercel/project.json
  // as that would silently deploy the wrong project.
  if (vars.VERCEL_ORG_ID) return;
  if (!fs.existsSync(VERCEL_PROJECT_JSON)) {
    console.warn('⚠️  .vercel/project.json not found — fill VERCEL_ORG_ID by hand.');
    return;
  }
  try {
    const { orgId } = JSON.parse(fs.readFileSync(VERCEL_PROJECT_JSON, 'utf8'));
    if (!vars.VERCEL_ORG_ID && orgId) { vars.VERCEL_ORG_ID = orgId; fetched.VERCEL_ORG_ID = orgId; }
  } catch (e) {
    console.warn(`⚠️  Could not read Vercel org ID from .vercel/project.json: ${e.message}`);
  }
}

function fetchSupabaseKey(vars, fetched) {
  if (vars.VITE_SUPABASE_KEY) return;
  if (!vars.SUPABASE_PROJECT_REF || !vars.SUPABASE_ACCESS_TOKEN) return;
  const res = run('npx', ['--prefix', 'frontend', 'supabase', 'projects', 'api-keys',
    '--project-ref', vars.SUPABASE_PROJECT_REF, '--output', 'json'],
    { env: { ...process.env, SUPABASE_ACCESS_TOKEN: vars.SUPABASE_ACCESS_TOKEN } });
  if (res.status !== 0) {
    console.warn(`⚠️  Could not fetch the Supabase publishable key (fill VITE_SUPABASE_KEY by hand):\n${(res.stderr || '').trim()}`);
    return;
  }
  try {
    const keys = JSON.parse(res.stdout);
    const publishable = keys.find((k) => String(k.api_key).startsWith('sb_publishable_'));
    const anon = keys.find((k) => k.name === 'anon');
    const chosen = (publishable || anon)?.api_key;
    if (chosen) { vars.VITE_SUPABASE_KEY = chosen; fetched.VITE_SUPABASE_KEY = chosen; }
  } catch (e) {
    console.warn(`⚠️  Could not parse Supabase api-keys output: ${e.message}`);
  }
}

// Money-critical: never auto-pick which price is "basic" vs "pro". Just list them.
function hintStripePrices(vars) {
  if (vars.STRIPE_PRICE_BASIC && vars.STRIPE_PRICE_FISCAL_AGENT) return;
  if (!vars.STRIPE_SECRET_KEY) return;
  const res = run('stripe', ['prices', 'list', '--api-key', vars.STRIPE_SECRET_KEY, '--limit', '100']);
  if (res.status !== 0) return;
  try {
    const prices = (JSON.parse(res.stdout).data || []).filter((p) => p.active);
    if (!prices.length) return;
    console.log('\nℹ️  Live prices — set STRIPE_PRICE_BASIC / STRIPE_PRICE_FISCAL_AGENT to the right ids yourself:');
    for (const p of prices) {
      const amount = p.unit_amount != null ? `${(p.unit_amount / 100).toFixed(2)} ${p.currency}` : '—';
      console.log(`     ${p.id}  ${amount}  product=${p.product}  ${p.nickname || ''}`);
    }
    console.log('');
  } catch (_) { /* ignore */ }
}

function resolve(vars) {
  const fetched = {};
  // Derive the Supabase URL from the ref (no network needed).
  if (!vars.VITE_SUPABASE_URL && vars.SUPABASE_PROJECT_REF) {
    vars.VITE_SUPABASE_URL = `https://${vars.SUPABASE_PROJECT_REF}.supabase.co`;
    fetched.VITE_SUPABASE_URL = vars.VITE_SUPABASE_URL;
  }
  fetchVercelIds(vars, fetched);
  fetchSupabaseKey(vars, fetched);
  hintStripePrices(vars);

  const names = Object.keys(fetched);
  if (names.length) {
    console.log('🔍 Auto-filled:');
    for (const k of names) console.log(`   ${k} = ${SECRETS.has(k) ? mask(fetched[k]) : fetched[k]}`);
    console.log('');
  }
  return fetched;
}

// ── Preflight ────────────────────────────────────────────────────────────────
// Hard-fail up front if a CLI the run will actually use is missing or not
// authenticated, instead of letting resolve()'s soft warnings leave gaps.
//   gh       — always (it performs every push)
//   supabase — only when auto-fetch is on and VITE_SUPABASE_KEY is blank
// Credentials are validated with a cheap read-only call using the env-file
// token/key, so "signed in" means the token actually works — not just present.
function toolInstalled(cmd, versionArgs) {
  const res = run(cmd, versionArgs, { stdio: 'ignore' });
  return res.status === 0;
}

function preflight(vars) {
  const problems = [];

  // gh — always required, and a prerequisite for reading the environment below.
  if (!toolInstalled('gh', ['--version'])) {
    problems.push('• GitHub CLI (`gh`) is not installed — https://cli.github.com');
  } else if (run('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    problems.push('• GitHub CLI is not logged in — run `gh auth login`.');
  }
  if (problems.length) {
    console.error('❌ Preflight failed:\n' + problems.join('\n') + '\n');
    return false;
  }

  // gh works — load what the environment already holds so we can skip auto-fetch
  // and credential checks for anything the user didn't re-supply locally.
  remoteSecrets = listRemote('secret', ENV_NAME);
  remoteVariables = listRemote('variable', ENV_NAME);

  // The Supabase CLI is only used by the auto-fetch path — and only when the
  // publishable key is absent both locally and in the environment.
  if (STAGE_DEF.autoFetch) {
    // supabase — only needed to fetch the publishable key.
    if (!vars.VITE_SUPABASE_KEY?.trim()) {
      if (!toolInstalled('npx', ['--prefix', 'frontend', 'supabase', '--version'])) {
        problems.push('• Supabase CLI is unavailable — run `npm install --prefix frontend`.');
      } else if (vars.SUPABASE_ACCESS_TOKEN?.trim()) {
        const res = run('npx', ['--prefix', 'frontend', 'supabase', 'projects', 'list', '--output', 'json'],
          { env: { ...process.env, SUPABASE_ACCESS_TOKEN: vars.SUPABASE_ACCESS_TOKEN }, stdio: 'ignore' });
        if (res.status !== 0) {
          problems.push('• SUPABASE_ACCESS_TOKEN is invalid/expired — mint one at https://supabase.com/dashboard/account/tokens');
        }
      }
    }
  }

  if (problems.length) {
    console.error('❌ Preflight failed:\n' + problems.join('\n') + '\n');
    return false;
  }
  console.log('✅ Preflight OK — required CLIs installed and authenticated.\n');
  return true;
}

function main() {
  console.log('====================================================');
  console.log(`🔐 Sync ${STAGE} config → GitHub \`${ENV_NAME}\` environment`);
  console.log('====================================================\n');

  // Scaffold the file from the committed template on first run.
  if (!fs.existsSync(ENV_FILE)) {
    if (!fs.existsSync(EXAMPLE_FILE)) {
      console.error(`❌ Template not found: ${path.relative(process.cwd(), EXAMPLE_FILE)}`);
      process.exitCode = 1;
      return;
    }
    fs.mkdirSync(DEPLOY_DIR, { recursive: true });
    fs.copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log(`📝 Created ${path.relative(process.cwd(), ENV_FILE)} from the template.`);
    console.log('   Fill in the values, then run this again.\n');
    return;
  }
  const vars = parseEnvFile(ENV_FILE);

  // Fail fast if a CLI we're about to use is missing or not authenticated.
  if (!preflight(vars)) {
    process.exitCode = 1;
    return;
  }

  // Auto-fetch everything we safely can (staging/production only), then persist
  // it back to the file so the derived values stick.
  if (STAGE_DEF.autoFetch) {
    const fetched = resolve(vars);
    if (!dryRun && Object.keys(fetched).length) writeBack(ENV_FILE, fetched);
  }

  // Warn on unknown keys (typos), then validate required values are present.
  const known = new Set([...SECRETS, ...VARIABLES]);
  for (const key of Object.keys(vars)) {
    if (!known.has(key)) console.warn(`⚠️  Ignoring unrecognized key: ${key}`);
  }
  // A required key is satisfied if it's supplied locally OR already stored in the
  // environment. Only error on keys missing from both.
  const missing = [...known].filter((k) => !OPTIONAL.has(k) && !vars[k]?.trim() && !remoteHas(k));
  if (missing.length) {
    const src = path.relative(process.cwd(), ENV_FILE);
    console.error(
      `\n❌ Missing required values — not in ${src} and not already set in the \`${ENV_NAME}\` GitHub environment: ${missing.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  // Anything blank locally but already in the environment is kept as-is.
  const reused = [...known].filter((k) => !vars[k]?.trim() && remoteHas(k));
  if (reused.length) {
    console.log(`ℹ️  Keeping ${reused.length} value(s) already in \`${ENV_NAME}\` (not supplied locally): ${reused.join(', ')}\n`);
  }

  // Money-critical: Basic and Pro must be distinct prices. A shared id means one
  // tier is silently billing at the other's rate — refuse rather than deploy it.
  // (Only the staging/production schema carries these keys.)
  if (vars.STRIPE_PRICE_BASIC && vars.STRIPE_PRICE_FISCAL_AGENT &&
      vars.STRIPE_PRICE_BASIC.trim() === vars.STRIPE_PRICE_FISCAL_AGENT.trim()) {
    console.error(
      `\n❌ STRIPE_PRICE_BASIC and STRIPE_PRICE_FISCAL_AGENT are the same id (${vars.STRIPE_PRICE_BASIC}).\n` +
      '   Set two distinct Stripe price ids before deploying.'
    );
    process.exitCode = 1;
    return;
  }

  // Ensure the target environment exists (gh auth already verified in preflight).
  if (!dryRun) {
    // Check first and only create when missing —
    // a blind PUT would reset protection rules (required reviewers) on an existing env.
    const exists = run('gh', ['api', `repos/{owner}/{repo}/environments/${ENV_NAME}`], { stdio: 'ignore' });
    if (exists.status !== 0) {
      console.log(`ℹ️  Creating the \`${ENV_NAME}\` environment…`);
      const create = run('gh', ['api', '-X', 'PUT', `repos/{owner}/{repo}/environments/${ENV_NAME}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      if (create.status !== 0) {
        console.error(`❌ Could not create the \`${ENV_NAME}\` environment:\n${(create.stderr || '').trim()}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  // Push every present key to its destination kind.
  const pushed = [];
  for (const key of [...known]) {
    const value = vars[key]?.trim();
    if (!value) continue; // optional + blank → skip
    const kind = SECRETS.has(key) ? 'secret' : 'variable';

    if (dryRun) {
      console.log(`   [dry-run] ${kind.padEnd(8)} ${key} = ${mask(value)}`);
      continue;
    }

    // Value is passed on stdin so it never lands in argv / process listings.
    const res = run('gh', [kind, 'set', key, '--env', ENV_NAME], { input: value, stdio: ['pipe', 'ignore', 'pipe'] });
    if (res.status !== 0) {
      console.error(`❌ Failed to set ${kind} ${key}:\n${(res.stderr || '').trim()}`);
      process.exitCode = 1;
      return;
    }
    console.log(`   ✅ ${kind.padEnd(8)} ${key}`);
    pushed.push(key);
  }

  if (dryRun) {
    console.log('\nDry run only — nothing was changed.');
    return;
  }

  console.log(`\n🎉 Synced ${pushed.length} keys to the GitHub \`${ENV_NAME}\` environment.`);
  console.log('\n🔎 Current environment contents:');
  run('gh', ['secret', 'list', '--env', ENV_NAME], { stdio: 'inherit' });
  run('gh', ['variable', 'list', '--env', ENV_NAME], { stdio: 'inherit' });

  const rel = path.relative(process.cwd(), ENV_FILE);
  if (keep) {
    console.log(`\n💡 Kept ${rel} (--keep). It holds live secrets — store it safely.`);
  } else {
    fs.rmSync(ENV_FILE, { force: true });
    console.log(`\n🧹 Shredded ${rel} — no live secrets left on disk. (Use --keep to retain it.)`);
  }
}

main();
