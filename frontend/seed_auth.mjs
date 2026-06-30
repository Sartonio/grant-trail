import { createClient } from '@supabase/supabase-js';

// Local-only seeding helper. The service_role key is NOT hardcoded — grab it from
// your running stack: `supabase status` (service_role key) and export it first:
//   SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2- | tr -d '"')
const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (from `supabase status`) before running this seed.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const emails = [
  'maria.smith@example.com',
  'jacob.soto@example.com',
  'faizan.sharp@example.com',
  'eric.hobbs@example.com',
  'sam.reeves@example.com',
  'alex.tan@example.com',
  'priya.sharma@example.com',
  'david.chen@example.com',
  'amara.okafor@example.com',
  'carlos.lopez@example.com',
  'nadia.park@example.com'
];

async function seedAuth() {
  console.log('Creating auth users...');
  for (const email of emails) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: 'password123',
      email_confirm: true
    });
    if (error && !error.message.includes('already exists')) {
      console.error(`Error creating ${email}:`, error.message);
    } else {
      console.log(`User created/exists: ${email}`);
    }
  }
}

seedAuth();
