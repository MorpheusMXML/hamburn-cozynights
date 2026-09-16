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
	isPublicAdminPath,
	toAdminSession
} from '$lib/server/admin-auth';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize PocketBase instances
	event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

	// Use the singleton service-account instance (Master Key)
	event.locals.adminPb = await getAdminPb();

	// 2. Guest session: the ticket code cookie
	event.locals.orderNumber = event.cookies.get('bookingCode') || null;

	// 3. Admin session. Only records of the `admins` collection count; the token
	//    is re-validated against PocketBase on every request, so revoking an
	//    admin (scripts/cozy-admin.sh remove) takes effect immediately.
	event.locals.admin = null;
	const hadAuthCookie = event.cookies.get(AUTH_COOKIE) !== undefined;

	if (hadAuthCookie) {
		event.locals.pb.authStore.loadFromCookie(
			event.request.headers.get('cookie') || '',
			AUTH_COOKIE
		);

		if (event.locals.pb.authStore.isValid && toAdminSession(event.locals.pb.authStore.record)) {
			try {
				await event.locals.pb.collection(ADMIN_COLLECTION).authRefresh();
				event.locals.admin = toAdminSession(event.locals.pb.authStore.record);
			} catch {
				// revoked, expired or PocketBase unreachable
			}
		}

		if (!event.locals.admin) event.locals.pb.authStore.clear();
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
