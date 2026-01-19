import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { AuthProviderInfo } from 'pocketbase';

// Interface Korrektur: Wir definieren explizit, was wir erwarten
// und nutzen 'authURL' (groß geschrieben), wie vom Linter gefordert.
interface ExtendedAuthProviderInfo extends AuthProviderInfo {
    authURL: string;
}

interface AuthMethodsResponse {
    authProviders: ExtendedAuthProviderInfo[];
    usernamePassword?: boolean;
    emailPassword?: boolean;
}

export const load: PageServerLoad = async ({ locals }) => {
    if (locals.pb.authStore.isValid) {
        throw redirect(303, '/admin');
    }

    const authMethods = await locals.pb.collection('users').listAuthMethods();
    const typedAuthMethods = authMethods as unknown as AuthMethodsResponse;

    return {
        providers: typedAuthMethods.authProviders
    };
};

export const actions: Actions = {
    oauth2: async ({ locals, cookies, url, request }) => {
        const formData = await request.formData();
        const providerName = formData.get('provider')?.toString();

        const authMethods = await locals.pb.collection('users').listAuthMethods();
        const typedAuthMethods = authMethods as unknown as AuthMethodsResponse;
        
        const provider = typedAuthMethods.authProviders.find((p) => p.name === providerName);

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

        // KORREKTUR: Hier nutzen wir jetzt 'authURL' + 'redirectUrl'
        // Hinweis: authURL enthält bereits den ersten Teil des Links, wir hängen den Redirect-Parameter an.
        // PocketBase erwartet oft: provider.authURL + redirectUrl
        throw redirect(303, provider.authURL + redirectUrl);
    },

    logout: async ({ locals }) => {
        locals.pb.authStore.clear();
        throw redirect(303, '/admin/login');
    }
};