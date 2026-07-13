# supabase/functions

Deno edge functions. Each subdir is one function (`index.ts`); `_shared/` holds
common code; `tests/` has its own README.

- `create-checkout-session` — membership checkout for all tiers; picks price + tier from the feature key (`basic_membership` → basic, fiscal-agent → fiscal-agent price, else premium).
- `create-billing-portal-session` — opens the Stripe customer billing portal.
- `stripe-webhook` — handles Stripe events: upserts subscriptions, provisions fiscal-agent tenant/listing, sends emails.
- `sync-my-subscription` — pulls the caller's Stripe subscriptions and reconciles membership.
- `notify-inquiry` — emails the charity when a seeker submits a sponsorship inquiry (service-role resolves the hidden recipient).
- `_shared/` — `stripe-client.ts` (Stripe + admin Supabase client, provisioning, CORS), `stripe-subscription-sync.ts` (subscription upsert),
  `subscription-status.ts` (status derivation), `redirect.ts` (safe redirect-URL handling),
  `email.ts` (Resend HTTP transport, no-ops without env), `validation.ts` (untrusted-body validation + `ValidationError`).

Invariant: bodies are untrusted even on JWT-verified routes — validate via
`_shared/validation.ts`. Email/notification failures must never surface as the
user's action failing (log to `system_logs`, still return 200). No secrets or
price IDs hard-coded; everything comes from env.
