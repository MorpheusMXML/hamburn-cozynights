/**
 * Check-in at arrival (docs/admin/passes.md): the crew checks a guest's booking
 * pass, and the spot goes from booked to checked in (beds.checked_in_at,
 * beds.checked_in_by). Only admins and superusers check guests in. Safe for
 * the browser: no secrets in here. Times are shown with formatBerlin
 * ($lib/booking-phase), the same on the server and in every browser.
 */

/** What guests read when their spot can't change anymore because the crew checked them in. */
export const CHECKED_IN_NOTE =
	'The crew has checked you in, so your spot is final. To change it, please ask the crew.';
