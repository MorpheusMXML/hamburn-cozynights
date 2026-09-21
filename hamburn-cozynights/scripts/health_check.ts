// scripts/health_check.ts
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Forcing override ensures that .env values win over any pre-set shell variables
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PB_URL = process.env.PB_URL || process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const ADMIN_RULE =
	'@request.auth.collectionName = "admins" && (@request.auth.role = "admin" || @request.auth.role = "superuser")';

async function run() {
	console.log('🩺 Running Hamburn Cozynights Health Check...');
	const pb = new PocketBase(PB_URL);

	// 1. Check PB Connection
	try {
		await pb.health.check();
		console.log('✅ PocketBase is reachable at', PB_URL);
	} catch {
		console.error('❌ PocketBase is NOT reachable. Did you run `npm run db:up`?');
		process.exit(1);
	}

	// 2. Check Credentials
	if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
		console.error('❌ Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD in .env');
		console.error(
			'💡 Fix: Add them to your .env file. See https://morpheusmxml.github.io/hamburn-cozynights/develop/ for instructions.'
		);
		process.exit(1);
	}

	// 3. Test Authentication
	try {
		await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
		console.log('✅ Service Account authentication successful for', PB_ADMIN_EMAIL);
	} catch {
		console.error('❌ Authentication failed for', PB_ADMIN_EMAIL);
		console.error(
			'💡 Fix: Create the service superuser, e.g. `docker compose exec pocketbase /usr/local/bin/pocketbase superuser upsert <email> <password> --dir=/pb_data --encryptionEnv=PB_ENCRYPTION_KEY`.'
		);
		process.exit(1);
	}

	// 4. Check Schema (applied by pb_migrations/ on PocketBase start)
	const problems: string[] = [];
	try {
		const orders = (await pb.collections.getOne('orders')) as any;
		if (!orders.fields?.some((f: any) => f.name === 'order_hash')) {
			problems.push('orders.order_hash is missing');
		}

		const admins = (await pb.collections.getOne('admins').catch(() => null)) as any;
		if (!admins) {
			problems.push('collection "admins" is missing');
		} else {
			if (admins.createRule !== '@request.context = "oauth2"') {
				problems.push('admins.createRule must only allow the oauth2 sign-in');
			}
			if (admins.updateRule !== null) problems.push('admins.updateRule must be null');
			if (!admins.oauth2?.enabled) {
				console.warn(
					'⚠️  Google admin login is disabled (set PB_GOOGLE_CLIENT_ID/PB_GOOGLE_CLIENT_SECRET for PocketBase).'
				);
			}
		}

		const houses = (await pb.collections.getOne('houses')) as any;
		if (houses.updateRule !== ADMIN_RULE) problems.push('houses rules are not admin-only');

		const users = (await pb.collections.getOne('users').catch(() => null)) as any;
		if (users && users.createRule !== null) problems.push('users.createRule allows public sign-up');
	} catch (e: any) {
		console.error('❌ Could not verify the database schema.');
		console.error('   Reason:', e.message);
		process.exit(1);
	}

	if (problems.length > 0) {
		console.error('❌ Database schema is outdated:');
		for (const problem of problems) console.error('   -', problem);
		console.error('💡 Fix: restart PocketBase so pb_migrations/ are applied (`npm run db:up`).');
		process.exit(1);
	}
	console.log('✅ Database schema is up to date (admins, rules, order_hash).');

	console.log('🚀 All systems go! Ready for ignition.');
	process.exit(0);
}

run();
