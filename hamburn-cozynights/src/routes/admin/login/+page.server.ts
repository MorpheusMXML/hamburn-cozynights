import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ClientResponseError } from 'pocketbase';

// Eigener Typ für sauberen Code
interface SafeAuthProvider {
    name: string;
    displayName: string;
    authURL?: string;
    authUrl?: string; // Fallback
}

export const load: PageServerLoad = async ({ locals }) => {
    // Wenn schon eingeloggt und verifiziert -> Dashboard
    if (locals.pb.authStore.isValid && locals.pb.authStore.model?.verified) {
        throw redirect(303, '/admin');
    }

    try {
        const rawData = await locals.pb.collection('users').listAuthMethods();
        const data = JSON.parse(JSON.stringify(rawData));
        
        let providers: SafeAuthProvider[] = data.authProviders || [];
        if ((!providers || providers.length === 0) && data.oauth2 && data.oauth2.providers) {
            providers = data.oauth2.providers;
        }

        return {
            providers: providers,
            // Email-Login ist quasi immer möglich, wenn wir Register anbieten
            enableEmail: true 
        };
    } catch {
        return { providers: [], enableEmail: true, error: "Backend nicht erreichbar" };
    }
};

export const actions: Actions = {
    // ACTION 1: Login mit Email
    login: async ({ locals, request }) => {
        const data = await request.formData();
        const email = data.get('email')?.toString();
        const password = data.get('password')?.toString();

        if (!email || !password) return fail(400, { message: 'Bitte Felder ausfüllen' });

        try {
            await locals.pb.collection('users').authWithPassword(email, password);
        } catch {
            return fail(400, { fail: true, message: 'Falsche Zugangsdaten oder User existiert nicht.' });
        }
        throw redirect(303, '/admin');
    },

    // ACTION 2: Registrieren (User erstellen + Login)
    register: async ({ locals, request }) => {
        const data = await request.formData();
        const email = data.get('email')?.toString();
        const password = data.get('password')?.toString();
        const passwordConfirm = data.get('passwordConfirm')?.toString();

        if (!email || !password || !passwordConfirm) {
            return fail(400, { register: true, message: 'Alle Felder ausfüllen.' });
        }
        if (password !== passwordConfirm) {
            return fail(400, { register: true, message: 'Passwörter stimmen nicht überein.' });
        }

        try {
            // 1. User erstellen (Standard: verified = false)
            await locals.pb.collection('users').create({
                email,
                password,
                passwordConfirm,
                verified: false // explizit false (obwohl default)
            });

            // 2. Sofort einloggen
            await locals.pb.collection('users').authWithPassword(email, password);

        } catch (error) {
            const err = error as ClientResponseError;
            // Fehler abfangen (z.B. Email schon vergeben)
            return fail(400, { register: true, message: err.message || 'Registrierung fehlgeschlagen.' });
        }
        
        // Redirect zum Admin -> Layout wird blockieren, weil verified=false
        throw redirect(303, '/admin');
    },

    // ACTION 3: OAuth (GitHub/Google)
    oauth2: async ({ locals, cookies, url, request }) => {
        const formData = await request.formData();
        const providerName = formData.get('provider')?.toString();

        const rawData = await locals.pb.collection('users').listAuthMethods();
        const data = JSON.parse(JSON.stringify(rawData));
        
        let providers: SafeAuthProvider[] = data.authProviders || [];
        if ((!providers || providers.length === 0) && data.oauth2?.providers) {
            providers = data.oauth2.providers;
        }
        
        const provider = providers.find((p) => p.name === providerName);
        if (!provider) return fail(400, { message: 'Provider fehlt' });

        const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;
        
        cookies.set('provider', JSON.stringify(provider), {
            path: '/', httpOnly: true, secure: false, maxAge: 60 * 5
        });

        const targetUrl = provider.authURL || provider.authUrl || '';
        throw redirect(303, targetUrl + redirectUrl);
    }
};