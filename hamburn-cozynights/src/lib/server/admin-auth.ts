/**
 * Admin access model.
 *
 * The admin area is only for records of the PocketBase auth collection
 * `admins`, which are provisioned exclusively on the server with
 * `scripts/cozy-admin.sh` (no invite or sign-up flow exists in the app).
 * Sign-in is Google OAuth2 only, restricted to verified Google Workspace
 * accounts of {@link ADMIN_EMAIL_DOMAIN}. PocketBase enforces the same rules in
 * `pb_hooks/admins_oauth_guard.pb.js`; the checks here are defense in depth
 * and also reject sessions of any other auth collection (`users`,
 * `_superusers`).
 */
export const ADMIN_COLLECTION = 'admins';
export const ADMIN_EMAIL_DOMAIN = 'mauersegler.art';
export const ADMIN_OAUTH_PROVIDER = 'google';

/** PocketBase auth cookie (SDK default name). */
export const AUTH_COOKIE = 'pb_auth';
/** Short-lived cookie carrying the OAuth2 state + PKCE verifier between login and callback. */
export const ADMIN_OAUTH_COOKIE = 'admin_oauth';
export const ADMIN_OAUTH_COOKIE_PATH = '/auth/callback';

export type AdminRole = 'superuser' | 'admin';

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
	| 'failed';

const ROLES: readonly string[] = ['superuser', 'admin'];

export function isAdminDomainEmail(email: unknown): boolean {
	return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${ADMIN_EMAIL_DOMAIN}`);
}

/**
 * Derives the admin session from an authenticated PocketBase record, or null if
 * the record is not an admin of the allowed domain with a known role.
 */
export function toAdminSession(
	record: { [key: string]: any } | null | undefined
): AdminSession | null {
	if (!record || record.collectionName !== ADMIN_COLLECTION) return null;
	if (!isAdminDomainEmail(record.email)) return null;
	if (!ROLES.includes(record.role)) return null;

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
