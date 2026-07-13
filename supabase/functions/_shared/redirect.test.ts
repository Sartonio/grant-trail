// Security unit test for the return-origin allowlist. The wildcard match is the
// open-redirect boundary — these asserts fail loudly if a lookalike host slips
// through or the fallback stops defaulting to APP_URL.
//
// Run:  deno test supabase/functions/_shared/redirect.test.ts
import { isOriginAllowed, parseAllowedOrigins, requireHttpOrigin, resolveAppOrigin } from './redirect.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DEFAULT = 'https://grant-trail.vercel.app';
// The wildcard uses the ACTUAL Vercel preview shape: one hyphen-joined label
// (project-hash-scope) under vercel.app, with the account scope as the trailing
// segment.
const ALLOWED = parseAllowedOrigins(
  ' https://grant-trail.vercel.app , https://*-programmer484s-projects.vercel.app/ ',
);
const PREVIEW = 'https://grant-trail-brdbksyks-programmer484s-projects.vercel.app';

Deno.test('parseAllowedOrigins trims, drops trailing slash and empties', () => {
  assert(ALLOWED.length === 2, 'expected 2 entries');
  assert(ALLOWED[1] === 'https://*-programmer484s-projects.vercel.app', 'trailing slash not stripped');
  assert(parseAllowedOrigins(undefined).length === 0, 'undefined -> []');
  assert(parseAllowedOrigins('').length === 0, 'empty -> []');
});

Deno.test('exact origins and the default are allowed', () => {
  assert(isOriginAllowed(DEFAULT, DEFAULT, ALLOWED), 'default rejected');
  assert(isOriginAllowed('https://grant-trail.vercel.app', DEFAULT, ALLOWED), 'exact rejected');
});

Deno.test('legitimate preview URL matches the wildcard', () => {
  assert(isOriginAllowed(PREVIEW, DEFAULT, ALLOWED), 'real preview rejected');
});

Deno.test('lookalike and malicious origins are rejected', () => {
  const bad = [
    '', // empty
    'https://attacker-com.vercel.app', // wrong scope
    'https://x-programmer484s-projects.vercel.app.attacker.com', // scope in middle, attacker suffix
    'https://x-programmer484s-projects.vercel.app.evil', // trailing junk breaks the anchor
    'http://x-programmer484s-projects.vercel.app', // http, not https
    'https://x-programmer484s-projects.vercel.app:1234', // port smuggling
    'https://evil.com-programmer484s-projects.vercel.app', // dot in the wildcard region
    'https://x-programmer484s-projects.evil.app', // different apex
    'https://attacker.com', // unrelated
  ];
  for (const origin of bad) {
    assert(!isOriginAllowed(origin, DEFAULT, ALLOWED), `should reject: ${origin}`);
  }
});

Deno.test('requireHttpOrigin accepts full http(s) URLs and returns the bare origin', () => {
  assert(requireHttpOrigin('APP_URL', 'https://www.atkasolutions.org') === 'https://www.atkasolutions.org', 'https origin');
  assert(requireHttpOrigin('APP_URL', 'https://www.atkasolutions.org/') === 'https://www.atkasolutions.org', 'trailing slash stripped');
  assert(requireHttpOrigin('APP_URL', 'https://host/path?q=1') === 'https://host', 'path/query dropped');
  assert(requireHttpOrigin('APP_URL', 'http://localhost:3000') === 'http://localhost:3000', 'localhost with port');
});

Deno.test('requireHttpOrigin rejects scheme-less / non-http values (the prod url_invalid bug)', () => {
  const bad = ['www.atkasolutions.org', 'atkasolutions.org', '', 'ftp://host', '//host'];
  for (const raw of bad) {
    let threw = false;
    try {
      requireHttpOrigin('APP_URL', raw);
    } catch {
      threw = true;
    }
    assert(threw, `should reject: "${raw}"`);
  }
});

Deno.test('resolveAppOrigin falls back to default for untrusted/omitted', () => {
  assert(resolveAppOrigin(undefined, DEFAULT, ALLOWED) === DEFAULT, 'undefined -> default');
  assert(resolveAppOrigin('https://attacker.com', DEFAULT, ALLOWED) === DEFAULT, 'untrusted -> default');
  assert(resolveAppOrigin(PREVIEW, DEFAULT, ALLOWED) === PREVIEW, 'trusted preview passed through');
});
