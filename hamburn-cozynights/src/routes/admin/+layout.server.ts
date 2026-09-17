import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Public pages within /admin that must stay reachable without a session 🔓
const PUBLIC_PATHS = ['/admin/login', '/admin/reset-password'];

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const isPublicPath = PUBLIC_PATHS.some(
		(path) => url.pathname === path || url.pathname.startsWith(`${path}/`)
	);

	// 1. Basic Check: Is user logged in?
	if (!locals.pb.authStore.isValid) {
		if (!isPublicPath) {
			throw redirect(303, '/admin/login');
		}
	} else {
		// User is logged in.

		// Lock login page for authenticated users
		if (url.pathname === '/admin/login') {
			throw redirect(303, '/admin');
		}
	}

	// Fetch user object
	const userModel = locals.pb.authStore.model;
	const userJSON = userModel ? JSON.parse(JSON.stringify(userModel)) : null;

	return {
		user: userJSON,
		// Explicit flag for the frontend to hide buttons
		isVerified: userJSON?.verified === true
	};
};
