# Dev Setup (Local)

Zero to a running local GrantTrail. For day-to-day operations (schema changes, resets,
troubleshooting) see [Dev Practices](dev_practices.md). For staging/prod see
[Staging Setup](staging_setup.md) / [Production Setup](prod_setup.md).

## Prerequisites

- **Node.js 18+** and **npm** (`node -v`)
- **Docker**, running (`docker ps`) — required by local Supabase
- **Stripe CLI** (`stripe --version`) — only if you're testing billing locally

## Concepts (60 seconds)

- **Tenant** = the account / data-isolation boundary (`tenants` table). **Organization** =
  the real-world entity a user belongs to (`users.organization_name`). Not interchangeable.
- **Roles:** `grantee` (owns grants/expenses), `admin` (tenant review workflows, via `/admin*`),
  `super_admin` (cross-tenant, via `/super/tenants`).
- **Tenant types:** *managed* (approval workflows, invite signup, admin role — e.g. TFAC) vs
  *self-service* (open signup, auto-approved, no admin role).

## Quick start

```bash
npm run setup      # 1. deps + env files + git hooks
npm run db:start   # 2. local Supabase (Docker + migrations + seed)
npm run dev        # 3. app at http://localhost:3000
```

Runs fully offline with deterministic local keys and seeded auth users — no manual account
creation, no paywall (seeded memberships bypass it).

### What `npm run setup` does

1. **`npm install --prefix frontend`** — frontend deps (the only install; root has no devDeps).
2. **Copies env templates** — `frontend/.env.local` (pre-filled with the local Supabase URL +
   anon key — works as-is) and `supabase/functions/.env` for edge-function secrets (blank Stripe
   keys; the app boots fine without them, only billing functions need them).
3. **`install-git-hooks.js`** — `git config core.hooksPath .githooks`, wiring:
   - **pre-push** — blocks a push with uncaptured schema drift, then runs `npm run verify`.
   - **post-merge** — after a pull, runs `supabase migration up` (incremental; preserves data).

### `db:start` vs `db:reset`

`db:start` boots the stack (resumes an existing DB). `db:reset` wipes and rebuilds from
scratch — re-applies all migrations + `seed.sql`, then regenerates `database.types.ts`.

Migrations are **squashed** into two baseline files (`20260630130000_squashed_schema.sql` +
`20260630140000_bootstrap_data.sql`); new changes go on top. See
[Dev Practices → Schema changes](dev_practices.md#schema-changes-local-first-migrations).

### Test accounts (password `password123`)

| Email | Role | Notes |
|---|---|---|
| `maria.smith@example.com` | Grantee | seeded Basic membership |
| `eric.hobbs@example.com` | Admin | subscription-exempt |
| `sam.reeves@example.com` | Super Admin | subscription-exempt |

Others (jacob.soto, faizan.sharp, etc.) are in `supabase/seed.sql`.

## Frontend env vars

`frontend/.env.local` is created by setup (git-ignored; template is `frontend/.env.example`).

| Variable | Used by | Source |
|---|---|---|
| `VITE_SUPABASE_URL` | `supabaseClient.js`, `lib/billing.js` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_KEY` | `supabaseClient.js`, `lib/billing.js` | Supabase → Settings → API → anon/public key |

Vars **must** start with `VITE_` (baked into the bundle at build time — restart the dev server
after changing). New var → add a placeholder to `.env.example` and handle empty/undefined
gracefully (no crash). The anon key being in the bundle is normal and safe.

## Optional integrations

The app runs fully without these. Set them up when you need to test billing or email end-to-end.
Both live in `supabase/functions/.env`.

| Integration | What breaks without it | Guide |
|---|---|---|
| **Stripe** (test) | Checkout, portal, subscription webhooks error; paywall UI still works via seeded memberships | [Local Stripe Testing](local_stripe_testing.md) |
| **Resend** (email) | Receipts + inquiry emails silently skipped (no crash) | [Local Email Testing](local_email_testing.md) |

Auth emails (magic links, password resets) go through Supabase's built-in **Inbucket** at
`http://localhost:54324` — no setup needed.

### Running the billing stack locally (four terminals)

```bash
npm run db:start                                                                   # 1. stack
npx --prefix frontend supabase functions serve --env-file ./supabase/functions/.env  # 2. edge fns
stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook      # 3. webhook fwd
npm run dev                                                                         # 4. app
```

Terminal 3 prints a `whsec_…` — paste it into `STRIPE_WEBHOOK_SECRET` and restart terminal 2.
The secret changes every `stripe listen` session; a stale one → every webhook 400s. Test card
`4242 4242 4242 4242` (any future expiry/CVC); see [Local Stripe Testing](local_stripe_testing.md)
for the full card matrix, the automated suite, and the debugging table.

Verify a checkout wrote through:
```bash
docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "SELECT stripe_subscription_id, status FROM subscriptions ORDER BY id DESC LIMIT 3;"
```

## Things every dev should know

- **Two user IDs, not interchangeable:** `auth.users.id` (UUID, Supabase Auth) vs `users.id`
  (int PK, the FK used everywhere else — `grant_record.user_id`, `expenses.user_id`, …).
- **RLS fails silently:** a disallowed row returns `data:null, error:null`, not an exception.
  Always null-check. Less data than expected → suspect RLS.
- **Triggers own side effects** — spending totals (`total_spent`, `remaining_balance`,
  `amount_spent`), `grant_status_history`, and `notifications` are all trigger-managed. Don't
  replicate them in the frontend or you'll create duplicate data.
- **Never edit a committed migration** — prod tracks by version, not content; edits never re-run.
- **`stripe-webhook` is the only `verify_jwt=false` function** — Stripe authenticates via the
  `stripe-signature` header, not a JWT. Don't change it.
- **CSS uses design tokens** — `var(--color-primary)`, not raw hex; tokens in
  `frontend/src/styles/variables.css`. No Tailwind.
- **Removed edge functions aren't auto-pruned:** `npm run functions:prune -- --project-ref <ref>`.
