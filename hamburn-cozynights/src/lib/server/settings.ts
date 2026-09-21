import type { TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';
import {
	effectivePhase,
	nextTransition,
	windowFromRecord,
	type BookingPhase,
	type BookingWindow,
	type PhaseTransition
} from '$lib/booking-phase';

export interface BookingSettings {
	/** staging → live → closed, see $lib/booking-phase. */
	phase: BookingPhase;
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
}

/**
 * Fetches app_settings and computes the *effective* booking phase: the phase
 * set by hand, overridden by an armed timer whose opening or closing time has
 * passed — computed on read, so no scheduled job is needed to open or close
 * booking at the target time.
 *
 * notify_mail / telegram_bot are kept up to date by PocketBase itself
 * (pb_hooks/lib/notify.js, refreshCapabilities).
 */
export async function getBookingSettings(pb: TypedPocketBase): Promise<BookingSettings> {
	const settings = await pb
		.collection('app_settings')
		// requestKey null: parallel loads read this too, never auto-cancel it.
		.getOne(APP_SETTINGS_ID, { requestKey: null })
		.catch(() => null);

	const window = windowFromRecord(settings);
	const now = Date.now();
	const phase = effectivePhase(window, now);
	const telegramBot = settings?.telegram_bot || '';
	return {
		phase,
		isBookingActive: phase === 'live',
		isLayoutLocked: phase !== 'staging',
		bookingUnlockAt: window.opensAt,
		bookingCloseAt: window.closesAt,
		window,
		next: nextTransition(window, now),
		notifyMail: !!settings?.notify_mail,
		// Telegram usernames: 5–32 letters, digits and underscores
		telegramBot: /^[A-Za-z0-9_]{5,32}$/.test(telegramBot) ? telegramBot : '',
		requestsOpen: !!settings?.special_requests_open
	};
}
