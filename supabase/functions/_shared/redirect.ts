// Post-checkout return-origin resolution.
//
// The billing functions build Stripe success/cancel/return URLs from a fixed
// server-side base (APP_URL) plus a validated relative return path, so a checkout
// can never be turned into an open redirect. To let Vercel PREVIEW deployments
// return to their own dynamic URL (instead of always bouncing to prod APP_URL),
// the frontend may send its window.location.origin as `returnOrigin`. We honour
// it ONLY if it matches an explicit allowlist — anything else silently falls back
// to APP_URL. The allowlist IS the security boundary; treat it as untrusted input.

/** Parse the comma-separated APP_URL_ALLOWED_ORIGINS env into trimmed entries. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Turn a wildcard allowlist entry into an anchored regex, or null if it has no
 * `*`. Every regex metacharacter is escaped first, then `*` becomes
 * `[a-z0-9-]+` — one or more DNS-label characters, crucially NO dots. That means
 * a `*` can never span a dot to reach another domain, and the literal suffix
 * (e.g. `.vercel.app`) stays anchored at the end. So both Vercel URL shapes work
 * safely:
 *   - `https://*-programmer484s-projects.vercel.app`  (preview: one label,
 *      hyphen-joined project/hash/scope — the actual Vercel format)
 *   - `https://*.programmer484s-projects.vercel.app`  (dot subdomain, if used)
 * and lookalikes are rejected: the trailing `-programmer484s-projects` (or
 * `.…`) is the account scope only your Vercel team can produce.
 */
function wildcardToRegExp(entry: string): RegExp | null {
  if (!entry.includes('*')) return null;
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\\\*/g, '[a-z0-9-]+') + '$', 'i');
}

/**
 * Is `origin` a trusted redirect base?
 * - exact match against the default (APP_URL) or any exact allowlist entry, or
 * - an anchored match against a wildcard entry (see `wildcardToRegExp`). Only
 *   safe when the wildcard's fixed part is an account-scoped host nobody else can
 *   produce (your Vercel team domain) — never a shared host like `vercel.app`.
 */
export function isOriginAllowed(origin: string, defaultOrigin: string, allowed: string[]): boolean {
  if (!origin) return false;
  if (origin === defaultOrigin) return true;
  for (const entry of allowed) {
    if (entry === origin) return true;
    const re = wildcardToRegExp(entry);
    if (re && re.test(origin)) return true;
  }
  return false;
}

/** Trusted candidate → itself; anything else → the default (APP_URL). */
export function resolveAppOrigin(
  candidate: string | undefined,
  defaultOrigin: string,
  allowed: string[],
): string {
  return candidate && isOriginAllowed(candidate, defaultOrigin, allowed) ? candidate : defaultOrigin;
}
