// scripts/test_setup.ts
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

function createLookupHash(text: string): string {
	const salt = ENCRYPTION_KEY || 'default_salt';
	return crypto.createHmac('sha256', salt).update(text).digest('hex');
}

async function run() {
	console.log('🧹 Initializing Test Environment...');
	const pb = new PocketBase(PB_URL);

	try {
		try {
			await pb
				.collection('_superusers')
				.authWithPassword(process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
		} catch {
			await pb.admins.authWithPassword(process.env.PB_ADMIN_EMAIL!, process.env.PB_ADMIN_PASSWORD!);
		}

		// 1. Ensure test order XXXXX exists
		const testCode = 'XXXXX';
		const orderHash = createLookupHash(testCode);

		let orderId;
		try {
			const existingOrder = await pb
				.collection('orders')
				.getFirstListItem(`order_number="${testCode}"`);
			orderId = existingOrder.id;
			console.log('✅ Test order XXXXX already exists.');

			// Ensure hash is set
			if (!existingOrder.order_hash) {
				await pb.collection('orders').update(orderId, { order_hash: orderHash });
				console.log('✅ Updated test order hash.');
			}
		} catch {
			const newOrder = await pb.collection('orders').create({
				order_number: testCode,
				order_hash: orderHash,
				customer_name: 'Test Setup User',
				burner_name: '000000000000:000000000000:000000000000', // Dummy encrypted format
				booking_date: new Date().toISOString()
			});
			orderId = newOrder.id;
			console.log('✅ Created test order XXXXX.');
		}

		// 2. Unbook all beds
		const beds = await pb.collection('beds').getFullList({ filter: 'occupied = true' });
		for (const bed of beds) {
			await pb.collection('beds').update(bed.id, { occupied: false, order: null });
		}
		console.log(`✅ Cleared ${beds.length} existing bookings.`);

		console.log('🧪 Test environment is ready!');
		process.exit(0);
	} catch (err) {
		console.error('❌ Test setup failed:', err);
		process.exit(1);
	}
}

run();
