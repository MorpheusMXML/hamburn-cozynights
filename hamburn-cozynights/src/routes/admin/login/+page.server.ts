import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import type { ClientResponseError } from 'pocketbase';

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
			// Email login is almost always available if we offer registration 👤
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
			// 1. Try regular user auth
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch (userErr) {
			try {
				// 2. Fallback: Try Superuser (v0.23+) / Admin auth
				try {
					await locals.pb.collection('_superusers').authWithPassword(email, password);
				} catch {
					await locals.pb.admins.authWithPassword(email, password);
				}
			} catch (adminErr) {
				return fail(400, { fail: true, message: 'Invalid keys or burner does not exist.' });
			}
		}
		throw redirect(303, '/admin');
	},

	// ACTION 2: Register (Create User + Login) ✨
	register: async ({ locals, request }) => {
		const data = await request.formData();
		const email = data.get('email')?.toString();
		const password = data.get('password')?.toString();
		const passwordConfirm = data.get('passwordConfirm')?.toString();

		if (!email || !password || !passwordConfirm) {
			return fail(400, { register: true, message: 'The playa needs all info.' });
		}
		if (password !== passwordConfirm) {
			return fail(400, { register: true, message: 'Passphrases do not match.' });
		}

		try {
			// 1. Create user (Default: verified = false) 🗝️
			await locals.pb.collection('users').create({
				email,
				password,
				passwordConfirm,
				verified: false
			});

			// 2. Login immediately 🚀
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch (error) {
			const err = error as ClientResponseError;
			return fail(400, {
				register: true,
				message: err.message || 'Registration turned into dust.'
			});
		}

		// Redirect to admin -> layout will block because verified=false 🛡️
		throw redirect(303, '/admin');
	},

	// ACTION 3: OAuth (GitHub/Google) 🔗
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
