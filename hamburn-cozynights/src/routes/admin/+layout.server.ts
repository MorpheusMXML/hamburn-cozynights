import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isPublicAdminPath } from '$lib/server/admin-auth';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (isPublicAdminPath(url.pathname)) {
		// Already signed in: no reason to see the login page.
		if (locals.admin && url.pathname === '/admin/login') {
			throw redirect(303, '/admin');
		}
		return { admin: null, isSuperuser: false };
	}

	// hooks.server.ts only lets page/data requests through without a session,
	// so they can be redirected here.
	if (!locals.admin) {
		throw redirect(303, '/admin/login');
	}

	const { email, name, role, isSuperuser } = locals.admin;
	return {
		admin: { email, name, role },
		isSuperuser
	};
};
