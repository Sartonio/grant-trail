// Exhaustive unit tests for the pure subscription-sync decision core.
// Expectations were transcribed from the pre-extraction
// stripe-subscription-sync.ts (behavior-preserving pin, including the
// null-tenant listing/sponsorship asymmetry logged in DEBT.md).
//
// Run:  deno test supabase/functions/_shared/subscription-sync-core.test.ts
import type Stripe from 'npm:stripe@18.1.1';
import {
  ACTIVE_STATUSES,
  assertTenantOwnedTierAllowed,
  buildMembershipRow,
  buildSubscriptionPayload,
  derivePeriods,
  extractPricing,
  isKnownTier,
  KNOWN_TIERS,
  LAPSE_STATUSES,
  parseMetaUserId,
  planListingPublication,
  planSponsorshipEntitlement,
  planTenantMirror,
  resolveOwner,
  resolveTierFromMetadata,
  resolveTierFromPlatformProducts,
} from './subscription-sync-core.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertEquals(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function assertThrows(fn: () => unknown, includes: string, msg: string) {
  try {
    fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    assert(text.includes(includes), `${msg}: threw but message '${text}' lacks '${includes}'`);
    return;
  }
  throw new Error(`${msg}: expected a throw`);
}

const ALL_STATUSES = [
  'active', 'trialing', 'past_due', 'canceled', 'unpaid',
  'incomplete', 'incomplete_expired', 'paused', '',
];
const OTHER_STATUSES = ALL_STATUSES.filter(
  (s) => !LAPSE_STATUSES.includes(s) && !ACTIVE_STATUSES.includes(s),
);

// ── status tables ───────────────────────────────────────────────────────────

Deno.test('directory status tables pin the exact lapse/active sets', () => {
  assertEquals(LAPSE_STATUSES, ['past_due', 'canceled', 'unpaid'], 'LAPSE_STATUSES');
  assertEquals(ACTIVE_STATUSES, ['active', 'trialing'], 'ACTIVE_STATUSES');
  assertEquals(KNOWN_TIERS, ['basic', 'premium'], 'KNOWN_TIERS');
});

// ── planListingPublication: tier x status x tenant grid ─────────────────────

Deno.test('listing: premium lapse statuses demote published -> unlisted', () => {
  for (const status of LAPSE_STATUSES) {
    assertEquals(
      planListingPublication('premium', status, 7),
      { fromStatus: 'published', toStatus: 'unlisted' },
      `premium/${status}`,
    );
  }
});

Deno.test('listing: premium active statuses restore unlisted -> published', () => {
  for (const status of ACTIVE_STATUSES) {
    assertEquals(
      planListingPublication('premium', status, 7),
      { fromStatus: 'unlisted', toStatus: 'published' },
      `premium/${status}`,
    );
  }
});

Deno.test('listing: incomplete/paused/unknown statuses are a no-op', () => {
  for (const status of OTHER_STATUSES) {
    assertEquals(planListingPublication('premium', status, 7), null, `premium/${status}`);
  }
});

Deno.test('listing: non-premium tiers never touch listings, any status', () => {
  for (const tier of ['basic', '', 'gold']) {
    for (const status of ALL_STATUSES) {
      assertEquals(planListingPublication(tier, status, 7), null, `${tier}/${status}`);
    }
  }
});

Deno.test('listing: unresolved tenant (0) silently no-ops even on mapped statuses', () => {
  for (const status of [...LAPSE_STATUSES, ...ACTIVE_STATUSES]) {
    assertEquals(planListingPublication('premium', status, 0), null, `premium/${status}/tenant=0`);
  }
});

// ── planSponsorshipEntitlement: tier x status x tenant grid ─────────────────

Deno.test('sponsorship: premium active statuses set accepts=true', () => {
  for (const status of ACTIVE_STATUSES) {
    assertEquals(planSponsorshipEntitlement('premium', status, 7), { accepts: true }, `premium/${status}`);
  }
});

Deno.test('sponsorship: premium lapse statuses set accepts=false', () => {
  for (const status of LAPSE_STATUSES) {
    assertEquals(planSponsorshipEntitlement('premium', status, 7), { accepts: false }, `premium/${status}`);
  }
});

Deno.test('sponsorship: other statuses / non-premium tiers are a no-op', () => {
  for (const status of OTHER_STATUSES) {
    assertEquals(planSponsorshipEntitlement('premium', status, 7), null, `premium/${status}`);
  }
  for (const tier of ['basic', '', 'gold']) {
    for (const status of ALL_STATUSES) {
      assertEquals(planSponsorshipEntitlement(tier, status, 7), null, `${tier}/${status}`);
    }
  }
});

Deno.test('sponsorship: unresolved tenant THROWS on mapped statuses (asymmetry with listing — pinned, see DEBT.md)', () => {
  for (const status of [...LAPSE_STATUSES, ...ACTIVE_STATUSES]) {
    assertThrows(
      () => planSponsorshipEntitlement('premium', status, 0),
      'Unable to resolve tenant for sponsorship entitlement sync: no tenant',
      `premium/${status}/tenant=0`,
    );
  }
});

Deno.test('sponsorship: unresolved tenant on unmapped status is still a silent no-op', () => {
  for (const status of OTHER_STATUSES) {
    assertEquals(planSponsorshipEntitlement('premium', status, 0), null, `premium/${status}/tenant=0`);
  }
});

// ── membership-tier resolution ──────────────────────────────────────────────

Deno.test('tier from metadata: membership_tier wins and is lowercased', () => {
  assertEquals(resolveTierFromMetadata({ membership_tier: 'Premium' }), 'premium', 'Premium');
  assertEquals(resolveTierFromMetadata({ membership_tier: 'BASIC' }), 'basic', 'BASIC');
  // Unknown values pass through untouched (resolved later via product ids).
  assertEquals(resolveTierFromMetadata({ membership_tier: 'gold' }), 'gold', 'gold passthrough');
});

Deno.test('tier from metadata: feature_key fallback mapping', () => {
  assertEquals(resolveTierFromMetadata({ feature_key: 'basic_membership' }), 'basic', 'basic_membership');
  for (const key of ['premium_membership', 'admin_membership', 'excel_export']) {
    assertEquals(resolveTierFromMetadata({ feature_key: key }), 'premium', key);
  }
  assertEquals(resolveTierFromMetadata({ feature_key: 'Excel_Export' }), 'premium', 'feature_key lowercased');
  assertEquals(resolveTierFromMetadata({ feature_key: 'unknown' }), '', 'unknown feature_key');
  assertEquals(resolveTierFromMetadata({}), '', 'empty metadata');
});

Deno.test('tier from metadata: a non-empty membership_tier blocks the feature_key fallback', () => {
  assertEquals(
    resolveTierFromMetadata({ membership_tier: 'gold', feature_key: 'basic_membership' }),
    'gold',
    'membership_tier=gold blocks feature_key',
  );
});

Deno.test('tier from platform products: match, precedence, and passthrough', () => {
  const platform = { basic_membership_product_id: 'prod_b', premium_membership_product_id: 'prod_p' };
  assertEquals(resolveTierFromPlatformProducts('prod_b', platform, ''), 'basic', 'basic match');
  assertEquals(resolveTierFromPlatformProducts('prod_p', platform, ''), 'premium', 'premium match');
  assertEquals(resolveTierFromPlatformProducts('prod_x', platform, 'gold'), 'gold', 'no match keeps current');
  // Both ids the same product: premium wins (second assignment).
  assertEquals(
    resolveTierFromPlatformProducts('prod_s', { basic_membership_product_id: 'prod_s', premium_membership_product_id: 'prod_s' }, ''),
    'premium',
    'both match -> premium',
  );
  // Missing platform row / null ids never match a real product id.
  assertEquals(resolveTierFromPlatformProducts('prod_b', null, ''), '', 'null platform');
  assertEquals(resolveTierFromPlatformProducts('prod_b', {}, 'gold'), 'gold', 'empty platform row');
});

Deno.test('isKnownTier accepts exactly basic/premium', () => {
  assert(isKnownTier('basic') && isKnownTier('premium'), 'known tiers');
  for (const tier of ['', 'gold', 'Premium', 'fiscal_agent']) {
    assert(!isKnownTier(tier), `unknown tier ${tier}`);
  }
});

// ── ownership / identity ────────────────────────────────────────────────────

Deno.test('resolveOwner: tenant_id set => tenant-owned, else user-owned', () => {
  assertEquals(resolveOwner({ user_id: null, tenant_id: 9 }), { ownerTenantId: 9, isTenantOwned: true }, 'tenant-owned');
  assertEquals(resolveOwner({ user_id: 4, tenant_id: null }), { ownerTenantId: null, isTenantOwned: false }, 'user-owned');
  assertEquals(resolveOwner({ user_id: 4, tenant_id: undefined }), { ownerTenantId: null, isTenantOwned: false }, 'undefined tenant');
});

Deno.test('parseMetaUserId: numeric strings only, positive safe integers', () => {
  assertEquals(parseMetaUserId({ user_id: '42' }), 42, '42');
  assertEquals(parseMetaUserId({ user_id: ' 42 ' }), 42, 'trimmed');
  assertEquals(parseMetaUserId({ user_id: '0' }), null, 'zero rejected');
  assertEquals(parseMetaUserId({ user_id: '-1' }), null, 'negative rejected (regex)');
  assertEquals(parseMetaUserId({ user_id: '4.2' }), null, 'decimal rejected');
  assertEquals(parseMetaUserId({ user_id: 'abc' }), null, 'non-numeric rejected');
  assertEquals(parseMetaUserId({ user_id: '' }), null, 'empty rejected');
  assertEquals(parseMetaUserId({}), null, 'missing rejected');
  assertEquals(parseMetaUserId({ user_id: '9007199254740993' }), null, 'unsafe integer rejected');
});

Deno.test('assertTenantOwnedTierAllowed: premium passes, anything else throws', () => {
  assertTenantOwnedTierAllowed('premium'); // no throw
  for (const tier of ['basic', '', 'gold']) {
    assertThrows(
      () => assertTenantOwnedTierAllowed(tier),
      `Tenant-owned billing customer carries non-premium tier '${tier}'.`,
      tier || '(empty)',
    );
  }
});

// ── Stripe fact extraction ──────────────────────────────────────────────────

function fakeSub(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    canceled_at: null,
    metadata: {},
    items: { data: [{ price: { id: 'price_1', product: 'prod_1' }, current_period_start: 1750000000, current_period_end: 1752600000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

Deno.test('extractPricing: happy path returns price + string product', () => {
  assertEquals(extractPricing(fakeSub()), { priceId: 'price_1', productId: 'prod_1' }, 'pricing');
});

Deno.test('extractPricing: missing item, missing price id, or expanded (object) product all throw', () => {
  const cases: Record<string, unknown>[] = [
    { items: { data: [] } },
    { items: { data: [{ price: { id: '', product: 'prod_1' } }] } },
    { items: { data: [{ price: { id: 'price_1', product: { id: 'prod_1' } } }] } }, // expanded product => '' => throw
  ];
  for (const [i, c] of cases.entries()) {
    assertThrows(() => extractPricing(fakeSub(c)), 'Subscription is missing a Stripe price id.', `case ${i}`);
  }
});

Deno.test('derivePeriods: epoch-seconds -> ISO; absent or 0 timestamps -> null', () => {
  assertEquals(
    derivePeriods(fakeSub()),
    {
      currentPeriodStart: new Date(1750000000 * 1000).toISOString(),
      currentPeriodEnd: new Date(1752600000 * 1000).toISOString(),
    },
    'both set',
  );
  assertEquals(
    derivePeriods(fakeSub({ items: { data: [{ price: { id: 'p', product: 'pr' } }] } })),
    { currentPeriodStart: null, currentPeriodEnd: null },
    'absent -> null',
  );
  // Falsy-zero pin: a 0 (epoch) timestamp is treated as absent.
  assertEquals(
    derivePeriods(fakeSub({ items: { data: [{ price: { id: 'p', product: 'pr' }, current_period_start: 0, current_period_end: 0 }] } })),
    { currentPeriodStart: null, currentPeriodEnd: null },
    'zero -> null',
  );
});

// ── write payloads ──────────────────────────────────────────────────────────

Deno.test('buildSubscriptionPayload maps every column of the subscriptions upsert', () => {
  const metadata = { membership_tier: 'premium', user_id: '3' };
  const sub = fakeSub({ status: 'past_due', cancel_at_period_end: 1, canceled_at: 1751000000, metadata });
  const payload = buildSubscriptionPayload({
    subscription: sub,
    stripeCustomerId: 'cus_1',
    priceId: 'price_1',
    productId: 'prod_1',
    membershipTier: 'premium',
    subscriptionUserId: 3,
    ownerTenantId: 9,
    currentPeriodStart: '2026-06-15T00:00:00.000Z',
    currentPeriodEnd: '2026-07-15T00:00:00.000Z',
    metadata,
  });
  assertEquals(payload, {
    user_id: 3,
    tenant_id: 9,
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_1',
    stripe_product_id: 'prod_1',
    stripe_price_id: 'price_1',
    membership_tier: 'premium',
    status: 'past_due',
    current_period_start: '2026-06-15T00:00:00.000Z',
    current_period_end: '2026-07-15T00:00:00.000Z',
    cancel_at_period_end: true, // Boolean() coercion of truthy raw value
    canceled_at: new Date(1751000000 * 1000).toISOString(),
    metadata,
  }, 'full payload');
});

Deno.test('buildSubscriptionPayload: null canceled_at and falsy cancel_at_period_end', () => {
  const payload = buildSubscriptionPayload({
    subscription: fakeSub(),
    stripeCustomerId: 'cus_1',
    priceId: 'price_1',
    productId: 'prod_1',
    membershipTier: 'basic',
    subscriptionUserId: null,
    ownerTenantId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    metadata: {},
  });
  assertEquals(payload.canceled_at, null, 'canceled_at null');
  assertEquals(payload.cancel_at_period_end, false, 'cancel_at_period_end false');
  assertEquals(payload.user_id, null, 'user_id null');
  assertEquals(payload.tenant_id, null, 'tenant_id null');
});

Deno.test('buildMembershipRow maps the shared membership columns with source=stripe', () => {
  assertEquals(
    buildMembershipRow({ subscriptionRowId: 11, membershipTier: 'premium', isActive: true, startsAt: 's', endsAt: 'e' }),
    { subscription_id: 11, membership_tier: 'premium', is_active: true, starts_at: 's', ends_at: 'e', source: 'stripe' },
    'row',
  );
  assertEquals(
    buildMembershipRow({ subscriptionRowId: null, membershipTier: 'basic', isActive: false, startsAt: 's', endsAt: null }).subscription_id,
    null,
    'null subscription row id',
  );
});

// ── legacy tenant mirror decision ───────────────────────────────────────────

Deno.test('planTenantMirror: premium+tenant mirrors, non-premium+tenant demotes, no tenant does nothing', () => {
  assertEquals(planTenantMirror('premium', 7), 'mirror-premium', 'premium+tenant');
  assertEquals(planTenantMirror('basic', 7), 'demote-stale', 'basic+tenant');
  assertEquals(planTenantMirror('gold', 7), 'demote-stale', 'unknown tier + tenant still demotes');
  assertEquals(planTenantMirror('premium', null), 'none', 'premium no tenant');
  assertEquals(planTenantMirror('basic', null), 'none', 'basic no tenant');
});
