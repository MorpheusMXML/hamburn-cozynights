// src/lib/tickets.ts
/**
 * The ticket roster (collection `orders`) in the admin area: reading the ticket
 * shop's CSV export, comparing it with the stored tickets, and the masking used
 * in the audit log and the crew chat (e-mail addresses: maskEmail in
 * $lib/server/notifications). Pure code without server imports, shared
 * by the admin actions, the admin UI and the unit tests.
 *
 * The server CLI (`cozy-admin tickets import` in pb_hooks/cozy_admin.pb.js)
 * reads the same files by the same rules. Keep TICKET_CODE_PATTERN,
 * GUEST_EMAIL_PATTERN and TICKET_CSV_COLUMNS in sync with it;
 * tests/tickets.test.ts compares them.
 */

/** Same as the guest sign-in (src/routes/+page.server.ts): anything else can't be typed in. */
export const TICKET_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Close to what PocketBase's email field (orders.email) accepts. */
export const GUEST_EMAIL_PATTERN =
	/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export const TICKET_LIMITS = {
	fileBytes: 2 * 1024 * 1024,
	rows: 5000,
	nameLength: 100,
	emailLength: 254
} as const;

/** Header names per column, compared in lower case with "_" and runs of spaces as one space. */
export const TICKET_CSV_COLUMNS = {
	code: [
		'code',
		'ticket',
		'ticket code',
		'ticketcode',
		'order',
		'order code',
		'order number',
		'secret'
	],
	email: ['email', 'e-mail', 'mail', 'email address', 'e-mail address', 'attendee email'],
	name: ['name', 'customer name', 'attendee', 'attendee name', 'full name']
} as const;

export type TicketColumn = keyof typeof TICKET_CSV_COLUMNS;

/** Column index per field; -1 = not in the file. */
export type ColumnMap = Record<TicketColumn, number>;

/** Zero-width characters that copy & paste likes to bring along. */
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

/** A ticket code as typed or pasted: without surrounding spaces and invisible characters. */
export function cleanTicketCode(raw: unknown): string {
	return (typeof raw === 'string' ? raw : '').replace(INVISIBLE, '').trim();
}

/** Lower case and trimmed; '' stays ''. */
export function normalizeEmail(raw: unknown): string {
	return (typeof raw === 'string' ? raw : '').replace(INVISIBLE, '').trim().toLowerCase();
}

export function isValidGuestEmail(email: string): boolean {
	return email.length <= TICKET_LIMITS.emailLength && GUEST_EMAIL_PATTERN.test(email);
}

/** The label the CLI gives tickets without a name; mails greet those without a name. */
export function defaultTicketName(code: string): string {
	return `Ticket ${code}`;
}

/**
 * A code shortened for logs, the crew chat and lists of tickets the admin
 * didn't type: enough to tell tickets apart, never enough to guess one. At
 * most a third of the code shows; short codes (pretix order codes have five
 * characters) keep only their first one. "HB-1001" → "H•••".
 */
export function maskTicketCode(code: string): string {
	const value = String(code || '');
	if (!value) return '';
	if (value.length >= 15) return `${value.slice(0, 3)}•••${value.slice(-2)}`;
	if (value.length >= 9) return `${value.slice(0, 2)}•••${value.slice(-1)}`;
	return `${value.charAt(0)}•••`;
}

// --- reading the CSV file -------------------------------------------------------

/**
 * A CSV text as records of fields. The delimiter (, ; or tab) is taken from the
 * first line that isn't blank, or from Excel's "sep=;" line in front. Blank
 * lines stay in, so record n is row n of the file. A quote only opens a quoted
 * field at the start of the field; elsewhere it is an ordinary character, so a
 * stray quote in a name can't swallow the following rows.
 */
export function parseCsv(text: string): string[][] {
	const lines = String(text)
		.replace(/^\uFEFF/, '')
		.split(/\r?\n/);
	const first = lines.findIndex((line) => line.trim() !== '');
	let delimiter = ',';
	const directive = first >= 0 ? /^\s*"?sep=([^"\r\n])"?\s*$/i.exec(lines[first]) : null;
	if (directive) {
		delimiter = directive[1];
		lines[first] = '';
	} else if (first >= 0) {
		const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
		let quoted = false;
		for (const c of lines[first]) {
			if (c === '"') quoted = !quoted;
			else if (!quoted && counts[c] !== undefined) counts[c]++;
		}
		if (counts[';'] > counts[delimiter]) delimiter = ';';
		if (counts['\t'] > counts[delimiter]) delimiter = '\t';
	}
	const src = lines.join('\n');

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const c = src.charAt(i);
		if (quoted) {
			if (c === '"' && src.charAt(i + 1) === '"') {
				field += '"';
				i++;
			} else if (c === '"') {
				quoted = false;
			} else {
				field += c;
			}
		} else if (c === '"' && field === '') {
			quoted = true;
		} else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else if (c !== '\r') {
			field += c;
		}
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

const isBlank = (row: string[]) => row.every((field) => field.trim() === '');

function headerKey(name: string): string {
	return String(name)
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, ' ');
}

/** The first header column that matches each field (like the CLI). */
export function detectColumns(header: string[]): ColumnMap {
	const names = header.map(headerKey);
	const find = (column: TicketColumn) =>
		names.findIndex((name) => (TICKET_CSV_COLUMNS[column] as readonly string[]).includes(name));
	return { code: find('code'), email: find('email'), name: find('name') };
}

/** Every header column that could hold this field: offered as choices in the review. */
export function candidateColumns(header: string[], column: TicketColumn): number[] {
	return header
		.map((name, index) => ({ key: headerKey(name), index }))
		.filter(({ key }) => (TICKET_CSV_COLUMNS[column] as readonly string[]).includes(key))
		.map(({ index }) => index);
}

/** One data row of the file: the cells of the three columns that matter, as they are. */
export interface RosterRow {
	/** Row in the file (the header is row 1), as a spreadsheet counts it. */
	line: number;
	code: string;
	email: string;
	name: string;
}

export interface RosterEntry {
	line: number;
	code: string;
	/** Lower case; '' = empty cell (keeps a stored address). */
	email: string;
	/** '' = empty cell (keeps a stored name). */
	name: string;
}

export interface RosterProblem {
	line: number;
	code: string;
	message: string;
}

export type RosterFileResult =
	| { ok: true; header: string[]; columns: ColumnMap; rows: RosterRow[] }
	| { ok: false; error: string; header?: string[] };

/**
 * Reads a roster file in the browser: the header, the columns to use and only
 * their cells. The rest of the file (shop exports hold addresses, payment
 * details, …) never leaves the browser. `columns` overrides the detection
 * (the admin picked other columns in the review; -1 = none).
 */
export function readRosterFile(text: string, columns?: Partial<ColumnMap>): RosterFileResult {
	if (!text || text.trim() === '') return { ok: false, error: 'The file is empty.' };
	if (/[\u0000-\u0008\u000E-\u001F]/.test(text.slice(0, 2000))) {
		return {
			ok: false,
			error:
				'This is not a text file. Export the ticket list from the ticket shop as CSV (comma, semicolon or tab separated).'
		};
	}

	const records = parseCsv(text);
	const headerAt = records.findIndex((record) => !isBlank(record));
	if (headerAt < 0) return { ok: false, error: 'The file is empty.' };
	const header = records[headerAt].map((h) => h.replace(INVISIBLE, '').trim());

	const detected = detectColumns(header);
	const pick = (column: TicketColumn) => {
		const chosen = columns?.[column];
		const valid =
			typeof chosen === 'number' &&
			Number.isInteger(chosen) &&
			chosen >= (column === 'code' ? 0 : -1) &&
			chosen < header.length;
		return valid ? chosen : detected[column];
	};
	const map: ColumnMap = { code: pick('code'), email: pick('email'), name: pick('name') };
	if (map.code < 0) {
		return {
			ok: false,
			header,
			error: `No ticket code column found. The header line needs a column called "code" (or "Ticket", "Order code", "Secret", …). Found: ${header.join(' | ') || 'nothing'}.`
		};
	}

	const rows: RosterRow[] = [];
	for (let r = headerAt + 1; r < records.length; r++) {
		if (isBlank(records[r])) continue;
		const cell = (index: number) =>
			index >= 0 && index < records[r].length ? records[r][index] : '';
		rows.push({ line: r + 1, code: cell(map.code), email: cell(map.email), name: cell(map.name) });
	}
	if (rows.length === 0) {
		return { ok: false, header, error: 'The file has a header line but no tickets.' };
	}
	if (rows.length > TICKET_LIMITS.rows) {
		return {
			ok: false,
			header,
			error: `The file has ${rows.length} tickets, the limit is ${TICKET_LIMITS.rows}. Split it into smaller files.`
		};
	}
	return { ok: true, header, columns: map, rows };
}

/**
 * Checks the rows. Broken ones become problems: they are listed and left out,
 * the rest can still be imported.
 */
export function checkRosterRows(rows: RosterRow[]): {
	entries: RosterEntry[];
	problems: RosterProblem[];
} {
	const entries: RosterEntry[] = [];
	const problems: RosterProblem[] = [];
	const lineOfCode = new Map<string, number>();
	for (const row of rows) {
		const line = row.line;
		const clean = (value: string) =>
			String(value ?? '')
				.replace(INVISIBLE, '')
				.trim();
		const code = clean(row.code);
		const email = clean(row.email).toLowerCase();
		const name = clean(row.name);

		if (/[\r\n]/.test(`${row.code}${row.email}${row.name}`)) {
			problems.push({
				line,
				code: code.split(/\s/)[0] ?? '',
				message: 'a cell spans several lines (a quote in the file that is never closed?)'
			});
		} else if (!code) {
			problems.push({ line, code, message: 'no ticket code' });
		} else if (!TICKET_CODE_PATTERN.test(code)) {
			problems.push({
				line,
				code,
				message: 'invalid ticket code: only letters, digits, "-" and "_", at most 64 characters'
			});
		} else if (email && !isValidGuestEmail(email)) {
			problems.push({ line, code, message: `invalid e-mail address "${email}"` });
		} else if (name.length > TICKET_LIMITS.nameLength) {
			problems.push({
				line,
				code,
				message: `name longer than ${TICKET_LIMITS.nameLength} characters`
			});
		} else if (lineOfCode.has(code.toLowerCase())) {
			problems.push({
				line,
				code,
				message: `the same ticket code is in row ${lineOfCode.get(code.toLowerCase())}`
			});
		} else {
			lineOfCode.set(code.toLowerCase(), line);
			entries.push({ line, code, email, name });
		}
	}
	return { entries, problems };
}

export type RosterParseResult =
	| {
			ok: true;
			header: string[];
			columns: ColumnMap;
			entries: RosterEntry[];
			problems: RosterProblem[];
	  }
	| { ok: false; error: string; header?: string[] };

/** readRosterFile and checkRosterRows in one step. */
export function parseRoster(text: string, columns?: Partial<ColumnMap>): RosterParseResult {
	const file = readRosterFile(text, columns);
	if (!file.ok) return file;
	return { ok: true, header: file.header, columns: file.columns, ...checkRosterRows(file.rows) };
}

// --- comparing with the stored tickets -------------------------------------------

/** A stored ticket as the roster review needs it. */
export interface StoredTicket {
	id: string;
	code: string;
	email: string;
	name: string;
	/** Holds a spot (booked or assigned). */
	hasSpot: boolean;
	/** A Telegram chat is linked for updates. */
	telegram: boolean;
}

export interface RosterChange {
	/** Lower-case code: what the selection refers to. */
	key: string;
	/** The stored ticket (changed tickets only). */
	id: string | null;
	line: number;
	code: string;
	kind: 'new' | 'changed';
	/** What the ticket will have afterwards. */
	email: string;
	name: string;
	/** What it has now (changed tickets only). */
	before: { email: string; name: string } | null;
	emailChanged: boolean;
	nameChanged: boolean;
	hasSpot: boolean;
	telegram: boolean;
	/**
	 * The address changes on a ticket that has something of its holder:
	 * a spot or a Telegram link. The review offers to treat it as passed on.
	 */
	canBeNewHolder: boolean;
	/** Pre-selected "passed on": address AND name change, like a ticket transfer in the shop. */
	suggestNewHolder: boolean;
}

export interface RosterDiff {
	changes: RosterChange[];
	unchanged: { code: string; line: number }[];
	/** Lines that can't be imported: broken, or in conflict with the stored tickets. */
	problems: RosterProblem[];
	/** Stored tickets that are not in the file. They are left alone. */
	notInFile: { code: string; hasSpot: boolean }[];
	/** Addresses used by several tickets of the file (allowed, worth a look). */
	sharedEmails: { email: string; codes: string[] }[];
}

/**
 * What importing `entries` would change. Empty cells keep what is stored; codes
 * are matched exactly, a code that differs from a stored one only in upper and
 * lower case is a problem (the sign-in could mix them up).
 */
export function diffRoster(
	entries: RosterEntry[],
	stored: StoredTicket[],
	problems: RosterProblem[] = []
): RosterDiff {
	const byKey = new Map<string, StoredTicket[]>();
	for (const ticket of stored) {
		const key = ticket.code.toLowerCase();
		const list = byKey.get(key);
		if (list) list.push(ticket);
		else byKey.set(key, [ticket]);
	}

	const changes: RosterChange[] = [];
	const unchanged: RosterDiff['unchanged'] = [];
	const allProblems = [...problems];
	const inFile = new Set<string>();

	for (const entry of entries) {
		const key = entry.code.toLowerCase();
		inFile.add(key);
		const twins = byKey.get(key) ?? [];
		const exact = twins.filter((t) => t.code === entry.code);

		if (exact.length > 1) {
			allProblems.push({
				line: entry.line,
				code: entry.code,
				message: `${exact.length} tickets in the database have this code; fix them in the PocketBase dashboard first`
			});
			continue;
		}
		if (exact.length === 0 && twins.length > 0) {
			allProblems.push({
				line: entry.line,
				code: entry.code,
				message: `differs only in upper/lower case from the stored ticket ${twins[0].code} (the sign-in could mix them up)`
			});
			continue;
		}

		if (exact.length === 0) {
			changes.push({
				key,
				id: null,
				line: entry.line,
				code: entry.code,
				kind: 'new',
				email: entry.email,
				name: entry.name || defaultTicketName(entry.code),
				before: null,
				emailChanged: !!entry.email,
				nameChanged: false,
				hasSpot: false,
				telegram: false,
				canBeNewHolder: false,
				suggestNewHolder: false
			});
			continue;
		}

		const ticket = exact[0];
		const email = entry.email || ticket.email;
		const name = entry.name || ticket.name;
		// Stored addresses may differ in case only (typed in the dashboard): no change.
		const emailChanged = email.toLowerCase() !== ticket.email.toLowerCase();
		const nameChanged = name !== ticket.name;
		if (!emailChanged && !nameChanged) {
			unchanged.push({ code: entry.code, line: entry.line });
			continue;
		}
		const canBeNewHolder = emailChanged && !!ticket.email && (ticket.hasSpot || ticket.telegram);
		changes.push({
			key,
			id: ticket.id,
			line: entry.line,
			code: entry.code,
			kind: 'changed',
			email,
			name,
			before: { email: ticket.email, name: ticket.name },
			emailChanged,
			nameChanged,
			hasSpot: ticket.hasSpot,
			telegram: ticket.telegram,
			canBeNewHolder,
			suggestNewHolder:
				canBeNewHolder && nameChanged && ticket.name !== defaultTicketName(ticket.code)
		});
	}

	const notInFile = stored
		.filter((ticket) => !inFile.has(ticket.code.toLowerCase()))
		.map((ticket) => ({ code: ticket.code, hasSpot: ticket.hasSpot }))
		.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

	const codesByEmail = new Map<string, string[]>();
	for (const entry of entries) {
		if (!entry.email) continue;
		const list = codesByEmail.get(entry.email);
		if (list) list.push(entry.code);
		else codesByEmail.set(entry.email, [entry.code]);
	}
	const sharedEmails = [...codesByEmail.entries()]
		.filter(([, codes]) => codes.length > 1)
		.map(([email, codes]) => ({ email, codes }));

	allProblems.sort((a, b) => a.line - b.line);
	return { changes, unchanged, problems: allProblems, notInFile, sharedEmails };
}

/** Selection the review starts with: every new and changed ticket. */
export function defaultRosterSelection(diff: RosterDiff): {
	selected: string[];
	newHolders: string[];
} {
	return {
		selected: diff.changes.map((change) => change.key),
		newHolders: diff.changes.filter((change) => change.suggestNewHolder).map((c) => c.key)
	};
}

// --- what the admin area shows (server results) -----------------------------------

export interface TicketSpot {
	house: string;
	room: string;
	spot: string;
	roomId: string;
}

/** A ticket as the admin sees it. */
export interface TicketView {
	id: string;
	/** The ticket code; masked ("HB-•••01") when the ticket was found by its address. */
	code: string;
	codeMasked: boolean;
	/** customer_name; '' for the default label "Ticket <code>". */
	name: string;
	email: string;
	/** The code was used to sign in at least once. */
	signedIn: boolean;
	spot: TicketSpot | null;
	burnerName: string;
	telegram: boolean;
	/** A booking pass was issued (pb_hooks/cozy_pass.pb.js). */
	pass: boolean;
}

export interface TicketSearch {
	by: 'code' | 'email';
	query: string;
	tickets: TicketView[];
	/** More tickets matched than are shown. */
	more: boolean;
}

export interface TicketChangeOutcome {
	ticket: TicketView;
	/** Code for the audit log, masked. */
	maskedCode: string;
	emailBefore: string;
	emailChanged: boolean;
	nameChanged: boolean;
	newHolder: boolean;
	/** The old holder's special-needs request was deleted with the hand-over. */
	requestRemoved: boolean;
	/** The new address will get a confirmation of the ticket's spot. */
	confirmation: boolean;
}

export interface RosterPreview {
	diff: RosterDiff;
	/** Tickets in the database now. */
	stored: number;
}

export interface RosterImportOutcome {
	created: number;
	updated: number;
	/** Updated tickets that were handed over to a new holder. */
	newHolders: number;
	/** Handed-over tickets whose old holder's special-needs request was deleted. */
	requestsRemoved: number;
	/** New addresses of tickets that hold a spot: they get a confirmation. */
	confirmations: number;
	/** Selected, but nothing (or no longer anything) to change. */
	skipped: number;
	failed: { code: string; error: string }[];
}
