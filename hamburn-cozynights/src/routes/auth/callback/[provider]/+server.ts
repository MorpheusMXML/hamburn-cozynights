import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
    // FEHLERBEHEBUNG: Unbenutzte Variable 'providerName' entfernt
    
    // 1. Provider-Daten aus dem Cookie holen
    const providerCookie = cookies.get('provider');
    if (!providerCookie) {
        throw redirect(303, '/admin/login?fail=true');
    }
    const provider = JSON.parse(providerCookie);

    // 2. State-Parameter prüfen
    if (provider.state !== url.searchParams.get('state')) {
        throw new Error("State parameters don't match.");
    }

    try {
        const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;
        
        await locals.pb.collection('users').authWithOAuth2Code(
            provider.name,
            url.searchParams.get('code') || '',
            provider.codeVerifier,
            redirectUrl
        );
    } catch (err) {
        console.error('OAuth Error:', err);
        return redirect(303, '/admin/login?fail=true');
    }

    throw redirect(303, '/admin');
};