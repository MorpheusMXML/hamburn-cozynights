// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { env } from '$env/dynamic/public';

const PB_URL = env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Initialize PocketBase instance for the request
    event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

    // 2. Retrieve booking code from cookies
    event.locals.orderNumber = event.cookies.get('bookingCode') || null;

    // 3. Handle PocketBase Auth (Session-based via cookies)
    const cookie = event.request.headers.get('cookie') || '';
    event.locals.pb.authStore.loadFromCookie(cookie);

    try {
        if (event.locals.pb.authStore.isValid) {
            // Re-authenticate and refresh the session
            await event.locals.pb.collection('users').authRefresh();
            event.locals.user = event.locals.pb.authStore.model;
        } else {
            event.locals.user = undefined;
        }
    } catch {
        event.locals.pb.authStore.clear();
        event.locals.user = undefined;
    }

    const response = await resolve(event);

    // 4. Export updated auth state back to cookie
    response.headers.append('set-cookie', event.locals.pb.authStore.exportToCookie({ 
        httpOnly: false, // Must be false if client-side PocketBase needs to read it
        secure: !dev,
        sameSite: 'lax',
        path: '/'
    }));

    return response;
};