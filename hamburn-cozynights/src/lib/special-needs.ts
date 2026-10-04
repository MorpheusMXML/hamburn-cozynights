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
 *
 * The same form serves art projects, workshops, theme camps and crews (a room
 * of their own, spots close together), and guests can ask together as a
 * request group. There is no stored "kind" of request: it follows from the
 * ticked needs (requestKinds), which are stored encrypted, so outside the
 * admin area nothing tells an access request from a project request.
 */
import { PASS_ALPHABET } from './pass';

/*
 * `needs` is free ciphertext (a JSON list of these values), no select list in
 * any migration: a value can be added here without one.
 */

/** Something a guest needs to sleep well: the ♿ spots are kept for these. */
export const ACCESS_NEEDS = [
	{ value: 'lower_bunk', label: 'A lower bunk or a bed without a ladder' },
	{ value: 'step_free', label: 'Step-free access or the ground floor' },
	{ value: 'near_toilet', label: 'Close to a toilet' },
	{ value: 'quiet', label: 'A quiet room' }
] as const;

/** An art project, a workshop, a theme camp or a crew: the crew matches these by hand. */
export const PROJECT_NEEDS = [
	{ value: 'own_room', label: 'A room just for our project or crew' },
	{ value: 'close_together', label: 'Spots close to the people I come with' }
] as const;

/** What the guest wrote themselves; when unclear, it counts as needing a ♿ spot. */
export const OTHER_NEED = { value: 'other', label: 'Something else' } as const;

/** What the form offers, in this order. */
export const SPECIAL_NEEDS = [...ACCESS_NEEDS, ...PROJECT_NEEDS, OTHER_NEED] as const;

/** Off the form since v0.30.0 (Max 2026-10-04: every room has power); old requests still show it to admins. */
export const RETIRED_NEEDS = [
	{ value: 'power', label: 'A power socket for a medical device (old form)' }
] as const;

export type SpecialNeed =
	(typeof SPECIAL_NEEDS)[number]['value'] | (typeof RETIRED_NEEDS)[number]['value'];
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

const FORM_VALUES: readonly string[] = SPECIAL_NEEDS.map((need) => need.value);
const RETIRED_VALUES: readonly string[] = RETIRED_NEEDS.map((need) => need.value);
const ACCESS_VALUES: readonly string[] = [
	...ACCESS_NEEDS.map((need) => need.value),
	...RETIRED_VALUES
];
const PROJECT_VALUES: readonly string[] = PROJECT_NEEDS.map((need) => need.value);

/** A need the form offers or once offered: stored requests keep the old values. */
export function isSpecialNeed(value: unknown): value is SpecialNeed {
	return (
		typeof value === 'string' && (FORM_VALUES.includes(value) || RETIRED_VALUES.includes(value))
	);
}

/** A need the form offers now: what a guest sends. A posted retired value is dropped. */
export function isFormNeed(value: unknown): value is SpecialNeed {
	return typeof value === 'string' && FORM_VALUES.includes(value);
}

/** Something the guest needs to sleep well (the retired socket included). */
export function isAccessNeed(value: string): boolean {
	return ACCESS_VALUES.includes(value);
}

/** What an art project, a workshop, a theme camp or a crew asks for. */
export function isProjectNeed(value: string): boolean {
	return PROJECT_VALUES.includes(value);
}

export function needLabel(value: string): string {
	return [...SPECIAL_NEEDS, ...RETIRED_NEEDS].find((need) => need.value === value)?.label ?? value;
}

/**
 * What a request is about, from its ticked needs:
 * - access: something the guest needs, or "Something else" (when unclear,
 *   treat it as needing a ♿ spot);
 * - project: a room or spots for a project or crew;
 * - groupOnly: nothing ticked, the guest asks only as part of their group.
 * Both access and project can be true.
 */
export function requestKinds(needs: readonly string[]): {
	access: boolean;
	project: boolean;
	groupOnly: boolean;
} {
	return {
		access: needs.some((need) => isAccessNeed(need) || need === OTHER_NEED.value),
		project: needs.some(isProjectNeed),
		groupOnly: needs.length === 0
	};
}

/** At most this many requests in one group (Max, 2026-10-04). */
export const GROUP_MAX = 12;
export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 40;
/** A group code: characters of the booking pass alphabet (no look-alikes). */
export const GROUP_CODE_LENGTH = 8;

const GROUP_CODE = new RegExp(`^[${PASS_ALPHABET}]{${GROUP_CODE_LENGTH}}$`);

/**
 * What the request form says about a group:
 * - keep: the request is in a group already, which stays as it is;
 * - none: just for me;
 * - start: start a group with this name;
 * - join: join the group with this code.
 */
export type GroupChoice =
	| { mode: 'keep' }
	| { mode: 'none' }
	| { mode: 'start'; name: string }
	| { mode: 'join'; code: string };

/**
 * A group code as typed or pasted, without dashes and spaces and in capitals,
 * or '' when it can't be one. A pasted invite link counts for its code.
 */
export function normalizeGroupCode(input: unknown): string {
	let text = typeof input === 'string' ? input.trim() : '';
	const link = /group=([^&#\s]*)/i.exec(text);
	if (link) text = link[1];
	text = text.replace(/[\s-]+/g, '').toUpperCase();
	return GROUP_CODE.test(text) ? text : '';
}

/** "KM7PQ2XR" → "KM7P-Q2XR", like the booking pass shows its code. */
export function formatGroupCode(code: string): string {
	return code.length === GROUP_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export interface SpotInfo {
	bedId: string;
	roomId: string;
	/** The spot's house; '' when the room has none. */
	houseId: string;
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
	/** A text was stored but can't be read (another ENCRYPTION_KEY); `text` is '' then. */
	textUnreadable: boolean;
	consentAt: string;
	decidedBy: string;
	decidedAt: string;
	/** The guest sent the form again after the crew decided (a race with the decision). */
	changedAfterDecision: boolean;
	/** From the ticket list. The name is empty when it would show the ticket code. */
	ticket: { name: string; email: string };
	/** The ticket's spot; `assigned` when the crew booked it for this request. */
	spot: (SpotInfo & { assigned: boolean }) | null;
	/** The request group it is in, '' for none. */
	groupId: string;
}

/**
 * What a member of a request group sees of it: the name, the code to share
 * and the burner names in it. Never ids, needs, text, status, spot, e-mail
 * or ticket name of anyone.
 */
export interface GuestGroupView {
	name: string;
	/** Formatted: "KM7P-Q2XR". */
	code: string;
	/** The invite link: /special-needs?group=<code>. */
	link: string;
	/** The own entry first, the others by name. */
	members: { name: string; you: boolean }[];
	max: number;
	full: boolean;
}

/** A request group in the admin area. */
export interface AdminGroupView {
	id: string;
	name: string;
	/** Formatted: "KM7P-Q2XR". */
	code: string;
	created: string;
	/** The requests in it, oldest first. */
	memberIds: string[];
}

export interface RequestInput {
	needs: SpecialNeed[];
	text: string;
	burnerName: string;
	consent: boolean;
	group: GroupChoice;
}

export type RequestFormErrors = Partial<
	Record<'needs' | 'text' | 'consent' | 'burnerName' | 'groupName' | 'groupCode', string>
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

/**
 * Reads and checks the request form. Never throws; messages are written for
 * the guest.
 * @param opts.inGroup the request is in a group already: the form shows no
 *   group choice then, and the membership stays (mode keep).
 *
 * Who asks only as part of a group (in one, or joining one) may leave the
 * needs empty; a ticked need still wants a few words. Starting a group follows
 * the normal rules: the crew needs to know what the group is about.
 */
export function parseRequestForm(
	form: FormData,
	opts: { inGroup?: boolean } = {}
): RequestFormResult {
	const needs = [...new Set(form.getAll('needs'))].filter(isFormNeed);
	const text = cleanRequestText(form.get('text'));
	const burnerName = cleanBurnerName(form.get('burnerName'));
	const consent = form.get('consent') === 'yes';
	const errors: RequestFormErrors = {};

	const posted = form.get('groupMode');
	let group: GroupChoice;
	if (opts.inGroup) {
		group = { mode: 'keep' };
	} else if (posted === 'start') {
		// One line, like a burner name; others in the group see it.
		const name = cleanBurnerName(cleanRequestText(form.get('groupName')));
		group = { mode: 'start', name };
		if (name.length < GROUP_NAME_MIN || name.length > GROUP_NAME_MAX) {
			errors.groupName = `Give your group a name (${GROUP_NAME_MIN} to ${GROUP_NAME_MAX} characters).`;
		}
	} else if (posted === 'join') {
		const code = normalizeGroupCode(form.get('groupCode'));
		group = { mode: 'join', code };
		if (!code) errors.groupCode = 'A group code has 8 letters and digits, like ABCD-EF23.';
	} else {
		group = { mode: 'none' };
		// Without JavaScript, typing a name doesn't pick "Start a group": say so
		// rather than drop the name. Never the code, which an invite fills in.
		if (cleanBurnerName(cleanRequestText(form.get('groupName')))) {
			errors.groupName = 'You named a group: choose “Start a group”, or clear the name.';
		}
	}
	const grouped = !!opts.inGroup || group.mode === 'join';
	const value: RequestInput = { needs, text, burnerName, consent, group };

	if (needs.length === 0 && !grouped) {
		errors.needs = 'Tick at least one thing. If none fits, tick "Something else".';
	}
	if (text.length > REQUEST_TEXT_MAX) {
		errors.text = `Please keep it short: at most ${REQUEST_TEXT_MAX} characters (now ${text.length}).`;
	} else if (text.length < REQUEST_TEXT_MIN && (!grouped || needs.length > 0)) {
		errors.text = 'Tell the crew in a few words what you need or what your project is.';
	}
	if (burnerName.length > BURNER_NAME_MAX) {
		errors.burnerName = `A burner name can have at most ${BURNER_NAME_MAX} characters.`;
	}
	if (!consent) {
		errors.consent = 'Without your consent the crew may not use what you wrote. Tick the box.';
	}

	return Object.keys(errors).length > 0 ? { ok: false, value, errors } : { ok: true, value };
}
