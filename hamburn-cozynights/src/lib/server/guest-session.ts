/**
 * The guest session: one ticket code in a cookie, and the booking round it was
 * signed in for.
 *
 * The cookie holds nothing but the code — bookings, special-needs requests and
 * the phase are read from PocketBase on every request. Two things end a
 * session, and `hooks.server.ts` checks both before any page runs, so every
 * page sees the same answer:
 *
 * - **the code is gone** (test codes removed, roster replaced, the ticket list
 *   deleted after the event): the cookies go and the guest is asked for their
 *   code again, instead of the start page still saying "already signed in";
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
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { BookingService } from '$lib/server/booking';

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
export type GuestSignOut = 'expired' | 'round';

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

export function setGuestSession(cookies: Cookies, code: string, round: number): void {
	cookies.set(GUEST_COOKIE, code, { ...COOKIE_OPTIONS, maxAge: MAX_AGE });
	cookies.set(ROUND_COOKIE, String(round), { ...COOKIE_OPTIONS, maxAge: MAX_AGE });
}

export function clearGuestSession(cookies: Cookies): void {
	cookies.delete(GUEST_COOKIE, { path: COOKIE_OPTIONS.path });
	cookies.delete(ROUND_COOKIE, { path: COOKIE_OPTIONS.path });
}

/** `/?login=…` with the reason this device has to sign in again. */
export function signInUrl(locals: App.Locals): string {
	return `/?login=${locals.guestSignOut ?? 'required'}`;
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
}

/** The round the cookie was set in; cookies from before the round stamp count as 0. */
function signedInRound(cookies: Cookies): number {
	const round = Number(cookies.get(ROUND_COOKIE));
	return Number.isFinite(round) && round >= 0 ? round : 0;
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
	const code = cookies.get(GUEST_COOKIE) || null;
	if (!code) return { code: null };

	const round = await readGuestRound(pb);
	if (round !== null && signedInRound(cookies) !== round) {
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
	return { code, order };
}
