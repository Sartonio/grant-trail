# Dev Setup (Local)

Zero to a running local GrantTrail. For day-to-day operations (schema changes, resets,
troubleshooting) see [Dev Practices](dev_practices.md). For staging/prod see
[Staging Setup](staging_setup.md) / [Production Setup](prod_setup.md).

## Setup

1. **Prerequisites:** Node.js 18+ and npm (`node -v`), Docker running (`docker ps`). Stripe CLI
   (`stripe --version`) only if you'll test billing locally.
2. `npm run setup` — installs deps, copies env file templates, installs git hooks.
3. `npm run db:start` — boots local Supabase (Docker + migrations + seed).
4. `npm run dev` — app at http://localhost:3000.

Runs fully offline with deterministic local keys and seeded auth users — no manual account
creation, no paywall (seeded memberships bypass it). Log in with one of the
[test accounts](#test-accounts-password-password123) below.

`npm run setup` also pre-fills `frontend/.env.local` (Supabase URL + anon key, works as-is —
`VITE_`-prefixed vars baked into the bundle, restart dev server after changing) and installs the
git hooks. `db:start` resumes the existing local DB; `db:reset` wipes and rebuilds from the
migrations + `seed.sql`. See [Dev Practices](dev_practices.md) for the migration baseline,
hooks, and everyday gotchas.

## Concepts (60 seconds)

- **Tenant** = the account / data-isolation boundary (`tenants` table). **Organization** =
  the real-world entity a user belongs to (`users.organization_name`). Not interchangeable.
- **Roles:** `grantee` (owns grants/expenses), `admin` (tenant review workflows, via `/admin*`),
  `super_admin` (cross-tenant, via `/super/tenants`).
- **Tenant types:** *managed* (approval workflows, invite signup, admin role — e.g. TFAC) vs
  *self-service* (open signup, auto-approved, no admin role).

### Test accounts (password `password123`)

| Email | Role | Notes |
|---|---|---|
| `maria.smith@example.com` | Grantee | seeded Basic membership |
| `eric.hobbs@example.com` | Admin | subscription-exempt |
| `sam.reeves@example.com` | Super Admin | subscription-exempt |

Others (jacob.soto, faizan.sharp, etc.) are in `supabase/seed.sql`.

## Optional integrations

The app runs fully without these. Set them up when you need to test billing or email end-to-end.
Both live in `supabase/functions/.env`.

| Integration | What breaks without it | Guide |
|---|---|---|
| **Stripe** (test) | Checkout, portal, subscription webhooks error; paywall UI still works via seeded memberships | [Local Stripe Testing](local_stripe_testing.md) |
| **Resend** (email) | Receipts + inquiry emails silently skipped (no crash) | [Local Email Testing](local_email_testing.md) |

Auth emails (magic links, password resets) go through Supabase's built-in **Inbucket** at
`http://localhost:54324` — no setup needed.

### Running the billing stack locally (two terminals)

```bash
npm run db:start   # 1. Supabase stack (Docker)
npm run dev        # 2. edge functions + Stripe webhook forwarder + Vite
```

`npm run dev` ([`scripts/dev.sh`](../../scripts/dev.sh)) owns all three dev processes and tears them
down together on Ctrl-C. The `supabase start` stack does **not** load `supabase/functions/.env`, so
the functions are served separately with `--env-file`; the forwarder reuses the same
`STRIPE_SECRET_KEY`, so there is nothing extra to configure.

Get the signing secret once (it is stable per machine) and put it in `supabase/functions/.env`:

```bash
stripe listen --print-secret   # -> whsec_…  → STRIPE_WEBHOOK_SECRET
```

If it does not match what the forwarder is using, every webhook 400s (`No signatures found
matching…`) — `npm run dev` checks this at startup and prints the correct value. Test card
`4242 4242 4242 4242` (any future expiry/CVC); see [Local Stripe Testing](local_stripe_testing.md)
for the full card matrix, the automated suite, and the debugging table.

Verify a checkout wrote through:
```bash
docker exec supabase_db_grant-trail psql -U postgres -d postgres \
  -c "SELECT stripe_subscription_id, status FROM subscriptions ORDER BY id DESC LIMIT 3;"
```
