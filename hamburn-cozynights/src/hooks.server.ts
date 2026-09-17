// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { getAdminPb, PB_URL } from '$lib/server/pocketbase';
import {
	ADMIN_COLLECTION,
	AUTH_COOKIE,
	isAdminPath,
	isAdminAccount,
	isPublicAdminPath,
	toAdminSession,
	toPendingAdmin
} from '$lib/server/admin-auth';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize PocketBase instances
	event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

	// Use the singleton service-account instance (Master Key)
	event.locals.adminPb = await getAdminPb();

	// 2. Guest session: the ticket code cookie
	event.locals.orderNumber = event.cookies.get('bookingCode') || null;

	// 3. Admin session. Only records of the `admins` collection count; the token
	//    is re-validated against PocketBase on every request, so approving,
	//    changing or revoking an account (scripts/cozy-admin.sh, PocketBase
	//    dashboard) takes effect on the next request. A pending access request
	//    keeps its session (to show "waiting for approval") but has no rights.
	event.locals.admin = null;
	event.locals.pendingAdmin = null;
	const hadAuthCookie = event.cookies.get(AUTH_COOKIE) !== undefined;

	if (hadAuthCookie) {
		event.locals.pb.authStore.loadFromCookie(
			event.request.headers.get('cookie') || '',
			AUTH_COOKIE
		);

		if (event.locals.pb.authStore.isValid && isAdminAccount(event.locals.pb.authStore.record)) {
			try {
				await event.locals.pb.collection(ADMIN_COLLECTION).authRefresh();
				event.locals.admin = toAdminSession(event.locals.pb.authStore.record);
				event.locals.pendingAdmin = toPendingAdmin(event.locals.pb.authStore.record);
			} catch {
				// revoked, expired or PocketBase unreachable
			}
		}

		if (!event.locals.admin && !event.locals.pendingAdmin) event.locals.pb.authStore.clear();
	}

	// 4. The admin area requires an admin session. Page and data requests reach
	//    the admin layout, which redirects to the login page; everything else
	//    (form actions, API endpoints) is refused right here, so no individual
	//    action can be forgotten.
	const { pathname } = event.url;
	if (isAdminPath(pathname) && !isPublicAdminPath(pathname) && !event.locals.admin) {
		const isPageRequest =
			(event.request.method === 'GET' || event.request.method === 'HEAD') &&
			!pathname.startsWith('/admin/api/');
		if (!isPageRequest) {
			return new Response('Forbidden', { status: 403 });
		}
	}

	const response = await resolve(event);

	// 5. Persist (or clear) the admin session cookie. Guests never get one.
	if (hadAuthCookie || event.locals.pb.authStore.isValid) {
		response.headers.append(
			'set-cookie',
			event.locals.pb.authStore.exportToCookie(
				{
					httpOnly: true,
					secure: !dev,
					sameSite: 'Lax',
					path: '/'
				},
				AUTH_COOKIE
			)
		);
	}

	return response;
};
