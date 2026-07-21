// Fail-fast guard: the e2e fixtures need the local stack's credentials, which
// are deliberately NOT in .env.local (browser-safe values only). Without them,
// every spec used to die in beforeAll with an identical, cryptic
// "supabaseKey is required" — 36 stack traces that all mean "you invoked
// Playwright directly". Catch it here, once, with the fix in the message.
//
// The supported entry points export these automatically from
// `supabase status -o env` (verify-lib's vf_export_stack_env):
//   npm run e2e         -- fast path, stack must already be running
//   npm run verify:e2e  -- full gate: lock + boot + db reset + suite
//   npm run verify:full -- everything
module.exports = async () => {
  const required = ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_KEY'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(
      `Local-stack env missing: ${missing.join(', ')}.\n` +
      `Run the suite via "npm run e2e" (stack already up) or "npm run verify:e2e" ` +
      `(boots + resets) from the repo root — both export these from the running ` +
      `stack. To invoke Playwright directly, export them yourself from ` +
      `"npx supabase status -o env" (SERVICE_ROLE_KEY / API_URL / ANON_KEY).`
    );
  }
};
