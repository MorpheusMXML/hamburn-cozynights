// scripts/encrypt_db_migration.ts
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Copy-paste encryption logic since we can't easily import from $lib in a script
function encrypt(text: string): string {
    if (!text) return text;
    if (text.split(':').length === 3) return text; // already encrypted
    const key = Buffer.from(ENCRYPTION_KEY || '', 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function createLookupHash(text: string): string {
    const salt = ENCRYPTION_KEY || 'default_salt';
    return crypto.createHmac('sha256', salt).update(text).digest('hex');
}

async function run() {
    const pb = new PocketBase(PB_URL);
    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD || !ENCRYPTION_KEY) {
        console.error('Missing env vars');
        process.exit(1);
    }

    try {
        try {
            // New PocketBase (v0.23+)
            await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        } catch {
            // Old PocketBase
            await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        }
        console.log('Authenticated');

        const orders = await pb.collection('orders').getFullList();
        console.log(`Migrating ${orders.length} orders...`);

        for (const order of orders) {
            const updates: any = {};
            
            if (order.customer_name && order.customer_name.split(':').length !== 3) {
                updates.customer_name = encrypt(order.customer_name);
            }
            if (order.burner_name && order.burner_name.split(':').length !== 3) {
                updates.burner_name = encrypt(order.burner_name);
            }
            if (!order.order_hash && order.order_number) {
                updates.order_hash = createLookupHash(order.order_number);
            }

            if (Object.keys(updates).length > 0) {
                await pb.collection('orders').update(order.id, updates);
                console.log(`Updated order ${order.id}`);
            }
        }
        console.log('Migration complete!');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

run();
