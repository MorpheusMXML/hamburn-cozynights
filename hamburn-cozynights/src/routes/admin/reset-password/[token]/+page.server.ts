import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ClientResponseError } from 'pocketbase';

export const load: PageServerLoad = async ({ locals }) => {
	// Already have a live session -> nothing to do here.
	if (locals.pb.authStore.isValid) {
		throw redirect(303, '/admin');
	}
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const token = params.token;
		const data = await request.formData();
		const password = data.get('password')?.toString();
		const passwordConfirm = data.get('passwordConfirm')?.toString();

		if (!password || !passwordConfirm) {
			return fail(400, { message: 'Fill in both passphrase fields.' });
		}
		if (password !== passwordConfirm) {
			return fail(400, { message: 'Passphrases do not match.' });
		}

		try {
			// Also marks the account as verified once the reset succeeds 🔓
			await locals.pb.collection('users').confirmPasswordReset(token, password, passwordConfirm);
		} catch (error) {
			const err = error as ClientResponseError;
			return fail(400, {
				message:
					err.status === 400
						? 'This invite link is invalid or has expired. Ask an admin to resend it.'
						: err.message || 'Could not set your passphrase.'
			});
		}

		throw redirect(303, '/admin/login?activated=true');
	}
};
