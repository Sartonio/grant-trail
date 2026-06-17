# Local Stripe / Billing Testing

The billing flows (checkout, billing portal, subscription sync, webhooks) live in
Supabase **Edge Functions** under `supabase/functions/`. To run them locally you
need three things: Stripe **test-mode** credentials, an `.env` file the functions
read, and a webhook forwarder. None of this touches real money — everything runs
in a Stripe **sandbox** (test mode), using fake cards and fake events.

## How the pieces fit together

```
frontend (lib/billing.js)
        │  authenticated fetch (Supabase JWT)
        ▼
supabase functions serve  ──>  _shared/stripe.ts  ──>  Stripe API (sandbox)
        ▲                                                     │
        │  forwards signed events                             │ emits events
        └──────────────  stripe listen  <────────────────────┘
```

- `supabase/functions/_shared/stripe.ts` reads `STRIPE_SECRET_KEY` and the price
  IDs from the environment. If `STRIPE_SECRET_KEY` is missing the module throws on
  import and **every** function returns an error — so a missing key shows up
  immediately.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
  **injected automatically** by `supabase functions serve`. Do not put them in the
  `.env` file.
- The `stripe-webhook` function is the only one Stripe calls directly. Stripe
  authenticates with a `stripe-signature` header (verified against
  `STRIPE_WEBHOOK_SECRET`), **not** a Supabase JWT — so it is already marked
  `verify_jwt = false` in `supabase/config.toml`. The other functions keep JWT
  verification on.

## Prerequisites

- Docker + the running local stack (`npm run db:start`). **Use the repo-pinned
  CLI** — this project's `config.toml` uses newer keys than older global CLIs
  accept. If `supabase status` fails to parse the config, run commands via
  `npx --prefix frontend supabase ...` (the `npm run db:*` scripts already do).
- The **Stripe CLI**: `npm i -g @stripe/cli` (verify with `stripe --version`).

## One-time setup

1. **Create a sandbox and get test keys** (no Stripe account or signup needed —
   uses a proof-of-work challenge):

   ```bash
   stripe sandbox create --email you@example.com
   ```

   This prints a `secret_key` (`rk_test_…`/`sk_test_…`), a `publishable_key`, and
   an `account_id`, and saves the key to your CLI profile so later `stripe`
   commands work. Sandboxes **expire after 7 days** — re-run this when keys stop
   working, or `stripe sandbox claim` to keep one.

2. **Create the recurring prices** the checkout functions reference:

   ```bash
   stripe products create --name "Grant Trail Basic Membership"
   stripe prices create --product prod_XXX --unit-amount 900  --currency usd -d "recurring[interval]=month"

   stripe products create --name "Grant Trail Fiscal Agent Access"
   stripe prices create --product prod_YYY --unit-amount 2900 --currency usd -d "recurring[interval]=month"
   ```

   Keep the two `price_…` IDs (Basic and Premium/Fiscal Agent).

3. **Get a webhook signing secret** (stable per machine):

   ```bash
   stripe listen --print-secret    # -> whsec_…
   ```

4. **Create the env file** from the template and fill in the values above:

   ```bash
   cp supabase/functions/.env.example supabase/functions/.env
   ```

   ```dotenv
   STRIPE_SECRET_KEY=rk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   STRIPE_PRICE_BASIC=price_…
   STRIPE_PRICE_FISCAL_AGENT_ACCESS=price_…
   APP_URL=http://localhost:3000
   ```

   `supabase/functions/.env` is **git-ignored** — never commit real keys. Only
   `.env.example` is tracked.

## Running it

Open two terminals:

```bash
# Terminal 1 — serve the functions with the env file
npx --prefix frontend supabase functions serve --env-file ./supabase/functions/.env

# Terminal 2 — forward sandbox webhook events to the local function
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook
```

Make sure the secret printed by `stripe listen` matches `STRIPE_WEBHOOK_SECRET` in
`.env`, or signature verification fails with HTTP 400.

## Verifying the wiring

```bash
# Fire a fake event — the listener should log <-- [200] and a row should appear
stripe trigger payment_intent.succeeded

docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "select stripe_event_id, event_type from billing_webhook_events order by id desc limit 5;"
```

Use `/stripe:test-cards` (or card `4242 4242 4242 4242`, any future expiry/CVC) for
checkout flows. To exercise the full subscription path end to end, sign in to the
frontend and start a checkout — the `checkout.session.completed` event flows back
through `stripe listen` into `upsertSubscriptionFromStripe`, which writes to
`subscriptions` and `user_memberships`.

## Common gotchas

| Symptom | Cause / fix |
|---------|-------------|
| Every function returns `Missing STRIPE_SECRET_KEY` | `.env` not passed — use `--env-file ./supabase/functions/.env`. |
| Webhook returns `Missing authorization header` | `verify_jwt` not disabled for `stripe-webhook` in `config.toml`, or server not restarted after the config change. |
| Webhook returns 400 `No signatures found matching…` | `STRIPE_WEBHOOK_SECRET` ≠ the secret `stripe listen` is using. |
| `supabase status` / `functions serve` fails to parse config | Global CLI too old — use the repo-pinned `npx --prefix frontend supabase`. |
| Stripe calls suddenly 401 | Sandbox expired (7 days) — run `stripe sandbox create` again and update `.env`. |
