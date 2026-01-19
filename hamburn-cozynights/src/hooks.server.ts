// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';

// Deine PB URL (Lokal oder Produktion)
const PB_URL = 'http://127.0.0.1:8090'; 

export const handle: Handle = async ({ event, resolve }) => {
    event.locals.pb = new PocketBase(PB_URL);

    // Lade Auth-Store aus dem Cookie des Browsers
    event.locals.pb.authStore.loadFromCookie(event.request.headers.get('cookie') || '');

    try {
        // Prüfe ob das Token noch gültig ist
        if (event.locals.pb.authStore.isValid) {
            await event.locals.pb.collection('users').authRefresh();
        }
    } catch {
        // Wenn ungültig, lösche den Store
        event.locals.pb.authStore.clear();
    }

    const response = await resolve(event);

    // Setze das Cookie neu (Refresh Token update)
    response.headers.append('set-cookie', event.locals.pb.authStore.exportToCookie({ httpOnly: false }));

    return response;
};