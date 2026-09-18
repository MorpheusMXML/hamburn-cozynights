import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { isPublicAdminPath } from '$lib/server/admin-auth';
import { countOpenRequests } from '$lib/server/special-requests';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (isPublicAdminPath(url.pathname)) {
		// Already signed in: no reason to see the login page.
		if (locals.admin && url.pathname === '/admin/login') {
			throw redirect(303, '/admin');
		}
		return { admin: null, isSuperuser: false, openRequests: 0 };
	}

	// hooks.server.ts only lets page/data requests through without a session,
	// so they can be redirected here.
	if (!locals.admin) {
		throw redirect(303, locals.adminSignInExpired ? '/admin/login?error=reauth' : '/admin/login');
	}

	const { email, name, role, isSuperuser } = locals.admin;
	// Special-needs requests waiting for a decision, for the header link.
	const openRequests = await countOpenRequests(locals.adminPb).catch((err) => {
		console.error('[Admin] Counting special-needs requests failed:', (err as Error)?.message);
		return 0;
	});
	return {
		admin: { email, name, role },
		isSuperuser,
		openRequests
	};
};
