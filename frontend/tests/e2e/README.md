# End-to-End Testing (Playwright)

This directory contains automated end-to-end (E2E) tests for the Grant Trail application using [Playwright](https://playwright.dev/). 

## Setup
Playwright is configured to automatically start the local React development server (`npm start`) before running the tests. It connects to whatever backend the `.env.local` file is pointed to. For isolated testing, it is recommended to test against a fresh local Supabase instance.

## Running Tests

- **Run all tests in the background (headless):**
  ```bash
  npx playwright test
  ```
- **Run all tests and see the browser (headed):**
  ```bash
  npx playwright test --headed
  ```
- **Run a specific test file:**
  ```bash
  npx playwright test tests/e2e/onboarding.spec.js
  ```

## Test Flows

The suite spans 12 spec files (26 test cases) covering onboarding, billing, the three
roles (grantee / admin / super-admin), and negative authorization / tenant-isolation
checks. The core flows are described below.

### 0. Smoke (`smoke.spec.js`)
**What it does:**
- Loads the public landing page and asserts it renders, as a fast liveness check for the dev server and app boot.

### 1. Onboarding (`onboarding.spec.js`)
**What it does:**
- Navigates to the `/signup` page.
- Registers a new user with a dynamically generated email (to avoid collisions on repeated test runs) and a test password.
- Waits for the application to redirect to the `/complete-profile` page.
- Fills out the required profile fields (First Name, Last Name, Phone Number, Organization).
- Clicks the "Complete Setup" button and verifies that the user is successfully redirected to their dashboard or the subscription page (`/home`, `/admin`, or `/subscription`).

### 2. Invite-Only Onboarding (`invite-onboarding.spec.js`)
**What it does:**
- Seeds a managed tenant, its tenant settings, and an admin user in the database via the service-role client.
- Seeds an active invite row in the `invites` table linked to the tenant.
- Navigates the browser to `/signup?invite=<token>` and verifies the signup page pre-fills the invite email and shows the invite role context.
- Fills the password and signs up, redirects to `/complete-profile?invite=<token>`, fills in profile details, and clicks "Complete Setup".
- Verifies that the new user is redirected correctly and assigned the correct role and tenant in the database, and that the invite is marked as consumed.
  - *Note:* invite reads and consumption go through the `get_invite_by_token` / `consume_invite` SECURITY DEFINER RPCs; the `invites` table is no longer anon-readable.

### 3. Subscription (`subscription.spec.js`)
**What it does:**
- **Account Setup:** Registers a fresh user dynamically to establish a clean state, and verifies the user ID is correctly inserted into the `users` table via a direct Supabase query.
- **Navigation:** Navigates to `/subscription` and verifies the UI states "No active subscription".
- **Mocking the API:** Uses Playwright's `page.route` to intercept network requests specifically bound for the Stripe Edge Function. It instantly responds with a mocked successful checkout URL (`/subscription?success=true`) to bypass actual Stripe API limits and flaky third-party integrations.
- **Simulating the Webhook:** It uses the `@supabase/supabase-js` service role client to directly execute the exact database mutations a real Stripe Webhook would perform: inserting a record into `subscriptions` and `user_memberships`.
  - *Note:* The test enforces database integrity by specifically utilizing the exact required `stripe_product_id` and `stripe_price_id` to satisfy the backend's strict constraint triggers.
- **Final UI Verification:** It reloads the page and targets the specific heading (`getByRole('heading', { name: 'Manage Basic Subscription' })`) to guarantee the front-end successfully synchronized with the backend membership changes.

### 4. Workspace Access & Expense Tracking (`workspace.spec.js`)
**What it does:**
- Creates a new user via the signup UI and profile completion.
- Bypasses the subscription wall by directly inserting a basic-tier membership/subscription into the database.
- Navigates to `/grants/new`, submits a new grant application, and navigates to the grant details page.
- Accesses the budget breakdown page (`/grants/:id/breakdown`), adds a new budget item via a modal, expands the budget item accordion, and adds a new expense.
- Verifies that the expense is rendered in the UI and asserts the data was successfully written to the database.

### 5. Premium Reporting & Excel Export (`reporting.spec.js`)
**What it does:**
- Seeds a premium-tier user, subscription, membership, grant, budget item, and expense in the database via the service-role client.
- Logs in as the premium user and navigates to the expense reports page (`/expenses`).
- Verifies the summary strip shows the correct totals (count, total amount, number of grants).
- Verifies the expense table renders the seeded expense row.
- Clicks the "Export Excel" button (which is gated by premium access) and verifies that an `.xlsx` file download is successfully triggered.

### 6. Admin Grant Review (`admin-review.spec.js`)
**What it does:**
- Seeds admin and grantee user records, a managed tenant, and a pending grant record in the database using the service-role client.
- Bypasses subscription checks by setting `require_subscription: false` on the tenant's settings.
- Logs in as the admin user and navigates to the admin review page for the pending grant (`/admin/grants/:id`).
- Clicks the "Approve" button, completes the approval confirmation form, and waits for the API update response.
- Verifies the UI success message is shown.
- Directly queries the database to assert that the grant's status was changed to `approved` and a notification was sent to the grantee.

### 7. Notifications & Audit Trail Flow (`notifications-audit.spec.js`)
**What it does:**
- Seeds a grantee user, self-service tenant, active subscription, membership, and a new grant record in the database using the service-role client.
- Updates the grant's status to `needs_changes` and then back to `approved` via direct Supabase client calls.
  - *Triggers:* Triggers `notify_grant_status_change` which inserts database notification records, and `trg_audit_grant_record` which inserts change logs into `audit_log`.
- Logs in as the grantee user via the browser and waits for the backend to respond to notification fetch calls.
- Verifies that the notification bell displays a badge count of `2`.
- Clicks the bell trigger and asserts that the dropdown panel contains the two notifications mentioning the correct grant name.
- Directly queries the `audit_log` table via Supabase to verify that both `UPDATE` entries exist with the corresponding status change values.
- Wipes all seeded data (grant, users, tenant, auth user) bottom-up in a `finally` block to prevent foreign key errors.

### 8. Grantee Flows (`grantee-flows.spec.js`)
**What it does:**
- Exercises grantee-owned views: the grant detail status-history timeline, uploading an attachment and seeing it listed, and exporting the expense report as CSV.

### 9. Admin Management Flows (`admin-flows.spec.js`)
**What it does:**
- Covers tenant-admin actions: requesting changes on a pending grant, generating an invite link from user management, promoting a grantee to admin, toggling an approval workflow in settings, filtering the audit log by table, and exporting the grant list as CSV.

### 10. Super-Admin Platform Flows (`super-admin-flows.spec.js`)
**What it does:**
- Logs in as a super admin and verifies the platform surface at `/super/tenants`: landing on tenant management with cross-tenant data, disabling and re-enabling a tenant, and saving platform defaults.

### 11. Authorization & Tenant Isolation (`authz-negative.spec.js`)
**What it does:**
- Negative authz checks: a logged-out visitor is redirected to `/login` on protected routes; a grantee is bounced from admin/super routes; an admin is bounced from super-admin routes; and an admin in tenant A cannot see or directly open tenant B's grant (RLS-backed tenant isolation).

## Playwright Best Practices Used
- **User-Facing Locators**: Instead of targeting brittle CSS classes or specific `name` attributes, tests use `getByPlaceholder` and `getByRole`. This ensures tests only pass when the elements are genuinely accessible and visible to a real user.
- **Dynamic Test Data**: Timestamped emails/identifiers are generated at runtime to ensure the database doesn't reject subsequent runs due to "Email already exists" or other unique constraint errors.
- **Direct Database Assertions**: Tests use the `@supabase/supabase-js` client with the `SUPABASE_SERVICE_ROLE_KEY` to directly query the database and assert that backend triggers, inserts, and state changes worked correctly.
- **Mocking External APIs**: Playwright intercepts network calls (like Stripe API requests) to simulate success cases without hitting third-party limits or introducing network flakiness.
