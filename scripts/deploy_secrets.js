const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Sync production config → the GitHub `production` environment.
//
// One source of truth: `.deploy/prod.env` (git-ignored). This script pushes
// every key into the GitHub environment as a Secret or Variable. The
// "Deploy to Production" workflow is the ONLY consumer — it sets Supabase
// secrets and injects the Vite build vars from there. No dashboard clicking.
//
//   npm run deploy:secrets            push everything
//   npm run deploy:secrets -- --dry-run   show what would be pushed, change nothing
//   npm run deploy:secrets -- --shred     delete .deploy/prod.env after a successful push
// ─────────────────────────────────────────────────────────────────────────────

const ENV_NAME = 'production';
const DEPLOY_DIR = path.join(__dirname, '..', '.deploy');
const ENV_FILE = path.join(DEPLOY_DIR, 'prod.env');
const EXAMPLE_FILE = path.join(__dirname, '..', 'deploy', 'prod.env.example');

// Keys stored as GitHub Actions *secrets* (masked). Everything else is a *variable*.
const SECRETS = new Set([
  'SUPABASE_ACCESS_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
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
]);

// Keys allowed to be blank. Everything else must have a value.
const OPTIONAL = new Set([
  'STRIPE_BILLING_PORTAL_CONFIGURATION_ID',
  'VITE_SENTRY_DSN',
  'VITE_SUPABASE_URL', // derived from SUPABASE_PROD_PROJECT_REF when blank
]);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const shred = args.includes('--shred');

const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { ...opts });

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

function mask(value) {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
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
    console.log('   Fill in the values, then run this again.\n');
    return;
  }

  const vars = parseEnvFile(ENV_FILE);

  // Derive VITE_SUPABASE_URL from the project ref if it was left blank.
  if (!vars.VITE_SUPABASE_URL && vars.SUPABASE_PROD_PROJECT_REF) {
    vars.VITE_SUPABASE_URL = `https://${vars.SUPABASE_PROD_PROJECT_REF}.supabase.co`;
    console.log(`ℹ️  Derived VITE_SUPABASE_URL = ${vars.VITE_SUPABASE_URL}\n`);
  }

  // Warn on unknown keys (typos), then validate required values are present.
  const known = new Set([...SECRETS, ...VARIABLES]);
  for (const key of Object.keys(vars)) {
    if (!known.has(key)) console.warn(`⚠️  Ignoring unrecognized key: ${key}`);
  }
  const missing = [...known].filter((k) => !OPTIONAL.has(k) && !vars[k]?.trim());
  if (missing.length) {
    console.error(`\n❌ Missing values in ${path.relative(process.cwd(), ENV_FILE)}: ${missing.join(', ')}`);
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

    // Ensure the environment exists so first-time setup needs no manual GitHub
    // dashboard step. Check first and only create when missing — a blind PUT
    // would reset protection rules (required reviewers) on an existing env.
    const exists = run('gh', ['api', `repos/{owner}/{repo}/environments/${ENV_NAME}`], { stdio: 'ignore' });
    if (exists.status !== 0) {
      console.log(`ℹ️  Creating the \`${ENV_NAME}\` environment…`);
      const create = run('gh', ['api', '-X', 'PUT', `repos/{owner}/{repo}/environments/${ENV_NAME}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      if (create.status !== 0) {
        console.error(`❌ Could not create the \`${ENV_NAME}\` environment:\n${(create.stderr || '').toString().trim()}`);
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
      console.error(`❌ Failed to set ${kind} ${key}:\n${(res.stderr || '').toString().trim()}`);
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

  if (shred) {
    fs.rmSync(ENV_FILE, { force: true });
    console.log('\n🧹 Shredded .deploy/prod.env (re-create from deploy/prod.env.example next time).');
  } else {
    console.log('\n💡 .deploy/prod.env kept as your editable source of truth. Re-run anytime; it is idempotent.');
    console.log('   (Pass --shred to delete it after pushing.)');
  }

  console.log('\nNext: GitHub → Actions → "Deploy to Production" → Run workflow → approve.');
}

main();
