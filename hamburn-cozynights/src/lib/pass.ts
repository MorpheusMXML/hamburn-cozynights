/**
 * Booking pass codes (docs/admin/passes.md): 12 characters without
 * look-alikes (no 0/O, 1/I/L), stored without dashes, shown as XXXX-XXXX-XXXX.
 * Same format as pb_hooks/lib/pass.js, which is the only place codes are made.
 * Safe for the browser: no secrets in here.
 */
export const PASS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PASS_CODE_LENGTH = 12;

const PASS_CODE = new RegExp(`^[${PASS_ALPHABET}]{${PASS_CODE_LENGTH}}$`);

/**
 * What the admin check page shows for one scanned or typed pass. Checking a
 * pass there checks the guest in (docs/admin/passes.md):
 * - checkedin: checked in just now
 * - already: checked in before (`checkIn` says when and by whom); nothing changed
 * - undone: the check-in was taken back, the spot stays booked
 * - booked: holds a spot, not checked in (an undo found nothing to undo)
 * - nospot: the ticket exists but holds no spot, so there is nothing to check in
 * - unknown: no ticket has this pass
 */
export type PassCheckStatus = 'checkedin' | 'already' | 'undone' | 'booked' | 'nospot' | 'unknown';

export interface PassCheckResult {
	status: PassCheckStatus;
	code: string;
	/** When this check ran. */
	checkedAt: string;
	ticketName?: string;
	email?: string;
	spot?: { house: string; room: string; spot: string; roomId: string } | null;
	burnerName?: string;
	/** The check-in at arrival: when and by which admin. */
	checkIn?: { at: string; by: string } | null;
	warning?: string;
}

/** A guest's own pass as the small ticket on house, room and map pages shows it (PassTicket.svelte). */
export interface PassSummary {
	/** XXXX-XXXX-XXXX */
	code: string;
	house: string;
	room: string;
	spot: string;
	burnerName: string;
}

export function isPassCode(value: string): boolean {
	return PASS_CODE.test(value);
}

/** "7F3K9QXM2CWD" → "7F3K-9QXM-2CWD" */
export function formatPassCode(code: string): string {
	return code.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * What a scanner read or a person typed → the stored code, or null.
 * Accepts the code with or without dashes and spaces, in any case, and whole
 * links like https://…/pass/7F3K-9QXM-2CWD (what the QR code holds; USB
 * scanners type it like a keyboard).
 */
export function normalizePassInput(input: unknown): string | null {
	let value = typeof input === 'string' ? input.trim() : '';
	const fromLink = /\/pass\/([^/?#\s]+)/i.exec(value);
	if (fromLink) {
		try {
			value = decodeURIComponent(fromLink[1]);
		} catch {
			return null;
		}
	}
	value = value.replace(/[\s-]/g, '').toUpperCase();
	return isPassCode(value) ? value : null;
}
