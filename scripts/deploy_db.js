const readline = require('readline');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
  console.log('====================================================');
  console.log('🚀 GrantTrail Production Database Deployment Script');
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

    console.log('\n📦 Pushing database migrations to remote database...');
    const pushResult = spawnSync('npx', ['--prefix', 'frontend', 'supabase', 'db', 'push'], {
      stdio: 'inherit',
      shell: true
    });
    if (pushResult.status !== 0) {
      throw new Error('Failed to push database migrations.');
    }

    console.log('\n👤 Let\'s configure the first Super Admin user:');
    const firstName = (await askQuestion('First Name [Sam]: ')).trim() || 'Sam';
    const lastName = (await askQuestion('Last Name [Reeves]: ')).trim() || 'Reeves';
    const email = (await askQuestion('Email [sam.reeves@example.com]: ')).trim() || 'sam.reeves@example.com';
    const phone = (await askQuestion('Phone Number [312-555-0105]: ')).trim() || '312-555-0105';

    console.log('\n🌱 Bootstrapping initial tenant & Super Admin user...');
    
    // Construct the bootstrap SQL query
    const bootstrapSql = `
-- Create initial tenant
INSERT INTO tenants (name, slug, tenant_type)
VALUES ('The Family Advocates Canada', 'tfac', 'managed')
ON CONFLICT (slug) DO NOTHING;

-- Create tenant settings
INSERT INTO tenant_settings (tenant_id)
VALUES ((SELECT id FROM tenants WHERE slug = 'tfac'))
ON CONFLICT (tenant_id) DO NOTHING;

-- Create super admin
INSERT INTO users (tenant_id, firstname, lastname, organization_name, email, phone_number, role)
VALUES (
  (SELECT id FROM tenants WHERE slug = 'tfac'),
  '${firstName.replace(/'/g, "''")}',
  '${lastName.replace(/'/g, "''")}',
  'The Family Advocates Canada',
  '${email.replace(/'/g, "''")}',
  '${phone.replace(/'/g, "''")}',
  'super_admin'
)
ON CONFLICT (email) DO UPDATE 
SET firstname = EXCLUDED.firstname, 
    lastname = EXCLUDED.lastname, 
    phone_number = EXCLUDED.phone_number,
    role = 'super_admin';
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
    if (bootstrapExec.status !== 0) {
      throw new Error('Failed to bootstrap remote database.');
    }

    console.log('\n====================================================');
    console.log('🔑 CRITICAL STEP: CREATE AUTH USER');
    console.log('====================================================');
    console.log(`1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/${projectRef}/auth/users`);
    console.log(`2. Click "Add user" -> "Create user"`);
    console.log(`3. Email: ${email}`);
    console.log(`4. Set a password and click Save.`);
    console.log('====================================================\n');

    await askQuestion('Press [Enter] once you have created the user in the Supabase Auth dashboard...');

    console.log('\n🔗 Linking Auth UUID to users record...');
    const linkSql = `
UPDATE users 
SET user_id = (SELECT id FROM auth.users WHERE email = '${email.replace(/'/g, "''")}')
WHERE email = '${email.replace(/'/g, "''")}';
`;
    const linkSqlPath = path.join(tempDir, 'prod_link_auth.sql');
    fs.writeFileSync(linkSqlPath, linkSql);

    const linkExec = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'db', 'query', '--linked', '-f', linkSqlPath
    ], {
      stdio: 'inherit',
      shell: true
    });
    if (linkExec.status !== 0) {
      throw new Error('Failed to link Auth UUID.');
    }

    // Clean up temporary files
    try {
      if (fs.existsSync(bootstrapPath)) fs.unlinkSync(bootstrapPath);
      if (fs.existsSync(linkSqlPath)) fs.unlinkSync(linkSqlPath);
    } catch (e) {
      // Ignore cleanup error
    }

    console.log('\n🎉 Production Database Deployment Successful!');
    console.log(`Super Admin user (${email}) is successfully linked and ready to log in.`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  } finally {
    rl.close();
  }
}

main();
