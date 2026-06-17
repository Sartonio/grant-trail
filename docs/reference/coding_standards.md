# Coding Standards

All contributors must follow these standards when working in the GrantTrail codebase. They encode architectural decisions that are easy to break accidentally.

---

## 1. Authentication & Identifiers

- The `users` table has an integer primary key (`id`) and a UUID `user_id` that maps to Supabase Auth.
- Use `session.user.id` (UUID) only when querying the `users` table directly.
- Use `session.userRecord.id` (integer) as the foreign key when inserting into business tables (`grant_record`, `expenses`, etc.).
- Never use the `service_role` key in frontend code. All frontend queries must run as the authenticated user and rely on RLS for isolation.

---

## 2. Database Migrations

- All schema changes must be generated via `supabase db diff` and stored in `supabase/migrations/`.
- Never modify schema directly on remote environments.
- Development seed data is managed via `supabase/seed.sql`. Keep it in sync with schema changes.

---

## 3. Testing

- Never write raw `createClient()` calls inside individual `*.spec.js` test files.
- Always import and use the shared Playwright fixture from `frontend/tests/e2e/fixtures.js`. Use `testData.createAuthUser()`, `testData.createManagedTenant()`, `testData.createGrant()`, etc.
- Rely on the automatic bottom-up teardown in the fixture. Do not manually delete records at the end of tests.

---

## 4. Frontend Styling

- Do not use Tailwind CSS or any third-party UI library.
- Use only the CSS custom property system defined in `frontend/src/styles/variables.css`.
- Always use semantic variables (`var(--color-primary)`, `var(--spacing-md)`) rather than hardcoded values.

---

## 5. Architectural Patterns

- **Database triggers** — Do not manually insert into `grant_status_history`. The `trg_grant_status_tracking` trigger handles this automatically on status changes.
- **Compensating transactions** — When uploading files to Supabase Storage, upload first, then insert the database record. If the insert fails, delete the orphaned file in the `catch` block.
- **Single-row queries** — Use `.single()` when expecting exactly one row. Handle the resulting `error` object; do not assume success.
- **Established patterns** — Read [development_patterns.md](file:///home/ryan/Documents/grant-trail/docs/explanation/development_patterns.md) before implementing data fetching or UI interactions. The `useCallback` + `useEffect` pattern and two-click delete pattern are both documented there.

---

## 6. Error Handling

- Never swallow errors silently. Always capture, log, and provide user-facing fallback UI where applicable.
- Wrap all third-party API calls (`Stripe`, etc.) in `try/catch`. Anticipate network failures, 500 errors, and rate limits.
- Non-critical failures (analytics, notifications) must not take down core functionality.

---

## 7. Defensive Programming

- Validate all inputs and external API payloads before operating on them.
- Use optional chaining (`?.`) and nullish coalescing (`??`) to guard against unexpected `null` or `undefined` from API responses.
- Keep components focused. If a component exceeds 300–400 lines, extract logic into custom hooks or sub-components.
- Write self-documenting variable names (`isSubmitting` not `loading`, `grantApplicationId` not `id`).

---

## 8. Security

- Never trust the client. All business rules, role checks, and tenant isolation must be enforced at the database level via RLS policies.
- Sanitize all user-generated content before rendering it in the DOM.
- Follow the principle of least privilege — do not expose columns or API routes that the current user context does not need.
