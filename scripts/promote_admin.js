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
  console.log('🛡️ GrantTrail Super Admin Promotion Tool');
  console.log('====================================================\n');

  try {
    let email = process.argv[2];
    if (!email) {
      email = await askQuestion('Enter the email address of the user to promote: ');
    }
    email = email.trim().toLowerCase();

    if (!email) {
      throw new Error('Email address cannot be empty.');
    }

    console.log(`\n🔍 Checking if user profile exists for "${email}" on remote database...`);
    
    // We execute a check query in JSON format
    const checkQuery = `SELECT id, role, tenant_id FROM users WHERE email = '${email.replace(/'/g, "''")}';`;
    const checkResult = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'db', 'query', '--linked', '-o', 'json', checkQuery
    ], {
      shell: true
    });

    if (checkResult.status !== 0) {
      throw new Error(`Failed to query remote database: ${checkResult.stderr.toString()}`);
    }

    let rows = [];
    try {
      const output = checkResult.stdout.toString().trim();
      // Parse JSON from the CLI output. Supabase might print log prefixes before/after JSON,
      // so we find the start of the JSON array '[' and parse it.
      const jsonStart = output.indexOf('[');
      if (jsonStart !== -1) {
        rows = JSON.parse(output.substring(jsonStart));
      } else {
        throw new Error('No JSON output returned.');
      }
    } catch (e) {
      throw new Error(`Failed to parse query result: ${e.message}\nRaw CLI output: ${checkResult.stdout.toString()}`);
    }

    if (rows.length === 0) {
      throw new Error(`No user profile found for email "${email}".\n` + 
                      'Please ensure the user has completed their registration in the application browser signup first.');
    }

    const user = rows[0];
    console.log(`✅ Found user record (ID: ${user.id}, Current Role: ${user.role}).`);

    console.log(`\n⬆️ Promoting "${email}" to Super Admin...`);

    // We build the update SQL query to promote them and shift their tenant assignment to 'tfac'
    const promoteSql = `
UPDATE users 
SET role = 'super_admin',
    tenant_id = (SELECT id FROM tenants WHERE slug = 'tfac')
WHERE email = '${email.replace(/'/g, "''")}';
`;

    const tempDir = path.join(__dirname, '..', 'supabase', '.temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempSqlPath = path.join(tempDir, 'promote_admin_temp.sql');
    fs.writeFileSync(tempSqlPath, promoteSql);

    const promoteExec = spawnSync('npx', [
      '--prefix', 'frontend', 'supabase', 'db', 'query', '--linked', '-f', tempSqlPath
    ], {
      stdio: 'inherit',
      shell: true
    });

    // Clean up temporary script
    try {
      if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
    } catch (e) {
      // Ignore cleanup error
    }

    if (promoteExec.status !== 0) {
      throw new Error('Failed to execute promotion SQL on remote database.');
    }

    console.log('\n====================================================');
    console.log('🎉 PROMOTION SUCCESSFUL!');
    console.log('====================================================');
    console.log(`User "${email}" has been elevated to Super Admin.`);
    console.log('They can now log in and access the platform control panel.');
    console.log('====================================================\n');

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  } finally {
    rl.close();
  }
}

main();
