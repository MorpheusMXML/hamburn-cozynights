import type { AppSettingsResponse, TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import {
	effectivePhase,
	guestPhase,
	nextTransition,
	windowFromRecord,
	type BookingPhase,
	type BookingWindow,
	type PhaseTransition
} from '$lib/booking-phase';

export interface BookingSettings {
	/** staging → live → closed, see $lib/booking-phase. */
	phase: BookingPhase;
	/** The phase as guests are told about it: Closed with an opening armed reads as "not open yet". */
	guestPhase: BookingPhase;
	/** Guests can book, change and release spots (phase live). */
	isBookingActive: boolean;
	/** Houses, rooms and spots can't be added, moved or deleted (phase live or closed). */
	isLayoutLocked: boolean;
	/** Opening time of the booking window ('' = none). */
	bookingUnlockAt: string;
	/** Closing time of the booking window ('' = none). */
	bookingCloseAt: string;
	/** The stored window, for the Control Center. */
	window: BookingWindow;
	/** The next switch the armed timer makes, for countdowns. */
	next: PhaseTransition | null;
	/** The server sends booking confirmations by e-mail (SMTP is set up). */
	notifyMail: boolean;
	/** The bot guests can link for updates ("" = no Telegram updates). */
	telegramBot: string;
	/** Guests can send special-needs requests (own switch, independent of the phase). */
	requestsOpen: boolean;
	/** The crew turned swap requests off (they only ever run during Live Booking). */
	swapsOff: boolean;
	/**
	 * False: PocketBase didn't answer just now. Everything above then comes
	 * from the last good read (at most 30 s old, see `known`) or is the
	 * defaults — fine to show, never a reason to allow or refuse a change: an
	 * action answers SETTINGS_UNREACHABLE instead.
	 */
	reachable: boolean;
	/** The values are real: read just now, or by the last good read of the past 30 s. */
	known: boolean;
}

/** What a guest's action answers when the booking phase could not be read. */
export const SETTINGS_UNREACHABLE =
	'The booking system is not reachable right now. Nothing was changed. Please try again in a moment.';

/**
 * How long the last good read stands in for a failed one, for what pages
 * show: a short hiccup must not tell every guest "booking is not open".
 */
const FALLBACK_MS = 30 * 1000;

let lastGood: { settings: AppSettingsResponse | null; at: number } | null = null;

/** Tests: forget the last good read. */
export function forgetLastSettings(): void {
	lastGood = null;
}

const isNotFound = (err: unknown) => (err as { status?: number })?.status === 404;

/**
 * Fetches app_settings and computes the *effective* booking phase: the phase
 * set by hand, overridden by an armed timer whose opening or closing time has
 * passed — computed on read, so no scheduled job is needed to open or close
 * booking at the target time.
 *
 * Never throws. A missing record is the defaults (Staging); a read that
 * fails says so (`reachable: false`) and shows the last good read of the
 * past 30 seconds, if there is one.
 *
 * notify_mail / telegram_bot are kept up to date by PocketBase itself
 * (pb_hooks/lib/notify.js, refreshCapabilities).
 */
export async function getBookingSettings(pb: TypedPocketBase): Promise<BookingSettings> {
	const now = Date.now();
	let settings: AppSettingsResponse | null = null;
	let reachable = true;
	let known = true;
	try {
		settings =
			(await pb
				.collection('app_settings')
				// requestKey null: parallel loads read this too, never auto-cancel it.
				.getOne(APP_SETTINGS_ID, { requestKey: null })) ?? null;
		lastGood = { settings, at: now };
	} catch (err) {
		if (isNotFound(err)) {
			lastGood = { settings: null, at: now };
		} else {
			reachable = false;
			known = !!lastGood && now - lastGood.at <= FALLBACK_MS;
			if (known) settings = lastGood!.settings;
			console.error(
				`[Settings] app_settings could not be read${known ? ', showing the last good read' : ''}:`,
				(err as Error)?.message
			);
		}
	}

	const window = windowFromRecord(settings);
	const phase = effectivePhase(window, now);
	const next = nextTransition(window, now);
	const telegramBot = settings?.telegram_bot || '';
	return {
		phase,
		guestPhase: guestPhase(phase, next),
		isBookingActive: phase === 'live',
		isLayoutLocked: phase !== 'staging',
		bookingUnlockAt: window.opensAt,
		bookingCloseAt: window.closesAt,
		window,
		next,
		notifyMail: !!settings?.notify_mail,
		// Telegram usernames: 5–32 letters, digits and underscores
		telegramBot: /^[A-Za-z0-9_]{5,32}$/.test(telegramBot) ? telegramBot : '',
		requestsOpen: !!settings?.special_requests_open,
		swapsOff: !!settings?.swaps_off,
		reachable,
		known
	};
}

/**
 * The booking phase for a gate that unlocks something destructive (clearing
 * the bookings, importing a template, deleting a house, freeing a spot):
 * read right now, or not at all — never a fallback.
 * @throws when app_settings can't be read (a missing record is Staging)
 */
export async function readPhaseStrict(pb: TypedPocketBase): Promise<BookingPhase> {
	const settings = await pb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID, { requestKey: null })
		.catch((err) => {
			if (isNotFound(err)) return null;
			throw err;
		});
	return effectivePhase(windowFromRecord(settings));
}

/** What a destructive admin action answers when readPhaseStrict failed. */
export const PHASE_UNREADABLE =
	'The booking phase could not be read, so nothing was changed. Try again in a moment.';
