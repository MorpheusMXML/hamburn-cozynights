// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { env } from '$env/dynamic/public';
import { getAdminPb } from '$lib/server/pocketbase';

const PB_URL = env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize PocketBase instances
	event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

	// Use the singleton admin instance (Master Key)
	event.locals.adminPb = await getAdminPb();

	// 2. Retrieve session data
	event.locals.orderNumber = event.cookies.get('bookingCode') || null;

	// 3. Handle Auth (Session-based via cookies)
	const cookie = event.request.headers.get('cookie') || '';
	event.locals.pb.authStore.loadFromCookie(cookie);

	try {
		if (event.locals.pb.authStore.isValid) {
			const record = event.locals.pb.authStore.record || event.locals.pb.authStore.model;

			// Check for Superuser (v0.23+) or Legacy Admin
			// @ts-ignore - isSuperuser is the new way
			const isSuper =
				record?.collectionName === '_superusers' || event.locals.pb.authStore.isSuperuser;

			if (isSuper) {
				try {
					await event.locals.pb.collection('_superusers').authRefresh();
				} catch {
					await event.locals.pb.admins.authRefresh();
				}
			} else {
				await event.locals.pb.collection('users').authRefresh();
			}

			event.locals.user = event.locals.pb.authStore.record || event.locals.pb.authStore.model;
		} else {
			event.locals.user = undefined;
		}
	} catch (err) {
		event.locals.pb.authStore.clear();
		event.locals.user = undefined;
	}

	const response = await resolve(event);

	// 4. Export updated auth state
	response.headers.append(
		'set-cookie',
		event.locals.pb.authStore.exportToCookie({
			httpOnly: false,
			secure: !dev,
			sameSite: 'lax',
			path: '/'
		})
	);

	return response;
};
