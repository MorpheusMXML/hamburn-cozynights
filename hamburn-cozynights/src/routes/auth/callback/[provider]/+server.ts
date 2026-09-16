import { redirect } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import type { RequestHandler } from './$types';
import {
	ADMIN_COLLECTION,
	ADMIN_OAUTH_COOKIE,
	ADMIN_OAUTH_COOKIE_PATH,
	ADMIN_OAUTH_PROVIDER,
	checkGoogleIdentity,
	toAdminSession,
	type AdminLoginError
} from '$lib/server/admin-auth';

async function completeSignIn(
	locals: App.Locals,
	url: URL,
	providerParam: string,
	flowCookie: string | undefined
): Promise<AdminLoginError | null> {
	if (providerParam !== ADMIN_OAUTH_PROVIDER) return 'failed';
	// e.g. access_denied when the user cancels on Google's consent screen
	if (url.searchParams.get('error')) return 'cancelled';

	let flow: { state?: unknown; codeVerifier?: unknown } | null = null;
	try {
		flow = flowCookie ? JSON.parse(flowCookie) : null;
	} catch {
		flow = null;
	}
	// CSRF protection: the state must match the one issued by the login action.
	const state = url.searchParams.get('state');
	if (!flow || typeof flow.state !== 'string' || !state || flow.state !== state) return 'expired';

	const code = url.searchParams.get('code');
	if (!code || typeof flow.codeVerifier !== 'string') return 'failed';

	// Must be identical to the redirect URL sent in the login action.
	const redirectUrl = `${url.origin}/auth/callback/${ADMIN_OAUTH_PROVIDER}`;

	try {
		const auth = await locals.pb
			.collection(ADMIN_COLLECTION)
			.authWithOAuth2Code(ADMIN_OAUTH_PROVIDER, code, flow.codeVerifier, redirectUrl);

		// The PocketBase guard hook already enforced all of this; re-check anyway.
		const identityError = checkGoogleIdentity(auth.meta);
		if (identityError) return identityError;
		if (!locals.pb.authStore.isValid || !toAdminSession(auth.record)) return 'not_authorized';
		return null;
	} catch (err) {
		if (err instanceof ClientResponseError && err.status === 403) {
			// Rejected by the guard hook (not invited / wrong domain) or createRule.
			console.warn(`[AdminLogin] Sign-in rejected by PocketBase: ${err.message}`);
			return 'not_authorized';
		}
		if (err instanceof ClientResponseError && err.status === 400) {
			// e.g. Google refused the code exchange (reused code, redirect URI mismatch)
			console.error(`[AdminLogin] OAuth2 code exchange refused: ${err.message}`);
			return 'failed';
		}
		console.error('[AdminLogin] OAuth2 code exchange failed:', (err as Error)?.message);
		return 'unavailable';
	}
}

export const GET: RequestHandler = async ({ locals, url, cookies, params }) => {
	const flowCookie = cookies.get(ADMIN_OAUTH_COOKIE);
	cookies.delete(ADMIN_OAUTH_COOKIE, { path: ADMIN_OAUTH_COOKIE_PATH });

	const loginError = await completeSignIn(locals, url, params.provider, flowCookie);
	if (loginError) {
		locals.pb.authStore.clear();
		throw redirect(303, `/admin/login?error=${loginError}`);
	}

	// hooks.server.ts writes the session cookie on the way out.
	throw redirect(303, '/admin');
};
