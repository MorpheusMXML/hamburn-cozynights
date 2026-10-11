/**
 * The check before every booking (docs/guide/booking.md "Book a spot"): the
 * guest makes their bed — the hostel provides pillow and blanket, the covers
 * come from the guest's own bag — and confirms that they have read the booking
 * rules, the Code of Conduct and the privacy policy. Max decided on 11 Oct
 * 2026 that it comes with every booking and that nothing about it is stored:
 * the booking request carries both confirmations, and the server refuses a
 * new spot without them (renaming the spot a ticket holds needs neither).
 *
 * The bedding text is also on the booking pass and in the booking messages
 * (pb_hooks/lib/texts.js, mail.bedding and tg.bedding, keep them in line).
 */

/** The form fields of a booking request that carry the two confirmations. */
export const BOOKING_CHECK_FIELDS = {
	rules: 'rulesConfirmed',
	bedding: 'beddingConfirmed'
} as const;

/** The value both fields have once the guest confirmed. */
export const CONFIRMED = 'yes';

/** Both confirmations as form fields, for a booking request. */
export const CONFIRMED_FIELDS: Record<string, string> = {
	[BOOKING_CHECK_FIELDS.rules]: CONFIRMED,
	[BOOKING_CHECK_FIELDS.bedding]: CONFIRMED
};

/** Whether a booking request carries both confirmations. */
export function bookingCheckPassed(form: FormData): boolean {
	return (
		form.get(BOOKING_CHECK_FIELDS.rules) === CONFIRMED &&
		form.get(BOOKING_CHECK_FIELDS.bedding) === CONFIRMED
	);
}

/**
 * What the server answers a booking without the confirmations: a tab that was
 * opened before the check existed, or a request made by hand.
 */
export const BOOKING_CHECK_MISSING =
	"Before a spot is yours, make your bed and confirm the rules in the booking window. Don't see them? Reload the page.";

/** What the booking window says when "Save" or "Book it" comes before the tick. */
export const RULES_UNTICKED = 'Tick the box first: it confirms you have read the rules.';

/** A cover from the guest's bag and the piece of bedding it goes on. */
export interface Cover {
	id: 'sheet' | 'duvet' | 'case';
	/** What the guest packs. */
	name: string;
	/** What the hostel provides and the cover goes on. */
	piece: 'mattress' | 'blanket' | 'pillow';
}

/** What every guest brings. The order is the order of making a bed. */
export const COVERS: readonly Cover[] = [
	{ id: 'sheet', name: 'Bed sheet', piece: 'mattress' },
	{ id: 'duvet', name: 'Duvet cover', piece: 'blanket' },
	{ id: 'case', name: 'Pillowcase', piece: 'pillow' }
];

/** What the hostel puts on every bed. */
export const BEDDING_PROVIDED = 'Pillow and blanket are provided.';

/** What a sleeping bag can replace, and what not. */
export const SLEEPING_BAG_NOTE =
	'A sleeping bag is fine instead of the duvet cover; the bed sheet and the pillowcase are still a must.';

/**
 * Where a cover dropped on the bed lands: the sheet slips under everything,
 * so any part of the bed takes it; the duvet cover only fits the blanket and
 * the pillowcase only the pillow. 'wrong' is another piece of the bed, 'off'
 * is next to the bed.
 */
export function dropResult(cover: Cover, piece: Cover['piece'] | null): 'fits' | 'wrong' | 'off' {
	if (!piece) return 'off';
	if (cover.id === 'sheet' || cover.piece === piece) return 'fits';
	return 'wrong';
}

/** The friendly nudge after a cover was dropped on the wrong piece. */
export function wrongDropHint(cover: Cover, piece: Cover['piece']): string {
	return `That's the ${piece}! The ${cover.name.toLowerCase()} goes on the ${cover.piece}.`;
}

/** "2 covers to go" — what is still in the bag. */
export function coversLeftText(left: number): string {
	if (left <= 0) return 'Bed made!';
	return `${left} ${left === 1 ? 'cover' : 'covers'} to go`;
}

/**
 * A check the guest did in this tab and that no booking used yet: a booking
 * that failed (someone was faster) doesn't make them make the bed again for
 * the next spot. A booking that went through uses it up, so the next booking
 * asks again. Module state, written only in the browser; a reload starts over.
 */
const carried = { rules: false, bedding: false };

/** What this tab's last check left: shown as done in the next booking window. */
export function carriedCheck(): { rules: boolean; bedding: boolean } {
	return { ...carried };
}

/** Remembers a confirmation for the next booking attempt in this tab. */
export function carryCheck(part: 'rules' | 'bedding', done: boolean): void {
	carried[part] = done;
}

/** A booking went through: the next one asks again. */
export function useUpCheck(): void {
	carried.rules = false;
	carried.bedding = false;
}
