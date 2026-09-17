import { fail, redirect } from '@sveltejs/kit';
import crypto from 'crypto';
import type { Actions, PageServerLoad } from './$types';
import type { ClientResponseError } from 'pocketbase';
import type { UsersResponse } from '$lib/pocketbase-types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.pb.authStore.isValid) {
		throw redirect(303, '/admin/login');
	}
	if (!locals.pb.authStore.model?.verified) {
		throw redirect(303, '/admin');
	}

	// Admin connection needed: the `users` listRule is locked to "own record only" 🔒
	const admins = await locals.adminPb.collection('users').getFullList<UsersResponse>({
		sort: '-created'
	});

	return { admins };
};

export const actions: Actions = {
	invite: async ({ locals, request }) => {
		if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });

		const data = await request.formData();
		const email = data.get('email')?.toString().trim().toLowerCase();

		if (!email || !EMAIL_RE.test(email)) {
			return fail(400, { error: 'Enter a valid email address.' });
		}

		try {
			const existing = await locals.adminPb
				.collection('users')
				.getFirstListItem<UsersResponse>(locals.adminPb.filter('email = {:email}', { email }))
				.catch(() => null);

			if (existing?.verified) {
				return fail(400, { error: `${email} already has an active account.` });
			}

			if (!existing) {
				const randomPassword = crypto.randomBytes(32).toString('base64url');
				await locals.adminPb.collection('users').create({
					email,
					password: randomPassword,
					passwordConfirm: randomPassword,
					verified: false
				});
			}

			// Reuses PB's built-in reset flow as the "accept your invite" link ✉️
			await locals.adminPb.collection('users').requestPasswordReset(email);

			return { success: true, message: `Invite sent to ${email}.` };
		} catch (error) {
			const err = error as ClientResponseError;
			return fail(400, { error: err.message || 'Could not send invite.' });
		}
	},

	resend: async ({ locals, request }) => {
		if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });

		const data = await request.formData();
		const email = data.get('email')?.toString();
		if (!email) return fail(400, { error: 'Missing email.' });

		try {
			await locals.adminPb.collection('users').requestPasswordReset(email);
			return { success: true, message: `Invite re-sent to ${email}.` };
		} catch (error) {
			const err = error as ClientResponseError;
			return fail(400, { error: err.message || 'Could not resend invite.' });
		}
	},

	revoke: async ({ locals, request }) => {
		if (!locals.pb.authStore.model?.verified) return fail(403, { error: 'Unauthorized' });

		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400, { error: 'Missing user id.' });

		if (id === locals.pb.authStore.model?.id) {
			return fail(400, { error: "You can't revoke your own access." });
		}

		try {
			await locals.adminPb.collection('users').delete(id);
			return { success: true, message: 'Access revoked.' };
		} catch (error) {
			const err = error as ClientResponseError;
			return fail(400, { error: err.message || 'Could not revoke access.' });
		}
	}
};
