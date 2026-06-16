# Deployment Guide

This guide covers the full deployment process for GrantTrail: creating and configuring the Supabase backend, building the React frontend, and uploading it to a web host via FTP.

---

## Table of Contents

- [Part 1 — Supabase Project Setup](#part-1--supabase-project-setup)
- [Part 2 — Build and FTP Deployment](#part-2--build-and-ftp-deployment)
- [Production Setup & Bootstrapping](#production-setup--bootstrapping)

---

## Part 1 — Supabase Project Setup

This part walks through creating and configuring a brand-new Supabase project for GrantTrail. Follow this when setting up the project for the first time, or after a full teardown.

### Prerequisites (Supabase)

- A Supabase account — sign up free at [supabase.com](https://supabase.com)
- The SQL scripts from the `supabase/migrations/` and `supabase/` folders
- Node.js installed (to run the frontend after setup)

---

### Step 1 — Create a New Supabase Project

1. Log in to [supabase.com](https://supabase.com) and click **New project**
2. Fill in:
   - **Organization:** select your org (or create one)
   - **Project name:** e.g. `granttrail-dev`
   - **Database password:** choose a strong password and save it
   - **Region:** choose the region closest to your users
3. Click **Create new project** and wait 1–2 minutes for provisioning

---

### Step 2 — Note Your Project Credentials

Once the project is ready:

1. Go to **Project Settings → API**
2. Copy and save:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **anon / public key** — a long JWT string starting with `eyJ...`

These go into `frontend/.env.local` (for development) or `frontend/.env.production` (for deployment):

```env
VITE_SUPABASE_URL=https://abcdefghijkl.supabase.co
VITE_SUPABASE_KEY=eyJhbGci...your-anon-key...
```

Do **not** use the `service_role` key in the frontend — it bypasses all security policies.

---

### Step 3 — Configure Authentication

1. Go to **Authentication → Providers**
2. Under **Email**, confirm it is enabled (it is by default)
   - "Confirm email" can be left off for development (easier testing)
   - For production, enable email confirmation

3. Go to **Authentication → URL Configuration**
4. Set **Site URL** to your domain:
   - Development: `http://localhost:3000`
   - Production: `https://yourdomain.com`
5. Under **Redirect URLs**, add:
   - `http://localhost:3000` (for development)
   - `https://yourdomain.com` (when deploying)

---

### Step 4 — Run the Schema Script

1. Go to **SQL Editor** in the Supabase Dashboard
2. Click **New query**
3. Open the squashed migration schema (e.g. `supabase/migrations/*_initial_schema.sql`) in a text editor, copy its entire contents, paste into the SQL Editor
4. Click **Run**

This creates:
- All 19 tables with indexes and constraints (including `status` columns on `budget_items` and `expenses`, and `notifications` with realtime)
- All triggers (totals, status history, audit log — with no-op UPDATE guard)
- Tenant auto-populate triggers, auto-approval triggers, role enforcement trigger
- Helper functions like `is_admin()`, `current_tenant_id()`, `is_super_admin()`, and `provision_self_service_tenant()`
- RLS policies on every table
- Two storage buckets: `receipts` and `grant-documents`

**Verification:** The script ends with two SELECT statements. You should see 19 table names returned, and 2 storage bucket rows.

If you see errors, check that you're running on a clean database (no conflicting tables). If needed, see the [Resetting Test Data & Troubleshooting Guide](reset_test_data.md).

---

### Step 5 — Choose Your Path

- **For testing/development:** Continue with Steps 6-9 below to load sample data.
- **For production:** Skip to [Production Setup](#production-setup--bootstrapping) for instructions on bootstrapping the first tenant and super admin.

---

### Step 6 — Insert Sample Data (Test Only)

1. In the SQL Editor, run the contents of `supabase/seed.sql`

This inserts:
- 4 tenants (2 managed, 2 self-service) with tenant settings
- 9 users across the 4 tenants
- 11 grants with budget items and expenses
- `user_id` (UUID) is left NULL — will be linked in Step 8

---

### Step 7 — Create Auth Accounts for Sample Users (Test Only)

The `users` table rows exist, but there are no Supabase Auth accounts yet. Create them manually:

1. Go to **Authentication → Users**
2. Click **Add user → Create new user** for each of the following:

   | Email | Tenant | Role |
   |-------|--------|------|
   | `maria.smith@example.com` | TFAC | grantee |
   | `jacob.soto@example.com` | TFAC | grantee |
   | `faizan.sharp@example.com` | TFAC | grantee |
   | `eric.hobbs@example.com` | TFAC | admin |
   | `sam.reeves@example.com` | TFAC | super_admin |
   | `priya.sharma@example.com` | Bright Horizons | grantee |
   | `david.chen@example.com` | Bright Horizons | grantee |
   | `amara.okafor@example.com` | Bright Horizons | admin |
   | `carlos.lopez@example.com` | Lopez Consulting | grantee (self-service) |
   | `nadia.park@example.com` | Greenleaf | grantee (self-service) |

3. Uncheck "Send email invitation" for each (these are test accounts)

---

### Step 8 — Link Auth UUIDs to User Records (Test Only)

After creating the Auth accounts:

1. In the SQL Editor, run `supabase/migrations/*_after_user_creation.sql` or similar post-creation scripts to link UUIDs to emails:
   ```sql
   UPDATE users
   SET user_id = (SELECT id FROM auth.users WHERE email = 'maria.smith@example.com')
   WHERE email = 'maria.smith@example.com';
   -- ... repeat for other users
   ```
   Without this, login will succeed in Auth but the app can't find the user's profile and will redirect back to login.

---

### Step 9 — (Optional) Load Large Sample Data (Test Only)

If you want to test pagination, charts with more data, or performance with 50+ grants:

1. In the SQL Editor, run the contents of `supabase/large_sample_data.sql`
2. Create a Supabase Auth account for `alex.tan@example.com` and run the update query to link the UUID.

---

### Step 10 — Verify the Setup

Run the following in the SQL Editor to confirm everything is connected:

```sql
-- Should return 4 rows (or 5 if you added Alex Tan)
SELECT firstname, lastname, email, role, user_id IS NOT NULL AS linked
FROM users
ORDER BY role, lastname;

-- Should return 6 grants with non-null total_spent on approved ones
SELECT grant_name, status, grant_amount, total_spent, remaining_balance
FROM grant_record
ORDER BY status, grant_name;
```

Then start the frontend locally to test:
```bash
cd frontend
npm run dev
```

---

## Part 2 — Build and FTP Deployment

This part explains how to build the GrantTrail frontend and upload it to a web hosting provider via FTP.

### Overview

GrantTrail's frontend is a React application that compiles into a folder of static HTML, CSS, and JavaScript files. These static files can be hosted on any web server — no Node.js, PHP, or database software is needed on the server.

- **What you are deploying**: The compiled frontend files only.
- **What stays in the cloud**: The Supabase database, authentication, and file storage.

---

### Prerequisites (Deployment)

Before you begin:

- **Node.js and npm** installed on your computer
- **FTP client**: FileZilla is recommended
- **FTP credentials** from your web hosting provider:
  - Host (e.g. `ftp.yourdomain.com`)
  - Username
  - Password
  - Port (usually `21`)
- **Your Supabase project URL and anon key** (noted in Step 2)

---

### Step 11 — Set Up the Production Environment File

Create the file `frontend/.env.production` with the following content:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_KEY=your-anon-public-key-here
```

*Note: The anon/public key is designed to be exposed in frontend code — it is safe to use here. This file should not be committed to Git.*

---

### Step 12 — Build the App

Open a terminal, navigate to the `frontend/` folder, and run the build command:

```bash
cd frontend
npm run build
```

This compiles the React app into the `frontend/build/` folder. The process takes 30–90 seconds.

---

### Step 13 — Create the `.htaccess` File for SPA Routing

GrantTrail uses React Router, which means URLs like `/grants/1` are handled by JavaScript inside the browser. If a visitor navigates directly to `/grants/1` or refreshes the page, the server will return a 404 error.

To fix this, the server must redirect all requests to `index.html` and let React handle the routing.

Create a new file at `frontend/build/.htaccess` with the following content:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [QSA,L]
```

*Note: If you rebuild the app (`npm run build`) in the future, the `build/` folder is regenerated and the `.htaccess` file will be deleted. Recreate it before uploading.*

---

### Step 14 — Upload Files via FTP (FileZilla)

1. **Open FileZilla**
2. **Connect to your host** (File → Site Manager → New Site → Enter FTP credentials).
3. **Navigate to the correct server folder** in the right panel (usually `public_html/`, `www/`, or `htdocs/`).
4. **Navigate to the build folder on your computer** in the left panel (`frontend/build/`).
5. **Upload the contents** (select all files inside `build/`: `index.html`, `static/`, `manifest.json`, `favicon.ico`, `.htaccess` and upload).

---

### Step 15 — Allow Your Domain in Supabase

Supabase needs to know your production domain to allow authentication redirects and CORS requests.

1. **Open Supabase Dashboard** for your project.
2. Go to **Authentication → URL Configuration**.
3. Add your domain to **Redirect URLs**: `https://yourdomain.com`.
4. Go to **Project Settings → API**.
5. Under **Additional Allowed Headers / Allowed Origins (CORS)**, add: `https://yourdomain.com`.

---

### Step 16 — Verify the Deployment

1. Visit `https://yourdomain.com` in a browser.
2. Log in with a test account.
3. Navigate to a grant, then **press F5 to refresh**. It should reload correctly and not show a 404.
4. Check the browser developer console for any errors.

---

## Production Setup & Bootstrapping

For production deployments, instead of manually copy-pasting SQL files into the Supabase Dashboard, you can automate database setup and admin provisioning securely from the command line.

### 1. Database & Edge Functions Setup
Run the following command from the repository root:
```bash
npm run db:deploy
```
This script will:
* Prompt for your production Supabase Project Reference.
* Link the local project to the remote project via the Supabase CLI.
* Perform a clean reset of the remote database (wiping existing tables and schemas).
* Apply all local migrations sequentially to build the schema structure.
* Deploy all Edge Functions.
* Provision the default platform root tenant (`tfac`) and default settings.

### 2. Secure Super Admin Creation
For security, credentials are never committed. To create the first platform administrator, follow the **Promotion Workflow**:
* Refer to the [Super Admin Promotion How-To Guide](promote_superadmin.md) for step-by-step instructions.
