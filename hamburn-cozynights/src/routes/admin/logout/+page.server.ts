import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

// Signing out is a POST (the header's "Eject" button). Opening the URL directly
// has nothing to render: send the visitor to the admin area, whose layout
// forwards signed-out visitors to the login page.
export const load: PageServerLoad = async () => {
	throw redirect(303, '/admin');
};

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
