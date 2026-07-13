# Security Headers Configuration

Baseline security headers for GrantTrail. Deploy target is a **Vite SPA on
Vercel**; the deployed config is `vercel.json` at the repo root.

---

## Secure Transport / Headers

Headers are configured in `vercel.json` (does **not** affect local `vite dev`,
which never reads `vercel.json`):

| Header | Value | Notes |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | enforced |
| `X-Frame-Options` | `DENY` | legacy clickjacking protection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | enforced |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | enforced (Vercel serves HTTPS only) |
| `Content-Security-Policy` | see below | **enforced** |

**CSP is enforced** (`Content-Security-Policy`). Policy:
```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
worker-src 'self' blob:;
img-src 'self' data: https:; font-src 'self' data:;
style-src 'self' 'unsafe-inline';
script-src 'self' https://js.stripe.com;
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://*.sentry.io https://*.ingest.sentry.io https://api.stripe.com;
frame-src https://js.stripe.com https://checkout.stripe.com;
form-action 'self' https://checkout.stripe.com
```
Origins reflect the app's real external dependencies (Supabase https+wss, Sentry
DSN, Stripe). `frame-ancestors 'none'` complements `X-Frame-Options`.
`worker-src 'self' blob:` permits blob-backed web workers. `'unsafe-inline'` is
allowed for **styles only** (React/Recharts inline styles); scripts remain
restricted to `'self'` and Stripe.js (no `'unsafe-inline'`/`'unsafe-eval'`).

---

## Secrets Sweep

### `.env` gitignore coverage — ✅ OK
All real env files are ignored; only `*.example` templates are tracked:
- Tracked: `frontend/.env.example`, `supabase/.env.example`,
  `supabase/functions/.env.example` (templates — fine).
- `git check-ignore` confirms `frontend/.env`, `frontend/.env.local`,
  `supabase/.env`, `supabase/.env.local` are all **IGNORED**.

### Working tree — ✅ OK

`frontend/seed_auth.mjs` is a local-only seeding helper. It does **not** hardcode
a service-role key — it reads `SUPABASE_SERVICE_ROLE_KEY` from the environment
and defaults the URL to the local stack (`127.0.0.1:54321`). The only literal
credential is the throwaway local test password `password123`.

### Git history — ✅ clean (no real secrets, no rewrite needed)
- Only JWTs found anywhere in history are the **public Supabase demo keys**
  (`iss: supabase-demo`, anon + service_role) — these are documented defaults
  shipped with every local Supabase install, **not secrets**. They appear in
  `supabase/functions/tests/lib/stripe_test_helpers.sh` as the standard local `ANON_KEY` default.
- No `sk_live_…`, `rk_live_…`, `whsec_…` (real), AWS `AKIA…`, GitHub `ghp_…`,
  or PEM private keys found in working tree or history.
- `Capstone5-3/.../.env:Zone.Identifier` in old history = a Windows binary
  metadata stub (no secret payload).
- A `supabase/functions/.env` entry surfaced only from a **git stash** commit
  (`untracked files on main`), never an actual branch commit — no retrievable
  secret content.
- Stripe/Supabase strings in `docs/**` are all placeholders (`sk_live_...`,
  `whsec_...`) in documentation, not real values.

**No git history was rewritten**. No production rotation is required based on
this sweep.
