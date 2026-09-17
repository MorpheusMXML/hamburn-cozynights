import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';

// Custom type for cleaner code
interface SafeAuthProvider {
	name: string;
	displayName: string;
	authURL?: string;
	authUrl?: string; // Fallback
}

export const load: PageServerLoad = async ({ locals }) => {
	// If already logged in and verified -> Dashboard 🚀
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
			enableEmail: true
		};
	} catch {
		return { providers: [], enableEmail: true, error: 'House backend unreachable.' };
	}
};

export const actions: Actions = {
	// ACTION 1: Login with Email 👤
	login: async ({ locals, request }) => {
		const data = await request.formData();
		const email = data.get('email')?.toString();
		const password = data.get('password')?.toString();

		if (!email || !password) return fail(400, { message: 'Fill in the blanks!' });

		try {
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch {
			return fail(400, { fail: true, message: 'Invalid keys or burner does not exist.' });
		}
		throw redirect(303, '/admin');
	},

	// ACTION 2: OAuth (GitHub/Google) 🔗
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
		if (!provider) return fail(400, { message: 'Provider lost in the desert.' });

		const redirectUrl = `${url.origin}/auth/callback/${provider.name}`;

		cookies.set('provider', JSON.stringify(provider), {
			path: '/',
			httpOnly: true,
			secure: !dev,
			maxAge: 60 * 5
		});

		const targetUrl = provider.authURL || provider.authUrl || '';
		throw redirect(303, targetUrl + redirectUrl);
	}
};
