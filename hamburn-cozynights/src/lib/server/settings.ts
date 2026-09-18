import type { TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';

export interface BookingSettings {
	isBookingActive: boolean;
	bookingUnlockAt: string;
	/** The server sends booking confirmations by e-mail (SMTP is set up). */
	notifyMail: boolean;
	/** The bot guests can link for updates ("" = no Telegram updates). */
	telegramBot: string;
	/** Guests can send special-needs requests (own switch, independent of the phase). */
	requestsOpen: boolean;
}

/**
 * Fetches app_settings and computes the *effective* booking-active state:
 * true once either the admin has flipped the switch, or the configured
 * unlock time has passed — computed on read, so no scheduled job is needed
 * to "auto-open" bookings at the target time.
 *
 * notify_mail / telegram_bot are kept up to date by PocketBase itself
 * (pb_hooks/lib/notify.js, refreshCapabilities).
 */
export async function getBookingSettings(pb: TypedPocketBase): Promise<BookingSettings> {
	const settings = await pb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID)
		.catch(() => ({
			is_booking_active: false,
			booking_unlock_at: '',
			notify_mail: false,
			telegram_bot: '',
			special_requests_open: false
		}));

	const bookingUnlockAt = settings.booking_unlock_at || '';
	let isBookingActive = !!settings.is_booking_active;

	if (!isBookingActive && bookingUnlockAt) {
		const unlockTime = new Date(bookingUnlockAt).getTime();
		if (!Number.isNaN(unlockTime) && Date.now() >= unlockTime) {
			isBookingActive = true;
		}
	}

	const telegramBot = settings.telegram_bot || '';
	return {
		isBookingActive,
		bookingUnlockAt,
		notifyMail: !!settings.notify_mail,
		// Telegram usernames: 5–32 letters, digits and underscores
		telegramBot: /^[A-Za-z0-9_]{5,32}$/.test(telegramBot) ? telegramBot : '',
		requestsOpen: !!settings.special_requests_open
	};
}
