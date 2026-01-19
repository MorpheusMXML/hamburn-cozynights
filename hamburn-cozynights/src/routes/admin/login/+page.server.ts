import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { ClientResponseError } from 'pocketbase';

// 1. Eigener, flexibler Typ statt Extension
// Wir definieren genau das, was wir im Frontend brauchen.
// Das verhindert Konflikte mit strengen SDK-Typen.
interface SafeAuthProvider {
    name: string;
    displayName: string;
    authURL?: string; // Neu (PocketBase v0.23+)
    authUrl?: string; // Alt (Fallback)
    state?: string;
    codeVerifier?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
}

interface RobustAuthResponse {
    authProviders?: SafeAuthProvider[];
    oauth2?: {
        enabled: boolean;
        providers: SafeAuthProvider[];
    };
    emailPassword?: boolean;
    usernamePassword?: boolean;
    password?: {
        enabled: boolean;
    };
}

export const load: PageServerLoad = async ({ locals }) => {
    if (locals.pb.authStore.isValid) {
        throw redirect(303, '/admin');
    }

    try {
        const rawData = await locals.pb.collection('users').listAuthMethods();
        
        // Wir nutzen 'unknown' als Brücke, um unseren eigenen Typ zu erzwingen
        const data = JSON.parse(JSON.stringify(rawData)) as unknown as RobustAuthResponse;

        // Robuste Suchlogik
        let providers: SafeAuthProvider[] = data.authProviders || [];
        
        if ((!providers || providers.length === 0) && data.oauth2 && data.oauth2.providers) {
            providers = data.oauth2.providers;
        }

        let enableEmail = !!(data.emailPassword || data.usernamePassword);
        if (!enableEmail && data.password) {
            enableEmail = data.password.enabled;
        }

        return {
            providers: providers,
            enableEmail: enableEmail
        };

    } catch (err) {
        console.error('Fehler beim Laden der Auth-Methoden:', err);
        return {
            providers: [],
            enableEmail: true,
            error: "Backend nicht erreichbar"
        };
    }
};

export const actions: Actions = {
    login: async ({ locals, request }) => {
        const data = await request.formData();
        const email = data.get('email')?.toString();
        const password = data.get('password')?.toString();

        if (!email || !password) {
            return fail(400, { emailRequired: true, message: 'Bitte Email und Passwort angeben.' });
        }

        try {
            await locals.pb.collection('users').authWithPassword(email, password);
        } catch (error) {
            const err = error as ClientResponseError;
            return fail(500, { fail: true, message: err.message || 'Login fehlgeschlagen.' });
        }

        throw redirect(303, '/admin');
    },

    oauth2: async ({ locals, cookies, url, request }) => {
        const formData = await request.formData();
        const providerName = formData.get('provider')?.toString();

        const rawData = await locals.pb.collection('users').listAuthMethods();
        const data = JSON.parse(JSON.stringify(rawData)) as unknown as RobustAuthResponse;
        
        let providers: SafeAuthProvider[] = data.authProviders || [];
        if ((!providers || providers.length === 0) && data.oauth2 && data.oauth2.providers) {
            providers = data.oauth2.providers;
        }
        
        const provider = providers.find((p) => p.name === providerName);

        if (!provider) {
            return fail(400, { message: 'Provider nicht gefunden' });
        }

        const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;

        cookies.set('provider', JSON.stringify(provider), {
            path: '/',
            httpOnly: true,
            secure: false, // Bei HTTPS auf true setzen
            maxAge: 60 * 5
        });

        // Jetzt greifen wir sicher auf das zu, was da ist
        const targetUrl = provider.authURL || provider.authUrl || '';
        
        throw redirect(303, targetUrl + redirectUrl);
    }
};