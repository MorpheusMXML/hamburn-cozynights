// src/routes/admin/+layout.server.ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
    // 1. Validierung (wie gehabt) ...
    if (!locals.pb.authStore.isValid && url.pathname !== '/admin/login') {
        throw redirect(303, '/admin/login');
    }

    // 2. Daten für Frontend vorbereiten (SERIALISIERUNG IST PFLICHT!)
    const userModel = locals.pb.authStore.model;
    
    // Programonaut macht dies implizit oft durch DTOs, hier die explizite Lösung:
    return {
        user: userModel ? JSON.parse(JSON.stringify(userModel)) : null
    };
};