import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
    // 1. Wir holen uns die Provider-Infos, die wir beim Start des Logins gespeichert haben
    const providerCookie = cookies.get('provider');
    
    if (!providerCookie) {
        console.error('Callback Error: Kein Provider-Cookie gefunden.');
        throw redirect(303, '/admin/login?fail=true');
    }

    // 2. Cookie parsen
    const provider = JSON.parse(providerCookie);

    // 3. Sicherheits-Check: Stimmt der "State" überein? (Schutz vor CSRF-Attacken)
    if (provider.state !== url.searchParams.get('state')) {
        console.error('Callback Error: State stimmt nicht überein.');
        throw redirect(303, '/admin/login?fail=true');
    }

    try {
        // 4. Den Code von GitHub gegen einen echten Login-Token tauschen
        // WICHTIG: Diese URL muss exakt mit der in der Login-Action übereinstimmen
        const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;
        
        await locals.pb.collection('users').authWithOAuth2Code(
            provider.name,
            url.searchParams.get('code') || '',
            provider.codeVerifier,
            redirectUrl
        );
    } catch (err) {
        console.error('OAuth Error beim Code-Tausch:', err);
        // Bei Fehler zurück zum Login
        throw redirect(303, '/admin/login?fail=true');
    }

    // 5. Alles hat geklappt -> Weiterleitung zum Admin-Dashboard
    throw redirect(303, '/admin');
};