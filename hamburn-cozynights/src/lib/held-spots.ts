// src/lib/held-spots.ts
/**
 * Guest bookings on what an admin is about to delete or free, as the admin
 * pages know them from their booking rows — so the dialog can say what the
 * server will say ($lib/server/held-spots has the rules): only a superuser
 * ends guest bookings that way, and a spot the crew booked for a
 * special-needs request only goes when the confirmation ticks it.
 */
import type { BookingRow } from '$lib/bookings';
import type { DialogCheckbox } from '$lib/dialogs';

/** The form field of a superuser's "release the special-needs spots too". */
export const RELEASE_CREW_SPOTS = 'releaseCrewSpots';

/** Guest bookings among `rows`, and how many of them the crew booked for requests. */
export function heldIn(rows: readonly Pick<BookingRow, 'guest' | 'viaRequest'>[]): {
	guest: number;
	crew: number;
} {
	const guest = rows.filter((row) => !!row.guest);
	return { guest: guest.length, crew: guest.filter((row) => row.viaRequest).length };
}

/** What a regular admin reads instead of the confirmation. */
export function superuserOnlyNote(guest: number): string {
	return `${guest === 1 ? 'A guest booking' : `${guest} guest bookings`} would end. Only a superuser can release ${guest === 1 ? 'it' : 'them'}: ask one, or leave it as it is.`;
}

/** The switch of the confirmation when crew-booked spots would go too. */
export function crewSpotsCheckbox(crew: number): DialogCheckbox {
	return {
		label:
			crew === 1
				? 'Release the special-needs spot the crew booked too'
				: `Release the ${crew} special-needs spots the crew booked too`,
		checked: false,
		hint: 'Without it nothing happens. Their requests stay approved and show “No spot yet”.'
	};
}
