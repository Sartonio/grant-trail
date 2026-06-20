# Edge-function authorization review

Security baseline review of the Supabase Edge Functions in `supabase/functions/`.
Scope: that each function authenticates the caller from their Supabase JWT,
authorizes only against the caller's *own* data, and never trusts client-supplied
identity. The Stripe webhook is reviewed for signature verification and correct
service-role use.

Reviewed at: branch `main` (post-merge). Verified against the local Supabase
stack + the edge-function test suites (see "Verification" below).

## How identity is resolved (shared baseline)

All four authenticated functions funnel identity through two shared helpers in
`_shared/stripe.ts`:

- `requireAuthenticatedProfile(authHeader)` — extracts the bearer token, calls
  `adminSupabase.auth.getUser(bearerToken)` to validate the JWT, then loads the
  app user row by the **token's** `user.id` (`public.users.user_id = user.id`).
  The returned `profile.profileId` is the server-resolved `public.users.id`.
- `getOrCreateStripeCustomer(profile)` — resolves the Stripe customer strictly by
  `profile.profileId` against `billing_customers`, creating one if absent.

No function reads `user_id` / `email` / `customer_id` from the request body for
identity. The only body fields consumed are `returnPath` and `featureKey`, both
validated by `_shared/validation.ts` (allowlist + relative-path / open-redirect
checks). `config.toml` sets `verify_jwt = true` for all four authenticated
functions, so the gateway also rejects malformed/missing JWTs before the function
runs.

---

## Per-function verdicts

### create-checkout-session — PASS

- (a) Authentication: identity from JWT via `requireAuthenticatedProfile`. ✔
- (b) Authorization: checkout session is created against the customer resolved
  from the caller's own `profileId`; `client_reference_id`, `metadata.user_id`,
  and `subscription_data.metadata.user_id` are all `String(profile.profileId)`. ✔
- (c) No client identity trusted: body is only `returnPath` + `featureKey`
  (allowlisted). `membership_tier` is hardcoded `'premium'`, so a user cannot
  mint a different tier via the body. ✔

### create-basic-membership-checkout-session — PASS

- Same identity/customer-resolution path as above. `featureKey` allowlist is the
  single value `['basic_membership']`; `membership_tier` hardcoded `'basic'`. ✔
- (a)/(b)/(c) all satisfied. ✔

### create-billing-portal-session — PASS

- (a) JWT-derived identity. ✔
- (b) Billing-portal session targets `getOrCreateStripeCustomer(profile)` — the
  caller's own customer. This is the highest-impact surface (a portal session for
  another customer would let an attacker manage/cancel another user's
  subscription); it is correctly bound to the caller. ✔
- (c) Body is only `returnPath` (validated). No customer/user id is read from the
  body. ✔

### sync-my-subscription — PASS

- (a) JWT-derived identity. ✔
- (b) Lists Stripe subscriptions for the caller's own customer only
  (`stripe.subscriptions.list({ customer: customerId })` where `customerId` comes
  from `profile`), and the membership-clear branch updates
  `user_memberships WHERE user_id = profile.profileId`. A caller can only sync
  their own subscription/membership. ✔
- (c) Body is ignored entirely (not even parsed for fields). ✔

### stripe-webhook — PASS

- (d) Signature verification: every request must carry a `stripe-signature`
  header and is verified with `stripe.webhooks.constructEventAsync(payload,
  signature, STRIPE_WEBHOOK_SECRET)`. Missing secret/signature throws before any
  processing; an invalid signature throws inside `constructEventAsync` → 400. No
  branch acts on an unverified payload. `verify_jwt = false` in `config.toml` is
  correct here (Stripe is server-to-server, no user JWT). ✔
- (e) Service-role use: writes go through `adminSupabase` (service role), which is
  appropriate for a server-to-server webhook with no user session. It acts only on
  data derived from the *verified* event — and the customer→user mapping in
  `upsertSubscriptionFromStripe` is resolved from `billing_customers` by the
  verified `subscription.customer`, not from anything caller-controlled.
  Idempotency is enforced via `billing_webhook_events.stripe_event_id`. ✔

---

## Holes fixed

None. No authorization hole was found. The functions already derive identity from
the verified JWT and resolve the Stripe customer / membership rows by the
server-resolved id, so there is no IDOR / identity-spoofing surface to close.

## Tests added

`supabase/functions/tests/authz-identity.test.sh` — a focused regression test for
the "identity from JWT, never the body" property, which previously had no direct
coverage (existing suites map a customer to the caller and never attempt a spoof).
It sets up two users A and B, each with their own mapped Stripe customer, then:

- Calls `create-checkout-session` as **A** with **B's** `user_id` / `userId` /
  `customerId` / `customer` / `email` / `profileId` in the body, and asserts the
  resulting Stripe session's `customer`, `metadata.user_id`, and
  `client_reference_id` are all **A's** — and that B's customer/id never leak in.
- Asserts B's `billing_customers` row is untouched by A's calls (checkout +
  portal).
- Asserts unauthenticated and invalid-JWT requests are rejected (HTTP 400 from the
  function / 401 from the gateway) even when the body names a valid user.
- Control case: B's own token resolves B's own customer (the guard isn't blanket
  denial).

The portal cross-user assertion auto-skips if the configured Stripe TEST key
cannot reach the billing-portal endpoint (a key limitation, not an authz finding;
the identity-resolution path is shared with checkout and proven there).

This test is Stripe-TEST-mode-dependent (it inspects the created session), so it
belongs in the **`stripe-edge-function-tests`** (STRIPE-ENABLED) CI tier alongside
`webhook-matrix` / `portal-and-sync`. Per the test README, CI discovers tests by
basename, so wiring it in is a one-line addition to that tier's list in
`.github/workflows/ci.yml` — left to the maintainer since `.github/` is out of
scope for this review.

## Remaining flags

- **FLAG (product/CI, not a security hole):** the new `authz-identity.test.sh` is
  not yet listed in any CI tier. It runs locally and on demand; to gate on it, add
  its basename to the `stripe-edge-function-tests` tier in
  `.github/workflows/ci.yml`. Not changed here because `.github/` is outside this
  review's boundary.
- **Observation (no action):** `corsHeaders` uses `Access-Control-Allow-Origin: *`.
  This is acceptable for these endpoints because they are JWT-authenticated and
  CORS does not weaken bearer-token auth (the browser still must possess a valid
  token; cookies are not used). Noted for completeness, not a finding.

## Verification

Run against the local stack (`npx --prefix frontend supabase ...`) with functions
served from `supabase/functions/.env` (Stripe TEST mode):

- `authz-identity.test.sh` — 11 passed, 0 failed (portal cross-user step skipped:
  restricted Checkout-only TEST key).
- `checkout-sessions.test.sh` — 14 passed, 0 failed (regression).
- `system-logs-failure.test.sh` — 4 passed, 0 failed (regression).
