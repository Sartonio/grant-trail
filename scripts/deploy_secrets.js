const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Sync production config → the GitHub `production` environment.
//
// One source of truth: `.deploy/prod.env` (git-ignored). You mint the three
// account-level tokens by hand (Supabase / Stripe / Vercel) and pick the project
// ref + app URL; this script auto-fetches everything else it safely can, then
// pushes each key into the GitHub environment as a Secret or Variable. The
// "Deploy to Production" workflow is the ONLY consumer.
//
//   npm run deploy:secrets              fetch + push, then delete the local file
//   npm run deploy:secrets -- --keep    keep .deploy/prod.env on disk afterward
//   npm run deploy:secrets -- --dry-run show what would happen, change nothing
//   npm run deploy:secrets -- --recreate-webhook  delete + recreate the Stripe endpoint
// ─────────────────────────────────────────────────────────────────────────────

const ENV_NAME = 'production';
const REPO_ROOT = path.join(__dirname, '..');
const DEPLOY_DIR = path.join(REPO_ROOT, '.deploy');
const ENV_FILE = path.join(DEPLOY_DIR, 'prod.env');
const EXAMPLE_FILE = path.join(REPO_ROOT, 'deploy', 'prod.env.example');
const VERCEL_PROJECT_JSON = path.join(REPO_ROOT, '.vercel', 'project.json');

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
];

// Keys stored as GitHub Actions *secrets* (masked). Everything else is a *variable*.
const SECRETS = new Set([
  'SUPABASE_ACCESS_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  'RESEND_API_KEY',
]);

const VARIABLES = new Set([
  'SUPABASE_PROD_PROJECT_REF',
  'STRIPE_PRICE_BASIC',
  'STRIPE_PRICE_PRO',
  'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
  'APP_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_KEY',
  'VITE_SENTRY_DSN',
  'RESEND_FROM_EMAIL',
]);

// Keys allowed to be blank after auto-fetch.
const OPTIONAL = new Set([
  'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
  'VITE_SENTRY_DSN',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
]);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keep = args.includes('--keep');
const recreateWebhook = args.includes('--recreate-webhook');

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
  if (!vars.SUPABASE_PROD_PROJECT_REF || !vars.SUPABASE_ACCESS_TOKEN) return;
  const res = run('npx', ['--prefix', 'frontend', 'supabase', 'projects', 'api-keys',
    '--project-ref', vars.SUPABASE_PROD_PROJECT_REF, '--output', 'json'],
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
  if (!vars.SUPABASE_PROD_PROJECT_REF || !vars.STRIPE_SECRET_KEY) return;
  const url = `https://${vars.SUPABASE_PROD_PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;
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
  if (!vars.VITE_SUPABASE_URL && vars.SUPABASE_PROD_PROJECT_REF) {
    vars.VITE_SUPABASE_URL = `https://${vars.SUPABASE_PROD_PROJECT_REF}.supabase.co`;
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

function main() {
  console.log('====================================================');
  console.log('🔐 Sync production config → GitHub `production` env');
  console.log('====================================================\n');

  // Scaffold the file from the committed template on first run.
  if (!fs.existsSync(ENV_FILE)) {
    fs.mkdirSync(DEPLOY_DIR, { recursive: true });
    fs.copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log(`📝 Created ${path.relative(process.cwd(), ENV_FILE)} from the template.`);
    console.log('   Fill in the 3 tokens + project ref + app URL + price ids, then run this again.\n');
    return;
  }

  const vars = parseEnvFile(ENV_FILE);

  // Auto-fetch everything we safely can, then persist it back into the file.
  const fetched = resolve(vars);
  if (!dryRun && Object.keys(fetched).length) writeBack(ENV_FILE, fetched);

  // Warn on unknown keys (typos), then validate required values are present.
  const known = new Set([...SECRETS, ...VARIABLES]);
  for (const key of Object.keys(vars)) {
    if (!known.has(key)) console.warn(`⚠️  Ignoring unrecognized key: ${key}`);
  }
  const missing = [...known].filter((k) => !OPTIONAL.has(k) && !vars[k]?.trim());
  if (missing.length) {
    console.error(`\n❌ Still missing values in ${path.relative(process.cwd(), ENV_FILE)}: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Preflight: gh must be authenticated and pointed at a repo.
  if (!dryRun) {
    const auth = run('gh', ['auth', 'status'], { stdio: 'ignore' });
    if (auth.status !== 0) {
      console.error('❌ GitHub CLI is not logged in. Run `gh auth login`, then re-run.');
      process.exitCode = 1;
      return;
    }

    // Ensure the environment exists. Check first and only create when missing —
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

  if (keep) {
    console.log('\n💡 Kept .deploy/prod.env (--keep). It holds live secrets — store it safely.');
  } else {
    fs.rmSync(ENV_FILE, { force: true });
    console.log('\n🧹 Shredded .deploy/prod.env — no live secrets left on disk. (Use --keep to retain it.)');
  }

  console.log('\nNext: GitHub → Actions → "Deploy to Production" → Run workflow → approve.');
}

main();
