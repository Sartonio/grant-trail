# Scalability & Performance

This document covers database performance, connection pooling, and load testing for GrantTrail. It is intended for situations where the application needs to handle high-concurrency traffic.

---

## Database Index Audit

The initial schema includes indexes on all foreign keys and tenant isolation columns:

- `users(tenant_id, email, user_id)`
- `grant_record(tenant_id, user_id, status)`
- `expenses(tenant_id, grant_id, budget_item_id)`
- `audit_log(tenant_id, table_name, record_id)`

For dashboard sorting and timeline queries under high load, the following composite indexes are recommended. Run these in the Supabase SQL Editor:

```sql
-- Grant timeline and dashboard sorting by date per tenant
CREATE INDEX IF NOT EXISTS idx_grant_record_tenant_created
ON grant_record(tenant_id, created_at DESC);

-- Expense report queries ordered by date per tenant
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_created
ON expenses(tenant_id, created_at DESC);

-- Audit log searches by table and timestamp
CREATE INDEX IF NOT EXISTS idx_audit_log_table_created
ON audit_log(table_name, created_at DESC);
```

---

## Connection Pooling (Supavisor)

Direct PostgreSQL connections will exhaust database connection limits under high concurrent load. Supabase uses Supavisor for connection pooling.

1. Go to **Supabase Dashboard → Settings → Database**
2. Scroll to **Connection Pooling**
3. Copy the **Pooler connection string** (port `6543`, host: `*.pooler.supabase.com`)
4. Use **Transaction Mode** (the default) — multiple concurrent requests share a pool of server connections, which is required for serverless deployments scaling to high connection counts

> [!NOTE]
> Update your server environment variables to point to the pooler host (port `6543`) rather than the direct database port (`5432`) for production workloads.

---

## Load Testing with k6

A load test script is located at [`tests/load/k6-load-test.js`](file:///home/ryan/Documents/grant-trail/tests/load/k6-load-test.js). It simulates users logging in, fetching grants, and querying expenses.

### Install k6

On Debian/Ubuntu:

```bash
sudo gpg --no-default-keyring \
  --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17B8A0E8E5D9
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install k6
```

### Run the load test

Pass your Supabase credentials as environment variables:

```bash
SUPABASE_URL="https://<your-project-ref>.supabase.co" \
SUPABASE_ANON_KEY="your-anon-key" \
TEST_USER_EMAIL="maria.smith@example.com" \
TEST_USER_PASSWORD="password123" \
k6 run tests/load/k6-load-test.js
```

---

## Profiling Slow Queries

During or after a load test, use the Supabase query profiler to identify bottlenecks:

1. Go to **Supabase Dashboard → Database → Query Performance**
2. Sort by **Total Execution Time** or **Average Execution Time**
3. Investigate any query exceeding 50ms
4. Run `EXPLAIN ANALYZE <your_query>` in the SQL Editor to distinguish sequential scans (missing index) from index scans
