# Resetting Test Data & Troubleshooting

This guide covers how to restore local sample data and troubleshoot common issues you are likely to encounter during development or local setup.

---

## 1. Resetting Test Data (Local Environment)

### How to Completely Reset the Database and Start Over
To tear down your database and rebuild it with fresh seed data, run:

```bash
supabase db reset
```

This automatically runs all migrations chronologically and re-applies `supabase/seed.sql` to populate default users, tenants, grants, budget items, and expenses.

### How to Reset Only Expense Data (Keep Grants & Budget Items)
If you want to clear out test expenses while keeping grants and budget allocations, run this SQL in your local Supabase Studio SQL Editor (`http://127.0.0.1:54323`):

```sql
DELETE FROM receipts;      -- clears all receipt metadata
DELETE FROM expenses;      -- clears all expenses (triggers update totals to 0)
```
*Note: Storage files inside the `receipts` bucket will need manual deletion via the Storage panel in the local Supabase dashboard.*

### How to Randomize Expense Dates
For better UI charts, you can randomize expense dates across the spends periods. Run the SQL from `supabase/randomize_expense_dates.sql` (or similar helper scripts if present) in the SQL Editor.

---

## 2. Troubleshooting Guide

### 2.1 Authentication & Login

#### Problem: Login succeeds but redirects back to the login page
* **Symptom**: You enter correct credentials. Supabase Auth accepts the login, but the app immediately redirects you back to `/login`.
* **Root Cause**: The profile row in the `users` table has its `user_id` (the UUID column) set to `NULL` or mismatches the Auth UUID. The session check fails to locate a valid user profile.
* **Fix**: Ensure the Auth UUID is linked. Run the after-user-creation SQL updates:
  ```sql
  UPDATE users
  SET user_id = (SELECT id FROM auth.users WHERE email = 'maria.smith@example.com')
  WHERE email = 'maria.smith@example.com';
  ```

#### Problem: "Invalid login credentials" error
* **Symptom**: Login fails with credential errors.
* **Root Cause**: 
  1. Incorrect password.
  2. No Auth account exists for this email.
  3. Email confirmation is required by Supabase Auth but not completed.
* **Fix**: Check `Authentication → Users` in the local Supabase Studio. If the account is missing, create it. If "Email confirmed" is required, disable email confirmation for development (`Authentication → Providers → Email → toggle "Confirm email" off`).

---

### 2.2 Database / RLS Errors

#### Problem: Error 42P17 — Infinite recursion in RLS policy
* **Symptom**: Queries on the `users` table return:
  ```text
  ERROR:  infinite recursion detected in policy for relation "users"
  ```
* **Root Cause**: An admin RLS policy has an inline subquery checking the `users` table, causing PostgreSQL to recursively evaluate the policy.
* **Fix**: Ensure you are using the `is_admin()` helper function, which is defined as `SECURITY DEFINER` to bypass policy evaluations during the check.

#### Problem: Grant, budget, or expense query returns null with no error
* **Symptom**: A record definitely exists, but the query returns `data = null` and `error = null`.
* **Root Cause**: Row Level Security (RLS) is silently denying the query because the logged-in user does not satisfy the policy constraint (e.g. grantee trying to access another tenant's grant).
* **Fix**: Check if the user's integer `id` matches `grant_record.user_id`, or if they belong to the correct `tenant_id`. Verify the user role and active tenant in local Studio.

---

### 2.3 Frontend & React Issues

#### Problem: App shows blank white page on load
* **Symptom**: The browser displays a blank page with no UI.
* **Root Cause**: JavaScript error during initialization, usually due to missing environment variables.
* **Fix**: Open the developer console (F12). If you see `TypeError` or network requests to `undefined.supabase.co`, your `.env.local` file is missing or contains incorrect keys. Re-create `frontend/.env.local` using `frontend/.env.example` as a template and restart the development server.

#### Problem: Charts not rendering / empty state
* **Symptom**: The chart area displays a "No data" message.
* **Fix**: Ensure that the `<ResponsiveContainer>` component in React has a fixed height prop (e.g., `height={240}`). Without it, the chart may render at `0px` height.

---

### 2.4 File Upload Issues

#### Problem: File uploads fail with storage error
* **Symptom**: Upload fails with 400 or 403.
* **Root Cause**: 
  1. The storage bucket does not exist.
  2. RLS policy on `storage.objects` is blocking uploads.
* **Fix**: Verify buckets exist in local Supabase Studio under Storage (should have `receipts` and `grant-documents`). Confirm the RLS policies for storage buckets are applied.
* **Note on tenant scoping**: `storage.objects` policies for both buckets are now **tenant-scoped by object path**, not just "authenticated". The **second path segment is the owning `tenant_id`** (`grant-documents/attachments/<tenant_id>/…`, `receipts/receipts/<tenant_id>/…`), checked via the `storage_object_tenant_id()` helper against the user's `current_tenant_id()`. So an upload/read can 403 even when the bucket and a generic policy exist, if the path's tenant segment doesn't match the user's tenant. (`super_admin` gets read across tenants; writes stay on the user's own tenant path.) Confirm uploads write to the correct `<tenant_id>` path segment.
