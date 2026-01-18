import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Prüfen: Ist ein User eingeloggt?
    if (!locals.pb.authStore.isValid) {
        // Wenn nicht eingeloggt und nicht schon auf der Login-Seite -> Redirect
        if (url.pathname !== '/admin/login') {
            throw redirect(303, '/admin/login');
        }
    } else {
        // 2. User ist eingeloggt:
        // Wenn er versucht, die Login-Seite aufzurufen -> direkt ins Dashboard schicken
        if (url.pathname === '/admin/login') {
            throw redirect(303, '/admin');
        }

        // 3. Rollen-Check (Sicherheit)
        const user = locals.pb.authStore.model;
        // Erlaube nur reader oder superadmin
        if (!['reader', 'superadmin'].includes(user?.role)) {
             locals.pb.authStore.clear(); // Rauswerfen
             throw redirect(303, '/admin/login');
        }
    }

    // User-Daten an die Pages weitergeben
    return {
        user: locals.pb.authStore.model
    };
};