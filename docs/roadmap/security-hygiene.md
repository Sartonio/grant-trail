# Security Hygiene Baseline Pass

Basic cyber-hygiene pass for GrantTrail (no formal framework). Conservative:
only clearly-safe fixes applied; anything risky is flagged for human review.

Date: 2026-06-19 · Branch: `worktree-agent-...` (off merged `main`)

CI status after changes: **lint ✅ · unit tests ✅ (62/62) · build ✅**

---

## (1) Dependency / Vuln Scan

**Status: PARTIAL — 1 high advisory remains, no safe fix available (FLAGGED).**

| Scope | Result |
| --- | --- |
| `frontend/` `npm audit` | 1 **high** advisory: `xlsx` |
| repo root `npm audit` | N/A — root `package.json` has **no dependencies** (scripts-only, no lockfile). Nothing to audit. |

### Remaining advisory (FLAGGED — needs human decision)

**`xlsx` (SheetJS) — HIGH**
- Prototype Pollution — GHSA-4r6h-8v6p-xvw6
- ReDoS — GHSA-5pgg-2g8v-p4x9
- Installed: `0.18.5` (latest on the public npm registry). **No fix available via npm.**
  `npm audit fix` (without `--force`) does **not** resolve it — it only pulls in
  a transitive `@adobe/css-tools` bump for a dev dependency.
- The patched SheetJS (`>=0.20.x`) is published **only on SheetJS's own CDN**
  (`cdn.sheetjs.com`), not npm. Switching the install source is a
  dependency-sourcing change with supply-chain implications — **not** a safe
  auto-fix.
- **Usage:** `frontend/src/components/ExpenseReports.js` — `XLSX.writeFile(...)`
  to **generate/export** an `.xlsx` file client-side. The app does **not parse
  untrusted workbooks** here, which substantially lowers real-world exposure of
  both advisories (both are primarily triggered on the read/parse path).
- **Recommendation (human review):**
  1. Preferred: migrate to a maintained alternative for write-only export
     (e.g. `exceljs`, or `write-excel-file`), or
  2. Pin to the SheetJS CDN build `xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/...`
     if staying on SheetJS, after vetting the source, or
  3. Accept the risk short-term given the write-only usage and document it.

**No dependency changes were applied** — the only advisory has no safe upgrade,
so nothing was bumped and nothing needed reverting.

---

## (2) Secrets Sweep

**Status: DONE — no production secrets found. One local-dev hardcoded key FLAGGED.**

### `.env` gitignore coverage — ✅ OK
All real env files are ignored; only `*.example` templates are tracked:
- Tracked: `frontend/.env.example`, `supabase/.env.example`,
  `supabase/functions/.env.example` (templates — fine).
- `git check-ignore` confirms `frontend/.env`, `frontend/.env.local`,
  `supabase/.env`, `supabase/.env.local` are all **IGNORED**.

### Working tree — 1 finding (FLAGGED)

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
- Still flagged because (a) committing a `service_role`-shaped secret is poor
  hygiene and (b) this file is **outside this pass's edit boundary**
  (frontend source, not config), so it was left untouched per the boundaries.
- **Recommendation:** read the key from `process.env.SUPABASE_SERVICE_ROLE_KEY`
  (sourced from gitignored `supabase/.env`) instead of inlining it; if the local
  stack uses a non-default `sb_secret_...` key, **rotate the local key** after
  removing it. No production rotation required.

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

**No git history was rewritten** (per instructions). No production rotation is
required based on this sweep.

---

## (3) Secure Transport / Headers

**Status: DONE — baseline headers added to `frontend/vercel.json`.**

Deploy target is a **Vite SPA on Vercel**; the deployed config is
`frontend/vercel.json`. Added a `headers` block (does **not** affect local
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
scripts remain restricted. **Flag for follow-up:** before enforcing CSP, confirm
no `script-src 'unsafe-inline'`/`unsafe-eval` is needed and watch report-only
violations in production.

---

## (4) CI advisory step (optional, non-blocking)

Added an **advisory** dependency-audit step to `.github/workflows/ci.yml`
(`build-and-test` job, after the build):
```yaml
- name: Dependency audit (advisory)
  run: npm audit --audit-level=high || true
```
Surfaces HIGH/CRITICAL advisories in the logs **without failing** the pipeline
(`|| true`). Promote to a hard gate once the `xlsx` advisory is resolved.

---

## Summary: changed vs flagged

**Changed (safe):**
- `frontend/vercel.json` — added security `headers` block (item 3).
- `.github/workflows/ci.yml` — added advisory `npm audit` step (item 4).
- `docs/roadmap/security-hygiene.md` — this report.

**Flagged (human review, not changed):**
- `xlsx` HIGH advisory — no safe npm fix; needs dependency migration or CDN pin
  decision (item 1).
- `frontend/seed_auth.mjs` hardcoded **local** service-role key + password —
  low severity, outside edit boundary; move to env + rotate local key (item 2).
- CSP is **Report-Only** by design — promote to enforcing after monitoring (item 3).

**Not touched (per boundaries):** `supabase/**`, `frontend/src/lib/guards.js`,
`frontend/src/App.js`, other lanes' code.
