import { redirect } from '@sveltejs/kit';
import { ClientResponseError } from 'pocketbase';
import type { RequestHandler } from './$types';
import {
	ADMIN_COLLECTION,
	ADMIN_OAUTH_COOKIE,
	ADMIN_OAUTH_COOKIE_PATH,
	ADMIN_OAUTH_PROVIDER,
	checkGoogleIdentity,
	isAdminAccount,
	isSignInFresh,
	toAdminSession,
	type AdminLoginError
} from '$lib/server/admin-auth';

/** Resolves to where the browser goes next: an error reason, or the admin area / pending page. */
async function completeSignIn(
	locals: App.Locals,
	url: URL,
	providerParam: string,
	flowCookie: string | undefined
): Promise<AdminLoginError | 'approved' | 'pending'> {
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
		if (!locals.pb.authStore.isValid || !isAdminAccount(auth.record)) return 'not_authorized';
		// A new access request (or one not approved yet) keeps its session, so the
		// login page can show that it is waiting for a superuser.
		if (!toAdminSession(auth.record)) return 'pending';
		// The guard hook records the sign-in (last_sign_in) before it completes;
		// hooks.server.ts ends every session whose record lacks a fresh one. A
		// session started without it would only bounce back here, so say so.
		if (!isSignInFresh(auth.record)) {
			console.error('[AdminLogin] Sign-in accepted but not recorded (admins.last_sign_in empty)');
			return 'not_recorded';
		}
		return 'approved';
	} catch (err) {
		if (err instanceof ClientResponseError && err.response?.data?.code === 'sign_in_not_recorded') {
			// The guard hook could not write last_sign_in and refused the sign-in.
			console.error(`[AdminLogin] Sign-in not recorded by PocketBase: ${err.message}`);
			return 'not_recorded';
		}
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

	const outcome = await completeSignIn(locals, url, params.provider, flowCookie);

	// hooks.server.ts writes (or clears) the session cookie on the way out.
	if (outcome === 'approved') throw redirect(303, '/admin');
	if (outcome === 'pending') throw redirect(303, '/admin/login');

	locals.pb.authStore.clear();
	throw redirect(303, `/admin/login?error=${outcome}`);
};
