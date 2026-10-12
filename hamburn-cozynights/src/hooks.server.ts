// src/hooks.server.ts
import PocketBase from 'pocketbase';
import { type Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { authTimeout, getAdminPb, limitReads, PB_URL, tokenRejected } from '$lib/server/pocketbase';
import { assertEncryptionKey } from '$lib/server/crypto';
import {
	ADMIN_COLLECTION,
	ADMIN_SESSION_UNCHECKED,
	AUTH_COOKIE,
	isAdminPath,
	isAdminAccount,
	isPublicAdminPath,
	isSignInFresh,
	toAdminSession,
	toPendingAdmin
} from '$lib/server/admin-auth';
import { resolveGuestSession } from '$lib/server/guest-session';

/**
 * Pages that act for a guest's ticket. The crew's area, the OAuth callback,
 * the health endpoint, the docs and the booking pass (its code is in the URL)
 * don't, and shouldn't pay for a ticket lookup.
 */
function usesGuestSession(pathname: string): boolean {
	if (isAdminPath(pathname)) return false;
	return !/^\/(auth|api|docs|pass)(\/|$)/.test(pathname);
}

// Fail fast: without a valid ENCRYPTION_KEY the app could neither find ticket
// codes (lookup hashes) nor read names. A container that starts with a wrong
// key must not serve requests, so the deploy script rolls back instead.
try {
	assertEncryptionKey();
} catch (err) {
	console.error(`[startup] ${(err as Error).message}`);
	if (!dev) throw err;
}

// Sent with every response unless a route sets a stricter value itself (the
// pass pages send same-origin: no referrer to other sites). HSTS belongs to the TLS terminator
// (deploy/nginx/*.conf). The Content-Security-Policy is deliberately narrow:
// it only forbids embedding and plugins. The full policy runs in
// report-only mode first: SvelteKit's inline bootstrap script and the
// components' inline styles need nonces/hashes (kit.csp) before it can be
// enforced, see docs/reference/security.md.
const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
	'cross-origin-opener-policy': 'same-origin',
	'content-security-policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
	'content-security-policy-report-only': [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"media-src 'self'",
		"font-src 'self'",
		"connect-src 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"object-src 'none'"
	].join('; ')
};

export const handle: Handle = async ({ event, resolve }) => {
	// 1. Initialize PocketBase instances
	// Reads give up after 10 s ($lib/server/pocketbase, limitReads); writes never do.
	event.locals.pb = limitReads(new PocketBase(PB_URL) as TypedPocketBase);
	// Auto-cancellation is meant for a browser deduping its own requests. Here
	// the layout and the page load run in parallel and both read app_settings:
	// the SDK would cancel one of them, and that page would fall back to Staging.
	event.locals.pb.autoCancellation(false);

	// Use the singleton service-account instance (Master Key)
	event.locals.adminPb = await getAdminPb();

	// 2. Guest session: the ticket code cookie, checked against the ticket list
	//    and the booking round, so every guest page sees the same answer and a
	//    session nobody can use anymore ends here (see $lib/server/guest-session).
	//    Pages of the crew and endpoints that carry their own code (the booking
	//    pass) never need it.
	event.locals.orderNumber = null;
	// A remote-function call (/_app/remote/…) reports the page path "/": it is
	// none, and the app has no remote functions to act for a guest.
	if (usesGuestSession(event.url.pathname) && !event.isRemoteRequest) {
		const session = await resolveGuestSession(event.cookies, event.locals.pb, event.locals.adminPb);
		event.locals.orderNumber = session.code;
		event.locals.order = session.order;
		event.locals.guestSignOut = session.signedOut;
	}

	// 3. Admin session. Only records of the `admins` collection count; the token
	//    is re-validated against PocketBase on every request, so approving,
	//    changing or revoking an account (scripts/cozy-admin.sh, PocketBase
	//    dashboard) takes effect on the next request. A pending access request
	//    keeps its session (to show "waiting for approval") but has no rights.
	//    Once a week the session ends anyway and Google is asked again
	//    (ADMIN_SIGN_IN_MAX_AGE_DAYS): that's when Workspace suspensions and
	//    2-Step Verification apply.
	//    Only PocketBase turning the token down (revoked, expired, account
	//    removed) ends the session. When it doesn't answer (restart, a hiccup
	//    under load), the cookie stays as it is and only this request runs
	//    without admin rights (adminUnchecked): the admin is still signed in a
	//    moment later, instead of being sent through Google again.
	event.locals.admin = null;
	event.locals.pendingAdmin = null;
	event.locals.adminSignInExpired = false;
	event.locals.adminUnchecked = false;
	const hadAuthCookie = event.cookies.get(AUTH_COOKIE) !== undefined;

	if (hadAuthCookie) {
		event.locals.pb.authStore.loadFromCookie(
			event.request.headers.get('cookie') || '',
			AUTH_COOKIE
		);

		if (event.locals.pb.authStore.isValid && isAdminAccount(event.locals.pb.authStore.record)) {
			try {
				await event.locals.pb.collection(ADMIN_COLLECTION).authRefresh(authTimeout());
				const record = event.locals.pb.authStore.record;
				if (isSignInFresh(record)) {
					event.locals.admin = toAdminSession(record);
					event.locals.pendingAdmin = toPendingAdmin(record);
				} else {
					event.locals.adminSignInExpired = true;
				}
			} catch (err) {
				if (!tokenRejected(err)) {
					event.locals.adminUnchecked = true;
					console.error(
						'[Admin] Session check failed, PocketBase did not answer; the session is kept:',
						(err as Error)?.message
					);
				}
			}
		}

		// Not signed in for this request: nothing goes to PocketBase with the token.
		if (!event.locals.admin && !event.locals.pendingAdmin) event.locals.pb.authStore.clear();
	}
	// What the request itself does to the session (signing out, the Google
	// callback) is saved in step 5, also when the check above couldn't run.
	let sessionChanged = false;
	event.locals.pb.authStore.onChange(() => {
		sessionChanged = true;
	});

	// 4. The admin area requires an admin session. Page and data requests reach
	//    the admin layout, which redirects to the login page; everything else
	//    (form actions, API endpoints) is refused right here, so no individual
	//    action can be forgotten.
	const { pathname } = event.url;
	if (isAdminPath(pathname) && !isPublicAdminPath(pathname) && !event.locals.admin) {
		const isPageRequest =
			(event.request.method === 'GET' || event.request.method === 'HEAD') &&
			!pathname.startsWith('/admin/api/');
		if (!isPageRequest) {
			const isAction = event.request.headers.get('x-sveltekit-action') === 'true';
			if (event.locals.adminUnchecked) {
				// Not a sign-in problem: the page says so where the admin is looking
				// (an action result of type "error"), and the session stays.
				if (isAction) {
					return new Response(
						JSON.stringify({ type: 'error', error: { message: ADMIN_SESSION_UNCHECKED } }),
						{ status: 503, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(ADMIN_SESSION_UNCHECKED, { status: 503 });
			}
			// A form submitted with use:enhance cannot show a plain-text 403: the
			// client deserialises every action response, so a bare body ends up as
			// the page's generic "We could not reach the server" message, which
			// hides the real reason (the admin session ran out, at the latest at
			// the weekly re-sign-in). An action result of type "redirect" sends
			// the browser to the login page instead, where the reason is visible.
			if (isAction) {
				const location = event.locals.adminSignInExpired
					? '/admin/login?error=reauth'
					: '/admin/login';
				return new Response(JSON.stringify({ type: 'redirect', status: 303, location }), {
					status: 403,
					headers: { 'content-type': 'application/json' }
				});
			}
			return new Response('Forbidden', { status: 403 });
		}
	}

	const response = await resolve(event);

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}

	// 5. Persist (or clear) the admin session cookie. Guests never get one. A
	//    session PocketBase couldn't check is left exactly as it is, unless the
	//    request signed in or out itself.
	const leaveCookie = event.locals.adminUnchecked && !sessionChanged;
	if (!leaveCookie && (hadAuthCookie || event.locals.pb.authStore.isValid)) {
		response.headers.append(
			'set-cookie',
			event.locals.pb.authStore.exportToCookie(
				{
					httpOnly: true,
					secure: !dev,
					sameSite: 'Lax',
					path: '/'
				},
				AUTH_COOKIE
			)
		);
	}

	return response;
};
