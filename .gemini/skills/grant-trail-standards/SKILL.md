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
