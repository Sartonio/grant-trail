import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

// Fail fast with a clear message if the required env vars are missing, rather
// than letting createClient throw a cryptic error deep in the app.
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase configuration: set VITE_SUPABASE_URL and VITE_SUPABASE_KEY in your environment.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
