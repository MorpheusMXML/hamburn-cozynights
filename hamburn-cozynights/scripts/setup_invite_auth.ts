// scripts/setup_invite_auth.ts
//
// Locks the `users` collection down to invite-only signup:
//   - createRule -> null (superuser-only), so nobody can self-register via the
//     public API, the /admin/login form, or OAuth2 auto sign-up.
//   - resetPasswordTemplate -> points at our own /admin/reset-password/[token]
//     page instead of PocketBase's built-in admin UI, since we reuse PB's
//     password-reset flow as the "accept your invite" flow.
//
// Optionally pass an email as the first argument to invite that person as the
// first admin (useful for bootstrapping, since after this script runs nobody
// can create a `users` record except an already-authenticated superuser).
//
//   npx tsx scripts/setup_invite_auth.ts you@example.com
import PocketBase from 'pocketbase';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const PB_URL = process.env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';
const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

const inviteEmail = process.argv[2];

async function inviteUser(pb: PocketBase, email: string) {
	let existing: any = null;
	try {
		existing = await pb
			.collection('users')
			.getFirstListItem(pb.filter('email = {:email}', { email }));
	} catch {
		// not found, that's fine
	}

	if (existing?.verified) {
		console.log(`ℹ️  ${email} already has an active account, skipping invite.`);
		return;
	}

	if (!existing) {
		const randomPassword = crypto.randomBytes(32).toString('base64url');
		await pb.collection('users').create({
			email,
			password: randomPassword,
			passwordConfirm: randomPassword,
			verified: false
		});
		console.log(`✅ Created pending admin account for ${email}`);
	}

	await pb.collection('users').requestPasswordReset(email);
	console.log(`✉️  Invite email sent to ${email} (link expires in 30 min).`);
}

async function run() {
	if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
		console.error('❌ PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD not set in .env');
		process.exit(1);
	}

	const pb = new PocketBase(PB_URL);

	try {
		await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
	} catch {
		await pb.admins.authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
	}
	console.log(`✅ Authenticated as superuser (${PB_ADMIN_EMAIL})`);

	const usersCollection = (await pb.collections.getOne('users')) as any;

	console.log(`Current createRule: ${JSON.stringify(usersCollection.createRule)}`);
	usersCollection.createRule = null; // superuser-only: blocks self-registration + OAuth2 auto sign-up
	usersCollection.listRule = 'id = @request.auth.id';
	usersCollection.viewRule = 'id = @request.auth.id';
	usersCollection.updateRule = 'id = @request.auth.id';
	usersCollection.deleteRule = 'id = @request.auth.id';

	usersCollection.resetPasswordTemplate = {
		subject: 'Your Hamburn Cozynights admin invite 🔥',
		body: `<p>Hello,</p>
<p>You've been invited to the <strong>{APP_NAME}</strong> admin dashboard.</p>
<p>Click the button below to choose your passphrase and activate your account.</p>
<p>
  <a class="btn" href="${APP_URL}/admin/reset-password/{TOKEN}" target="_blank" rel="noopener">Set your passphrase</a>
</p>
<p><i>This link expires in 30 minutes. If you weren't expecting this, you can ignore this email.</i></p>
<p>
  Thanks,<br/>
  {APP_NAME} team
</p>`
	};

	await pb.collections.update(usersCollection.id, usersCollection);
	console.log('🔒 users collection locked down to invite-only signup.');
	console.log(`🔗 Reset/invite links now point to ${APP_URL}/admin/reset-password/{TOKEN}`);
	console.log(
		'⚠️  Make sure SMTP is configured in the PocketBase dashboard (Settings > Mail settings) or invite emails will not be delivered.'
	);

	if (inviteEmail) {
		await inviteUser(pb, inviteEmail);
	} else {
		console.log('\nTip: pass an email as an argument to invite your first admin, e.g.');
		console.log('  npx tsx scripts/setup_invite_auth.ts you@example.com');
	}
}

run().catch((err) => {
	console.error('❌ Failed to lock down users collection:', err);
	process.exit(1);
});
