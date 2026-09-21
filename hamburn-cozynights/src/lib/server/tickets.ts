// src/lib/server/tickets.ts
/**
 * The ticket roster (collection `orders`) for the admin area
 * (docs/admin/tickets.md): find a ticket by its code or e-mail address, change
 * its address and name, hand it over to a new holder, and import the ticket
 * shop's CSV list after a review. Orders are superuser-only in PocketBase, so
 * everything here runs on the app's service account; the callers check the
 * admin's rights first.
 *
 * E-mails go out from PocketBase: a new address on a ticket that holds a spot
 * gets a confirmation (pb_hooks/cozy_notify.pb.js).
 */
import type { ClientResponseError } from 'pocketbase';
import type {
	BedsResponse,
	HousesResponse,
	OrdersResponse,
	RoomsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import { createLookupHash, decrypt } from '$lib/server/crypto';
import { BookingService } from '$lib/server/booking';
import { disconnectTelegram } from '$lib/server/notifications';
import { checkInOf } from '$lib/server/pass';
import { forgetRequest } from '$lib/server/special-requests';
import {
	TICKET_CODE_PATTERN,
	TICKET_LIMITS,
	checkRosterRows,
	cleanTicketCode,
	defaultTicketName,
	diffRoster,
	holderName,
	isValidGuestEmail,
	maskTicketCode,
	normalizeEmail,
	type RosterImportOutcome,
	type RosterPreview,
	type RosterRow,
	type StoredTicket,
	type TicketChangeOutcome,
	type TicketSearch,
	type TicketSpot,
	type TicketView
} from '$lib/tickets';

/** Results of one search; more is a hint that the search was too broad. */
const MAX_RESULTS = 50;
/** Parallel writes of a roster import: quick, without flooding PocketBase and its hooks. */
const IMPORT_CONCURRENCY = 4;

/** A request the admin can fix (bad input, stale page). `message` is written for them. */
export class TicketError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
		this.name = 'TicketError';
	}
}

const isNotFound = (err: unknown) => (err as ClientResponseError | undefined)?.status === 404;

type BedWithRoom = BedsResponse<{ room?: RoomsResponse<{ house?: HousesResponse }> }>;

async function describeTicket(
	adminPb: TypedPocketBase,
	order: OrdersResponse,
	maskCode: boolean
): Promise<TicketView> {
	const [beds, links] = await Promise.all([
		adminPb.collection('beds').getFullList<BedWithRoom>({
			filter: adminPb.filter('order = {:id}', { id: order.id }),
			expand: 'room.house',
			sort: '-updated',
			requestKey: null
		}),
		adminPb
			.collection('guest_notify')
			.getFullList({
				filter: adminPb.filter('order = {:id} && tg_chat != ""', { id: order.id }),
				fields: 'id',
				requestKey: null
			})
			// Before the notifications migration there is nothing to link.
			.catch(() => [])
	]);

	const bed = beds[0];
	let spot: TicketSpot | null = null;
	if (bed) {
		const room = bed.expand?.room;
		const number = room?.room_number ? ` #${room.room_number}` : '';
		spot = {
			house: room?.expand?.house?.name ?? '',
			room: room ? `${room.name}${number}` : '',
			spot: bed.label,
			roomId: bed.room,
			checkIn: checkInOf(bed)
		};
	}

	let burnerName = '';
	if (order.burner_name) {
		try {
			burnerName = decrypt(order.burner_name);
		} catch {
			burnerName = '(unreadable)';
		}
	}

	const code = order.order_number ?? '';
	const name = holderName(order);
	return {
		id: order.id,
		code: maskCode ? maskTicketCode(code) : code,
		codeMasked: maskCode,
		name,
		email: order.email ?? '',
		signedIn: !!order.order_hash,
		spot,
		burnerName,
		telegram: links.length > 0,
		pass: !!order.pass_code
	};
}

/**
 * Every ticket with what the search needs. The roster is small (hundreds), and
 * matching here keeps codes and addresses out of request URLs: PocketBase
 * logs those, and so do errors.
 */
async function loadSearchIndex(adminPb: TypedPocketBase): Promise<OrdersResponse[]> {
	return adminPb.collection('orders').getFullList<OrdersResponse>({
		fields: 'id,order_number,order_hash,customer_name,email,burner_name,pass_code',
		batch: 1000,
		requestKey: null
	});
}

/**
 * Finds tickets by their code (exact, in any upper and lower case) or by their
 * e-mail address (exact). Codes of tickets found by their address are masked:
 * an address must not reveal somebody's sign-in.
 */
export async function searchTickets(adminPb: TypedPocketBase, raw: unknown): Promise<TicketSearch> {
	const text = cleanTicketCode(raw);
	if (!text) throw new TicketError('Type a ticket code or an e-mail address.');

	let by: TicketSearch['by'];
	let query: string;
	let matches: (order: OrdersResponse) => boolean;
	if (text.includes('@')) {
		const email = normalizeEmail(text);
		if (!isValidGuestEmail(email)) {
			throw new TicketError(`"${text.slice(0, 80)}" is not a complete e-mail address.`);
		}
		by = 'email';
		query = email;
		matches = (order) => (order.email ?? '').toLowerCase() === email;
	} else {
		if (!TICKET_CODE_PATTERN.test(text)) {
			throw new TicketError(
				'Ticket codes only contain letters, digits, "-" and "_" (at most 64). For an e-mail address, type the whole address.'
			);
		}
		// Any upper/lower case: stored codes never differ only in case (the CLI
		// and the import refuse that), so this can't mix two tickets up. The
		// hashes find tickets whose code is only stored as the sign-in hash.
		const lower = text.toLowerCase();
		const hashes = [...new Set([text, text.toUpperCase(), lower])].map(createLookupHash);
		by = 'code';
		query = text;
		matches = (order) =>
			(order.order_number ?? '').toLowerCase() === lower || hashes.includes(order.order_hash ?? '');
	}

	const found = (await loadSearchIndex(adminPb)).filter(matches).sort((a, b) =>
		// The exact spelling first, then by code.
		by === 'code'
			? Number(b.order_number === text) - Number(a.order_number === text) ||
				(a.order_number ?? '').localeCompare(b.order_number ?? '')
			: (a.order_number ?? '').localeCompare(b.order_number ?? '')
	);
	const shown = found.slice(0, MAX_RESULTS);
	return {
		by,
		query,
		tickets: await Promise.all(
			shown.map((order) => describeTicket(adminPb, order, by === 'email'))
		),
		more: found.length > shown.length
	};
}

export interface TicketChangeInput {
	email: unknown;
	name: unknown;
	/** The ticket went to somebody else: forget what belonged to the old holder. */
	newHolder: boolean;
}

/** Checks an address typed by an admin; '' removes the ticket's address. */
export function readEmailInput(raw: unknown): string {
	const email = normalizeEmail(raw);
	if (email && !isValidGuestEmail(email)) {
		throw new TicketError(`"${email.slice(0, 80)}" is not a valid e-mail address.`);
	}
	return email;
}

function readNameInput(raw: unknown): string {
	const name = (typeof raw === 'string' ? raw : '').trim();
	if (name.length > TICKET_LIMITS.nameLength) {
		throw new TicketError(`The name is too long (at most ${TICKET_LIMITS.nameLength} characters).`);
	}
	return name;
}

/**
 * The fields that hand a ticket over to a new holder: a new booking pass (the
 * old link stops working; PocketBase creates the next code on demand) and no
 * burner name. The Telegram link and the check-in go before them
 * (disconnectTelegram, BookingService.resetCheckIn): the new holder checks in
 * with the new pass.
 */
const NEW_HOLDER_FIELDS = { pass_code: '', burner_name: '' } as const;

/**
 * What a hand-over leaves for PocketBase: the first message to the new address
 * tells them the ticket was passed on to them, instead of confirming a booking
 * they never made (pb_hooks/lib/notify.js, which clears the mark once it is
 * used). The server CLI writes the same fields.
 */
function newHolderFields(): Record<string, string> {
	return { ...NEW_HOLDER_FIELDS, handed_over_at: new Date().toISOString() };
}

/**
 * Changes a ticket's address and name. With `newHolder`, also disconnects the
 * old holder's Telegram, invalidates their booking pass and forgets their
 * burner name; the spot stays with the ticket.
 */
export async function changeTicket(
	adminPb: TypedPocketBase,
	id: string,
	input: TicketChangeInput
): Promise<TicketChangeOutcome> {
	const email = readEmailInput(input.email);
	const typedName = readNameInput(input.name);

	let order: OrdersResponse;
	try {
		order = await adminPb.collection('orders').getOne<OrdersResponse>(id);
	} catch (err) {
		if (isNotFound(err)) {
			throw new TicketError('This ticket no longer exists. Search again.', 404);
		}
		throw err;
	}

	const code = order.order_number ?? '';
	const name = typedName || defaultTicketName(code);
	const emailBefore = order.email ?? '';
	const emailChanged = email !== emailBefore.toLowerCase();
	const nameChanged = name !== order.customer_name;

	const data: Record<string, string> = {};
	if (emailChanged) data.email = email;
	if (nameChanged) data.customer_name = name;
	if (input.newHolder) Object.assign(data, newHolderFields());

	let requestRemoved = false;
	let checkInReset = false;
	if (Object.keys(data).length > 0) {
		if (input.newHolder) {
			// Telegram first: no update about the new holder may reach the old chat.
			await disconnectTelegram(adminPb, order.id);
			// Then the old holder's special-needs request (their health data):
			// before the address changes, so the new holder is never told its
			// status. A spot the crew booked stays, as an ordinary booking.
			requestRemoved = await forgetRequest(adminPb, order.id);
			// The old holder's check-in: the new holder hasn't arrived yet.
			checkInReset = await new BookingService(adminPb).resetCheckIn(order.id);
		}
		order = await adminPb.collection('orders').update<OrdersResponse>(order.id, data);
	}

	// Masked like a search by address: the answer to a change must not hand out
	// the code of a ticket the admin only found by its address. The page keeps
	// showing the code the admin typed.
	const ticket = await describeTicket(adminPb, order, true);
	return {
		ticket,
		maskedCode: maskTicketCode(code),
		emailBefore,
		emailChanged,
		nameChanged,
		newHolder: input.newHolder,
		requestRemoved,
		checkInReset,
		confirmation: emailChanged && !!email && !!ticket.spot
	};
}

// --- the roster import ------------------------------------------------------------

/** Every stored ticket, with what the review needs to know about it. */
export async function loadStoredTickets(adminPb: TypedPocketBase): Promise<StoredTicket[]> {
	const [orders, beds, links] = await Promise.all([
		adminPb.collection('orders').getFullList<OrdersResponse>({
			fields: 'id,order_number,email,customer_name',
			batch: 1000,
			requestKey: null
		}),
		adminPb.collection('beds').getFullList({
			filter: 'order != ""',
			fields: 'order',
			batch: 1000,
			requestKey: null
		}),
		adminPb
			.collection('guest_notify')
			.getFullList({ filter: 'tg_chat != ""', fields: 'order', batch: 1000, requestKey: null })
			.catch(() => [])
	]);
	const booked = new Set(beds.map((bed) => bed.order));
	const linked = new Set(links.map((link) => link.order));
	return orders
		.filter((order) => !!order.order_number)
		.map((order) => ({
			id: order.id,
			code: order.order_number,
			email: order.email ?? '',
			name: order.customer_name ?? '',
			hasSpot: booked.has(order.id),
			telegram: linked.has(order.id)
		}));
}

/** Longest cell kept from the browser: longer than any valid value, so checks still see it. */
const MAX_CELL = 400;

/**
 * The rows the browser read from the file (readRosterFile): only line, code,
 * e-mail and name. Checked for shape and size here; the content is checked by
 * checkRosterRows like any file.
 */
export function readRosterRows(payload: unknown): RosterRow[] {
	let value = payload;
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			value = null;
		}
	}
	if (!Array.isArray(value) || value.length === 0) {
		throw new TicketError('No tickets arrived. Choose the file again.');
	}
	if (value.length > TICKET_LIMITS.rows) {
		throw new TicketError(
			`The file has ${value.length} tickets, the limit is ${TICKET_LIMITS.rows}. Split it into smaller files.`
		);
	}
	const text = (cell: unknown) => (typeof cell === 'string' ? cell.slice(0, MAX_CELL) : '');
	return value.map((row, index) => {
		const r = (row ?? {}) as Record<string, unknown>;
		const line =
			Number.isInteger(r.line) && (r.line as number) > 0 ? (r.line as number) : index + 2;
		return { line, code: text(r.code), email: text(r.email), name: text(r.name) };
	});
}

/** What importing the rows would change. Changes nothing. */
export async function previewRoster(
	adminPb: TypedPocketBase,
	rows: RosterRow[]
): Promise<RosterPreview> {
	const { entries, problems } = checkRosterRows(rows);
	const stored = await loadStoredTickets(adminPb);
	const diff = diffRoster(entries, stored, problems);
	// The file doesn't have these codes: only show enough to recognise them.
	diff.notInFile = diff.notInFile.map((ticket) => ({
		...ticket,
		code: maskTicketCode(ticket.code)
	}));
	return { diff, stored: stored.length };
}

function describeError(err: unknown): string {
	const failure = err as {
		status?: number;
		message?: string;
		response?: { message?: string; data?: Record<string, { message?: string }> };
	};
	if (failure?.status === 0) return 'the database did not answer';
	const fields = Object.entries(failure?.response?.data ?? {}).map(
		([field, problem]) => `${field}: ${problem?.message ?? 'not accepted'}`
	);
	if (fields.length > 0) return fields.join('; ');
	return failure?.response?.message || failure?.message || 'unknown error';
}

async function inPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await work(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

let importRunning = false;

/**
 * Imports the selected rows. They are checked and compared again here — the
 * review in the browser is only a courtesy — so a ticket that changed
 * meanwhile gets what the file says, and one that needs nothing anymore is
 * skipped.
 */
export async function importRoster(
	adminPb: TypedPocketBase,
	rows: RosterRow[],
	options: { selected: string[]; newHolders: string[] }
): Promise<RosterImportOutcome> {
	if (importRunning) {
		throw new TicketError(
			'Another ticket import is running right now. Wait until it has finished, then check again.',
			409
		);
	}
	importRunning = true;
	try {
		const { entries, problems } = checkRosterRows(rows);
		const diff = diffRoster(entries, await loadStoredTickets(adminPb), problems);
		const wanted = new Set(options.selected.map((key) => String(key).toLowerCase()));
		const handOver = new Set(options.newHolders.map((key) => String(key).toLowerCase()));
		const todo = diff.changes.filter((change) => wanted.has(change.key));

		const outcome: RosterImportOutcome = {
			created: 0,
			updated: 0,
			newHolders: 0,
			requestsRemoved: 0,
			confirmations: 0,
			skipped: wanted.size - todo.length,
			failed: []
		};

		await inPool(todo, IMPORT_CONCURRENCY, async (change) => {
			try {
				if (change.kind === 'new') {
					await adminPb.collection('orders').create({
						order_number: change.code,
						customer_name: change.name,
						email: change.email
					});
					outcome.created++;
					return;
				}
				const id = change.id as string;
				const newHolder = change.canBeNewHolder && handOver.has(change.key);
				const data: Record<string, string> = {};
				if (change.emailChanged) data.email = change.email;
				if (change.nameChanged) data.customer_name = change.name;
				let requestRemoved = false;
				if (newHolder) {
					Object.assign(data, newHolderFields());
					await disconnectTelegram(adminPb, id);
					// the old holder's health data goes with them, before the
					// address changes (see changeTicket)
					requestRemoved = await forgetRequest(adminPb, id);
					await new BookingService(adminPb).resetCheckIn(id);
				}
				await adminPb.collection('orders').update(id, data);
				outcome.updated++;
				if (newHolder) {
					outcome.newHolders++;
					if (requestRemoved) outcome.requestsRemoved++;
				}
				if (change.emailChanged && change.email && change.hasSpot) outcome.confirmations++;
			} catch (err) {
				console.error(`[Tickets] Import of ${maskTicketCode(change.code)} failed:`, err);
				outcome.failed.push({ code: change.code, error: describeError(err) });
			}
		});
		return outcome;
	} finally {
		importRunning = false;
	}
}
