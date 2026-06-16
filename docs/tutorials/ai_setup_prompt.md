# AI Setup & Bootstrapping Prompt

If you are an AI assistant starting work on this project for the first time, copy, paste, and run the following commands sequentially to bootstrap the database and local development server.

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install dependencies (including the local Supabase CLI)
npm install

# 3. Create the local environment file from the pre-filled example template
cp .env.example .env.local

# 4. Start the local database (Supabase Docker containers + migrations + seed data)
npm run db:start

# 5. Start the frontend React development server
npm run dev
```

---

### What this does:
- `npm install`: Installs all web app packages and places the local `supabase` CLI wrapper into `node_modules/.bin`.
- `cp .env.example .env.local`: Copies the pre-configured local Supabase API URL and standard `anon` key so the frontend can connect immediately without configuration.
- `npm run db:start`: Spins up the local database using Docker, runs the squashed migrations (`supabase/migrations/*_initial_schema.sql`), and applies the test auth/application users from `supabase/seed.sql`.
- `npm run dev`: Boots the local Vite server. You can access the app at the URL printed in the console.
