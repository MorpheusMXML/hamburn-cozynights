/**
 * The guest session: one ticket code in a cookie, and the booking round it was
 * signed in for.
 *
 * The cookie holds nothing but the code and the server's signature over it
 * and the round ($lib/server/session-sig) — bookings, special-needs requests
 * and the phase are read from PocketBase on every request. A cookie the server
 * didn't sign ends right away, without a lookup: the cookie is no way to try
 * out ticket codes. Three more things end a session, and `hooks.server.ts`
 * checks them before any page runs, so every page sees the same answer:
 *
 * - **the code is gone** (test codes removed, roster replaced, the ticket list
 *   deleted after the event): the cookies go and the guest is asked for their
 *   code again, instead of the start page still saying "already signed in";
 * - **the ticket isn't paid**: a later ticket list flags it `unpaid`
 *   (pb_migrations/1761000000_ticket_sign_in.js); the start page says why;
 * - **a new booking round started**: `app_settings.guest_round` moved on
 *   (a superuser released every booking, see the Control Center), so every
 *   device signs in once more. Nothing else moves it — the timer opening or
 *   closing booking, and a window planned while booking is closed, sign nobody
 *   out.
 *
 * A PocketBase that can't be reached never signs anyone out: the session
 * stays, and the pages answer with their own "not reachable" message.
 */
import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import type { OrdersResponse, TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID, APP_SETTINGS_LOCK } from '$lib/server/constants';
import { BookingService, withLock } from '$lib/server/booking';
import { guestCookieKey } from '$lib/server/crypto';
import { readSignedGuestCode, signGuestCode } from '$lib/server/session-sig';

/** The guest's ticket code. */
export const GUEST_COOKIE = 'bookingCode';
/** The booking round that code was signed in for (see `bumpGuestRound`). */
export const ROUND_COOKIE = 'bookingRound';
/** Both cookies, 30 days from signing in (privacy policy). */
const MAX_AGE = 60 * 60 * 24 * 30;

const COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax'
} as const;

/** Why a session ended, for the hint on the start page. */
export type GuestSignOut = 'expired' | 'round' | 'unpaid';

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

export function setGuestSession(cookies: Cookies, code: string, round: number): void {
	cookies.set(GUEST_COOKIE, signGuestCode(guestCookieKey(), code, round), {
		...COOKIE_OPTIONS,
		maxAge: MAX_AGE
	});
	cookies.set(ROUND_COOKIE, String(round), { ...COOKIE_OPTIONS, maxAge: MAX_AGE });
}

export function clearGuestSession(cookies: Cookies): void {
	cookies.delete(GUEST_COOKIE, { path: COOKIE_OPTIONS.path });
	cookies.delete(ROUND_COOKIE, { path: COOKIE_OPTIONS.path });
}

/**
 * `/?login=…` with the reason this device has to sign in again, and the guest
 * page to come back to afterwards (`next`): a link from a confirmation e-mail
 * to a room or to the Telegram page then ends up there, not on the map.
 */
export function signInUrl(locals: App.Locals, next?: string): string {
	const back = safeReturnPath(next);
	return `/?login=${locals.guestSignOut ?? 'required'}${back ? `&next=${encodeURIComponent(back)}` : ''}`;
}

// The guest pages a sign-in may return to. Nothing else: `next` comes from the
// URL, and a free-form target would make the start page an open redirect. The
// one query allowed is a request group's invite code (the booking pass
// alphabet, src/lib/pass.ts), so an invite link survives the sign-in.
const RETURN_PATH =
	/^\/(?:map|random-bed|special-needs(?:\?group=[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8})?|telegram|swaps|(?:room|house)\/[a-z0-9]{1,32})$/;

/** A page to return to after signing in, or null for anything that isn't one. */
export function safeReturnPath(value: unknown): string | null {
	return typeof value === 'string' && RETURN_PATH.test(value) ? value : null;
}

/**
 * The current booking round. 0 while no settings record exists yet, and null
 * when PocketBase can't answer — then the round is not checked at all.
 */
export async function readGuestRound(pb: TypedPocketBase): Promise<number | null> {
	try {
		// requestKey null: the layout and the page read app_settings in parallel,
		// and the SDK would cancel one of the requests.
		const settings = await pb
			.collection('app_settings')
			.getOne(APP_SETTINGS_ID, { requestKey: null });
		return Number(settings?.guest_round) || 0;
	} catch (err) {
		if (isNotFound(err)) return 0;
		console.error('[GuestSession] Round lookup failed:', (err as Error)?.message);
		return null;
	}
}

/**
 * Starts a new booking round: every device signed in for an earlier one signs
 * in again on its next request. Called where a superuser releases the guests'
 * bookings, so a fresh round never starts with half the camp still signed in
 * on a ticket whose spot is gone.
 * @returns the new round
 */
export async function bumpGuestRound(pb: TypedPocketBase): Promise<number> {
	// Read and written in the settings' queue: a phase switch or another
	// switch saved at the same moment stays saved. Never call this while
	// holding that lock (it isn't re-entrant): setPhase bumps after its write.
	return withLock(APP_SETTINGS_LOCK, async () => {
		let current = 0;
		let exists = true;
		try {
			const settings = await pb
				.collection('app_settings')
				.getOne(APP_SETTINGS_ID, { requestKey: null });
			current = Number(settings?.guest_round) || 0;
		} catch (err) {
			if (!isNotFound(err)) throw err;
			exists = false;
		}

		const next = current + 1;
		if (exists) await pb.collection('app_settings').update(APP_SETTINGS_ID, { guest_round: next });
		else await pb.collection('app_settings').create({ id: APP_SETTINGS_ID, guest_round: next });
		return next;
	});
}

/** The round the cookie was set in; cookies from before the round stamp count as 0. */
function signedInRound(cookies: Cookies): number {
	const round = Number(cookies.get(ROUND_COOKIE));
	return Number.isFinite(round) && round >= 0 ? round : 0;
}

/**
 * The ticket code of a signed guest cookie, by its signature alone: no
 * PocketBase, no round or ticket check, and nothing is deleted. Only for a
 * request that shows nothing personal and changes nothing (the room page's
 * poll for spots being booked); everything else goes through
 * resolveGuestSession.
 */
export function readGuestCookie(cookies: Cookies): string | null {
	const value = cookies.get(GUEST_COOKIE);
	return value ? readSignedGuestCode(guestCookieKey(), value, signedInRound(cookies)) : null;
}

export interface GuestSession {
	/** The ticket code this request acts for, or null when nobody is signed in. */
	code: string | null;
	/** The ticket, when it was read; undefined when PocketBase could not be asked. */
	order?: OrdersResponse | null;
	/** Set when this request ended a session, for the hint the guest gets. */
	signedOut?: GuestSignOut;
}

/**
 * Reads the cookies of a request and checks them against the round and the
 * ticket list. Deletes them when the session is over.
 */
export async function resolveGuestSession(
	cookies: Cookies,
	pb: TypedPocketBase,
	adminPb: TypedPocketBase
): Promise<GuestSession> {
	const value = cookies.get(GUEST_COOKIE) || null;
	if (!value) return { code: null };

	// Not signed by this server (made up, from before the signature, or for
	// another key): over before anything asks PocketBase.
	const signedIn = signedInRound(cookies);
	const code = readSignedGuestCode(guestCookieKey(), value, signedIn);
	if (!code) {
		clearGuestSession(cookies);
		return { code: null, signedOut: 'expired' };
	}

	const round = await readGuestRound(pb);
	if (round !== null && signedIn !== round) {
		clearGuestSession(cookies);
		return { code: null, signedOut: 'round' };
	}

	let order: OrdersResponse | null;
	try {
		order = await new BookingService(adminPb).getOrderByNumber(code);
	} catch (err) {
		// PocketBase is down or the key is wrong: keep the session. The pages
		// look the ticket up themselves and answer 503 if they have to.
		console.error('[GuestSession] Ticket lookup failed:', (err as Error)?.message);
		return { code };
	}

	if (!order) {
		// The code was removed from the ticket list (or was never in it).
		clearGuestSession(cookies);
		return { code: null, signedOut: 'expired' };
	}
	if (order.unpaid) {
		// A later ticket list says the order isn't paid (any more).
		clearGuestSession(cookies);
		return { code: null, signedOut: 'unpaid' };
	}
	return { code, order };
}
