import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Basis-Check: Ist User eingeloggt?
    if (!locals.pb.authStore.isValid) {
        if (url.pathname !== '/admin/login') {
            throw redirect(303, '/admin/login');
        }
    } else {
        // User ist drin.
        
        // Login-Seite für eingeloggte User sperren
        if (url.pathname === '/admin/login') {
            throw redirect(303, '/admin');
        }
    }

    // Wir holen das User-Objekt
    const userModel = locals.pb.authStore.model;
    const userJSON = userModel ? JSON.parse(JSON.stringify(userModel)) : null;

    return {
        user: userJSON,
        // Explizites Flag für das Frontend, um Buttons zu verstecken
        isVerified: userJSON?.verified === true
    };
};