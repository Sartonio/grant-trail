# GrantTrail - Deployment Guide

This guide covers the full deployment process for GrantTrail: creating and configuring the Supabase backend, building the React frontend, and uploading it to a web host via FTP.

---

## Table of Contents

- [Part 1 — Supabase Project Setup](#part-1--supabase-project-setup)
  - [Prerequisites (Supabase)](#prerequisites-supabase)
  - [Step 1 — Create a New Supabase Project](#step-1--create-a-new-supabase-project)
  - [Step 2 — Note Your Project Credentials](#step-2--note-your-project-credentials)
  - [Step 3 — Configure Authentication](#step-3--configure-authentication)
  - [Step 4 — Run the Schema Script](#step-4--run-the-schema-script)
  - [Step 5 — Choose Your Path](#step-5--choose-your-path)
  - [Step 6 — Insert Sample Data (Test Only)](#step-6--insert-sample-data-test-only)
  - [Step 7 — Create Auth Accounts for Sample Users (Test Only)](#step-7--create-auth-accounts-for-sample-users-test-only)
  - [Step 8 — Link Auth UUIDs to User Records (Test Only)](#step-8--link-auth-uuids-to-user-records-test-only)
  - [Step 9 — (Optional) Load Large Sample Data (Test Only)](#step-9--optional-load-large-sample-data-test-only)
  - [Step 10 — Verify the Setup](#step-10--verify-the-setup)
  - [Quick Reference — Supabase Dashboard Areas](#quick-reference--supabase-dashboard-areas)
  - [Starting Over](#starting-over)
- [Part 2 — Build and FTP Deployment](#part-2--build-and-ftp-deployment)
  - [Overview](#overview)
  - [Prerequisites (Deployment)](#prerequisites-deployment)
  - [Step 11 — Set Up the Production Environment File](#step-11--set-up-the-production-environment-file)
  - [Step 12 — Build the App](#step-12--build-the-app)
  - [Step 13 — Create the `.htaccess` File for SPA Routing](#step-13--create-the-htaccess-file-for-spa-routing)
  - [Step 14 — Upload Files via FTP (FileZilla)](#step-14--upload-files-via-ftp-filezilla)
  - [Step 15 — Allow Your Domain in Supabase](#step-15--allow-your-domain-in-supabase)
  - [Step 16 — Verify the Deployment](#step-16--verify-the-deployment)
  - [Updating the Site](#updating-the-site)
  - [Troubleshooting](#troubleshooting)
- [Production Setup](#production-setup)

---

## Part 1 — Supabase Project Setup

This part walks through creating and configuring a brand-new Supabase project for GrantTrail. Follow this when setting up the project for the first time, or after a full teardown.

---

### Prerequisites (Supabase)

- A Supabase account — sign up free at [supabase.com](https://supabase.com)
- The SQL scripts from the `backend/` folder
- Node.js installed (to run the frontend after setup)

---

### Step 1 — Create a New Supabase Project

1. Log in to [supabase.com](https://supabase.com) and click **New project**
2. Fill in:
   - **Organization:** select your org (or create one)
   - **Project name:** e.g. `granttrail-dev`
   - **Database password:** choose a strong password and save it — you won't need it often but it's hard to recover
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

```
REACT_APP_SUPABASE_URL=https://abcdefghijkl.supabase.co
REACT_APP_SUPABASE_KEY=eyJhbGci...your-anon-key...
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
3. Open `backend/01-Complete-Fresh-Setup.sql` in a text editor, copy its entire contents, paste into the SQL Editor
4. Click **Run**

This creates:
- All 13 tables with indexes and constraints (including `status` columns on `budget_items` and `expenses`, and `notifications` with realtime)
- All triggers (totals, status history, audit log — with no-op UPDATE guard)
- Tenant auto-populate triggers, auto-approval triggers, role enforcement trigger
- The `is_admin()` helper function
- `current_tenant_id()`, `is_super_admin()`, and `provision_self_service_tenant()` helper functions
- RLS policies on every table
- Two storage buckets: `receipts` and `grant-documents`

**Verification:** The script ends with two SELECT statements. You should see 13 table names returned, and 2 storage bucket rows.

If you see errors, check that you're running on a clean database (no conflicting tables). If needed, run `00-Full-Teardown.sql` first.

---

### Step 5 — Choose Your Path

- **For testing/development:** Continue with Steps 6-9 below to load sample data.
- **For production:** Skip to [Production Setup](#production-setup) for instructions on bootstrapping the first tenant and super admin using `backend/21-PROD-Setup.sql`.

---

### Step 6 — Insert Sample Data (Test Only)

1. In the SQL Editor, run `backend/02-Sample-Data.sql`

This inserts:
- 4 tenants (2 managed, 2 self-service) with tenant settings
- 9 users across the 4 tenants (see `backend/README-Sample-Data.md` for full breakdown)
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
   | `priya.sharma@example.com` | Bright Horizons | grantee |
   | `david.chen@example.com` | Bright Horizons | grantee |
   | `amara.okafor@example.com` | Bright Horizons | admin |
   | `carlos.lopez@example.com` | Lopez Consulting | grantee (self-service) |
   | `nadia.park@example.com` | Greenleaf | grantee (self-service) |

3. Uncheck "Send email invitation" for each (these are test accounts)

---

### Step 8 — Link Auth UUIDs to User Records (Test Only)

After creating the Auth accounts:

1. In the SQL Editor, run `backend/05-After-User-Creation.sql`

This runs `UPDATE users SET user_id = (SELECT id FROM auth.users WHERE email = '...')` for each sample user. Without this, login will succeed in Auth but the app can't find the user's profile and will redirect back to login.

The script also inserts two sample admin comments on the "Technology Access Grant" and "Mental Health Awareness Campaign" grants.

---

### Step 9 — (Optional) Load Large Sample Data (Test Only)

If you want to test pagination, charts with more data, or performance with 50+ grants:

1. In the SQL Editor, run `backend/03-Large-Sample-Data.sql`
2. This creates an `alex.tan@example.com` user with 50 grants
3. Create a Supabase Auth account for `alex.tan@example.com` and run `05-After-User-Creation.sql` again to link the UUID

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

Then start the frontend:

```bash
cd frontend
npm start
```

Log in as `eric.hobbs@example.com` — you should reach the Admin Dashboard.
Log in as `maria.smith@example.com` — you should reach the Grantee Dashboard.

---

### Quick Reference — Supabase Dashboard Areas

| What you need | Where to find it |
|---------------|-----------------|
| Project URL + anon key | Project Settings → API |
| Create/manage auth users | Authentication → Users |
| Redirect URL config | Authentication → URL Configuration |
| Run SQL | SQL Editor |
| Browse table data | Table Editor |
| View storage files | Storage |
| View logs / errors | Logs → API or Postgres |
| RLS policy list | Authentication → Policies (or SQL Editor: `SELECT * FROM pg_policies`) |

---

### Starting Over

To wipe everything and start fresh:

1. In the SQL Editor, run `backend/00-Full-Teardown.sql` — drops all tables, functions, and policies
2. Delete storage bucket contents manually: **Storage → receipts → select all → delete**, then same for `grant-documents`
3. Delete test Auth users: **Authentication → Users → delete each one**
4. Run `01-Complete-Fresh-Setup.sql` again to recreate everything

---

## Part 2 — Build and FTP Deployment

This part explains how to build the GrantTrail frontend and upload it to a web hosting provider via FTP.

---

### Overview

GrantTrail's frontend is a React application that compiles into a folder of static HTML, CSS, and JavaScript files. These static files can be hosted on any web server — no Node.js, PHP, or database software is needed on the server.

**What you are deploying:** The compiled frontend files only.
**What stays in the cloud:** The Supabase database, authentication, and file storage — these do not need to be deployed.

---

### Prerequisites (Deployment)

Before you begin:

- **Node.js and npm** installed on your computer (needed to compile the app)
- **FTP client:** FileZilla is recommended — free download at [filezilla-project.org](https://filezilla-project.org)
- **FTP credentials** from your web hosting provider:
  - Host (e.g. `ftp.yourdomain.com`)
  - Username
  - Password
  - Port (usually `21`)
- **Your Supabase project URL and anon key** (from Supabase Dashboard → Project Settings → API, noted in [Step 2](#step-2--note-your-project-credentials))

---

### Step 11 — Set Up the Production Environment File

React bakes environment variables into the compiled JavaScript at build time. You need to provide the production values before building.

Create the file `frontend/.env.production` with the following content:

```
REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co
REACT_APP_SUPABASE_KEY=your-anon-public-key-here
```

Notes:
- The anon/public key is designed to be exposed in frontend code — it is safe to use here
- This file should **not** be committed to git (add it to `.gitignore` if it isn't already)
- This file is separate from `.env.local` (used for local development) — you can have both

---

### Step 12 — Build the App

Open a terminal, navigate to the `frontend/` folder, and run the build command:

```bash
cd frontend
npm run build
```

This compiles the React app into the `frontend/build/` folder. The process takes 30–90 seconds. When it finishes you will see a summary of the generated files.

The `build/` folder now contains everything the web server needs to serve the app:

```
frontend/build/
├── index.html          ← Entry point for all pages
├── static/
│   ├── css/            ← Compiled stylesheets
│   └── js/             ← Compiled JavaScript bundles
├── manifest.json
└── favicon.ico
```

---

### Step 13 — Create the `.htaccess` File for SPA Routing

GrantTrail uses React Router, which means URLs like `/grants/1` are handled by JavaScript inside the browser — not by files on the server. If a visitor navigates directly to `/grants/1` or refreshes the page, the server will try to find a file at that path, fail, and return a 404 error.

To fix this, the server must redirect all requests to `index.html` and let React handle the routing.

Create a new file at `frontend/build/.htaccess` with the following content:

```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.html [QSA,L]
```

This tells Apache (the web server used by most shared hosting providers):
- If the requested file doesn't exist as an actual file (`!-f`)
- Serve `index.html` instead

**Note:** If you rebuild the app (`npm run build`) in the future, the `build/` folder is regenerated and the `.htaccess` file will be deleted. You will need to recreate it before uploading again.

---

### Step 14 — Upload Files via FTP (FileZilla)

1. **Open FileZilla**

2. **Connect to your host**
   - Go to **File → Site Manager → New Site**
   - Enter your FTP credentials:
     - Protocol: FTP
     - Host: `ftp.yourdomain.com`
     - Port: `21`
     - Logon Type: Normal
     - User / Password: from your hosting provider
   - Click **Connect**

3. **Navigate to the correct server folder**
   - In the right panel (the remote server), navigate to your site's public web root
   - This is usually named `public_html/`, `www/`, or `htdocs/` depending on your host
   - If you want the app at `yourdomain.com/`, upload into this folder directly
   - If you want it at `yourdomain.com/granttrail/`, create a subfolder and upload into it

4. **Navigate to the build folder on your computer**
   - In the left panel (your computer), navigate to `frontend/build/`

5. **Upload the contents (not the folder itself)**
   - Select all files and folders inside `build/`: `index.html`, `static/`, `manifest.json`, `favicon.ico`, `.htaccess`
   - Right-click → **Upload**

   **Common mistake:** Uploading the `build/` folder as a subfolder instead of its contents. This makes the app accessible at `yourdomain.com/build/` instead of `yourdomain.com/`. Upload what is _inside_ `build/`, not the `build/` folder itself.

   **Note about hidden files:** `.htaccess` starts with a dot and may be hidden by default in FileZilla. Go to **Server → Force showing hidden files** if you don't see it in the left panel.

---

### Step 15 — Allow Your Domain in Supabase

Supabase needs to know your production domain to allow authentication redirects and CORS requests.

1. **Open Supabase Dashboard** for your project
2. Go to **Authentication → URL Configuration**
3. Add your domain to **Redirect URLs**: `https://yourdomain.com`
4. Go to **Project Settings → API**
5. Under **Additional Allowed Headers / Allowed Origins (CORS)**, add: `https://yourdomain.com`

Without this step, login redirects will fail after authentication and the deployed frontend will get CORS errors when talking to Supabase.

---

### Step 16 — Verify the Deployment

1. Visit `https://yourdomain.com` in a browser
   - You should see the GrantTrail login page

2. Log in with a test account
   - You should reach the dashboard without errors

3. Navigate to a grant (e.g. click a grant in the list), then **press F5 to refresh**
   - The page should reload correctly, not show a 404 error
   - If you get a 404, the `.htaccess` file is missing or mod_rewrite is not enabled (see Troubleshooting)

4. Check the browser developer console (F12 → Console) for any errors

---

### Updating the Site

When you make code changes and want to redeploy:

1. Run `npm run build` again from the `frontend/` folder
2. Recreate `frontend/build/.htaccess` (it gets deleted with each build)
3. Upload the changed files via FileZilla
   - FileZilla's **Synchronize browsing** feature can help identify changed files
   - You can also re-upload everything — it will overwrite existing files

4. Hard-refresh your browser (`Ctrl+Shift+R` or `Cmd+Shift+R`) to bypass the browser cache

---

### Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| **Blank white page** | Missing environment variables | Open browser console (F12). If you see requests going to `undefined.supabase.co`, the `.env.production` file was missing when you ran `npm run build`. Fix the file and rebuild. |
| **404 error on page refresh** | `.htaccess` missing or Apache mod_rewrite is disabled | Check that `.htaccess` was uploaded (enable "Force showing hidden files" in FileZilla). In cPanel, check Apache settings for mod_rewrite. |
| **"Invalid login credentials"** | Normal auth error — check username/password | Use the correct email and password for a seeded user account. |
| **Redirected back to login after logging in** | Domain not in Supabase redirect URLs | Add `https://yourdomain.com` to Supabase → Authentication → URL Configuration → Redirect URLs. |
| **Files appear at `yourdomain.com/build/`** | Uploaded the folder instead of its contents | Delete the `build/` subfolder from the server and re-upload — this time upload the _contents_ of `build/`. |
| **CORS errors in browser console** | Origin not whitelisted in Supabase | Add `https://yourdomain.com` to Supabase → Project Settings → API → Additional Allowed Origins. |
| **Old version still showing** | Browser cache | Force-refresh with `Ctrl+Shift+R`. Also clear browser cache if needed. |
| **File uploads fail** | Supabase Storage bucket policies | Check Supabase Dashboard → Storage → Policies. The RLS policies in `01-Complete-Fresh-Setup.sql` should already handle this — confirm they were applied. |

---

## Production Setup

For production deployments, after running `01-Complete-Fresh-Setup.sql`, use `backend/21-PROD-Setup.sql` to bootstrap the first tenant and super admin. See the comments in that file for step-by-step instructions.
