// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { env } from '$env/dynamic/public';
import { getAdminPb } from '$lib/server/pocketbase';

const PB_URL = env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Initialize PocketBase instances for the request
    event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;
    
    try {
        // Use singleton admin instance to prevent rate-limiting auth requests
        event.locals.adminPb = await getAdminPb();
    } catch (err: any) {
        console.error(`[Security] Admin auth critical failure. Reason: ${err.message}`);
        // Still assign it (even if unauthenticated) so actions can check .isValid
        // @ts-ignore - Importing adminPb singleton as fallback
        import('$lib/server/pocketbase').then(m => event.locals.adminPb = m.adminPb);
    }

    // 2. Retrieve booking code from cookies
    event.locals.orderNumber = event.cookies.get('bookingCode') || null;

    // 3. Handle PocketBase Auth (Session-based via cookies)
    const cookie = event.request.headers.get('cookie') || '';
    event.locals.pb.authStore.loadFromCookie(cookie);

    try {
        if (event.locals.pb.authStore.isValid) {
            const model = event.locals.pb.authStore.model;
            // @ts-ignore - isAdmin is deprecated in newer PB
            const isSuper = model?.collectionName === '_superusers' || event.locals.pb.authStore.isAdmin;
            
            if (isSuper) {
                try {
                    await event.locals.pb.collection('_superusers').authRefresh();
                } catch {
                    await event.locals.pb.admins.authRefresh();
                }
            } else {
                await event.locals.pb.collection('users').authRefresh();
            }
            
            event.locals.user = event.locals.pb.authStore.model;
        } else {
            event.locals.user = undefined;
        }
    } catch (err) {
        console.warn('[Security] Auth refresh failed. Clearing session.', err);
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
