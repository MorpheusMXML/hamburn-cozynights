import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { ADMIN_SESSION_UNCHECKED, isPublicAdminPath } from '$lib/server/admin-auth';
import { countOpenRequests } from '$lib/server/special-requests';
import { liveStatsSnapshot } from '$lib/server/stats';
import type { NavCounts } from '$lib/admin-nav';

const NO_COUNTS: NavCounts = { openRequests: 0, booked: 0, arriving: 0 };

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (isPublicAdminPath(url.pathname)) {
		// Already signed in: no reason to see the login page.
		if (locals.admin && url.pathname === '/admin/login') {
			throw redirect(303, '/admin');
		}
		// Still signed in, PocketBase just didn't answer (an admin page sent the
		// browser here): signing in with Google again would not help.
		if (locals.adminUnchecked && url.pathname === '/admin/login') {
			throw error(503, ADMIN_SESSION_UNCHECKED);
		}
		return { admin: null, isSuperuser: false, openRequests: 0, navCounts: NO_COUNTS };
	}

	// hooks.server.ts only lets page/data requests through without a session,
	// so they can be redirected here. A session PocketBase couldn't check is
	// still there: the login page would only send the admin through Google
	// again, so the page says what is wrong instead.
	if (!locals.admin) {
		if (locals.adminUnchecked) throw error(503, ADMIN_SESSION_UNCHECKED);
		throw redirect(303, locals.adminSignInExpired ? '/admin/login?error=reauth' : '/admin/login');
	}

	const { email, name, role, isSuperuser } = locals.admin;
	// The numbers next to the menu entries. Special-needs requests waiting for
	// a decision; booked spots and arrivals from the shared live snapshot (a
	// few seconds old at most, shared by every admin page and the Intel poll).
	const [openRequests, spots] = await Promise.all([
		countOpenRequests(locals.adminPb).catch((err) => {
			console.error('[Admin] Counting special-needs requests failed:', (err as Error)?.message);
			return 0;
		}),
		liveStatsSnapshot(locals.adminPb)
			.then(({ stats }) => stats.spots)
			.catch((err) => {
				console.error('[Admin] Counting bookings for the menu failed:', (err as Error)?.message);
				return null;
			})
	]);
	const navCounts: NavCounts = {
		openRequests,
		booked: spots?.booked ?? 0,
		arriving: spots ? Math.max(0, spots.booked - spots.checkedIn) : 0
	};
	return {
		admin: { email, name, role },
		isSuperuser,
		openRequests,
		navCounts
	};
};
