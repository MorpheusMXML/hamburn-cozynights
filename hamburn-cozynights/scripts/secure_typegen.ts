// scripts/secure_typegen.ts
import { spawnSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load .env
dotenv.config();

const url = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const email = process.env.PB_ADMIN_EMAIL;
let password = process.env.PB_ADMIN_PASSWORD;

if (!email) {
    console.error('❌ PB_ADMIN_EMAIL is not set in .env');
    process.exit(1);
}

if (!password) {
    console.log('🔐 PB_ADMIN_PASSWORD not found in environment. Attempting GPG decryption...');
    
    // Check for .env.gpg or secrets.gpg
    const gpgFile = ['.env.gpg', 'secrets.gpg', 'pb_password.gpg'].find(f => fs.existsSync(f));
    
    if (gpgFile) {
        const gpg = spawnSync('gpg', ['-d', gpgFile], { encoding: 'utf8' });
        if (gpg.status === 0) {
            const gpgEnv = dotenv.parse(gpg.stdout);
            password = gpgEnv.PB_ADMIN_PASSWORD;
            console.log(`✅ Successfully decrypted credentials from ${gpgFile}`);
        } else {
            console.error('❌ GPG decryption failed.');
            console.error(gpg.stderr);
            process.exit(1);
        }
    }
}

if (!password) {
    console.error('❌ PB_ADMIN_PASSWORD is not set. Please provide it in .env or a GPG encrypted file.');
    process.exit(1);
}

console.log(`🚀 Running typegen for ${url} (${email})...`);

const typegen = spawnSync('npx', [
    'pocketbase-typegen',
    '--url', url,
    '--email', email,
    '--password', password,
    '--out', 'src/lib/pocketbase-types.ts'
], { stdio: 'inherit' });

if (typegen.status === 0) {
    console.log('✅ Typegen complete!');
} else {
    console.error('❌ Typegen failed.');
    process.exit(typegen.status || 1);
}
