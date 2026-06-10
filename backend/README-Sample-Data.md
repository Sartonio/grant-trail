# Sample Data Reference

> **Development only.** These sample data scripts (02, 03, 05, 06) are for local development and testing. For production deployments, use `21-PROD-Setup.sql` instead.

Run scripts in order: `01-Complete-Fresh-Setup.sql` → `02-Sample-Data.sql` → (optionally) `03-Large-Sample-Data.sql`

Run `04-Check-Missing-Auth-Users.sql` to see which Auth accounts need creating. After creating them in Supabase Dashboard, run `05-After-User-Creation.sql` to link UUIDs.

To start over: `00-Full-Teardown.sql`

---

## Tenants

| Tenant | Slug | Type | Approvals |
|--------|------|------|-----------|
| The Family Advocates Canada | `tfac` | managed | All on (default) |
| Bright Horizons Foundation | `bright-horizons` | managed | All on (default) |
| Lopez Consulting | `lopez-consulting` | self_service | All off |
| Greenleaf Bookkeeping | `greenleaf` | self_service | All off |

---

## Users (02-Sample-Data.sql)

### TFAC (managed)

| Name | Email | Role | Tax Month |
|------|-------|------|-----------|
| Maria Smith | maria.smith@example.com | grantee | May |
| Jacob Soto | jacob.soto@example.com | grantee | June |
| Faizan Sharp | faizan.sharp@example.com | grantee | May |
| Eric Hobbs | eric.hobbs@example.com | admin | — |
| Sam Reeves | sam.reeves@example.com | super_admin | — |

### Bright Horizons (managed)

| Name | Email | Role | Tax Month |
|------|-------|------|-----------|
| Priya Sharma | priya.sharma@example.com | grantee | April |
| David Chen | david.chen@example.com | grantee | April |
| Amara Okafor | amara.okafor@example.com | admin | — |

### Self-service

| Name | Email | Tenant | Tax Month |
|------|-------|--------|-----------|
| Carlos Lopez | carlos.lopez@example.com | Lopez Consulting | March |
| Nadia Park | nadia.park@example.com | Greenleaf Bookkeeping | September |

---

## Grants Summary

### TFAC

| Grant | Grantee | Status |
|-------|---------|--------|
| Community Outreach Program 2024 | Maria | Approved (with expenses) |
| Youth Education Initiative | Maria | Pending |
| After-School Program Funding | Jacob | Approved (with expenses) |
| Technology Access Grant | Jacob | Needs Changes |
| Mental Health Awareness Campaign | Faizan | Rejected |
| Food Security Initiative | Faizan | Approved (with expenses) |

### Bright Horizons

| Grant | Grantee | Status |
|-------|---------|--------|
| Women in STEM Scholarship | Priya | Pending |
| Newcomer Language Program | Priya | Approved (with expenses) |
| Youth Arts Initiative | David | Pending |

### Self-service (auto-approved)

| Grant | User | Status |
|-------|------|--------|
| Client Project Tracking Q1 | Carlos | Approved (with expenses) |
| Annual Operating Budget 2026 | Nadia | Approved (with expenses) |

---

## Large Sample Data (03-Large-Sample-Data.sql)

Creates **Alex Tan** (`alex.tan@example.com`, grantee in TFAC tenant) with:
- 50 grants (mixed statuses: ~62% approved, ~12% each for pending, needs_changes, rejected)
- 150 budget items (3 per grant)
- ~405 expenses (3 per budget item on approved grants)
- 1 stress-test grant with 25 budget items and 100 expenses on item #1

---

## Password

All sample Auth accounts should be created manually in the Supabase Dashboard (Authentication → Users → Add User). Use whatever password you like for testing. After creating them, run `05-After-User-Creation.sql` to link the Auth UUIDs.
