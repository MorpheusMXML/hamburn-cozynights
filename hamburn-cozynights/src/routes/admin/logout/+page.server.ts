import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ locals }) => {
		if (locals.admin) {
			console.log(`[Session] Admin ${locals.admin.email} signed out. 🚀`);
		}

		// hooks.server.ts turns the cleared store into an expired session cookie.
		locals.pb.authStore.clear();
		throw redirect(303, '/admin/login');
	}
};
