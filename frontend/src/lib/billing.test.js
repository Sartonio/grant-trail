import { describe, it, expect, vi, beforeEach } from 'vitest';

// billing.js reads VITE_SUPABASE_URL/KEY into module-level consts at import
// time, so stub them in vi.hoisted (which runs BEFORE the import) — otherwise
// getExpectedProjectRef() and invokeViaHttp() see empty config.
vi.hoisted(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://testproj.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'anon-test-key');
});

// Supabase auth is the only boundary billing.js touches for the security-
// critical token path; mock it so we can drive refresh/get-session/sign-out.
// vi.hoisted so the mock object exists when the hoisted vi.mock factory runs.
const authMock = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../supabaseClient', () => ({ supabase: { auth: authMock } }));

import {
  decodeJwtPayload,
  getRequiredAccessToken,
  invokeFirstAvailable,
  hasFeature,
  isOrgAdminSubscriptionRequired,
  FEATURE_KEYS,
} from './billing';

// Build a base64url JWT (no '=' padding, '+'→'-', '/'→'_') so decodeJwtPayload's
// re-padding logic is actually exercised, not bypassed.
function makeJwt(payload) {
  const body = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${body}.sig`;
}

// Derived from the stubbed VITE_SUPABASE_URL host (testproj.supabase.co).
const EXPECTED_REF = 'testproj';

beforeEach(() => {
  authMock.refreshSession.mockReset();
  authMock.getSession.mockReset();
  authMock.signOut.mockReset();
  authMock.signOut.mockResolvedValue({});
});

describe('decodeJwtPayload', () => {
  it('round-trips a known payload', () => {
    const payload = { ref: 'abcde', sub: 'user-1', role: 'authenticated' };
    expect(decodeJwtPayload(makeJwt(payload))).toEqual(payload);
  });

  it('decodes correctly across base64url padding lengths (mod 4 = 2 and 3)', () => {
    // Different byte lengths land on different padding remainders; both must
    // decode after re-padding.
    for (const ref of ['ab', 'abc', 'abcd', 'abcde']) {
      expect(decodeJwtPayload(makeJwt({ ref }))).toEqual({ ref });
    }
  });

  it('returns null when there is no payload segment', () => {
    expect(decodeJwtPayload('only-one-segment')).toBeNull();
  });

  it('returns null on non-base64 garbage', () => {
    expect(decodeJwtPayload('header.@@@not-base64@@@.sig')).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    const notJson = Buffer.from('plain text not json').toString('base64')
      .replace(/=+$/, '');
    expect(decodeJwtPayload(`header.${notJson}.sig`)).toBeNull();
  });
});

describe('getRequiredAccessToken', () => {
  it('returns the token when its project ref matches', async () => {
    const token = makeJwt({ ref: EXPECTED_REF });
    authMock.refreshSession.mockResolvedValue({ data: { session: { access_token: token } } });

    await expect(getRequiredAccessToken()).resolves.toBe(token);
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it('signs out and throws when the token ref belongs to a different project', async () => {
    const token = makeJwt({ ref: 'someotherproject' });
    authMock.refreshSession.mockResolvedValue({ data: { session: { access_token: token } } });

    await expect(getRequiredAccessToken()).rejects.toThrow(/different Supabase project/);
    expect(authMock.signOut).toHaveBeenCalledTimes(1);
  });

  it('falls back to getSession when refreshSession yields no token', async () => {
    const token = makeJwt({ ref: EXPECTED_REF });
    authMock.refreshSession.mockResolvedValue({ data: { session: null } });
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: token } } });

    await expect(getRequiredAccessToken()).resolves.toBe(token);
  });

  it('throws when no session exists at all', async () => {
    authMock.refreshSession.mockResolvedValue({ data: { session: null } });
    authMock.getSession.mockResolvedValue({ data: { session: null } });

    await expect(getRequiredAccessToken()).rejects.toThrow(/No active login session/);
    expect(authMock.signOut).not.toHaveBeenCalled();
  });
});

describe('invokeFirstAvailable', () => {
  const makeResp = (body, ok = true, status = 200) => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
  });

  beforeEach(() => {
    // requireAuth:false in these tests -> getOptionalAccessToken -> getSession.
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    global.fetch = vi.fn();
  });

  it('falls through to the second candidate when the first returns no url', async () => {
    global.fetch.mockImplementation((url) =>
      Promise.resolve(url.endsWith('/first') ? makeResp({}) : makeResp({ url: 'https://checkout/2' })),
    );

    const result = await invokeFirstAvailable(['first', 'second'], () => ({}), { requireAuth: false });

    expect(result).toEqual({ url: 'https://checkout/2' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls through when the first candidate throws', async () => {
    global.fetch.mockImplementation((url) =>
      url.endsWith('/first')
        ? Promise.reject(new Error('network down'))
        : Promise.resolve(makeResp({ url: 'https://checkout/2' })),
    );

    const result = await invokeFirstAvailable(['first', 'second'], () => ({}), { requireAuth: false });
    expect(result).toEqual({ url: 'https://checkout/2' });
  });

  it('throws when no candidate returns a checkout url', async () => {
    global.fetch.mockResolvedValue(makeResp({}));

    await expect(
      invokeFirstAvailable(['first', 'second'], () => ({}), { requireAuth: false }),
    ).rejects.toThrow(/did not return a checkout URL/);
  });
});

describe('hasFeature', () => {
  it('returns false without a membership', () => {
    expect(hasFeature(null, FEATURE_KEYS.EXCEL_EXPORT)).toBe(false);
    expect(hasFeature({ membership: null }, FEATURE_KEYS.EXCEL_EXPORT)).toBe(false);
  });

  it('grants everything to an exempt member', () => {
    const session = { membership: { isExempt: true } };
    expect(hasFeature(session, FEATURE_KEYS.EXCEL_EXPORT)).toBe(true);
    expect(hasFeature(session, FEATURE_KEYS.ADMIN_MEMBERSHIP)).toBe(true);
  });

  it('grants EXCEL_EXPORT to basic or premium members', () => {
    expect(hasFeature({ membership: { hasBasicAccess: true } }, FEATURE_KEYS.EXCEL_EXPORT)).toBe(true);
    expect(hasFeature({ membership: { hasPremiumAccess: true } }, FEATURE_KEYS.EXCEL_EXPORT)).toBe(true);
    expect(hasFeature({ membership: {} }, FEATURE_KEYS.EXCEL_EXPORT)).toBe(false);
  });

  it('returns false for unknown features when not exempt', () => {
    expect(hasFeature({ membership: { hasBasicAccess: true } }, FEATURE_KEYS.BASIC_MEMBERSHIP)).toBe(false);
  });
});

describe('isOrgAdminSubscriptionRequired', () => {
  it('is false for non-admin roles', () => {
    expect(isOrgAdminSubscriptionRequired({ userRecord: { role: 'grantee' } })).toBe(false);
    expect(isOrgAdminSubscriptionRequired({ userRecord: { role: 'super_admin' } })).toBe(false);
    expect(isOrgAdminSubscriptionRequired(null)).toBe(false);
  });

  it('is true for an admin without an exemption', () => {
    expect(isOrgAdminSubscriptionRequired({ userRecord: { role: 'admin' }, membership: { isExempt: false } })).toBe(true);
    expect(isOrgAdminSubscriptionRequired({ userRecord: { role: 'admin' } })).toBe(true);
  });

  it('is false for an exempt admin', () => {
    expect(isOrgAdminSubscriptionRequired({ userRecord: { role: 'admin' }, membership: { isExempt: true } })).toBe(false);
  });
});
