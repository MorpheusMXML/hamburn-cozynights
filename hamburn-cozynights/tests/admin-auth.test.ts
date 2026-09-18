// tests/admin-auth.test.ts — admin sign-in, session handling and role checks
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClientResponseError, RecordService } from 'pocketbase';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_URL: 'http://127.0.0.1:8090',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

// The service account is irrelevant for these tests.
vi.mock('$lib/server/pocketbase', () => ({
	PB_URL: 'http://127.0.0.1:8090',
	getAdminPb: vi.fn(async () => ({ authStore: { isValid: true } }))
}));

import {
	checkGoogleIdentity,
	isSignInFresh,
	toAdminSession,
	toPendingAdmin
} from '../src/lib/server/admin-auth';
import { handle } from '../src/hooks.server';
import { actions as loginActions } from '../src/routes/admin/login/+page.server';
import { GET as oauthCallback } from '../src/routes/auth/callback/[provider]/+server';
import { actions as dashboardActions } from '../src/routes/admin/+page.server';
import { load as adminLayoutLoad } from '../src/routes/admin/+layout.server';

const HOUR = 60 * 60 * 1000;
/** PocketBase's date format, like pb_hooks/cozy_notify.pb.js stores it. */
const pbDate = (ms: number) => new Date(ms).toISOString().replace('T', ' ');

const ADMIN_RECORD = {
	id: 'admin1',
	collectionId: 'pbc_admins',
	collectionName: 'admins',
	email: 'max@mauersegler.art',
	name: 'Max',
	role: 'superuser',
	verified: true,
	last_sign_in: pbDate(Date.now() - HOUR)
};

function fakeToken(expiresInSeconds = 3600): string {
	const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
	return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 'x', type: 'auth', exp })}.sig`;
}

function authCookie(record: object, token = fakeToken()): string {
	return 'pb_auth=' + encodeURIComponent(JSON.stringify({ token, record }));
}

async function isRedirect(promise: unknown) {
	try {
		await promise;
	} catch (e: any) {
		return { status: e.status, location: e.location };
	}
	throw new Error('expected a redirect');
}

function makeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	return {
		get: vi.fn((name: string) => jar.get(name)),
		set: vi.fn((name: string, value: string) => jar.set(name, value)),
		delete: vi.fn((name: string) => jar.delete(name))
	};
}

describe('toAdminSession', () => {
	it('accepts admins records of the allowed domain with a known role', () => {
		expect(toAdminSession({ ...ADMIN_RECORD, email: 'Max@Mauersegler.art' })).toEqual({
			id: 'admin1',
			email: 'max@mauersegler.art',
			name: 'Max',
			role: 'superuser',
			isSuperuser: true
		});
		expect(toAdminSession({ ...ADMIN_RECORD, role: 'admin' })?.isSuperuser).toBe(false);
	});

	it('rejects other auth collections, other domains and unknown roles', () => {
		expect(toAdminSession({ ...ADMIN_RECORD, collectionName: 'users' })).toBeNull();
		expect(toAdminSession({ ...ADMIN_RECORD, collectionName: '_superusers' })).toBeNull();
		expect(toAdminSession({ ...ADMIN_RECORD, email: 'max@gmail.com' })).toBeNull();
		expect(toAdminSession({ ...ADMIN_RECORD, email: 'max@mauersegler.art.evil.com' })).toBeNull();
		expect(toAdminSession({ ...ADMIN_RECORD, role: '' })).toBeNull();
		expect(toAdminSession(null)).toBeNull();
	});
});

describe('access requests (role pending)', () => {
	const pending = { ...ADMIN_RECORD, role: 'pending' };

	it('are not admin sessions but are recognized as pending', () => {
		expect(toAdminSession(pending)).toBeNull();
		expect(toPendingAdmin(pending)).toEqual({ email: 'max@mauersegler.art', name: 'Max' });
		expect(toPendingAdmin(ADMIN_RECORD)).toBeNull();
		expect(toPendingAdmin({ ...pending, collectionName: 'users' })).toBeNull();
		expect(toPendingAdmin({ ...pending, email: 'x@gmail.com' })).toBeNull();
	});
});

describe('isSignInFresh (weekly Google sign-in)', () => {
	const now = Date.parse('2026-09-18T12:00:00Z');

	it('accepts a Google sign-in of the last 7 days, in PocketBase and ISO format', () => {
		expect(isSignInFresh({ last_sign_in: '2026-09-18 11:00:00.000Z' }, now)).toBe(true);
		expect(isSignInFresh({ last_sign_in: '2026-09-11T12:30:00.000Z' }, now)).toBe(true);
	});

	it('asks again after 7 days, and when there is no sign-in on record', () => {
		expect(isSignInFresh({ last_sign_in: '2026-09-11 11:59:00.000Z' }, now)).toBe(false);
		expect(isSignInFresh({ last_sign_in: '' }, now)).toBe(false);
		expect(isSignInFresh({}, now)).toBe(false);
		expect(isSignInFresh(null, now)).toBe(false);
		expect(isSignInFresh({ last_sign_in: 'not a date' }, now)).toBe(false);
	});
});

describe('checkGoogleIdentity', () => {
	const rawUser = { email: 'max@mauersegler.art', email_verified: true, hd: 'mauersegler.art' };

	it('accepts a verified Workspace account of the domain', () => {
		expect(checkGoogleIdentity({ email: 'max@mauersegler.art', rawUser })).toBeNull();
	});

	it('rejects unverified, foreign and non-Workspace accounts', () => {
		expect(
			checkGoogleIdentity({
				email: 'max@mauersegler.art',
				rawUser: { ...rawUser, email_verified: false }
			})
		).toBe('wrong_domain');
		expect(
			checkGoogleIdentity({
				email: 'evil@gmail.com',
				rawUser: { ...rawUser, email: 'evil@gmail.com' }
			})
		).toBe('wrong_domain');
		expect(
			checkGoogleIdentity({ email: 'max@mauersegler.art', rawUser: { ...rawUser, hd: undefined } })
		).toBe('not_workspace');
		expect(checkGoogleIdentity(undefined)).toBe('wrong_domain');
	});
});

describe('hooks.server handle', () => {
	let refreshSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		refreshSpy = vi.spyOn(RecordService.prototype, 'authRefresh');
	});
	afterEach(() => {
		refreshSpy.mockRestore();
	});

	function makeEvent(path: string, { method = 'GET', cookie = '' } = {}) {
		const url = new URL(`http://localhost${path}`);
		const cookieMap: Record<string, string> = {};
		for (const part of cookie.split(';').filter(Boolean)) {
			const [k, ...v] = part.trim().split('=');
			cookieMap[k] = decodeURIComponent(v.join('='));
		}
		return {
			url,
			request: new Request(url, { method, headers: cookie ? { cookie } : {} }),
			cookies: makeCookies(cookieMap),
			locals: {} as any
		} as any;
	}

	it('lets guests through without touching the admin session', async () => {
		const event = makeEvent('/map');
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({ event, resolve });

		expect(resolve).toHaveBeenCalled();
		expect(event.locals.admin).toBeNull();
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(refreshSpy).not.toHaveBeenCalled();
	});

	it('refuses admin form actions and API endpoints without an admin session', async () => {
		const resolve = vi.fn(async () => new Response('ok'));

		for (const [path, method] of [
			['/admin', 'POST'],
			['/admin/room/abc', 'POST'],
			['/admin/api/export-template', 'GET']
		]) {
			const response = await handle({ event: makeEvent(path, { method }), resolve });
			expect(response.status).toBe(403);
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	it('lets admin page requests reach the layout (which redirects) and keeps login/logout reachable', async () => {
		const resolve = vi.fn(async () => new Response('ok'));
		await handle({ event: makeEvent('/admin'), resolve });
		await handle({ event: makeEvent('/admin/login', { method: 'POST' }), resolve });
		await handle({ event: makeEvent('/admin/logout', { method: 'POST' }), resolve });
		expect(resolve).toHaveBeenCalledTimes(3);
	});

	it('rejects sessions of other auth collections and clears the cookie', async () => {
		const event = makeEvent('/admin', {
			method: 'POST',
			cookie: authCookie({ ...ADMIN_RECORD, collectionName: 'users' })
		});
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({ event, resolve });

		expect(response.status).toBe(403);
		expect(event.locals.admin).toBeNull();
		expect(refreshSpy).not.toHaveBeenCalled();
	});

	it('establishes the admin session after a successful refresh and sets an httpOnly cookie', async () => {
		refreshSpy.mockImplementation(async function (this: any) {
			this.client.authStore.save(fakeToken(), ADMIN_RECORD);
			return { token: '', record: ADMIN_RECORD } as any;
		});
		const event = makeEvent('/admin', { method: 'POST', cookie: authCookie(ADMIN_RECORD) });
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({ event, resolve });

		expect(resolve).toHaveBeenCalled();
		expect(event.locals.admin?.email).toBe('max@mauersegler.art');
		const setCookie = response.headers.get('set-cookie') || '';
		expect(setCookie).toContain('pb_auth=');
		expect(setCookie).toContain('HttpOnly');
	});

	it('keeps a pending session (for the waiting page) without any admin rights', async () => {
		const pending = { ...ADMIN_RECORD, role: 'pending' };
		refreshSpy.mockImplementation(async function (this: any) {
			this.client.authStore.save(fakeToken(), pending);
			return { token: '', record: pending } as any;
		});
		const resolve = vi.fn(async () => new Response('ok'));

		const post = makeEvent('/admin', { method: 'POST', cookie: authCookie(pending) });
		expect((await handle({ event: post, resolve })).status).toBe(403);
		expect(post.locals.admin).toBeNull();
		expect(post.locals.pendingAdmin?.email).toBe('max@mauersegler.art');

		const page = makeEvent('/admin/login', { cookie: authCookie(pending) });
		const response = await handle({ event: page, resolve });
		expect(response.headers.get('set-cookie')).toContain('pb_auth=%7B');
	});

	it('lets an approval take effect on the next request (role re-read on refresh)', async () => {
		refreshSpy.mockImplementation(async function (this: any) {
			this.client.authStore.save(fakeToken(), { ...ADMIN_RECORD, role: 'admin' });
			return {} as any;
		});
		const event = makeEvent('/admin', {
			method: 'POST',
			cookie: authCookie({ ...ADMIN_RECORD, role: 'pending' })
		});
		const resolve = vi.fn(async () => new Response('ok'));
		await handle({ event, resolve });
		expect(event.locals.admin?.role).toBe('admin');
		expect(resolve).toHaveBeenCalled();
	});

	it('ends the session a week after the last Google sign-in, even while it is in use', async () => {
		const stale = { ...ADMIN_RECORD, last_sign_in: pbDate(Date.now() - 8 * 24 * HOUR) };
		refreshSpy.mockImplementation(async function (this: any) {
			this.client.authStore.save(fakeToken(), stale);
			return { token: '', record: stale } as any;
		});
		const resolve = vi.fn(async () => new Response('ok'));

		const post = makeEvent('/admin', { method: 'POST', cookie: authCookie(stale) });
		expect((await handle({ event: post, resolve })).status).toBe(403);
		expect(post.locals.admin).toBeNull();
		expect(post.locals.adminSignInExpired).toBe(true);
		expect(post.locals.pb.authStore.isValid).toBe(false);

		// the cookie's own (client-side) record doesn't count, only the refreshed one
		const forged = makeEvent('/admin', {
			method: 'POST',
			cookie: authCookie({ ...stale, last_sign_in: pbDate(Date.now()) })
		});
		expect((await handle({ event: forged, resolve })).status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('drops the session when PocketBase rejects the token (e.g. admin removed)', async () => {
		refreshSpy.mockRejectedValue(new ClientResponseError({ status: 401 }));
		const event = makeEvent('/admin', { method: 'POST', cookie: authCookie(ADMIN_RECORD) });
		const resolve = vi.fn(async () => new Response('ok'));
		const response = await handle({ event, resolve });

		expect(response.status).toBe(403);
		expect(event.locals.admin).toBeNull();
		expect(event.locals.pb.authStore.isValid).toBe(false);
	});
});

describe('admin layout', () => {
	it('redirects page requests without a session to the login page', async () => {
		const redirect = await isRedirect(
			adminLayoutLoad({ locals: { admin: null }, url: new URL('http://x/admin') } as any) as any
		);
		expect(redirect).toEqual({ status: 303, location: '/admin/login' });
	});

	it('tells admins why they have to sign in again after a week', async () => {
		const redirect = await isRedirect(
			adminLayoutLoad({
				locals: { admin: null, adminSignInExpired: true },
				url: new URL('http://x/admin')
			} as any) as any
		);
		expect(redirect).toEqual({ status: 303, location: '/admin/login?error=reauth' });
	});

	it('exposes only email, name and role', async () => {
		const data: any = await adminLayoutLoad({
			locals: { admin: toAdminSession(ADMIN_RECORD) },
			url: new URL('http://x/admin')
		} as any);
		expect(data).toEqual({
			admin: { email: 'max@mauersegler.art', name: 'Max', role: 'superuser' },
			isSuperuser: true
		});
	});
});

describe('Google sign-in flow', () => {
	const provider = {
		name: 'google',
		displayName: 'Google',
		state: 'state-123',
		codeVerifier: 'verifier-abc',
		authURL:
			'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=state-123&redirect_uri='
	};

	function makeLocals(overrides: Record<string, any> = {}) {
		const authStore = {
			isValid: false,
			clear: vi.fn(function (this: any) {
				this.isValid = false;
			})
		};
		const recordService = {
			listAuthMethods: vi.fn(async () => ({ oauth2: { enabled: true, providers: [provider] } })),
			authWithOAuth2Code: vi.fn(async () => {
				authStore.isValid = true;
				return {
					token: 't',
					record: ADMIN_RECORD,
					meta: {
						email: 'max@mauersegler.art',
						rawUser: { email: 'max@mauersegler.art', email_verified: true, hd: 'mauersegler.art' }
					}
				};
			}),
			...overrides
		};
		const collection = vi.fn(() => recordService);
		return { locals: { pb: { collection, authStore } } as any, recordService, collection };
	}

	it('starts the Google flow with state + PKCE verifier in an httpOnly cookie', async () => {
		const { locals, collection } = makeLocals();
		const cookies = makeCookies();
		const redirect = await isRedirect(
			loginActions.google({ locals, cookies, url: new URL('https://cozy.test/admin/login') } as any)
		);

		expect(collection).toHaveBeenCalledWith('admins');
		expect(redirect.status).toBe(303);
		expect(redirect.location).toBe(
			provider.authURL +
				encodeURIComponent('https://cozy.test/auth/callback/google') +
				'&hd=mauersegler.art&prompt=select_account'
		);
		expect(cookies.set).toHaveBeenCalledWith(
			'admin_oauth',
			JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-abc' }),
			expect.objectContaining({ httpOnly: true, path: '/auth/callback' })
		);
	});

	function callback(locals: any, query: string, cookieValue?: string, providerName = 'google') {
		const cookies = makeCookies(cookieValue ? { admin_oauth: cookieValue } : {});
		return {
			cookies,
			result: isRedirect(
				oauthCallback({
					locals,
					url: new URL(`https://cozy.test/auth/callback/${providerName}?${query}`),
					cookies,
					params: { provider: providerName }
				} as any)
			)
		};
	}

	const flowCookie = JSON.stringify({ state: 'state-123', codeVerifier: 'verifier-abc' });

	it('signs in an invited admin', async () => {
		const { locals, recordService } = makeLocals();
		const { cookies, result } = callback(locals, 'state=state-123&code=abc', flowCookie);

		expect(await result).toEqual({ status: 303, location: '/admin' });
		expect(recordService.authWithOAuth2Code).toHaveBeenCalledWith(
			'google',
			'abc',
			'verifier-abc',
			'https://cozy.test/auth/callback/google'
		);
		expect(cookies.delete).toHaveBeenCalledWith('admin_oauth', { path: '/auth/callback' });
		expect(locals.pb.authStore.isValid).toBe(true);
	});

	it('keeps a new access request signed in and sends it to the waiting page', async () => {
		const pendingLocals = makeLocals({
			authWithOAuth2Code: vi.fn(async function () {
				pendingLocals.locals.pb.authStore.isValid = true;
				return {
					record: { ...ADMIN_RECORD, role: 'pending' },
					meta: {
						email: 'max@mauersegler.art',
						rawUser: { email_verified: true, hd: 'mauersegler.art' }
					}
				};
			})
		});
		expect(
			await callback(pendingLocals.locals, 'state=state-123&code=abc', flowCookie).result
		).toEqual({ status: 303, location: '/admin/login' });
		expect(pendingLocals.locals.pb.authStore.isValid).toBe(true);
	});

	it('rejects a state mismatch or a missing flow cookie', async () => {
		const { locals, recordService } = makeLocals();
		expect(await callback(locals, 'state=other&code=abc', flowCookie).result).toEqual({
			status: 303,
			location: '/admin/login?error=expired'
		});
		expect(await callback(locals, 'state=state-123&code=abc').result).toEqual({
			status: 303,
			location: '/admin/login?error=expired'
		});
		expect(await callback(locals, 'state=state-123&code=abc', 'not-json').result).toEqual({
			status: 303,
			location: '/admin/login?error=expired'
		});
		expect(recordService.authWithOAuth2Code).not.toHaveBeenCalled();
	});

	it('handles a cancelled consent screen and unknown providers', async () => {
		const { locals } = makeLocals();
		expect(
			await callback(locals, 'error=access_denied&state=state-123', flowCookie).result
		).toEqual({
			status: 303,
			location: '/admin/login?error=cancelled'
		});
		expect(await callback(locals, 'state=state-123&code=abc', flowCookie, 'github').result).toEqual(
			{ status: 303, location: '/admin/login?error=failed' }
		);
	});

	it('maps a PocketBase rejection (not invited / wrong domain) to not_authorized', async () => {
		const { locals } = makeLocals({
			authWithOAuth2Code: vi.fn(async () => {
				throw new ClientResponseError({
					status: 403,
					response: { message: 'This account has not been invited as an admin.' }
				});
			})
		});
		expect(await callback(locals, 'state=state-123&code=abc', flowCookie).result).toEqual({
			status: 303,
			location: '/admin/login?error=not_authorized'
		});
		expect(locals.pb.authStore.clear).toHaveBeenCalled();
	});

	it('re-checks the Google identity and the record even if PocketBase accepted it', async () => {
		const withoutHd = makeLocals({
			authWithOAuth2Code: vi.fn(async function () {
				withoutHd.locals.pb.authStore.isValid = true;
				return {
					record: ADMIN_RECORD,
					meta: { email: 'max@mauersegler.art', rawUser: { email_verified: true } }
				};
			})
		});
		expect(await callback(withoutHd.locals, 'state=state-123&code=abc', flowCookie).result).toEqual(
			{
				status: 303,
				location: '/admin/login?error=not_workspace'
			}
		);
		expect(withoutHd.locals.pb.authStore.isValid).toBe(false);

		const usersRecord = makeLocals({
			authWithOAuth2Code: vi.fn(async function () {
				usersRecord.locals.pb.authStore.isValid = true;
				return {
					record: { ...ADMIN_RECORD, collectionName: 'users' },
					meta: {
						email: 'max@mauersegler.art',
						rawUser: { email_verified: true, hd: 'mauersegler.art' }
					}
				};
			})
		});
		expect(
			await callback(usersRecord.locals, 'state=state-123&code=abc', flowCookie).result
		).toEqual({ status: 303, location: '/admin/login?error=not_authorized' });
	});
});

describe('superuser-only dashboard actions', () => {
	function makeAdminPb() {
		const service = {
			getFullList: vi.fn(async (opts?: any) =>
				opts?.filter?.includes('burner_name') ? [{ id: 'order1' }] : [{ id: 'bed1' }]
			),
			update: vi.fn(async () => ({})),
			delete: vi.fn(async () => ({})),
			create: vi.fn(async () => ({ id: 'new' }))
		};
		return { pb: { collection: vi.fn(() => service) } as any, service };
	}

	const crew = {
		id: 'a2',
		email: 'crew@mauersegler.art',
		name: '',
		role: 'admin',
		isSuperuser: false
	};
	const boss = { ...crew, role: 'superuser', isSuperuser: true };

	it('refuses clearAllBookings and importTemplate for regular admins', async () => {
		const { pb, service } = makeAdminPb();
		const locals = { pb, adminPb: pb, admin: crew } as any;

		const cleared: any = await dashboardActions.clearAllBookings({ locals } as any);
		const imported: any = await dashboardActions.importTemplate({
			locals,
			request: { formData: async () => new FormData() }
		} as any);

		expect(cleared.status).toBe(403);
		expect(imported.status).toBe(403);
		expect(service.update).not.toHaveBeenCalled();
		expect(service.delete).not.toHaveBeenCalled();
	});

	it('lets superusers release all beds without deleting the ticket roster', async () => {
		const { pb, service } = makeAdminPb();
		const result: any = await dashboardActions.clearAllBookings({
			locals: { pb, adminPb: pb, admin: boss }
		} as any);

		expect(result).toEqual({ success: true });
		expect(service.update).toHaveBeenCalledWith('bed1', { occupied: false, order: null });
		expect(service.update).toHaveBeenCalledWith('order1', { burner_name: '' });
		expect(service.delete).not.toHaveBeenCalled();
	});
});
