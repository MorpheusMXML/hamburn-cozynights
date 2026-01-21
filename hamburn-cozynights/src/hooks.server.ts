// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import type { TypedPocketBase } from '$lib/pocketbase-types'; // <--- Import hinzufügen

const PB_URL = 'http://127.0.0.1:8090'; 

export const handle: Handle = async ({ event, resolve }) => {
    // Füge 'as TypedPocketBase' hinzu, damit die Typen übereinstimmen
    event.locals.pb = new PocketBase(PB_URL) as TypedPocketBase;

    // Lade Auth-Store aus dem Cookie
    event.locals.pb.authStore.loadFromCookie(event.request.headers.get('cookie') || '');

    try {
        if (event.locals.pb.authStore.isValid) {
            await event.locals.pb.collection('users').authRefresh();
        }
    } catch {
        event.locals.pb.authStore.clear();
    }

    const response = await resolve(event);

    response.headers.append('set-cookie', event.locals.pb.authStore.exportToCookie({ httpOnly: false }));

    return response;
};