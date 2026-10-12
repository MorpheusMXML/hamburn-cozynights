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
 * The form offers three paths ("What is your request about?", RequestPath):
 * a personal need because of a medical reason or a disability, the helper of
 * someone with such a need, or an art project or a crew. Guests can ask
 * together as a request group (a helper and the person they help, or the crew
 * of a project). There is no stored "kind" of request: it follows from the
 * stored needs (requestKinds, requestPath), which are stored encrypted, so
 * outside the admin area nothing tells one kind of request from another.
 */
import { PASS_ALPHABET } from './pass';

/*
 * `needs` is free ciphertext (a JSON list of these values), no select list in
 * any migration: a value can be added here without one.
 */

/**
 * A personal need (a medical reason or a disability). The ♿ spots are the pool
 * for every request (Max, 2026-10-12); among them, these choose first.
 */
export const ACCESS_NEEDS = [
	{ value: 'lower_bunk', label: 'A lower bunk or a bed without a ladder' },
	{ value: 'step_free', label: 'Step-free access or the ground floor' },
	{ value: 'near_toilet', label: 'Close to a toilet' },
	{ value: 'quiet', label: 'A quiet area' },
	{ value: 'stable_light', label: 'Stable light conditions' }
] as const;

/** What the guest wrote themselves; when unclear, it counts like a personal need. */
export const OTHER_NEED = { value: 'other', label: 'Something else' } as const;

/** The checkboxes of a personal need, in this order. */
export const PERSONAL_NEEDS = [...ACCESS_NEEDS, OTHER_NEED] as const;

/**
 * Comes as the helper of someone with a personal need. No checkbox: choosing
 * the helper path stores this alone. A helper asks in a group with the person
 * they help, and gets a ♿ spot after the members with a personal need.
 */
export const HELPER_NEED = {
	value: 'helper',
	label: 'I come as the helper of someone with a personal need'
} as const;

/** An art project or a crew: the crew matches these by hand. */
export const PROJECT_NEEDS = [
	{ value: 'own_room', label: 'A room for our art project or crew' },
	{ value: 'near_project', label: 'A bed close to our art piece or project' }
] as const;

/** Every value the form sends now, path by path. */
export const SPECIAL_NEEDS = [...PERSONAL_NEEDS, HELPER_NEED, ...PROJECT_NEEDS] as const;

/**
 * Off the form, with the path they belonged to; old requests still show them
 * to admins, and a posted one is dropped.
 * - power: since v0.30.0 (Max 2026-10-04: every room has power);
 * - close_together: since the three paths (Max 2026-10-11): a group says that
 *   now.
 */
export const RETIRED_NEEDS = [
	{
		value: 'power',
		label: 'A power socket for a medical device (old form)',
		path: 'personal'
	},
	{
		value: 'close_together',
		label: 'Spots close to the people I come with (old form)',
		path: 'project'
	}
] as const;

export type SpecialNeed =
	(typeof SPECIAL_NEEDS)[number]['value'] | (typeof RETIRED_NEEDS)[number]['value'];
export type RequestStatus = 'pending' | 'approved' | 'declined';

/** What a request is about: the radio at the top of the form. */
export type RequestPath = 'personal' | 'helper' | 'project';

export const REQUEST_PATHS: readonly { value: RequestPath; label: string }[] = [
	{ value: 'personal', label: 'A personal need: a medical reason or a disability' },
	{ value: 'helper', label: HELPER_NEED.label },
	{ value: 'project', label: 'An art project or a crew' }
];

export const REQUEST_TEXT_MIN = 5;
export const REQUEST_TEXT_MAX = 500;
/** An art project or a crew says in at least this many words why it needs the spot. */
export const PROJECT_WORDS_MIN = 5;
/** Same limit as a burner name chosen when booking. */
export const BURNER_NAME_MAX = 80;

export const STATUS_LABELS: Record<RequestStatus, string> = {
	pending: 'Waiting for the crew',
	approved: 'Approved',
	declined: 'Declined'
};

const values = (list: readonly { value: string }[]): readonly string[] =>
	list.map((need) => need.value);
const retired = (path: RequestPath): readonly string[] =>
	values(RETIRED_NEEDS.filter((need) => need.path === path));

const FORM_VALUES = values(SPECIAL_NEEDS);
const RETIRED_VALUES = values(RETIRED_NEEDS);
const ACCESS_VALUES: readonly string[] = [...values(ACCESS_NEEDS), ...retired('personal')];
const PROJECT_VALUES: readonly string[] = [...values(PROJECT_NEEDS), ...retired('project')];

/** What each path of the form sends: only these are kept when it is chosen. */
const PATH_VALUES: Record<RequestPath, readonly string[]> = {
	personal: values(PERSONAL_NEEDS),
	helper: [HELPER_NEED.value],
	project: values(PROJECT_NEEDS)
};

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

/** Something the guest needs to sleep well (the retired socket included). Not "Something else", not a helper. */
export function isAccessNeed(value: string): boolean {
	return ACCESS_VALUES.includes(value);
}

/** What an art project or a crew asks for (the retired "close together" included). */
export function isProjectNeed(value: string): boolean {
	return PROJECT_VALUES.includes(value);
}

export function needLabel(value: string): string {
	return [...SPECIAL_NEEDS, ...RETIRED_NEEDS].find((need) => need.value === value)?.label ?? value;
}

export function isRequestPath(value: unknown): value is RequestPath {
	return value === 'personal' || value === 'helper' || value === 'project';
}

/**
 * The path a stored request took, from its needs: the form preselects it
 * when the guest changes the request. A helper is a helper; a personal need
 * or "Something else" makes it personal, also in a request from before the
 * paths that asked for a project as well, so changing it never silently
 * drops what the guest needs to sleep well (the form says what the other
 * path asked for: needsOutsidePath); a project's wish, or the retired "close
 * together" alone, makes it a project. Null when nothing is stored: the
 * guest asks only as part of their group.
 */
export function requestPath(needs: readonly string[]): RequestPath | null {
	if (needs.includes(HELPER_NEED.value)) return 'helper';
	if (needs.some((need) => isAccessNeed(need) || need === OTHER_NEED.value)) return 'personal';
	if (needs.some(isProjectNeed)) return 'project';
	return null;
}

/**
 * The stored needs a path leaves out: values the form offers under another
 * path (retired ones are dropped anyway). Only a request from before the
 * paths, which could tick personal and project needs both, has any for the
 * path it was preselected with; the form then tells the guest what the other
 * part asked for, since saving keeps one path.
 */
export function needsOutsidePath(needs: readonly string[], path: RequestPath): SpecialNeed[] {
	return needs.filter(
		(need): need is SpecialNeed => isFormNeed(need) && !PATH_VALUES[path].includes(need)
	);
}

/**
 * What a request is about, from its stored needs:
 * - access: a personal need, or "Something else" (when unclear, treat it as
 *   needing a ♿ spot);
 * - project: a room or a bed for an art project or a crew;
 * - helper: the helper of someone with a personal need (never a ♿ spot of
 *   their own: the crew places them close to the person they help);
 * - groupOnly: nothing stored, the guest asks only as part of their group.
 * The form keeps one path per request; requests from before the paths may
 * have access and project both.
 */
export function requestKinds(needs: readonly string[]): {
	access: boolean;
	project: boolean;
	helper: boolean;
	groupOnly: boolean;
} {
	return {
		access: needs.some((need) => isAccessNeed(need) || need === OTHER_NEED.value),
		project: needs.some(isProjectNeed),
		helper: needs.includes(HELPER_NEED.value),
		groupOnly: needs.length === 0
	};
}

/** Words with at least one letter or digit: a dash or an emoji alone is no word. */
export function countWords(text: string): number {
	return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * At most this many requests in one group (Max, 2026-10-11; 12 before). A
 * group that is bigger already keeps everyone; nobody new can join it.
 */
export const GROUP_MAX = 5;
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
	/** The other spot of its bunk bed ('' or missing for a spot on its own). */
	bunkPartner?: string;
	/** What kind of house and room it is in (catalogue values, '' when not set). */
	houseKind?: string;
	roomKind?: string;
	/**
	 * What the room offers, before the spot's own rules: its own features and
	 * its house's, minus what the room switched off. The spot picker shows these
	 * on the room's card; `features` above is what counts for the spot itself.
	 */
	roomFeatures?: string[];
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

/**
 * A refused field of the request form, written for the guest. `about` is the
 * path radio, `needs` its checkboxes, `group` the group choice as a whole (a
 * helper without a group).
 */
export type RequestFormErrors = Partial<
	Record<
		'about' | 'needs' | 'text' | 'consent' | 'burnerName' | 'group' | 'groupName' | 'groupCode',
		string
	>
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

/** Where a helper's request goes: always together with the person they help. */
export const HELPER_NEEDS_GROUP =
	'A helper asks together with the person they help: join their group, or start one and share the link.';

/** The few words the crew needs, by path. */
const TEXT_MISSING: Record<RequestPath | 'none', string> = {
	personal: 'Tell the crew in a few words what you need.',
	helper: 'Tell the crew in a few words what they should know.',
	project: `Describe in at least ${PROJECT_WORDS_MIN} words what you need and why your art piece or project would be at risk without it.`,
	none: 'Tell the crew in a few words what you need.'
};

/** The path radio as posted, or null for none (or something else). */
export function readRequestPath(raw: unknown): RequestPath | null {
	return isRequestPath(raw) ? raw : null;
}

/** "You ticked “A quiet area” under another choice: …", for boxes the chosen path doesn't have. */
function tickedElsewhere(needs: readonly SpecialNeed[]): string {
	const list = needs.map((need) => `“${needLabel(need)}”`).join(', ');
	return needs.length === 1
		? `You ticked ${list} under another choice: choose that one, or untick it.`
		: `You ticked ${list} under another choice: choose the one that fits, or untick them.`;
}

/**
 * Reads and checks the request form. Never throws; messages are written for
 * the guest.
 * @param opts.inGroup the request is in a group already: the form shows no
 *   group choice then, and the membership stays (mode keep).
 *
 * The path (`about`) decides which needs count: only the ones it offers are
 * kept, so a browser without JavaScript, which posts the boxes of every path,
 * can't mix them; the helper path stores HELPER_NEED alone. Ticked boxes
 * without a path are refused rather than guessed.
 *
 * Who asks only as part of a group (in one, or joining one) may choose no
 * path and tick nothing, and then leave the text empty too; a ticked need
 * still wants a few words. Starting a group follows the normal rules: the
 * crew needs to know what the group is about. A helper always asks in a
 * group: starting one, joining one, or in one already.
 */
export function parseRequestForm(
	form: FormData,
	opts: { inGroup?: boolean } = {}
): RequestFormResult {
	const about = readRequestPath(form.get('about'));
	const posted = [...new Set(form.getAll('needs'))].filter(isFormNeed);
	const needs: SpecialNeed[] =
		about === 'helper'
			? [HELPER_NEED.value]
			: about
				? posted.filter((need) => PATH_VALUES[about].includes(need))
				: posted;
	const text = cleanRequestText(form.get('text'));
	const burnerName = cleanBurnerName(form.get('burnerName'));
	const consent = form.get('consent') === 'yes';
	const errors: RequestFormErrors = {};

	const mode = form.get('groupMode');
	let group: GroupChoice;
	if (opts.inGroup) {
		group = { mode: 'keep' };
	} else if (mode === 'start') {
		// One line, like a burner name; others in the group see it.
		const name = cleanBurnerName(cleanRequestText(form.get('groupName')));
		group = { mode: 'start', name };
		if (name.length < GROUP_NAME_MIN || name.length > GROUP_NAME_MAX) {
			errors.groupName = `Give your group a name (${GROUP_NAME_MIN} to ${GROUP_NAME_MAX} characters).`;
		}
	} else if (mode === 'join') {
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

	if (!about) {
		if (!grouped || needs.length > 0) errors.about = 'Choose what your request is about.';
	} else if (needs.length === 0 && (!grouped || posted.length > 0)) {
		// In a group, ticking nothing asks only through the group; but boxes
		// ticked under another path (a browser without JavaScript shows them
		// all) are never dropped without a word.
		const elsewhere = posted.length > 0 ? ` ${tickedElsewhere(posted)}` : '';
		errors.needs =
			(about === 'project'
				? 'Tick a room or a bed.'
				: 'Tick at least one thing. If none fits, tick "Something else".') + elsewhere;
	}
	if (about === 'helper' && group.mode === 'none' && !errors.groupName) {
		errors.group = HELPER_NEEDS_GROUP;
	}

	// In a group with nothing ticked, the text is optional; anything ticked wants a few words.
	const textNeeded = !grouped || needs.length > 0;
	if (text.length > REQUEST_TEXT_MAX) {
		errors.text = `Please keep it short: at most ${REQUEST_TEXT_MAX} characters (now ${text.length}).`;
	} else if (
		textNeeded &&
		(text.length < REQUEST_TEXT_MIN ||
			(about === 'project' && countWords(text) < PROJECT_WORDS_MIN))
	) {
		errors.text = TEXT_MISSING[about ?? 'none'];
	}
	if (burnerName.length > BURNER_NAME_MAX) {
		errors.burnerName = `A burner name can have at most ${BURNER_NAME_MAX} characters.`;
	}
	if (!consent) {
		errors.consent = 'Without your consent the crew may not use what you wrote. Tick the box.';
	}

	return Object.keys(errors).length > 0 ? { ok: false, value, errors } : { ok: true, value };
}
