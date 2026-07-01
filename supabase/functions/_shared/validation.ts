// Shared input validation for Edge Functions.
//
// Edge Functions are authenticated (verify_jwt) but must still treat the request
// body as untrusted: a valid user can craft arbitrary payloads. These helpers
// validate required inputs and surface a clear, client-facing 400 via
// `ValidationError` — which the function handlers distinguish from internal
// failures so bad input is not logged as a critical incident.
//
// Note on ownership: the billing functions never trust user-supplied identifiers.
// They derive the acting user from the verified JWT (see
// `requireAuthenticatedProfile`) and look up Stripe customer / membership rows by
// that server-resolved id, so there is no IDOR surface to validate here.

/** Thrown for invalid client input. Maps to an HTTP 400 with a clear message. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when the caller has no valid authenticated profile. Maps to an HTTP 401. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Reject anything that isn't a POST (handlers answer OPTIONS separately). */
export function assertPostRequest(request: Request): void {
  if (request.method !== 'POST') {
    throw new ValidationError(`Unsupported method ${request.method}; expected POST.`);
  }
}

/**
 * Parse the JSON request body. An empty body is treated as `{}` (these endpoints
 * have only optional fields), but a present-yet-malformed body is rejected so the
 * caller gets a clear 400 instead of silently falling back to defaults.
 */
export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (!raw || raw.trim() === '') {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

const MAX_RETURN_PATH_LENGTH = 512;
// Control characters (incl. CR/LF) and DEL — rejected to avoid URL/header injection.
// deno-lint-ignore no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/**
 * Validate a post-checkout return path. Must be a same-origin relative path so it
 * cannot be abused as an open redirect. Returns the default `'/'` when omitted.
 */
export function validateReturnPath(value: unknown): string {
  if (value === undefined || value === null) {
    return '/';
  }
  if (typeof value !== 'string') {
    throw new ValidationError('returnPath must be a string.');
  }
  if (value.length > MAX_RETURN_PATH_LENGTH) {
    throw new ValidationError('returnPath is too long.');
  }
  if (CONTROL_CHARS.test(value)) {
    throw new ValidationError('returnPath contains invalid characters.');
  }
  // Must be a relative path; reject protocol-relative ("//host") and backslash
  // variants ("/\\host") that some browsers normalise into a cross-origin URL.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    throw new ValidationError('returnPath must be a relative path beginning with "/".');
  }
  return value;
}

/**
 * Structurally validate a client-supplied return origin (the scheme+host the
 * frontend wants Stripe to redirect back to). This only enforces that it's a
 * well-formed bare origin with no path/query/fragment or injection characters —
 * whether it is actually TRUSTED is decided later by the allowlist in
 * `resolveAppOrigin`. Returns `undefined` when omitted.
 */
export function validateReturnOrigin(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('returnOrigin must be a string.');
  }
  if (value.length > 256) {
    throw new ValidationError('returnOrigin is too long.');
  }
  if (CONTROL_CHARS.test(value)) {
    throw new ValidationError('returnOrigin contains invalid characters.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('returnOrigin must be a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('returnOrigin must be an http(s) origin.');
  }
  // Must be a bare origin: no path, query, fragment, or credentials. Reparsing
  // `url.origin` and requiring equality rejects "https://host/evil", auth-in-URL
  // ("https://a@host") and trailing junk in one check.
  if (value !== url.origin) {
    throw new ValidationError('returnOrigin must be a bare origin (scheme + host only).');
  }
  return value;
}

/**
 * Validate a feature key against an allowlist. Returns `fallback` when omitted.
 * Prevents arbitrary user-supplied values from being persisted into Stripe
 * metadata (which downstream subscription syncing reads to derive the tier).
 */
export function validateFeatureKey(
  value: unknown,
  allowed: readonly string[],
  fallback: string,
): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError(
      `featureKey must be one of: ${allowed.join(', ')}.`,
    );
  }
  return value;
}
