# Test Users & Signup Reference

Quick reference for local dev accounts and how new users get into GrantTrail.

## Test users

All local accounts use the password **`password123`**. Seeded via `supabase/seed.sql`.

### Tenant: `tfac` (platform root)

| Email | Role | Org | What you can do |
|---|---|---|---|
| `maria.smith@example.com` | grantee | Helping Hands | Create/track grants, budgets, and expense reports for their own org |
| `jacob.soto@example.com` | grantee | Bright Future Org | Same as above (second grantee for multi-user tests) |
| `faizan.sharp@example.com` | grantee | Hope Foundation | Same as above |
| `eric.hobbs@example.com` | admin | The Family Advocates Canada | Review/approve grants, manage tenant users, admin settings, audit log |
| `sam.reeves@example.com` | super_admin | The Family Advocates Canada | Cross-tenant operations via `/super/tenants`; **billing-exempt** |

### Tenant: `bright-horizons`

| Email | Role | What you can do |
|---|---|---|
| `priya.sharma@example.com` | grantee | Grants/expenses for their org |
| `david.chen@example.com` | grantee | Grants/expenses for their org |
| `amara.okafor@example.com` | admin | Admin review + user management within this tenant |

### Other tenants (single grantee each)

| Email | Role | Tenant |
|---|---|---|
| `carlos.lopez@example.com` | grantee | `lopez-consulting` |
| `nadia.park@example.com` | grantee | `greenleaf` |

## How applicants sign up

New (non-invited) visitors start at **`/join`**, the single decision point. Invited users skip it —
invite links go straight to `/signup?invite=…`, which presets the role and skips payment.

Signup is account-first: `/signup` collects email + password only, then email verification routes to
`/complete-profile` to finish setup (role assignment + payment).

| Path | Route | Role assigned | Billing |
|---|---|---|---|
| **Self-serve** — find a fiscal agent / track grants | `/join` → `/signup` | grantee | Basic |
| **Fiscal agent** — list a 501(c)(3) in the directory | `/join` → `/fiscal-agents/list` (`?plan=fiscal-agent`) | admin | Premium |
| **Invited** — joining an existing org | `/signup?invite=…` | preset by invite | Covered by inviting org |

## What each role allows

| Role | Access |
|---|---|
| **grantee** | Owns their org's grants, budget allocations, and expense reports. `/grants*` and `/expenses` are grantee-only. Cannot post grant comments. |
| **admin** (tenant) | Reviews/approves grants, manages tenant users and settings, views audit log. A **lapsed subscription** drops them to **read-only** admin access (not locked out). |
| **super_admin** | Operates across tenants via `/super/tenants`. **Billing-exempt.** |

> Access is enforced by Postgres Row Level Security — the UI only mirrors these rules for UX.
