# Security Headers Configuration

Baseline security headers for GrantTrail. Deploy target is a **Vite SPA on
Vercel**; the deployed config is `frontend/vercel.json`.

Date: 2026-06-19 · Branch: `main`

---

## Secure Transport / Headers

Headers are configured in `frontend/vercel.json` (does **not** affect local
`vite dev`, which never reads `vercel.json`):

| Header | Value | Notes |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | enforced |
| `X-Frame-Options` | `DENY` | legacy clickjacking protection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | enforced |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | enforced (Vercel serves HTTPS only) |
| `Content-Security-Policy-Report-Only` | see below | **report-only** to avoid breakage |

**CSP shipped as Report-Only (conservative).** It defines a sane policy without
risking a production break; promote to enforcing (`Content-Security-Policy`)
after confirming no violations are reported. Policy:
```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
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
`'unsafe-inline'` is allowed for **styles only** (React/Recharts inline styles);
scripts remain restricted. Before enforcing CSP, confirm no
`script-src 'unsafe-inline'`/`unsafe-eval` is needed and watch report-only
violations in production.

---

## Secrets Sweep

### `.env` gitignore coverage — ✅ OK
All real env files are ignored; only `*.example` templates are tracked:
- Tracked: `frontend/.env.example`, `supabase/.env.example`,
  `supabase/functions/.env.example` (templates — fine).
- `git check-ignore` confirms `frontend/.env`, `frontend/.env.local`,
  `supabase/.env`, `supabase/.env.local` are all **IGNORED**.

### Working tree — 1 finding

**`frontend/seed_auth.mjs:4` — hardcoded Supabase service-role key + password**
```
const supabaseUrl = 'http://127.0.0.1:54321';            // LOCAL stack
const supabaseKey = 'sb_secret_LOCAL_DEV_KEY'; // service_role
...
password: 'password123'
```
- **Severity: LOW.** Points exclusively at the **local** Supabase stack
  (`127.0.0.1:54321`); it is a local dev seeding script with a throwaway
  password. It is **not** a production credential.

### Git history — ✅ clean (no real secrets, no rewrite needed)
- Only JWTs found anywhere in history are the **public Supabase demo keys**
  (`iss: supabase-demo`, anon + service_role) — these are documented defaults
  shipped with every local Supabase install, **not secrets**. They appear in
  `.github/scripts/edge-fn-ci-lib.sh` as the standard local `ANON_KEY` default.
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
