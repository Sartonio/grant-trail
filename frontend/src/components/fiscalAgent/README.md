# components/fiscalAgent

Fiscal-agent (charity) directory: browse listings, apply for sponsorship,
onboard a charity (pay-first), and triage inquiries.

- `FiscalAgentDirectory.js` — public/seeker grid of listings (teaser vs full).
- `FiscalAgentProfile.js` — single listing detail page.
- `SponsorshipApplicationModal.js` — structured seeker application -> agent inbox.
- `FiscalAgentInbox.js` — agent's view of incoming sponsorship inquiries.
- `FiscalAgentListIntake.js` — charity intake form, pre-pay onboarding step.
- `FiscalAgentCheckoutReturn.js` — Stripe checkout success/cancel landing.
- `FiscalAgentOwnerDashboard.js` — owner's listing + inbox (admin route, readOnly-aware).
- `FiscalAgentListingEditor.js` — edit/publish the owned listing.
- `fiscalAgents.data.js` — frontend-only mock seed data for the directory.
- `fiscalAgents.map.js` — adapters between Supabase row shapes and the camelCase view-model (teaser vs full).
- `fiscalAgentsShared.js` — shared presentational `.fad-*` primitives (no data fetching).

Invariant: listing ownership/mutation is gated by `canOwnListing(session)` +
`useWriteGuard` (folds into the premium "Fiscal Agents Plan"); the teaser view
must never leak contact/fee fields. RLS is the real boundary; these are UX gates.
