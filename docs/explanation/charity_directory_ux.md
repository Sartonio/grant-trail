# Charity / Fiscal Agent Directory — UX & Product Spec

> **Status:** Design spec (no code written). This is the source-of-truth handoff
> for the backend and frontend engineering teams building the production version
> of the Fiscal Agent Directory mockup that currently lives at
> `frontend/src/components/FiscalAgentDirectory.js` (+ `FiscalAgentProfile.js`,
> `FiscalAgentInbox.js`, `SponsorshipApplicationModal.js`, `fiscalAgents.data.js`).
>
> **Alignment constraint:** all gating decisions defer to the existing billing
> architecture — `frontend/src/lib/policy.js` (single source of truth),
> `frontend/src/lib/guards.js` (route `<Guard>`), `frontend/src/lib/billing.js`
> (Stripe checkout/portal helpers), and the RLS pattern in
> `supabase/migrations/20260617150000_subscription_gating_rls.sql`. Nothing in
> this feature invents a parallel gating mechanism.

---

## 0. The three paid concepts (recap)

| # | Who pays | Product name | What it unlocks |
|---|----------|--------------|-----------------|
| 1 | **Charity** (becomes a listing owner) | **Fiscal Agent subscription** (pay-first) | The right to onboard, create, and **publish** a directory listing and receive sponsorship inquiries. Pay BEFORE any account/listing is provisioned. |
| 2 | **Organization** (sponsorship seeker) | **Directory Access subscription** | The right to **view** full charity listings, contact details, and send partnership/sponsorship requests. |
| 3 | (the page itself) | — | The directory grid is **subscription-gated**: a logged-out or non-subscribed visitor sees only a blurred teaser + paywall. |

Concepts 2 and 3 are the same gate seen from two angles: the directory page is
paywalled (concept 3), and the key that opens it is Directory Access (concept 2).

---

## 1. Personas & entry points

### 1.1 Persona summary

| Persona | Goal | New product role | Maps to existing role |
|---------|------|------------------|------------------------|
| **Charity / Fiscal Agent owner** | Get listed so seekers find them; triage inquiries; convert accepted projects into grantees | **Fiscal Agent (listing owner)** | New capability layered on **`admin`** (the org-admin tenant role). The charity is a tenant/org; its primary user is an `admin`. The Fiscal Agent subscription is a **new premium add-on / membership feature** on that admin account, distinct from the existing org-admin (`premium`) membership. |
| **Organization / seeker** | Find a fiscal sponsor; compare; contact | **Directory subscriber (seeker)** | Any authenticated user with a **Directory Access** membership. Realistically a **`grantee`** (a project lead) or an **`admin`** of a seeking org. Role is orthogonal to the Directory-Access entitlement. |
| **Logged-out visitor** | Evaluate whether the product is worth signing up for | none (anonymous) | not authenticated |
| **super_admin** | Verify charities, moderate listings, refund | platform staff | **`super_admin`** (already billing-exempt; sees everything) |

### 1.2 Entry points

- **Marketing / hero** (`/fiscal-agents`) — public, indexable. Two CTAs:
  - "Find a charity to act as your Fiscal Agent" → seeker funnel (paywall).
  - "Are you a charity acting as a Fiscal Agent? List your charity" → charity pay-first funnel.
- **In-app nav** — authenticated grantees/admins get a "Find a Fiscal Agent" link; charities that own a listing get a "My Listing" link.
- **Deep link / shareable profile** — `/fiscal-agents/:id` (the existing `FiscalAgentProfile.js` page) can be shared externally; itself partially gated (see §4).
- **Subscription page** — existing `/subscription` becomes the plan picker that now also offers the two new plans.

---

## 2. End-to-end user flows

### 2.1 Charity (pay-FIRST Fiscal Agent listing owner)

The defining rule: **the charity pays before any account/listing exists.** Money
first, then a magic signup link, then onboarding, then publish. This mirrors the
mockup's `ListingFormModal` step order (Organization → Profile → Subscribe →
"Pay & publish"), but production splits checkout out to Stripe and provisions the
account only on a verified webhook.

```
 (public) /fiscal-agents
        │  "List your charity" CTA
        ▼
 /fiscal-agents/list  ── intake (org name, EIN, location, focus, blurb)  [no auth yet]
        │  "Continue to checkout"
        ▼
 Stripe Checkout (Fiscal Agent plan: $49/mo or $490/yr)   ◄── PAY FIRST
        │  webhook: checkout.session.completed
        ▼
 Backend provisions: tenant + admin user (status=invited) + listing(draft, unverified)
        │  emails a one-time SIGNUP / set-password link
        ▼
 /fiscal-agents/onboard?token=…  ── charity sets password, confirms org details
        │
        ▼
 /fiscal-agents/listing/edit  ── complete listing (about, services, fees, contact)
        │  "Publish" (allowed once required fields done AND 501c3 verification clears)
        ▼
 LIVE listing in directory  ─────────────►  Owner dashboard /fiscal-agents/me
        │                                         │
        │  inquiries arrive                       ▼
        └───────────────────────────────►  Sponsorship inbox (triage → accept → onboard as grantee)
```

Numbered:

1. **Discover.** Visitor lands on `/fiscal-agents`, clicks **"List your charity"**.
2. **Intake (pre-payment).** Route `/fiscal-agents/list`. Collect the minimum to
   create a draft listing: org name, location, EIN/Tax ID, focus areas, short
   blurb, billing email. No account is created yet. (Mockup steps 0–1.)
3. **Pay first.** Click **"Continue to checkout"** → redirect to Stripe Checkout
   for the **Fiscal Agent plan** via `startCheckoutSession({ membershipTier: 'fiscal_agent', returnPath: '/fiscal-agents/checkout/return' })` (new tier; see §7 Q1). Cancel returns to `/fiscal-agents/list` with intake preserved.
4. **Webhook provisioning.** On `checkout.session.completed`, the backend:
   creates the tenant, an `admin` user (`status = invited`), a `fiscal_agent_listing`
   row (`status = draft`, `verification = pending`), records the subscription, and
   emails a **one-time signup/magic link**.
5. **Receive signup link → onboard.** Charity opens link → `/fiscal-agents/onboard?token=…`,
   sets a password (or completes profile via existing `CompleteProfile`), lands authenticated.
6. **Build the listing.** `/fiscal-agents/listing/edit` (production form of
   `ListingEditorModal`): about, services, fee structure, eligibility, contact,
   accepting-toggle. A completeness meter nudges toward a full profile.
7. **Publish.** Button **"Publish listing"** enabled only when required fields are
   present. Listing becomes publicly visible once **both** published AND 501(c)(3)
   verification has cleared (until then it shows "Pending verification"; see §5).
8. **Manage.** Owner dashboard `/fiscal-agents/me`: public-preview card, completeness,
   "Accepting projects / Waitlist only" toggle, "Edit listing", subscription status.
9. **Receive & triage inquiries.** Structured applications land in the
   **Sponsorship inbox** (`FiscalAgentInbox`). Owner moves each through
   `new → reviewing → accepted | declined | waitlisted`.
10. **Convert.** On an accepted inquiry, **"Onboard as grantee"** bridges the
    project into GrantTrail (creates/invites a grantee user under the charity's
    tenant). This is the funnel payoff and the seam to the core product.

> **Gate for this persona:** the directory **listing-owner capabilities**
> (publish, stay visible, receive/triage inquiries) require an **active** Fiscal
> Agent subscription. On lapse, mirror the read-only-admin pattern (§4.3).

### 2.2 Organization / seeker (Directory Access)

```
 (public) /fiscal-agents ── blurred grid + paywall card  (logged-out OR no Directory Access)
        │  "Subscribe for access"
        ▼
 [if logged out] /login or /signup  ──►  back to /fiscal-agents
        │
        ▼
 Stripe Checkout (Directory Access plan)
        │  webhook activates membership entitlement
        ▼
 /fiscal-agents  ── UNLOCKED grid: search, filter, sort, paginate
        │  open a card
        ▼
 Profile (modal or /fiscal-agents/:id) ── full about, fees, eligibility, contacts
        │  "Request partnership" / "Apply for sponsorship"
        ▼
 SponsorshipApplicationModal (Project → Contact → Review → Send)
        │
        ▼
 Application delivered to that charity's inbox  +  "Sent" confirmation
```

Numbered:

1. **Discover locked directory.** `/fiscal-agents` renders the hero + a blurred,
   non-interactive grid behind a **paywall card** ("Subscribe to view the full
   directory"). Counts/teaser stats are visible; details are not.
2. **Authenticate if needed.** Logged-out → "Subscribe for access" routes through
   `/login` (or `/signup`) first, returning to `/fiscal-agents`.
3. **Subscribe.** `startCheckoutSession({ membershipTier: 'directory_access', returnPath: '/fiscal-agents/checkout/return' })`. Webhook activates the entitlement.
4. **Browse.** Grid unlocks: search by name/location, filter by focus chips +
   region + accepting-only, sort, paginate (`PAGE_SIZE = 4` in mock; tune for prod).
5. **View full profile.** Card → profile modal, or open the standalone
   `/fiscal-agents/:id` page. Full about, sponsorship model, fee structure,
   eligibility, services, recent projects, and contact lines.
6. **Send request.** "Request partnership" / "Apply for sponsorship" opens
   `SponsorshipApplicationModal` (Project → Contact → Review). Submit creates an
   inquiry routed to that charity's inbox; seeker sees a "Sent" confirmation.
7. **Track (post-MVP).** A "My requests" view listing submitted applications and
   their statuses. (See §7 Q6 — deferred.)

> **Gate for this persona:** every action beyond the teaser (full cards, profile
> details, contact info, sending a request) requires an **active Directory Access
> membership**. The gate is checked in both the router/UI and RLS.

### 2.3 Logged-out visitor — public vs. gated

| Surface | Public (logged-out) | Gated (needs Directory Access) |
|---------|---------------------|-------------------------------|
| `/fiscal-agents` hero, value prop, aggregate stats (#agents, #verified, #projects) | ✅ visible | — |
| Directory grid | Blurred teaser only (names/avatars may be faintly visible; no contact/fee detail) | Full interactive cards |
| Search / filter / sort / paginate | Disabled (decorative) | Enabled |
| Profile `/fiscal-agents/:id` | **Teaser**: name, location, verified badge, focus, blurb, model. **No** contact lines, exact fee table, eligibility notes; CTA replaced by "Subscribe to contact". | Full profile + working CTAs |
| "List your charity" funnel | ✅ fully public up to checkout (pay-first) | — |

Logged-out visitors are NEVER shown working contact details or the application
modal — those are the paid surface.

---

## 3. Screen / state inventory

Legend — **Mock**: existing mockup component it derives from.

| # | Screen / state | Route | Mock | Data needed | Key actions |
|---|----------------|-------|------|-------------|-------------|
| S1 | **Locked directory (teaser)** | `/fiscal-agents` | `FiscalAgentDirectory` (`is-gated` grid + `fad-paywall`) | aggregate counts; blurred subset of listings (no contact/fee) | "Subscribe for access" → checkout |
| S2 | **Unlocked directory** | `/fiscal-agents` | `FiscalAgentDirectory` (subscribed) | paginated published+verified listings; filters | search, filter, sort, save, open card, contact |
| S3 | **Profile teaser (public)** | `/fiscal-agents/:id` | `FiscalAgentProfile` (gated variant) | public-safe subset | "Subscribe to contact" |
| S4 | **Profile full** | `/fiscal-agents/:id` and profile modal | `FiscalAgentProfile`, `ProfileModal` | full listing incl. contacts, fees, eligibility | Apply / Request partnership, Save |
| S5 | **Charity intake (pre-pay)** | `/fiscal-agents/list` | `ListingFormModal` steps 0–1 | none (form state) | Continue to checkout |
| S6 | **Checkout (Fiscal Agent)** | Stripe-hosted | `ListingFormModal` step 2 | plan/price IDs from `platform_settings` | pay |
| S7 | **Checkout return — success** | `/fiscal-agents/checkout/return?status=success` | (new) | sync membership; provisioning status | "Check your email for your signup link" / continue |
| S8 | **Checkout return — cancel** | `/fiscal-agents/checkout/return?status=cancel` | (new) | preserved intake | "Resume" → back to S5 |
| S9 | **Onboarding (post-pay signup)** | `/fiscal-agents/onboard?token=…` | (new; reuse `CompleteProfile`) | invite token, draft listing | set password, confirm org |
| S10 | **Listing editor** | `/fiscal-agents/listing/edit` | `ListingEditorModal` | owner's listing draft | save, publish, add/remove services, accepting toggle |
| S11 | **Owner dashboard** | `/fiscal-agents/me` | `OwnerListingPanel` + owner banner | listing + completeness + sub status | edit, toggle accepting, manage billing |
| S12 | **Sponsorship inbox** | `/fiscal-agents/me/inbox` (or tab on S11) | `FiscalAgentInbox` | inquiries for this listing | filter, status change, onboard-as-grantee |
| S13 | **Application modal** | overlay on S4 | `SponsorshipApplicationModal` | agent id, focus list | submit application |
| S14 | **Plan picker** | `/subscription` | existing `SubscriptionPage` | available plans incl. 2 new | start checkout / portal |
| S15 | **Empty / edge states** | various | inbox empty, grid empty, not-found | — | see §5 |

> Production note: the mockup uses **modals** for profile/editor/application; for
> deep-linkability and SEO, S3/S4 should also exist as **standalone routes**
> (`/fiscal-agents/:id`), with the modal kept as the in-grid quick-view.

---

## 4. Paywall UX — exactly where the gate sits

### 4.1 Two distinct entitlements

- **`directory_access`** — seeker entitlement; gates **viewing** the directory and **contacting** charities.
- **`fiscal_agent`** — owner entitlement; gates **publishing** a listing, **staying visible**, and **receiving/triaging** inquiries.

Both resolve through `policy.js`. Recommended: extend the membership model with
boolean entitlements (e.g. `hasDirectoryAccess`, `hasFiscalAgentAccess`) computed
the same way `hasBasicAccess` / `hasPremiumAccess` are (RPCs + `user_memberships`),
and add helpers `canViewDirectory(session)` / `canOwnListing(session)` to
`policy.js` so it stays the single source of truth. `super_admin` and exempt
tenants pass both, matching `hasRequiredSubscription`.

### 4.2 Gate placement

| Surface | Gate condition (frontend) | Gate condition (backend / RLS) |
|---------|---------------------------|--------------------------------|
| **View directory grid (S2)** | `canViewDirectory(session)` true → render cards; else render S1 teaser + paywall | `SELECT` on `fiscal_agent_listing` returns **full rows** only when `directory_access` or owner/super_admin; otherwise a **public view** exposing only teaser columns |
| **Full profile (S4)** | `canViewDirectory(session)` | same public-view split |
| **Send application (S13)** | `canViewDirectory(session)` (button hidden/disabled otherwise) | `INSERT` into `sponsorship_inquiry` requires `has_directory_access()` in `WITH CHECK` — mirrors the `has_basic_membership()` write gate in the cited migration |
| **Publish listing (S10)** | `canOwnListing(session)` AND completeness AND verification cleared | `UPDATE … SET status='published'` requires `has_fiscal_agent_access()` in `WITH CHECK` |
| **Receive inquiries (S12)** | listing must be owned by caller (RLS ownership) | `SELECT` on `sponsorship_inquiry` scoped to listings the caller owns |
| **Route render** | `<Guard requireRole=… billingMode=…>` per route (see §4.4) | — |

The **router gate is convenience, not security.** Security is the RLS write/read
gates, exactly as the cited migration argues ("subscription access control was
enforced only in the React router … a forged JWT could still create/modify").
Every new write path (`fiscal_agent_listing` publish, `sponsorship_inquiry`
insert) MUST carry the membership predicate in its policy `WITH CHECK`.

### 4.3 What a non-subscriber can / can't see

- **Seeker without Directory Access:** sees S1 teaser (hero, aggregate counts,
  blurred grid). Cannot see: contact info, exact fee table, eligibility notes,
  pagination, working filters, application modal. CTA: **"Subscribe for access"**.
- **Logged-out:** same as above; CTA additionally routes through login/signup.
- **Charity without Fiscal Agent sub:** cannot publish or receive inquiries; the
  "List your charity" funnel is the way in (pay-first).

### 4.4 Route guard mapping (uses existing `<Guard>` / `guards.js`)

| Route | `requireRole` | `roleRedirect` | `billingMode` | Notes |
|-------|---------------|----------------|---------------|-------|
| `/fiscal-agents` (S1/S2) | none (public) | — | `none` | Component itself swaps teaser/full on `canViewDirectory`. Avoids redirecting anonymous visitors away from a public marketing page. |
| `/fiscal-agents/:id` (S3/S4) | none | — | `none` | Same teaser/full split inside the page. |
| `/fiscal-agents/list` (S5) | none | — | `none` | Pay-first; no auth required pre-checkout. |
| `/fiscal-agents/onboard` (S9) | none (token-auth) | — | `none` | Token validates instead of session. |
| `/fiscal-agents/listing/edit` (S10) | `admin` (listing owner) | `/` | **`readOnly`** | Lapsed Fiscal Agent → read-only (§4.5). |
| `/fiscal-agents/me` (S11) | `admin` | `/` | `readOnly` | dashboard viewable when lapsed; mutations blocked |
| `/fiscal-agents/me/inbox` (S12) | `admin` | `/` | `readOnly` | view inquiries when lapsed; status changes blocked |
| `/subscription` (S14) | `authenticated` | `/login` | `none` | unchanged |

> The directory's seeker gate is intentionally **not** a route redirect (it would
> hide a public marketing page). It's an in-component entitlement check that
> renders the paywall card — consistent with treating the router as UX, RLS as
> security.

### 4.5 Subscription lapse behavior (mirror `policy.js` read-only-lapse, issue #40)

- **Seeker lapse (Directory Access cancels/expires):** directory **reverts to the
  S1 teaser**. No grid, no contacts, no new applications. Already-submitted
  applications are not deleted. CTA: "Renew Directory Access". (SELECT teaser
  stays ungated, mirroring "lapsed grantee can still view their data".)
- **Charity lapse (Fiscal Agent cancels/expires):** mirror **read-only admin**.
  The listing is **unpublished / hidden from the directory** (no longer occupying
  paid visibility), but the **owner keeps READ access**: they can view their
  listing, view their inbox, and reach billing to resubscribe. They **cannot**
  edit/publish the listing or change inquiry statuses (writes route to
  `BILLING_NUDGE_PATH = '/subscription'` via the existing `useWriteGuard`
  pattern). `isReadOnlyAdmin(session)` already expresses exactly this.
- **Grace / past_due:** `fetchMembershipStatus` already treats `past_due` as an
  active subscription; honor that grace window before flipping to read-only.

---

## 5. Edge cases & empty states

| Case | Where | Behavior |
|------|-------|----------|
| **Charity paid but hasn't clicked signup link** | S7 | Success page: "Payment received. Check `<email>` for your signup link." Resend-link affordance. Listing exists as `draft/unverified`, not public. |
| **Unverified charity (501c3 pending)** | S10/S11/directory | Owner can build & even "publish", but card shows **"Pending verification"** badge and is **excluded from S2 public results** (or shown without the verified checkmark, per Q3) until `super_admin` clears it. |
| **Listing draft, never published** | directory | Not shown to seekers at all. Owner dashboard shows "Your listing is in draft — finish and publish to appear." |
| **Listing published + verified** | directory | Appears with verified badge; the `verified` flag drives the `FaCheckCircle`. |
| **No inquiries yet** | S12 | `FiscalAgentInbox` empty state: "No applications yet — when a project applies it will appear here." |
| **Filter yields nothing** | S2 | `fad-empty`: "No fiscal agents match your filters" + "Clear filters". |
| **Profile not found / removed** | S3/S4 | `fap-notfound`: "Agent not found" + back link (already in mock). A listing pulled for lapse/verification returns this for seekers. |
| **Seeker subscription canceled** | S2 | Reverts to S1 teaser (see §4.5). |
| **Charity subscription canceled** | S10–S12 | Read-only + listing hidden (see §4.5). |
| **Duplicate signup (charity already has a listing)** | S5 | If EIN matches an existing tenant/listing, route to login + "You already have a listing" instead of a second checkout. |
| **Accepting toggle off (waitlist)** | S2/S4 | Card shows "Waitlist only"; application still allowed but copy reflects waitlist. |
| **Inquiry accepted → onboard** | S12 | "Onboard as grantee" creates/invites a grantee under the charity tenant; success toast. Idempotent if clicked twice. |

---

## 6. Data each screen needs (engineering quick-ref)

- **`fiscal_agent_listing`** (new table): `id, tenant_id (owner), name, location,
  region, ein, focus[], blurb, about, services[], projects[], website, email,
  phone, response_time, accepting (bool), fee_admin_pct, fee_setup, fee_min_annual,
  model, eligibility (jsonb: geographies[], project_types[], requires_501c3, notes),
  rating, reviews, sponsored, assets_managed, verified (bool), status
  (draft|published|hidden), verification (pending|verified|rejected),
  created_at, updated_at`. Field set is lifted directly from `fiscalAgents.data.js`.
- **Public teaser view** (`fiscal_agent_listing_public`): exposes only
  `id, name, location, region, verified, focus, blurb, model, accepting` — i.e.
  everything safe to show pre-subscription. RLS lets anyone SELECT this view;
  the full table requires `directory_access` / ownership.
- **`sponsorship_inquiry`** (new table): `id, listing_id, status
  (new|reviewing|accepted|declined|waitlisted), submitted_at, project (jsonb:
  name, mission, focus, project_type, est_annual_budget, funding_sources,
  timeline, start_date), contact (jsonb: name, email, organization, phone),
  message, created_by (seeker user)`. Shape matches `SAMPLE_INQUIRIES` +
  `SponsorshipApplicationModal`'s `onSubmit` payload.
- **Memberships:** extend `user_memberships` / entitlement RPCs with
  `directory_access` and `fiscal_agent` tiers; surface as
  `hasDirectoryAccess` / `hasFiscalAgentAccess` in the session like the existing
  `hasBasicAccess` / `hasPremiumAccess`.
- **Stripe:** two new products/prices stored in `platform_settings` (never
  hard-coded — see `billing.js`), reached via new `membershipTier` values through
  `startCheckoutSession`. Webhook handles provisioning (charity) and entitlement
  activation (seeker).

---

## 7. Open product questions — assumptions chosen

Since I could not consult the product owner, each open question below states the
**decision I made** so engineering has a definitive spec. Flag any you disagree
with before build.

1. **New tiers vs. reuse existing `basic`/`premium`?**
   **Decision:** introduce two NEW entitlements (`directory_access`, `fiscal_agent`).
   Reusing `premium` would conflate org-admin billing with directory billing and
   muddy `hasRequiredSubscription`. Keep them orthogonal booleans resolved in
   `policy.js`.

2. **Does pay-first create the account, or just a payment + token?**
   **Decision:** payment first, then webhook provisions a tenant + `invited` admin
   + draft listing, then emails a one-time signup link. No password is collected
   before payment (avoids orphan accounts for abandoned checkouts).

3. **Can an unverified charity appear in the directory?**
   **Decision:** an unverified-but-published listing is **hidden from public
   results** until `super_admin` verifies 501(c)(3) status. The owner sees it as
   "Pending verification." (Safer for the platform's trust promise than showing
   unverified orgs without a badge.) Revisit if it slows supply too much.

4. **Is the seeker gate a route redirect or in-component paywall?**
   **Decision:** in-component paywall on a public route (S1), NOT a `<Guard>`
   redirect. Redirecting anonymous visitors away from the marketing page would
   kill acquisition. RLS still enforces real data protection.

5. **What happens to a charity's existing inquiries when its sub lapses?**
   **Decision:** read-only — inquiries are retained and viewable; the listing is
   hidden from the directory; no new triage writes. Mirrors issue #40 exactly.

6. **Seeker "My requests" tracking view — in MVP?**
   **Decision:** **deferred** to post-MVP. MVP delivers fire-and-forget
   applications with a "Sent" confirmation; the charity inbox is the system of
   record. A seeker-side request tracker is a fast-follow.

7. **Reviews/ratings — real or seeded?**
   **Decision:** treat `rating`/`reviews` as **display-only seeded metadata** for
   MVP (no review-submission flow). A real review system is out of scope here.

8. **Profile: modal vs. page?**
   **Decision:** ship **both** — standalone `/fiscal-agents/:id` page (shareable,
   SEO, teaser-gated) plus the in-grid quick-view modal for subscribed seekers.

9. **Can a seeker and a charity be the same org?**
   **Decision:** entitlements are independent, so yes — an org could hold both
   `directory_access` and `fiscal_agent`. No special handling needed beyond
   showing both the seeker directory and the owner dashboard.

---

## 8. Button-label & route glossary (for consistent implementation)

- Seeker CTA (locked): **"Subscribe for access"** → Directory Access checkout.
- Seeker CTA (profile, locked): **"Subscribe to contact"**.
- Seeker primary (unlocked): **"Apply for sponsorship"** / **"Request partnership"**.
- Charity CTA (acquisition): **"List your charity"**.
- Charity checkout button: **"Pay & publish listing"** (mock) → in prod, **"Continue to checkout"** (pre-pay) then Stripe.
- Charity publish: **"Publish listing"**; manage: **"Edit listing"**, accepting toggle **"Accepting projects" / "Waitlist only"**.
- Inbox: **"Mark reviewing" / "Accept" / "Waitlist" / "Decline"**, then **"Onboard as grantee"**.
- Lapse nudges: **"Renew Directory Access"** (seeker), writes route to `/subscription` (charity, via `useWriteGuard`).

Routes introduced: `/fiscal-agents/list`, `/fiscal-agents/checkout/return`,
`/fiscal-agents/onboard`, `/fiscal-agents/listing/edit`, `/fiscal-agents/me`,
`/fiscal-agents/me/inbox`. Existing: `/fiscal-agents`, `/fiscal-agents/:id`,
`/subscription`.
