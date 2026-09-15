import type { TypedPocketBase } from '$lib/pocketbase-types';
import { APP_SETTINGS_ID } from '$lib/server/constants';

export interface BookingSettings {
	isBookingActive: boolean;
	bookingUnlockAt: string;
}

/**
 * Fetches app_settings and computes the *effective* booking-active state:
 * true once either the admin has flipped the switch, or the configured
 * unlock time has passed — computed on read, so no scheduled job is needed
 * to "auto-open" bookings at the target time.
 */
export async function getBookingSettings(pb: TypedPocketBase): Promise<BookingSettings> {
	const settings = await pb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID)
		.catch(() => ({ is_booking_active: false, booking_unlock_at: '' }));

	const bookingUnlockAt = settings.booking_unlock_at || '';
	let isBookingActive = !!settings.is_booking_active;

	if (!isBookingActive && bookingUnlockAt) {
		const unlockTime = new Date(bookingUnlockAt).getTime();
		if (!Number.isNaN(unlockTime) && Date.now() >= unlockTime) {
			isBookingActive = true;
		}
	}

	return { isBookingActive, bookingUnlockAt };
}
