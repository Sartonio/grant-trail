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
// URL + publishable key, Vercel ids, Stripe webhook secret), validates required
// values, and refuses if the Basic/Pro prices collide. For `ci` it only handles
// the three Stripe *_TEST secrets — no auto-fetch, no preflight CLIs beyond gh.
//
// The matching GitHub workflow is the ONLY consumer of these values.
//
//   npm run deploy:secrets                  → production
//   npm run deploy:secrets:staging          → staging
//   npm run deploy:secrets:ci               → ci
//   node scripts/deploy_secrets.js --env staging
//   ... -- --keep              keep the local .deploy/<stage>.env afterward
//   ... -- --dry-run           show what would happen, change nothing
//   ... -- --recreate-webhook  delete + recreate the Stripe endpoint (prod/staging)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(REPO_ROOT, '.deploy');
const VERCEL_PROJECT_JSON = path.join(REPO_ROOT, '.vercel', 'project.json');

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

// ── Stage definitions ────────────────────────────────────────────────────────
// Each stage names its GitHub-Actions secret + variable key sets, plus the keys
// allowed to be blank after auto-fetch. `staging`/`production` share an identical
// schema (same key names, different values); `ci` is secrets-only.
const STAGES = {
  ci: {
    secrets: ['STRIPE_SECRET_KEY_TEST', 'STRIPE_PRICE_BASIC_TEST', 'STRIPE_PRICE_PRO_TEST'],
    variables: [],
    optional: [],
    autoFetch: false,
  },
  staging: {
    secrets: [
      'SUPABASE_ACCESS_TOKEN',
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
      'STRIPE_PRICE_PRO',
      'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
      'APP_URL',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_KEY',
      'VITE_SENTRY_DSN',
      'RESEND_FROM_EMAIL',
    ],
    optional: [
      'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
      'VITE_SENTRY_DSN',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
    ],
    autoFetch: true,
  },
};
// production shares staging's schema exactly.
STAGES.production = { ...STAGES.staging };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keep = args.includes('--keep');
const recreateWebhook = args.includes('--recreate-webhook');

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
  if (vars.VERCEL_ORG_ID && vars.VERCEL_PROJECT_ID) return;
  if (!fs.existsSync(VERCEL_PROJECT_JSON)) {
    console.warn('⚠️  .vercel/project.json not found — run `npx vercel link`, or fill VERCEL_ORG_ID/VERCEL_PROJECT_ID by hand.');
    return;
  }
  try {
    const { orgId, projectId } = JSON.parse(fs.readFileSync(VERCEL_PROJECT_JSON, 'utf8'));
    if (!vars.VERCEL_ORG_ID && orgId) { vars.VERCEL_ORG_ID = orgId; fetched.VERCEL_ORG_ID = orgId; }
    if (!vars.VERCEL_PROJECT_ID && projectId) { vars.VERCEL_PROJECT_ID = projectId; fetched.VERCEL_PROJECT_ID = projectId; }
  } catch (e) {
    console.warn(`⚠️  Could not read Vercel IDs from .vercel/project.json: ${e.message}`);
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

function fetchStripeWebhookSecret(vars, fetched) {
  if (vars.STRIPE_WEBHOOK_SECRET) return;
  if (!vars.SUPABASE_PROJECT_REF || !vars.STRIPE_SECRET_KEY) return;
  const url = `https://${vars.SUPABASE_PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;
  const apiKey = vars.STRIPE_SECRET_KEY;

  // Does an endpoint for this URL already exist?
  const list = run('stripe', ['webhook_endpoints', 'list', '--api-key', apiKey, '--limit', '100']);
  let existing = null;
  if (list.status === 0) {
    try { existing = (JSON.parse(list.stdout).data || []).find((e) => e.url === url) || null; } catch (_) { /* ignore */ }
  }

  if (existing && !recreateWebhook) {
    console.warn(
      `⚠️  A Stripe webhook for ${url} already exists (id ${existing.id}).\n` +
      "    Stripe never re-reveals a signing secret, so it can't be fetched. Either paste\n" +
      '    the stored STRIPE_WEBHOOK_SECRET into the file, or re-run with --recreate-webhook.'
    );
    return;
  }

  if (dryRun) {
    console.log(`   [dry-run] would ${existing ? 'recreate' : 'create'} the Stripe webhook at ${url}`);
    return;
  }

  if (existing && recreateWebhook) {
    run('stripe', ['webhook_endpoints', 'delete', existing.id, '--api-key', apiKey, '--confirm']);
  }

  const createArgs = ['webhook_endpoints', 'create', '--api-key', apiKey, '--url', url];
  for (const ev of WEBHOOK_EVENTS) createArgs.push('--enabled-events', ev);
  const created = run('stripe', createArgs);
  if (created.status !== 0) {
    console.warn(`⚠️  Could not create the Stripe webhook (fill STRIPE_WEBHOOK_SECRET by hand):\n${(created.stderr || '').trim()}`);
    return;
  }
  try {
    const secret = JSON.parse(created.stdout).secret;
    if (secret) { vars.STRIPE_WEBHOOK_SECRET = secret; fetched.STRIPE_WEBHOOK_SECRET = secret; }
  } catch (e) {
    console.warn(`⚠️  Created the webhook but could not parse its secret: ${e.message}`);
  }
}

// Money-critical: never auto-pick which price is "basic" vs "pro". Just list them.
function hintStripePrices(vars) {
  if (vars.STRIPE_PRICE_BASIC && vars.STRIPE_PRICE_PRO) return;
  if (!vars.STRIPE_SECRET_KEY) return;
  const res = run('stripe', ['prices', 'list', '--api-key', vars.STRIPE_SECRET_KEY, '--limit', '100']);
  if (res.status !== 0) return;
  try {
    const prices = (JSON.parse(res.stdout).data || []).filter((p) => p.active);
    if (!prices.length) return;
    console.log('\nℹ️  Live prices — set STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO to the right ids yourself:');
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
  fetchStripeWebhookSecret(vars, fetched);
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
//   stripe   — only when auto-fetch is on and STRIPE_WEBHOOK_SECRET is blank
// Credentials are validated with a cheap read-only call using the env-file
// token/key, so "signed in" means the token actually works — not just present.
function toolInstalled(cmd, versionArgs) {
  const res = run(cmd, versionArgs, { stdio: 'ignore' });
  return res.status === 0;
}

function preflight(vars) {
  const problems = [];

  // gh — always required.
  if (!toolInstalled('gh', ['--version'])) {
    problems.push('• GitHub CLI (`gh`) is not installed — https://cli.github.com');
  } else if (run('gh', ['auth', 'status'], { stdio: 'ignore' }).status !== 0) {
    problems.push('• GitHub CLI is not logged in — run `gh auth login`.');
  }

  // The Supabase / Stripe CLIs are only used by the auto-fetch path.
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

    // stripe — only needed to create the webhook endpoint.
    if (!vars.STRIPE_WEBHOOK_SECRET?.trim()) {
      if (!toolInstalled('stripe', ['version'])) {
        problems.push('• Stripe CLI is not installed — https://docs.stripe.com/stripe-cli#install');
      } else if (vars.STRIPE_SECRET_KEY?.trim()) {
        const res = run('stripe', ['prices', 'list', '--limit', '1', '--api-key', vars.STRIPE_SECRET_KEY],
          { stdio: 'ignore' });
        if (res.status !== 0) {
          problems.push('• STRIPE_SECRET_KEY is invalid — check https://dashboard.stripe.com/apikeys');
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
  const missing = [...known].filter((k) => !OPTIONAL.has(k) && !vars[k]?.trim());
  if (missing.length) {
    const src = path.relative(process.cwd(), ENV_FILE);
    console.error(`\n❌ Still missing values in ${src}: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Money-critical: Basic and Pro must be distinct prices. A shared id means one
  // tier is silently billing at the other's rate — refuse rather than deploy it.
  // (Only the staging/production schema carries these keys.)
  if (vars.STRIPE_PRICE_BASIC && vars.STRIPE_PRICE_PRO &&
      vars.STRIPE_PRICE_BASIC.trim() === vars.STRIPE_PRICE_PRO.trim()) {
    console.error(
      `\n❌ STRIPE_PRICE_BASIC and STRIPE_PRICE_PRO are the same id (${vars.STRIPE_PRICE_BASIC}).\n` +
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
