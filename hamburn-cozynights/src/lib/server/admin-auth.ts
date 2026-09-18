/**
 * Admin access model.
 *
 * The admin area is only for approved records (role `admin` or `superuser`)
 * of the PocketBase auth collection `admins`. Sign-in is Google OAuth2 only,
 * restricted to verified Google Workspace accounts of {@link ADMIN_EMAIL_DOMAIN}.
 * A first sign-in without an invite creates an access request (role
 * `pending`) that a superuser approves on the server — with
 * `scripts/cozy-admin.sh approve` or in the PocketBase dashboard; there is no
 * approval or invite UI in the app. PocketBase enforces the same rules in
 * `pb_hooks/admins_oauth_guard.pb.js`; the checks here are defense in depth
 * and also reject sessions of any other auth collection (`users`,
 * `_superusers`).
 */
export const ADMIN_COLLECTION = 'admins';
export const ADMIN_EMAIL_DOMAIN = 'mauersegler.art';
export const ADMIN_OAUTH_PROVIDER = 'google';

/**
 * Admins sign in with Google again after this many days. The session itself
 * slides with every request, so without this an admin who keeps using the app
 * would never meet Google again — a suspended Workspace account or a newly
 * enforced 2-Step Verification would not reach them.
 */
export const ADMIN_SIGN_IN_MAX_AGE_DAYS = 7;

/** PocketBase auth cookie (SDK default name). */
export const AUTH_COOKIE = 'pb_auth';
/** Short-lived cookie carrying the OAuth2 state + PKCE verifier between login and callback. */
export const ADMIN_OAUTH_COOKIE = 'admin_oauth';
export const ADMIN_OAUTH_COOKIE_PATH = '/auth/callback';

export type AdminRole = 'superuser' | 'admin';

/** A signed-in account that requested access and awaits approval. */
export interface PendingAdmin {
	email: string;
	name: string;
}

export interface AdminSession {
	id: string;
	email: string;
	name: string;
	role: AdminRole;
	isSuperuser: boolean;
}

/** Machine-readable reasons shown on /admin/login?error=... */
export type AdminLoginError =
	| 'not_authorized'
	| 'wrong_domain'
	| 'not_workspace'
	| 'cancelled'
	| 'expired'
	| 'unavailable'
	| 'reauth'
	| 'failed';

const APPROVED_ROLES: readonly string[] = ['superuser', 'admin'];
const PENDING_ROLE = 'pending';

export function isAdminDomainEmail(email: unknown): boolean {
	return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${ADMIN_EMAIL_DOMAIN}`);
}

type AuthRecord = { [key: string]: any } | null | undefined;

/** An `admins` record of the allowed domain (approved or pending). */
export function isAdminAccount(record: AuthRecord): boolean {
	return (
		!!record &&
		record.collectionName === ADMIN_COLLECTION &&
		isAdminDomainEmail(record.email) &&
		(APPROVED_ROLES.includes(record.role) || record.role === PENDING_ROLE)
	);
}

/**
 * Derives the admin session from an authenticated PocketBase record, or null if
 * the record is not an approved admin of the allowed domain.
 */
export function toAdminSession(record: AuthRecord): AdminSession | null {
	if (!record || !isAdminAccount(record) || !APPROVED_ROLES.includes(record.role)) return null;

	const role = record.role as AdminRole;
	return {
		id: record.id,
		email: String(record.email).toLowerCase(),
		name: typeof record.name === 'string' ? record.name : '',
		role,
		isSuperuser: role === 'superuser'
	};
}

/**
 * Whether the account's last Google sign-in is recent enough. PocketBase
 * records it on every OAuth2 sign-in (`last_sign_in`, pb_hooks/cozy_notify.pb.js);
 * read it from the refreshed record, never from the cookie.
 */
export function isSignInFresh(record: AuthRecord, now = Date.now()): boolean {
	const signedInAt = Date.parse(String(record?.last_sign_in || '').replace(' ', 'T'));
	if (Number.isNaN(signedInAt)) return false;
	return now - signedInAt < ADMIN_SIGN_IN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** The access request behind a signed-in, not yet approved admin account. */
export function toPendingAdmin(record: AuthRecord): PendingAdmin | null {
	if (!record || !isAdminAccount(record) || record.role !== PENDING_ROLE) return null;
	return {
		email: String(record.email).toLowerCase(),
		name: typeof record.name === 'string' ? record.name : ''
	};
}

/**
 * Validates the Google identity PocketBase returned in the OAuth2 `meta`
 * (`rawUser` is Google's userinfo response). Returns null when acceptable.
 */
export function checkGoogleIdentity(meta: Record<string, any> | undefined): AdminLoginError | null {
	const rawUser = meta?.rawUser ?? {};
	const email = String(meta?.email || rawUser.email || '').toLowerCase();

	if (!isAdminDomainEmail(email) || rawUser.email_verified !== true) return 'wrong_domain';
	if (String(rawUser.hd || '').toLowerCase() !== ADMIN_EMAIL_DOMAIN) return 'not_workspace';
	return null;
}

/** Paths under /admin that are reachable without an admin session. */
export function isPublicAdminPath(pathname: string): boolean {
	return pathname === '/admin/login' || pathname === '/admin/logout';
}

export function isAdminPath(pathname: string): boolean {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}
