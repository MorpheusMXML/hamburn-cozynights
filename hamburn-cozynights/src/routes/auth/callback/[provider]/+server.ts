import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
	// 1. Retrieve provider info stored at the start of the login flow 🔍
	const providerCookie = cookies.get('provider');

	if (!providerCookie) {
		console.error('Callback Error: No provider cookie found.');
		throw redirect(303, '/admin/login?fail=true');
	}

	// 2. Parse the cookie 🍪
	const provider = JSON.parse(providerCookie);

	// 3. Security check: Does the "state" match? (CSRF protection) 🛡️
	if (provider.state !== url.searchParams.get('state')) {
		console.error('Callback Error: State mismatch.');
		throw redirect(303, '/admin/login?fail=true');
	}

	try {
		// 4. Exchange the OAuth code for a real login token 🎫
		// IMPORTANT: This URL must exactly match the one in the login action!
		const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;

		await locals.pb
			.collection('users')
			.authWithOAuth2Code(
				provider.name,
				url.searchParams.get('code') || '',
				provider.codeVerifier,
				redirectUrl
			);
	} catch (err) {
		console.error('OAuth Error during code exchange:', err);
		// On error, send them back to the portal
		throw redirect(303, '/admin/login?fail=true');
	}

	// 5. The playa provides! Redirect to the admin dashboard 🚀
	throw redirect(303, '/admin');
};
