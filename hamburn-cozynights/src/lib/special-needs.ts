// src/lib/special-needs.ts
/**
 * Special-needs requests: what a guest can ask for, and the checks of the
 * request form. Pure code without server imports, shared by the guest page,
 * the admin page, the server actions and the unit tests. Storage and
 * decisions: $lib/server/special-requests.ts; background:
 * docs/admin/special-needs.md.
 *
 * The form asks what a guest NEEDS, never why: a diagnosis is health data the
 * crew doesn't need to find a fitting spot.
 */

/** Keep in sync with the `needs` values in pb_migrations/1759200000_special_requests.js. */
export const SPECIAL_NEEDS = [
	{ value: 'lower_bunk', label: 'A lower bunk or a bed without a ladder' },
	{ value: 'step_free', label: 'Step-free access or the ground floor' },
	{ value: 'near_toilet', label: 'Close to a toilet' },
	{ value: 'quiet', label: 'A quiet room' },
	{ value: 'power', label: 'A power socket for a medical device' },
	{ value: 'other', label: 'Something else' }
] as const;

export type SpecialNeed = (typeof SPECIAL_NEEDS)[number]['value'];
export type RequestStatus = 'pending' | 'approved' | 'declined';

export const REQUEST_TEXT_MIN = 5;
export const REQUEST_TEXT_MAX = 500;
/** Same limit as a burner name chosen when booking. */
export const BURNER_NAME_MAX = 80;

export const STATUS_LABELS: Record<RequestStatus, string> = {
	pending: 'Waiting for the crew',
	approved: 'Approved',
	declined: 'Declined'
};

const NEED_VALUES: readonly string[] = SPECIAL_NEEDS.map((need) => need.value);

export function isSpecialNeed(value: unknown): value is SpecialNeed {
	return typeof value === 'string' && NEED_VALUES.includes(value);
}

export function needLabel(value: string): string {
	return SPECIAL_NEEDS.find((need) => need.value === value)?.label ?? value;
}

export interface SpotInfo {
	bedId: string;
	roomId: string;
	/** "B1 · Dorm #2 · Villa" */
	label: string;
	spot: string;
	room: string;
	house: string;
	special: boolean;
	locked: boolean;
	/**
	 * What kind of bed it is and what is true around it, as plain values of the
	 * catalogue in src/lib/accommodation.ts (that module reads this one, so the
	 * types stay there). The features are the spot's own plus its room's and
	 * house's: this is what the ♿ picker matches a request's needs with.
	 */
	bedType: string;
	features: string[];
}

/** What the guest sees of their own request. */
export interface GuestRequestView {
	status: RequestStatus;
	needs: SpecialNeed[];
	text: string;
	burnerName: string;
	sentAt: string;
	updatedAt: string;
}

/** What admins see of a request, with the ticket it belongs to. */
export interface AdminRequestView extends GuestRequestView {
	id: string;
	consentAt: string;
	decidedBy: string;
	decidedAt: string;
	/** The guest sent the form again after the crew decided (a race with the decision). */
	changedAfterDecision: boolean;
	/** From the ticket list. The name is empty when it would show the ticket code. */
	ticket: { name: string; email: string };
	/** The ticket's spot; `assigned` when the crew booked it for this request. */
	spot: (SpotInfo & { assigned: boolean }) | null;
}

export interface RequestInput {
	needs: SpecialNeed[];
	text: string;
	burnerName: string;
	consent: boolean;
}

export type RequestFormErrors = Partial<
	Record<'needs' | 'text' | 'consent' | 'burnerName', string>
>;

export type RequestFormResult =
	{ ok: true; value: RequestInput } | { ok: false; value: RequestInput; errors: RequestFormErrors };

/**
 * The guest's text as it is stored: normal line breaks, no control or
 * invisible formatting characters, at most one empty line in a row.
 */
export function cleanRequestText(raw: unknown): string {
	return (
		(typeof raw === 'string' ? raw : '')
			.replace(/\r\n?|[\u2028\u2029]/g, '\n')
			// eslint-disable-next-line no-control-regex
			.replace(
				/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g,
				''
			)
			.replace(/[^\S\n]+/g, ' ')
			.split('\n')
			.map((line) => line.trim())
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}

/** Like the booking dialog: one line, no stray whitespace. */
export function cleanBurnerName(raw: unknown): string {
	return (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
}

/** Reads and checks the request form. Never throws; messages are written for the guest. */
export function parseRequestForm(form: FormData): RequestFormResult {
	const needs = [...new Set(form.getAll('needs'))].filter(isSpecialNeed);
	const text = cleanRequestText(form.get('text'));
	const burnerName = cleanBurnerName(form.get('burnerName'));
	const consent = form.get('consent') === 'yes';
	const value: RequestInput = { needs, text, burnerName, consent };

	const errors: RequestFormErrors = {};
	if (needs.length === 0) {
		errors.needs = 'Tick at least one thing you need. If none fits, tick "Something else".';
	}
	if (text.length < REQUEST_TEXT_MIN) {
		errors.text = 'Tell the crew in a few words what you need.';
	} else if (text.length > REQUEST_TEXT_MAX) {
		errors.text = `Please keep it short: at most ${REQUEST_TEXT_MAX} characters (now ${text.length}).`;
	}
	if (burnerName.length > BURNER_NAME_MAX) {
		errors.burnerName = `A burner name can have at most ${BURNER_NAME_MAX} characters.`;
	}
	if (!consent) {
		errors.consent = 'Without your consent the crew may not use what you wrote. Tick the box.';
	}

	return Object.keys(errors).length > 0 ? { ok: false, value, errors } : { ok: true, value };
}
