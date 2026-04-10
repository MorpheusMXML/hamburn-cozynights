// scripts/health_check.ts
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Forcing override ensures that .env values win over any pre-set shell variables
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

async function run() {
    console.log('🩺 Running Hamburn Cozynights Health Check...');
    const pb = new PocketBase(PB_URL);

    // 1. Check PB Connection
    try {
        await pb.health.check();
        console.log('✅ PocketBase is reachable at', PB_URL);
    } catch (e) {
        console.error('❌ PocketBase is NOT reachable. Did you run `npm run db:up`?');
        process.exit(1);
    }

    // 2. Check Credentials
    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
        console.error('❌ Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD in .env');
        console.error('💡 Fix: Add them to your .env file. See docs/SECURITY.md for instructions.');
        process.exit(1);
    }

    // 3. Test Authentication
    try {
        try {
            await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        } catch {
            await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        }
        console.log('✅ Service Account authentication successful for', PB_ADMIN_EMAIL);
    } catch (e) {
        console.error('❌ Authentication failed for', PB_ADMIN_EMAIL);
        console.error('💡 Fix: Ensure the user exists in PocketBase and the password matches your .env file.');
        process.exit(1);
    }

    // 4. Check Schema (orders)
    try {
        const orders = await pb.collections.getOne('orders') as any;
        
        // In newer PB, fields are in 'fields' instead of 'schema'
        const fields = orders.fields || orders.schema || [];
        const hasHash = fields.find((f: any) => f.name === 'order_hash');
        
        if (hasHash) {
            console.log('✅ Database schema is up to date (order_hash exists).');
        } else {
            console.warn('⚠️  Database schema is outdated (order_hash missing).');
            console.log('💡 Running automatic migration...');
            
            const newField = {
                name: 'order_hash',
                type: 'text',
                required: false,
                unique: true,
                options: { min: null, max: null, pattern: '' }
            };

            if (orders.fields) {
                orders.fields.push(newField);
            } else {
                orders.schema.push(newField);
            }

            await pb.collections.update(orders.id, orders);
            console.log('✅ Database migrated successfully!');
        }
    } catch (e: any) {
        console.error('❌ Could not verify orders schema.');
        console.error('   Reason:', e.message);
        process.exit(1);
    }

    console.log('🚀 All systems go! Ready for ignition.');
    process.exit(0);
}

run();
