import { fail, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Actions, PageServerLoad } from './$types';
import {
	ADMIN_COLLECTION,
	ADMIN_EMAIL_DOMAIN,
	ADMIN_OAUTH_COOKIE,
	ADMIN_OAUTH_COOKIE_PATH,
	ADMIN_OAUTH_PROVIDER
} from '$lib/server/admin-auth';

// Admin sign-in is Google only. There is deliberately no password login and no
// invite/approval UI here: a first sign-in of a @mauersegler.art Workspace
// account creates an access request, which a superuser approves on the server
// (scripts/cozy-admin.sh approve, or the PocketBase dashboard).

async function getGoogleProvider(locals: App.Locals) {
	const methods = await locals.pb.collection(ADMIN_COLLECTION).listAuthMethods();
	return methods.oauth2?.providers?.find((p) => p.name === ADMIN_OAUTH_PROVIDER) ?? null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	let googleEnabled = false;
	let backendError = false;
	try {
		googleEnabled = !!(await getGoogleProvider(locals));
	} catch (err: any) {
		backendError = true;
		console.error('[AdminLogin] Could not load auth methods:', err?.message);
	}

	return {
		googleEnabled,
		backendError,
		adminDomain: ADMIN_EMAIL_DOMAIN,
		pendingAdmin: locals.pendingAdmin,
		error: url.searchParams.get('error')
	};
};

export const actions: Actions = {
	google: async ({ locals, cookies, url }) => {
		let provider;
		try {
			provider = await getGoogleProvider(locals);
		} catch (err: any) {
			console.error('[AdminLogin] Could not load auth methods:', err?.message);
			return fail(503, {
				message: 'The control center backend is unreachable. Try again shortly.'
			});
		}
		if (!provider) {
			return fail(503, { message: 'Google sign-in is not configured on this server.' });
		}

		// PocketBase does not check `state`; the callback does, against this cookie.
		cookies.set(
			ADMIN_OAUTH_COOKIE,
			JSON.stringify({ state: provider.state, codeVerifier: provider.codeVerifier }),
			{
				path: ADMIN_OAUTH_COOKIE_PATH,
				httpOnly: true,
				secure: !dev,
				sameSite: 'lax',
				maxAge: 60 * 10
			}
		);

		// authURL ends with "redirect_uri=". `hd` and `prompt` only pre-select the
		// Workspace account in Google's chooser; enforcement is server-side.
		const redirectUrl = `${url.origin}/auth/callback/${ADMIN_OAUTH_PROVIDER}`;
		throw redirect(
			303,
			`${provider.authURL}${encodeURIComponent(redirectUrl)}&hd=${encodeURIComponent(ADMIN_EMAIL_DOMAIN)}&prompt=select_account`
		);
	}
};
