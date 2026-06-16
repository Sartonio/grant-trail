---
name: grant-trail-standards
description: Strict architectural rules and coding standards for the GrantTrail application. ACTIVATE this skill whenever writing React code, Playwright tests, or Supabase queries for the GrantTrail project.
---

# GrantTrail Coding Standards

When contributing to the GrantTrail codebase, you MUST adhere to the following architectural constraints and patterns.

## 1. Authentication & Identifiers (CRITICAL)
- **Two IDs:** The `users` table has an integer primary key (`id`) and a UUID `user_id` that maps to Supabase Auth.
- **Rule:** Use `session.user.id` (UUID) **only** when querying the `users` table directly.
- **Rule:** Use `session.userRecord.id` (integer) as the foreign key when inserting into business tables (e.g., `grant_record`, `expenses`).
- **Do not** use the Supabase `service_role` key in frontend code to bypass Row Level Security. All frontend database calls must be made as the authenticated user, relying on Postgres RLS for isolation.

## 2. Supabase Migrations
- The project has migrated to the formal **Supabase CLI**. 
- **Rule:** Never modify the legacy monolithic `.sql` files in `backend/` or run them manually via `docker exec`.
- **Rule:** All database schema changes must be generated via `supabase migration new` and stored in `supabase/migrations/`.
- **Rule:** Development data should be managed via `supabase/seed.sql`.

## 3. Playwright E2E Testing
- **Rule:** Never write raw, inline Supabase `createClient()` calls inside individual `*.spec.js` files to seed or tear down data.
- **Rule:** Always import and use the custom Playwright fixture from `frontend/tests/e2e/fixtures.js`. Use helper methods like `testData.createAuthUser()`, `testData.createManagedTenant()`, and `testData.createGrant()`.
- **Rule:** Rely on the automatic bottom-up teardown built into the fixture. Do not manually delete records at the end of tests.

## 4. Frontend Styling
- **Rule:** Do NOT use Tailwind CSS or any third-party UI library.
- **Rule:** Rely exclusively on the custom CSS variable system defined in `frontend/src/styles/variables.css`.
- **Rule:** Always use semantic variables (e.g., `var(--color-primary)`, `var(--spacing-md)`) rather than hardcoding hex codes or pixel values.

## 5. Architectural Patterns
- **Rule:** Rely on Database Triggers. Do not manually write inserts for `grant_status_history` in frontend code—the database triggers handle this automatically.
- **Rule:** When uploading files to Supabase Storage, implement **Compensating Transactions**. Upload the file first, then insert the database record. If the database insert fails, manually delete the orphaned file from Storage.
- **Rule:** Always use `.single()` for Supabase queries when expecting exactly one row (e.g., fetching a user profile or a specific grant by ID) to avoid unnecessary array unpacking.
- **Rule:** Do not re-invent the wheel. Read `DEVELOPER.md` to understand the `useCallback` + `useEffect` fetching pattern and UI patterns (like Two-Click Deletes).

## 6. Error Handling & Observability
- **Rule:** Never swallow errors implicitly. Always capture and log them, providing user-friendly fallback UI where applicable (e.g., via React Error Boundaries).
- **Rule:** For third-party integrations (like Stripe or SendGrid), always wrap calls in `try/catch` and anticipate network latency, 500 errors, or rate limits. Use Sentry for tracking unexpected frontend exceptions.
- **Rule:** Ensure that error states degrade gracefully. If a non-critical system fails (e.g., analytics), the core grant application must remain functional.

## 7. Defensive Programming & Code Quality
- **Rule:** Embrace fail-fast principles. Validate all inputs, prop types, and external data payloads before operating on them. Use optional chaining (`?.`) and nullish coalescing (`??`) to defend against unexpected `null` or `undefined` properties from API responses.
- **Rule:** Keep components modular and single-purpose (Separation of Concerns). If a component exceeds 300-400 lines, extract its logic into custom hooks or smaller sub-components.
- **Rule:** Write descriptive, self-documenting code over excessive comments. Variable names should reveal intent (e.g., `isSubmitting` instead of `loading`, `grantApplicationId` instead of `id`).

## 8. Security & Zero Trust
- **Rule:** Never trust the client. The frontend is insecure by definition. All business rules, role checks, and tenant isolation logic MUST be enforced at the database level via Row Level Security (RLS) policies.
- **Rule:** Sanitize all user-generated content before rendering it in the DOM to prevent Cross-Site Scripting (XSS).
- **Rule:** Enforce the principle of least privilege. Do not expose database columns or API routes that the current user context does not strictly need to access.
