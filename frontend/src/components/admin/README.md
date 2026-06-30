# components/admin

Tenant-admin and super-admin screens. Routes are guarded with
`billingMode="readOnly"`, so these components receive a `readOnly` prop.

- `AdminDashboard.js` — admin landing: grant stats, review queue, charts.
- `AdminGrantList.js` — filterable/sortable list of the tenant's grants + pending counts.
- `AdminGrantReview.js` — single-grant review: approve / reject / needs-changes, attachments.
- `AdminUserList.js` — manage tenant users: roles, enable/disable, invites.
- `AdminSettings.js` — tenant approval toggles, support email/phone.
- `AdminAuditLog.js` — paginated audit trail of record changes (diff view).
- `TenantManagement.js` — super-admin only: create/search/manage tenants.

Invariant: a lapsed admin (no premium, not exempt) is READ-ONLY. Honor the
`readOnly` prop and route every mutation through `useWriteGuard(session)` —
do not call Supabase mutations directly. The DB enforces this via RLS too.
