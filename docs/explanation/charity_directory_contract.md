# Charity Directory — Engineering Contract (authoritative)

This is the binding interface between the **backend** team (owns `supabase/**`) and
the **frontend** team (owns `frontend/**`). Neither team edits the other's tree.
The UX spec is `docs/explanation/charity_directory_ux.md`; this file wins on any
naming/shape conflict.

> **AMENDMENT (post-build, pricing review): folded to 2 SKUs.** The original draft
> below proposed a separate `fiscal_agent` entitlement for listing ownership. That
> was dropped: a charity operates as a fiscal agent under the EXISTING **premium**
> "Fiscal Agents Plan" (`STRIPE_PRICE_FISCAL_AGENT`), so listing publish/triage gates on
> `has_premium_membership()` (`canOwnListing` = premium), NOT a `fiscal_agent` tier.
> Only `directory_access` is a NEW SKU. Wherever this doc says `fiscal_agent` /
> `has_fiscal_agent_access()` / `hasFiscalAgentAccess`, read **premium** /
> `has_premium_membership()` / `hasPremiumAccess`. The pay-first charity onboarding
> still exists (it charges premium and stamps `provision_flow='fiscal_agent_onboarding'`).

## Entitlements

- `directory_access` (NEW SKU) — seeker: view full directory + send inquiries.
- `premium` ("Fiscal Agents Plan", existing) — charity: publish/maintain a listing
  + receive/triage inquiries. (Originally drafted as a separate `fiscal_agent` tier
  — see amendment above.)

Resolved through the existing membership system (`user_memberships` / `subscriptions`),
NOT a parallel mechanism. `super_admin` and exempt tenants pass both (mirror
`is_membership_exempt`).

## Database objects (backend owns)

### Tables
- `public.fiscal_agent_listings`
  - `id serial pk`, `tenant_id int not null` (owner org), `owner_user_id int` (users.id),
    `name varchar`, `location varchar`, `region varchar`, `ein varchar`,
    `focus text[]`, `blurb text`, `about text`, `services text[]`, `projects text[]`,
    `website varchar`, `email varchar`, `phone varchar`, `response_time varchar`,
    `accepting boolean default true`, `fee_admin_pct numeric`,
    `rating numeric default 0`, `reviews int default 0`, `sponsored int default 0`,
    `assets_managed varchar`,
    `verified boolean default false`,
    `status varchar default 'draft' check (status in ('draft','published','hidden'))`,
    `verification varchar default 'pending' check (verification in ('pending','verified','rejected'))`,
    `created_at timestamptz default now()`, `updated_at timestamptz default now()`.
- `public.sponsorship_inquiries`
  - `id serial pk`, `listing_id int not null references fiscal_agent_listings(id)`,
    `tenant_id int` (denormalized = listing's tenant, set by trigger; for RLS scoping),
    `created_by int` (users.id of seeker, nullable),
    `status varchar default 'new' check (status in ('new','reviewing','accepted','declined','waitlisted'))`,
    `project jsonb not null`, `contact jsonb not null`, `message text`,
    `submitted_at timestamptz default now()`, `created_at timestamptz default now()`.

### Public teaser view (anyone may SELECT)
- `public.fiscal_agent_listings_public` — SELECTs only teaser-safe columns from
  listings that are `status='published' AND verification='verified'`:
  `id, name, location, region, verified, focus, blurb, accepting, rating, reviews, sponsored`.
  No contact/email/phone/website/about/services. Granted to `anon` + `authenticated`.

### Helper functions (mirror `has_basic_membership()` style; SECURITY DEFINER, STABLE)
- `has_directory_access()` returns boolean — exempt OR active membership tier `directory_access` (or `fiscal_agent`/premium also pass? NO — keep strict: only `directory_access` or exempt).
- `has_fiscal_agent_access()` returns boolean — exempt OR active membership tier `fiscal_agent`.

### RLS (write paths MUST carry the entitlement predicate in WITH CHECK — per migration 20260617150000)
- `fiscal_agent_listings`:
  - SELECT full row: owner (`owner_user_id` maps to caller) OR `has_directory_access()` OR `is_super_admin()`.
  - INSERT/UPDATE: `has_fiscal_agent_access()` AND owner is caller (`owner_user_id` in caller's users.id) AND `tenant_id = current_tenant_id()`.
  - super_admin separate permissive policy for verification updates.
- `sponsorship_inquiries`:
  - INSERT: `has_directory_access()` (WITH CHECK), listing must be published+verified.
  - SELECT: caller owns the listing (`listing_id` in caller's owned listings) OR `is_super_admin()`.
  - UPDATE (status triage): caller owns the listing AND `has_fiscal_agent_access()`.

### Membership tier CHECK constraints
- Extend `subscriptions.membership_tier` and `user_memberships.membership_tier` CHECK
  constraints to also allow `'directory_access'` and `'fiscal_agent'`. Update the
  `enforce_membership_eligibility` / `enforce_subscription_tier_product_match` triggers
  as needed so the new tiers are accepted (they only need basic/premium product IDs to be
  configured; new tiers should not trip the product-match trigger — gate that trigger to
  only run for basic/premium).

### `get_session_context` RPC — extend the returned `membership` object
The frontend depends on these exact keys being present on `data.membership`:
- `hasDirectoryAccess` (boolean)
- `hasFiscalAgentAccess` (boolean)
Keep existing keys (`hasBasicAccess`, `hasPremiumAccess`, `isExempt`) unchanged.

### Charity pay-first provisioning (reuse existing `invites` infra)
On `checkout.session.completed` with `membership_tier='fiscal_agent'` and no existing
account for the billing email: webhook creates the tenant + a `fiscal_agent_listings`
row (`status='draft', verification='pending'`) seeded from Checkout `metadata`, plus an
`invites` row (role `admin`) — the invite token IS the "signup link." The success page
reads provisioning status and surfaces the link. Email send may be best-effort/stubbed
if infra is unavailable; the invite row + returned token is the hard requirement.

## Edge functions (backend owns)
- `create-directory-access-checkout-session/` — mode subscription, price from
  `STRIPE_PRICE_DIRECTORY` env, metadata `membership_tier='directory_access'`. Requires auth.
- `create-fiscal-agent-checkout-session/` — price from `STRIPE_PRICE_FISCAL_AGENT`,
  metadata `membership_tier='fiscal_agent'` + intake fields. Pay-FIRST: does NOT require an
  existing session (accept intake in body, use `client_reference_id`/metadata).
- Update `stripe-webhook` + `_shared/stripe.ts` `upsertSubscriptionFromStripe` to map the
  two new tiers to `user_memberships` rows and run charity provisioning.
- Follow the exact structure of `create-checkout-session/index.ts` (CORS, validation,
  system_logs on failure, returns `{ url }`).

## Frontend contract (frontend owns)
- `lib/billing.js`: add `MEMBERSHIP_TIERS.DIRECTORY_ACCESS='directory_access'` and
  `MEMBERSHIP_TIERS.FISCAL_AGENT='fiscal_agent'`; add checkout-function candidate lists
  `['create-directory-access-checkout-session']` and `['create-fiscal-agent-checkout-session']`;
  extend `fetchSessionContext`/`fetchMembershipStatus` to read `hasDirectoryAccess` /
  `hasFiscalAgentAccess` from `data.membership`.
- `lib/policy.js`: add `canViewDirectory(session)` (true if `hasDirectoryAccess` OR
  `hasFiscalAgentAccess` OR super_admin OR exempt) and `canOwnListing(session)` (true if
  `hasFiscalAgentAccess` OR super_admin OR exempt). Reuse `isReadOnlyAdmin` semantics for lapse.
- Replace the mock `viewAs` switcher in `FiscalAgentDirectory.js` with real session-driven
  gating (`canViewDirectory`). Fetch from `fiscal_agent_listings_public` (teaser) always, and
  from `fiscal_agent_listings` (full) when subscribed. Wire "Subscribe for access" to
  `startCheckoutSession({ membershipTier: 'directory_access', ... })`.
- Wire "List your charity" to the pay-first `fiscal_agent` checkout.
- Listing editor/inbox: real Supabase reads/writes against the new tables; respect
  `useWriteGuard` for lapse read-only.
- Routes (App.js): add `/fiscal-agents/list`, `/fiscal-agents/checkout/return`,
  `/fiscal-agents/me` (+ inbox), `/fiscal-agents/listing/edit`, `/fiscal-agents/onboard`.
  `/fiscal-agents` and `/fiscal-agents/:id` stay public with in-component paywall.

## Session shape (the shared interface — DO NOT diverge)
`session.membership = { isExempt, hasBasicAccess, hasPremiumAccess, hasDirectoryAccess, hasFiscalAgentAccess }`

## Test data
Add seed rows (in `supabase/seed.sql`) for: one published+verified listing, one draft,
one unverified, plus a couple of inquiries — so the frontend and e2e tests have data.
