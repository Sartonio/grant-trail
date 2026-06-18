#!/usr/bin/env node
//
// prune_functions.js — delete Edge Functions deployed to a Supabase project
// that are NO LONGER declared in supabase/config.toml.
//
// Why this exists: the Supabase GitHub integration deploys every function
// declared in config.toml on merge, but it NEVER deletes a function you've
// removed. A deleted-from-the-repo function keeps running in the project until
// someone prunes it by hand. This script is that hand — it diffs "declared in
// config.toml" against "deployed in the project" and removes the difference.
//
// Safe by design:
//   - Refuses to run if it can't find any declared functions (a parse failure
//     must not be read as "delete everything").
//   - Prints the prune list and asks for confirmation unless --yes is passed.
//   - --dry-run shows what would be deleted and changes nothing.
//
// Usage:
//   node scripts/prune_functions.js --project-ref <ref> [--dry-run] [--yes]
//   npm run functions:prune -- --project-ref <ref> --dry-run
//
// Requires the Supabase CLI to be logged in (`npx supabase login`).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_TOML = path.join(__dirname, '..', 'supabase', 'config.toml');

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { shell: true, encoding: 'utf8', ...opts });

function parseArgs(argv) {
  const args = { ref: null, dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-ref') args.ref = argv[++i];
    else if (a.startsWith('--project-ref=')) args.ref = a.split('=')[1];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
  }
  return args;
}

// Declared functions = the [functions.<name>] table headers in config.toml.
function declaredFunctions() {
  if (!fs.existsSync(CONFIG_TOML)) {
    throw new Error(`Cannot find ${path.relative(process.cwd(), CONFIG_TOML)}.`);
  }
  const declared = [];
  for (const line of fs.readFileSync(CONFIG_TOML, 'utf8').split('\n')) {
    const m = line.match(/^\s*\[functions\.([^\]]+)\]\s*$/);
    if (m) declared.push(m[1].trim());
  }
  return declared;
}

// `supabase functions list -o json` prints a JSON array, but the CLI may append
// an unrelated telemetry line after it — slice to the array before parsing.
function deployedFunctions(ref) {
  const res = run('npx', ['--prefix', 'frontend', 'supabase', 'functions', 'list', '-o', 'json', '--project-ref', ref]);
  if (res.status !== 0) {
    throw new Error(`'supabase functions list' failed (is the CLI logged in?):\n${res.stderr || res.stdout}`);
  }
  const out = res.stdout || '';
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error(`Could not parse functions list output:\n${out}`);
  }
  const parsed = JSON.parse(out.slice(start, end + 1));
  return parsed.map((f) => f.slug || f.name).filter(Boolean);
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ref) {
    throw new Error('Missing --project-ref <ref>. Find it in the Supabase dashboard URL or `supabase projects list`.');
  }

  const declared = declaredFunctions();
  if (declared.length === 0) {
    throw new Error('No [functions.*] entries found in config.toml — refusing to prune (this would look like "delete everything").');
  }

  const deployed = deployedFunctions(args.ref);
  const orphans = deployed.filter((name) => !declared.includes(name));

  console.log(`Declared in config.toml (${declared.length}): ${declared.join(', ')}`);
  console.log(`Deployed in project    (${deployed.length}): ${deployed.join(', ') || '(none)'}`);

  if (orphans.length === 0) {
    console.log('✓ Nothing to prune — every deployed function is still declared.');
    return;
  }

  console.log(`\n⚠️  ${orphans.length} deployed function(s) are NOT declared and will be deleted:`);
  orphans.forEach((name) => console.log(`   - ${name}`));

  if (args.dryRun) {
    console.log('\n--dry-run: no changes made.');
    return;
  }

  if (!args.yes) {
    const ok = await confirm(`\nDelete these ${orphans.length} function(s) from project ${args.ref}? [y/N] `);
    if (!ok) {
      console.log('Aborted — nothing deleted.');
      return;
    }
  }

  let failed = 0;
  for (const name of orphans) {
    process.stdout.write(`Deleting ${name}... `);
    const res = run('npx', ['--prefix', 'frontend', 'supabase', 'functions', 'delete', name, '--project-ref', args.ref]);
    if (res.status === 0) {
      console.log('done.');
    } else {
      console.log('FAILED.');
      console.error(res.stderr || res.stdout);
      failed++;
    }
  }

  if (failed > 0) {
    throw new Error(`${failed} deletion(s) failed.`);
  }
  console.log(`\n✓ Pruned ${orphans.length} function(s).`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
