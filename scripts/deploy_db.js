const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('====================================================');
  console.log('🚀 GrantTrail Production DB Schema Deployment Script');
  console.log('====================================================\n');

  try {
    const projectRef = await askQuestion('1. Enter your production Supabase Project Ref: ');
    if (!projectRef.trim()) {
      throw new Error('Project Reference cannot be empty.');
    }

    console.log('\n🔗 Linking project via Supabase CLI...');
    // Link the project using the CLI wrapper in the frontend folder
    const linkResult = spawnSync('npx', ['--prefix', 'frontend', 'supabase', 'link', '--project-ref', projectRef], {
      stdio: 'inherit',
      shell: true
    });
    if (linkResult.status !== 0) {
      throw new Error('Failed to link project. Make sure the Project Ref is correct and you entered the correct database password.');
    }

    console.log('\n💥 Initiating remote database teardown and clean reset...');
    // Reset remote database: tears down all schemas/tables, applies migrations, skips seed.sql
    const resetResult = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'db', 'reset', '--linked', '--no-seed', '--yes'
    ], {
      stdio: 'inherit',
      shell: true
    });
    if (resetResult.status !== 0) {
      throw new Error('Failed to reset remote database. Ensure you have ownership permissions over the remote database.');
    }
    console.log('✅ Remote database teardown and schema migrations applied successfully.');

    console.log('\n⚡ Deploying Supabase Edge Functions...');
    // 1. Deploy authenticated edge functions
    console.log('Deploying authenticated checkout and subscription sync functions...');
    const deployAuthResult = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'functions', 'deploy',
      'create-basic-membership-checkout-session',
      'create-billing-portal-session',
      'create-checkout-session',
      'sync-my-subscription',
      '--use-api'
    ], {
      stdio: 'inherit',
      shell: true
    });
    if (deployAuthResult.status !== 0) {
      throw new Error('Failed to deploy authenticated edge functions.');
    }

    // 2. Deploy stripe-webhook with JWT verification disabled
    console.log('Deploying Stripe Webhook function (no JWT verification)...');
    const deployWebhookResult = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'functions', 'deploy',
      'stripe-webhook',
      '--no-verify-jwt',
      '--use-api'
    ], {
      stdio: 'inherit',
      shell: true
    });
    if (deployWebhookResult.status !== 0) {
      throw new Error('Failed to deploy Stripe Webhook edge function.');
    }
    console.log('✅ Edge functions successfully deployed.');

    console.log('\n🧹 Pruning remote edge functions not found in local codebase...');
    
    // Get local function directory names
    const localFunctionsPath = path.join(__dirname, '..', 'supabase', 'functions');
    const localFunctions = fs.readdirSync(localFunctionsPath).filter(file => {
      const fullPath = path.join(localFunctionsPath, file);
      // Only include directories, exclude shared helper folder '_shared' and any dotfiles
      return fs.statSync(fullPath).isDirectory() && !file.startsWith('_') && !file.startsWith('.');
    });

    // Get remote deployed functions
    const listResult = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'functions', 'list', '-o', 'json'
    ], {
      shell: true
    });

    if (listResult.status === 0) {
      try {
        const output = listResult.stdout.toString().trim();
        const jsonStart = output.indexOf('[');
        if (jsonStart !== -1) {
          const remoteFunctions = JSON.parse(output.substring(jsonStart));
          for (const fn of remoteFunctions) {
            if (!localFunctions.includes(fn.name)) {
              console.log(`Pruning remote function: ${fn.name}...`);
              const deleteResult = spawnSync('npx', [
                '--prefix', 'frontend', 'supabase', 'functions', 'delete', fn.name
              ], {
                stdio: 'inherit',
                shell: true
              });
              if (deleteResult.status !== 0) {
                console.warn(`⚠️ Warning: Failed to prune remote function "${fn.name}"`);
              } else {
                console.log(`✅ Successfully deleted remote function: ${fn.name}`);
              }
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ Warning: Failed to parse remote functions list for pruning. Skipping prune step.', e.message);
      }
    } else {
      console.warn('⚠️ Warning: Failed to retrieve remote functions list for pruning. Skipping prune step.');
    }

    console.log('\n🌱 Bootstrapping initial tenant structure...');
    
    // Construct the bootstrap SQL query (structural only, no user details)
    const bootstrapSql = `
-- Create initial tenant
INSERT INTO tenants (name, slug, tenant_type)
VALUES ('The Family Advocates Canada', 'tfac', 'managed')
ON CONFLICT (slug) DO NOTHING;

-- Create tenant settings
INSERT INTO tenant_settings (tenant_id)
VALUES ((SELECT id FROM tenants WHERE slug = 'tfac'))
ON CONFLICT (tenant_id) DO NOTHING;
`;

    const tempDir = path.join(__dirname, '..', 'supabase', '.temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const bootstrapPath = path.join(tempDir, 'prod_bootstrap.sql');
    fs.writeFileSync(bootstrapPath, bootstrapSql);

    console.log('Executing bootstrap SQL on remote database...');
    const bootstrapExec = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'db', 'query', '--linked', '-f', bootstrapPath
    ], {
      stdio: 'inherit',
      shell: true
    });
    
    // Clean up temporary bootstrap file
    try {
      if (fs.existsSync(bootstrapPath)) fs.unlinkSync(bootstrapPath);
    } catch (e) {
      // Ignore cleanup error
    }

    if (bootstrapExec.status !== 0) {
      throw new Error('Failed to bootstrap initial tenant structure on the remote database.');
    }

    console.log('\n====================================================');
    console.log('🎉 Production Database Schema Setup Successful!');
    console.log('====================================================');
    console.log('The database structure, policies, and edge functions are deployed.');
    console.log('\nNext steps to set up your Super Admin securely:');
    console.log('1. Register the admin account via the signup UI (e.g. at http://localhost:3000/signup).');
    console.log('2. Complete the user profile setup in the browser.');
    console.log('3. Run the secure promotion script to elevate them to Super Admin:');
    console.log('   npm run admin:promote <email-address>');
    console.log('====================================================\n');

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  } finally {
    rl.close();
  }
}

main();
