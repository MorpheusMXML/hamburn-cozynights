// scripts/add_security_fields.ts
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

async function run() {
	const pb = new PocketBase(PB_URL);

	if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
		console.error('PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD not set in .env');
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
		console.log('Authenticated as Admin');

		// Add order_hash to orders collection
		const ordersCollection = (await pb.collections.getOne('orders')) as any;
		const fields = ordersCollection.fields || ordersCollection.schema || [];
		const hasOrderHash = fields.find((f: any) => f.name === 'order_hash');

		if (!hasOrderHash) {
			const newField = {
				name: 'order_hash',
				type: 'text',
				required: false,
				unique: true,
				options: { min: null, max: null, pattern: '' }
			};
			if (ordersCollection.fields) {
				ordersCollection.fields.push(newField);
			} else {
				ordersCollection.schema.push(newField);
			}
			await pb.collections.update(ordersCollection.id, ordersCollection);
			console.log('Added order_hash to orders collection');
		} else {
			console.log('order_hash already exists');
		}

		// Add is_locked to beds collection
		const bedsCollection = (await pb.collections.getOne('beds')) as any;
		const bedFields = bedsCollection.fields || bedsCollection.schema || [];
		const hasIsLocked = bedFields.find((f: any) => f.name === 'is_locked');

		if (!hasIsLocked) {
			const newField = {
				name: 'is_locked',
				type: 'bool',
				required: false,
				options: {}
			};
			if (bedsCollection.fields) {
				bedsCollection.fields.push(newField);
			} else {
				bedsCollection.schema.push(newField);
			}
			await pb.collections.update(bedsCollection.id, bedsCollection);
			console.log('Added is_locked to beds collection');
		} else {
			console.log('is_locked already exists');
		}

		// Lock down API rules
		ordersCollection.listRule = null;
		ordersCollection.viewRule = null;
		ordersCollection.createRule = null;
		ordersCollection.updateRule = null;
		ordersCollection.deleteRule = null;
		await pb.collections.update(ordersCollection.id, ordersCollection);
		console.log('Locked down orders collection API');

		const usersCollection = await pb.collections.getOne('users');
		usersCollection.listRule = 'id = @request.auth.id';
		usersCollection.viewRule = 'id = @request.auth.id';
		await pb.collections.update(usersCollection.id, usersCollection);
		console.log('Locked down users collection API');
	} catch (err) {
		console.error('Failed to update schema:', err);
	}
}

run();
