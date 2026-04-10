// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

const PB_URL = env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

export const handle: Handle = async ({ event, resolve }) => {
    // 1. Initialize PocketBase instances for the request
    event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;
    event.locals.adminPb = new PocketBase(PB_URL) as TypedPocketBase;

    // 2. Authenticate Admin instance for secure server-side ops
    try {
        if (privateEnv.PB_ADMIN_EMAIL && privateEnv.PB_ADMIN_PASSWORD) {
            try {
                // New PB (v0.23+)
                await event.locals.adminPb.collection('_superusers').authWithPassword(
                    privateEnv.PB_ADMIN_EMAIL, 
                    privateEnv.PB_ADMIN_PASSWORD
                );
            } catch {
                // Old PB
                await event.locals.adminPb.admins.authWithPassword(
                    privateEnv.PB_ADMIN_EMAIL, 
                    privateEnv.PB_ADMIN_PASSWORD
                );
            }
        }
    } catch (err) {
        console.error('[Security] Failed to authenticate adminPb instance.', err);
    }

    // 3. Retrieve booking code from cookies
    event.locals.orderNumber = event.cookies.get('bookingCode') || null;

    // 3. Handle PocketBase Auth (Session-based via cookies)
    const cookie = event.request.headers.get('cookie') || '';
    event.locals.pb.authStore.loadFromCookie(cookie);

    try {
        if (event.locals.pb.authStore.isValid) {
            // Re-authenticate and refresh the session based on the auth model type
            // Check if it's a regular user or a superuser (admin)
            // @ts-ignore - isAdmin is deprecated in newer PB, checking collection name instead
            const isSuper = event.locals.pb.authStore.model?.collectionName === '_superusers' || event.locals.pb.authStore.isAdmin;
            
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