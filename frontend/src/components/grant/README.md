# components/grant

Grantee grant lifecycle: create, list, view, budget, expenses, attachments,
plus the grantee dashboard.

- `Main.js` — grantee dashboard: summary stats and quick links.
- `Grants.js` — grantee's grant list (search/filter/sort via utils/grantsList).
- `CreateGrant.js` — create/edit a grant.
- `GrantDetail.js` — single-grant overview + charts + attachments.
- `GrantBreakdown.js` — budget items + expenses for a grant; hosts the modals.
- `BudgetItemModal.js` — add/edit a budget line.
- `AddExpenseModal.js` — add an expense (with receipt upload).
- `ExpenseReports.js` — expense reporting + Excel export (gated by `hasFeature`).
- `GrantAttachments.js` — upload/list/delete grant files (5 MB cap, type allowlist).

Invariant: these are grantee-scoped; all data access relies on tenant/owner RLS.
Mutations should pass `session` through so write gating stays consistent.
