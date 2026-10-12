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
 * GUEST_EMAIL_PATTERN, TICKET_CSV_COLUMNS, PAID_ORDER_STATUSES and
 * UNPAID_ORDER_STATUSES in sync with it; tests/tickets.test.ts compares them.
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
	name: ['name', 'customer name', 'attendee', 'attendee name', 'full name'],
	status: ['status', 'order status', 'payment status']
} as const;

/**
 * Order states (lower case) in a file's status column. pretix exports "paid",
 * "pending", "canceled" and "expired" (or p, n, c, e); German exports say
 * bezahlt, offen, storniert, abgelaufen.
 *
 * - Paid: the ticket comes in, its code signs in.
 * - Waiting for the payment (UNPAID_ORDER_STATUSES): the ticket comes in
 *   flagged `unpaid` (orders.unpaid); its code can't sign in until a later
 *   list shows the order as paid, or an admin marks it paid by hand
 *   (PaidByHand).
 * - Anything else (cancelled, expired, refunded, …): the row is left out.
 *
 * An empty cell says nothing, like a file without the column: a new ticket
 * counts as paid, a stored one keeps what it has (empty cells never change a
 * ticket).
 */
export const PAID_ORDER_STATUSES = ['paid', 'p', 'bezahlt'];
export const UNPAID_ORDER_STATUSES = ['pending', 'n', 'offen', 'unpaid', 'ausstehend'];

const orderStatus = (raw: unknown) => (typeof raw === 'string' ? raw : '').trim().toLowerCase();

/** The order is paid, or the file doesn't say. */
export function isPaidStatus(raw: unknown): boolean {
	const status = orderStatus(raw);
	return !status || PAID_ORDER_STATUSES.includes(status);
}

/** The order waits for its payment: the ticket comes in, but its code can't sign in yet. */
export function isUnpaidStatus(raw: unknown): boolean {
	return UNPAID_ORDER_STATUSES.includes(orderStatus(raw));
}

export type TicketColumn = keyof typeof TICKET_CSV_COLUMNS;

/** Column index per field; -1 = not in the file. */
export type ColumnMap = Record<TicketColumn, number>;

/**
 * Zero-width characters that copy & paste likes to bring along. The server CLI
 * strips the same ones (INVISIBLE_CHARS in pb_hooks/cozy_admin.pb.js).
 */
export const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;
const INVISIBLE = INVISIBLE_CHARS;

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

/** The stored fields the name rules below need: a record of `orders`. */
export interface TicketNameSource {
	customer_name?: string;
	order_number?: string;
}

/**
 * The holder's name from the ticket list, or '' when the ticket has none.
 * Tickets without a name are labelled "Ticket <code>" (defaultTicketName), and
 * the code signs the guest in: a name that carries the code is not a name and
 * is never shown. The one rule for the whole app — PocketBase has the same one
 * in pb_hooks/lib/tickets.js, and tests/tickets.test.ts compares them.
 */
export function holderName(order: TicketNameSource): string {
	const name = String(order.customer_name ?? '').trim();
	const code = String(order.order_number ?? '').trim();
	if (!name) return '';
	if (code && name.includes(code)) return '';
	return name;
}

/**
 * How the crew chat and the audit log name a ticket: "Ticket H•••" — never the
 * holder, never a full code. The crew chat runs on Telegram, so a line there
 * must not tie a person to what another line said about them.
 */
export function maskedTicketLabel(code: string): string {
	const masked = maskTicketCode(code);
	return masked ? `Ticket ${masked}` : '';
}

/**
 * What an admin sees when they look at a ticket (pass check, ticket list): the
 * holder's name, and for a ticket without one the masked label instead of the
 * code that would sign its guest in.
 */
export function displayTicketName(order: TicketNameSource): string {
	return holderName(order) || maskedTicketLabel(String(order.order_number ?? ''));
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
	return { code: find('code'), email: find('email'), name: find('name'), status: find('status') };
}

/** Every header column that could hold this field: offered as choices in the review. */
export function candidateColumns(header: string[], column: TicketColumn): number[] {
	return header
		.map((name, index) => ({ key: headerKey(name), index }))
		.filter(({ key }) => (TICKET_CSV_COLUMNS[column] as readonly string[]).includes(key))
		.map(({ index }) => index);
}

/** One data row of the file: the cells of the columns that matter, as they are. */
export interface RosterRow {
	/** Row in the file (the header is row 1), as a spreadsheet counts it. */
	line: number;
	code: string;
	email: string;
	name: string;
	/** The order's state in the shop; '' or missing = no status column. */
	status?: string;
}

export interface RosterEntry {
	line: number;
	code: string;
	/** Lower case; '' = empty cell (keeps a stored address). */
	email: string;
	/** '' = empty cell (keeps a stored name). */
	name: string;
	/**
	 * true: the shop lists the order as not paid yet; false: as paid. Missing
	 * when the file doesn't say (empty cell, no status column): a new ticket
	 * counts as paid, a stored one keeps what it has.
	 */
	unpaid?: boolean;
}

export interface RosterProblem {
	line: number;
	code: string;
	message: string;
}

/** A row the shop lists as neither paid nor waiting for the payment (cancelled, expired, …): left out. */
export interface RosterLeftOut {
	line: number;
	code: string;
	/** As the file writes it, in lower case. */
	status: string;
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
	const map: ColumnMap = {
		code: pick('code'),
		email: pick('email'),
		name: pick('name'),
		status: pick('status')
	};
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
		const row: RosterRow = {
			line: r + 1,
			code: cell(map.code),
			email: cell(map.email),
			name: cell(map.name)
		};
		if (map.status >= 0) row.status = cell(map.status);
		rows.push(row);
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
 * the rest can still be imported. Orders the shop lists as cancelled, expired
 * and the like are left out too, as `leftOut`; orders that wait for their
 * payment come in as entries with `unpaid`.
 */
export function checkRosterRows(rows: RosterRow[]): {
	entries: RosterEntry[];
	problems: RosterProblem[];
	leftOut: RosterLeftOut[];
} {
	const entries: RosterEntry[] = [];
	const problems: RosterProblem[] = [];
	const leftOut: RosterLeftOut[] = [];
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
		const status = clean(row.status ?? '').toLowerCase();

		if (/[\r\n]/.test(`${row.code}${row.email}${row.name}${row.status ?? ''}`)) {
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
		} else if (!isPaidStatus(status) && !isUnpaidStatus(status)) {
			leftOut.push({ line, code, status: status.slice(0, 40) });
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
			const entry: RosterEntry = { line, code, email, name };
			if (status) entry.unpaid = isUnpaidStatus(status);
			entries.push(entry);
		}
	}
	return { entries, problems, leftOut };
}

export type RosterParseResult =
	| {
			ok: true;
			header: string[];
			columns: ColumnMap;
			entries: RosterEntry[];
			problems: RosterProblem[];
			leftOut: RosterLeftOut[];
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
	/** A ♿ special-needs request belongs to it. */
	request: boolean;
	/** The shop's order isn't paid yet (orders.unpaid): the code can't sign in. */
	unpaid: boolean;
	/** An admin marked it paid by hand (and it still is). */
	paidByHand: PaidByHand | null;
}

/**
 * The Membership Team confirmed the payment in person and an admin marked the
 * ticket paid on the Tickets page (orders.marked_paid_at/by), while the shop
 * may still list the order as pending.
 */
export interface PaidByHand {
	/** ISO time of the mark. */
	at: string;
	/** The admin's e-mail address. */
	by: string;
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
	/** What the ticket will be afterwards: not paid yet, so its code can't sign in. */
	unpaid: boolean;
	/** The payment state changes (changed tickets only): paid → unpaid, or back. */
	unpaidChanged: boolean;
	/** The ticket was marked paid by hand (changed tickets only). */
	paidByHand: PaidByHand | null;
	/**
	 * The file still lists the order as pending although an admin marked the
	 * ticket paid by hand. The import keeps it paid — its address and name
	 * still change — unless the review chose 💳 Set back to unpaid for it
	 * (importRoster's `undoPaid`, its own decision like 🔁 New holder).
	 */
	undoesPaidByHand: boolean;
	/** The file lists as paid what an admin marked paid by hand: the import drops the mark. */
	confirmsPaidByHand: boolean;
	hasSpot: boolean;
	telegram: boolean;
	request: boolean;
	/**
	 * The address changes on a ticket that has something of its holder: a
	 * spot, a Telegram link or a ♿ request — also when it had no address yet
	 * (the crew may have cleared a wrong one). Not ticked in advance
	 * (defaultRosterSelection): taking it over needs a decision.
	 */
	needsTick: boolean;
	/**
	 * Like needsTick, but the address REPLACES one: only then can the ticket
	 * go to somebody else, so only then the review offers 🔁 New holder.
	 */
	canBeNewHolder: boolean;
	/**
	 * Pre-selected "passed on": address AND name change, like a ticket transfer
	 * in the shop — or the address changes and the file has no name to tell.
	 */
	suggestNewHolder: boolean;
}

export interface RosterDiff {
	changes: RosterChange[];
	unchanged: { code: string; line: number }[];
	/** Lines that can't be imported: broken, or in conflict with the stored tickets. */
	problems: RosterProblem[];
	/**
	 * Stored tickets the file doesn't list. The import leaves them alone unless
	 * the review ticks them for removal — which refers to `id`, because the
	 * preview shortens their codes (previewRoster).
	 */
	notInFile: {
		id: string;
		code: string;
		hasSpot: boolean;
		status?: string;
		/** Marked paid by hand: not deleted until the mark is taken back. */
		paidByHand?: PaidByHand;
	}[];
	/** Addresses used by several tickets of the file (allowed, worth a look). */
	sharedEmails: { email: string; codes: string[] }[];
	/**
	 * Rows the shop lists as cancelled, expired, …: left out. `stored`: the
	 * ticket is in the database (it is also under notInFile, where it can be
	 * deleted).
	 */
	leftOut: (RosterLeftOut & { stored: boolean })[];
	/**
	 * Tickets of the file that are unpaid once it is imported: new ones the shop
	 * lists as not paid yet, and stored ones that are (or turn) unpaid. Their
	 * codes can't sign in until a later list shows them as paid. Not the ones
	 * marked paid by hand: the import keeps them paid unless they are ticked.
	 */
	unpaid: number;
}

/**
 * What importing `entries` would change. Empty cells keep what is stored; codes
 * are matched exactly, a code that differs from a stored one only in upper and
 * lower case is a problem (the sign-in could mix them up).
 */
export function diffRoster(
	entries: RosterEntry[],
	stored: StoredTicket[],
	problems: RosterProblem[] = [],
	leftOut: RosterLeftOut[] = []
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
	let unpaid = 0;

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
			if (entry.unpaid) unpaid++;
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
				unpaid: !!entry.unpaid,
				unpaidChanged: false,
				paidByHand: null,
				undoesPaidByHand: false,
				confirmsPaidByHand: false,
				hasSpot: false,
				telegram: false,
				request: false,
				needsTick: false,
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
		// A paid order frees the code, a pending one locks it again; an empty
		// status cell leaves the ticket as it is.
		const isUnpaid = entry.unpaid ?? ticket.unpaid;
		const unpaidChanged = isUnpaid !== ticket.unpaid;
		// A payment the crew confirmed in person: a list that still says pending
		// only locks the code again when the review ticks it on purpose; one
		// that says paid has caught up, and the mark goes.
		const paidByHand = ticket.unpaid ? null : ticket.paidByHand;
		const undoesPaidByHand = !!paidByHand && isUnpaid;
		const confirmsPaidByHand = !!paidByHand && entry.unpaid === false;
		// Kept paid unless the review chooses otherwise: not counted.
		if (isUnpaid && !undoesPaidByHand) unpaid++;
		if (!emailChanged && !nameChanged && !unpaidChanged && !confirmsPaidByHand) {
			unchanged.push({ code: entry.code, line: entry.line });
			continue;
		}
		const needsTick = emailChanged && (ticket.hasSpot || ticket.telegram || ticket.request);
		const canBeNewHolder = needsTick && !!ticket.email;
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
			unpaid: isUnpaid,
			unpaidChanged,
			paidByHand,
			undoesPaidByHand,
			confirmsPaidByHand,
			hasSpot: ticket.hasSpot,
			telegram: ticket.telegram,
			request: ticket.request,
			needsTick,
			canBeNewHolder,
			suggestNewHolder:
				canBeNewHolder &&
				(entry.name ? nameChanged && ticket.name !== defaultTicketName(ticket.code) : true)
		});
	}

	const statusOf = new Map(leftOut.map((row) => [row.code.toLowerCase(), row.status]));
	const notInFile = stored
		.filter((ticket) => !inFile.has(ticket.code.toLowerCase()))
		.map((ticket) => {
			const status = statusOf.get(ticket.code.toLowerCase());
			const item: RosterDiff['notInFile'][number] = {
				id: ticket.id,
				code: ticket.code,
				hasSpot: ticket.hasSpot
			};
			if (status) item.status = status;
			if (ticket.paidByHand && !ticket.unpaid) item.paidByHand = ticket.paidByHand;
			return item;
		})
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
	const storedKeys = new Set(byKey.keys());
	return {
		changes,
		unchanged,
		problems: allProblems,
		notInFile,
		sharedEmails,
		leftOut: leftOut.map((row) => ({ ...row, stored: storedKeys.has(row.code.toLowerCase()) })),
		unpaid
	};
}

/**
 * Selection the review starts with: every new and changed ticket — except a
 * new address on a ticket that carries something of its holder (a spot, a
 * Telegram link, a ♿ request), also where it had none before (needsTick). Taking that over can mean a hand-over, or undo
 * an address the crew corrected in the app, so it needs a deliberate tick.
 * Its 🔁 New holder switch is still preset, for when it is ticked. Also left
 * out: a ticket marked paid by hand whose only change is that the file still
 * lists it as pending (undoesPaidByHand) — the shop may just not know about
 * the payment yet. Its 💳 Set back to unpaid switch always starts off: that
 * is a decision of its own, never part of a tick.
 */
export function defaultRosterSelection(diff: RosterDiff): {
	selected: string[];
	newHolders: string[];
} {
	return {
		selected: diff.changes
			.filter(
				(change) =>
					!change.needsTick &&
					!(change.undoesPaidByHand && !change.emailChanged && !change.nameChanged)
			)
			.map((c) => c.key),
		newHolders: diff.changes.filter((change) => change.suggestNewHolder).map((c) => c.key)
	};
}

// --- what the admin area shows (server results) -----------------------------------

export interface TicketSpot {
	house: string;
	room: string;
	spot: string;
	roomId: string;
	/** The crew checked the holder in at arrival: when and by which admin. */
	checkIn: { at: string; by: string } | null;
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
	/**
	 * The shop's order isn't paid yet: the code can't sign in until a later
	 * ticket list shows it as paid, or an admin marks it paid by hand.
	 */
	unpaid: boolean;
	/** An admin marked it paid by hand (only while it is paid). */
	paidByHand: PaidByHand | null;
	spot: TicketSpot | null;
	burnerName: string;
	telegram: boolean;
	/**
	 * The booking pass as it is written, "7F3K-9QXM-2CWD", or '' when the ticket
	 * has none yet (pb_hooks/cozy_pass.pb.js makes one with the first spot).
	 * Admins see it so the crew can check a guest in whose phone is dead
	 * (docs/admin/passes.md).
	 */
	passCode: string;
}

export interface TicketSearch {
	/** booking: opened from a booked spot (Open ticket); `query` names the spot. */
	by: 'code' | 'email' | 'booking';
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
	/** The old holder was checked in: the new holder checks in with the new pass. */
	checkInReset: boolean;
	/** The new address will get a confirmation of the ticket's spot. */
	confirmation: boolean;
}

export interface TicketPaidOutcome {
	ticket: TicketView;
	/** Code for the audit log, masked. */
	maskedCode: string;
	/** What was asked: marked paid (true), or set back to unpaid (false). */
	paid: boolean;
	/** False when the ticket already was in that state (a second click, another admin). */
	changed: boolean;
}

export interface RosterPreview {
	diff: RosterDiff;
	/** Tickets in the database now. */
	stored: number;
}

export interface RosterImportOutcome {
	created: number;
	updated: number;
	/** Stored tickets the file no longer lists, deleted on request (no spot, superusers only). */
	removed: number;
	/** Updated tickets that were handed over to a new holder. */
	newHolders: number;
	/** Handed-over tickets whose old holder's special-needs request was deleted. */
	requestsRemoved: number;
	/** New addresses of tickets that hold a spot: they get a confirmation. */
	confirmations: number;
	/** Tickets created or updated that are unpaid now: their codes can't sign in. */
	unpaid: number;
	/** Tickets that were unpaid and are paid now: their codes sign in again. */
	nowPaid: number;
	/** Tickets marked paid by hand that the list now shows as paid too: the mark went. */
	paidConfirmed: number;
	/**
	 * Tickets marked paid by hand that the list still shows as pending, kept
	 * paid (their address and name changes were taken over): the review didn't
	 * choose 💳 Set back to unpaid for them.
	 */
	keptPaid: number;
	/** Tickets marked paid by hand that the review set back to unpaid; masked codes. */
	paidUndone: { id: string; code: string }[];
	/** Selected, but nothing (or no longer anything) to change. */
	skipped: number;
	failed: { code: string; error: string }[];
}
