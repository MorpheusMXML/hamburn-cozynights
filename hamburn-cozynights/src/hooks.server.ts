// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import type { TypedPocketBase } from '$lib/pocketbase-types';

const PB_URL = 'http://127.0.0.1:8090'; 

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

    // 1. Retrieve booking code from cookies
    event.locals.orderNumber = event.cookies.get('bookingCode') || null;

    // 2. Handle PocketBase Auth
    event.locals.pb.authStore.loadFromCookie(event.request.headers.get('cookie') || '');
    try {
        if (event.locals.pb.authStore.isValid) {
            await event.locals.pb.collection('users').authRefresh();
        }
    } catch {
        event.locals.pb.authStore.clear();
    }

    const response = await resolve(event);

    // 3. Export auth state back to cookie
    response.headers.append('set-cookie', event.locals.pb.authStore.exportToCookie({ httpOnly: false }));

    return response;
};