import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Prüfen: Ist ein User eingeloggt?
    if (!locals.pb.authStore.isValid) {
        if (url.pathname !== '/admin/login') {
            throw redirect(303, '/admin/login');
        }
    } else {
        // 2. User ist eingeloggt:
        if (url.pathname === '/admin/login') {
            throw redirect(303, '/admin');
        }

        // 3. Rollen-Check (Sicherheit)
        const user = locals.pb.authStore.model;
        // Hinweis: Stellen Sie sicher, dass Ihr User-Schema in PocketBase ein Feld 'role' hat
        if (!['reader', 'superadmin'].includes(user?.role)) {
             locals.pb.authStore.clear();
             throw redirect(303, '/admin/login');
        }
    }

    // KORREKTUR: Das User-Objekt muss serialisiert werden, da es eine Klasseninstanz ist.
    // structuredClone oder JSON.parse(JSON.stringify(...)) beheben den 500er Fehler.
    return {
        user: locals.pb.authStore.model ? structuredClone(locals.pb.authStore.model) : null
    };
};