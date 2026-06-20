# Promoting Users to Super Admin

To maintain platform security, credentials and admin rights are never committed to repository files or entered directly in CLI configuration prompts. Instead, GrantTrail uses a **Promotion Workflow** to elevate registered users to the Super Admin role.

---

## Prerequisites

Before running the promotion workflow:
1. Ensure the backend database schema is deployed to your production Supabase instance.
2. The user you wish to promote must already be registered in the application.

---

## Step-by-Step Promotion Workflow

Follow these steps to elevate a user to Super Admin:

### Step 1: User Registration
The user must register an account using the deployed application frontend (or running the application locally against the production database):
1. Navigate to the **Sign Up** page.
2. Register an account using the target email address.
3. Complete the user profile setup in the browser to ensure the user profile row is written to the database's `users` table.

### Step 2: Run the Promotion Script
Once the user's profile is created in the database, promote their email address to Super Admin. Run the promotion script from the repository root:

```bash
npm run admin:promote <email-address>
```

*Replace `<email-address>` with the exact email address the user used to sign up (e.g., `admin@example.com`).*

---

## Under the Hood: What the Promotion Script Does

The promotion script executes a secure database operation that:
1. Locates the profile in the `users` table matching the provided email address.
2. Links the user profile to the root platform tenant (`tfac`).
3. Elevates the user's role to `super_admin` in the database.
4. Grants them the necessary bypasses for Stripe subscriptions and cross-tenant visibility.

> **Note on the platform-root tenant.** The script links the promoted user to the
> `tfac` tenant by slug. Which tenant counts as the *platform root* (exempt from
> subscription gating, granted cross-tenant scope) is now **config-driven** rather
> than hardcoded in the SECURITY DEFINER logic: it's read from
> `platform_settings.platform_root_slug` (DEFAULT `'tfac'`) via the
> `platform_root_slug()` / `is_platform_root_tenant()` helpers. TFAC is still the
> platform root by default. If you re-point the root with
> `UPDATE platform_settings SET platform_root_slug='<slug>' WHERE id=1;`, update
> the slug this script links against accordingly.

---

## What a Super Admin Can Do

Once promoted, a `super_admin` operates the platform via **`/super/tenants`** — they
are intentionally **not** part of the `/admin*` UI (which is tenant-scoped admin
tooling). At the database layer they now have **read-only** visibility into other
tenants' `subscriptions`, `user_memberships`, `billing_customers`, `notifications`,
and `grant_comments` (additive `SELECT` RLS policies keyed on `is_super_admin()`).
Writes to those tables are intentionally **not** granted — billing/membership
mutations stay on the `service_role` (Stripe) path.
