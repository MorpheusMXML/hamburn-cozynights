import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Prüfen: Ist überhaupt jemand eingeloggt?
    if (!locals.pb.authStore.isValid) {
        if (url.pathname !== '/admin/login') {
            throw redirect(303, '/admin/login');
        }
    } else {
        // User ist eingeloggt. Wir prüfen die Berechtigung.
        const user = locals.pb.authStore.model;

        // 2. TÜRSTEHER-LOGIK:
        // Wir prüfen das 'verified' Feld von PocketBase.
        // Dieses ist standardmäßig 'false' und muss von Ihnen im Admin-Panel auf 'true' gesetzt werden.
        if (!user?.verified) {
            console.warn(`Zugriff verweigert: User ${user?.email} ist nicht verifiziert.`);
            
            // Session löschen (optional: oder eingeloggt lassen, aber Zugriff verweigern)
            locals.pb.authStore.clear();
            
            throw redirect(303, '/admin/login?fail=true&reason=not_verified');
        }

        // Wenn User verifiziert ist -> darf er nicht mehr auf die Login-Seite
        if (url.pathname === '/admin/login') {
            throw redirect(303, '/admin');
        }
    }

    // Daten für das Frontend bereitstellen
    const userModel = locals.pb.authStore.model;
    const userJSON = userModel ? JSON.parse(JSON.stringify(userModel)) : null;

    return {
        user: userJSON
    };
};