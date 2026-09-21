// tests/layout/stress-data.ts — a camp full of awkward names for the layout test.
//
// Real guests and crews type long burner names, German compound words, e-mail
// addresses and emoji. Every text below is at (or near) the limit the app
// accepts, so a layout that survives this camp survives the real one.
// Structure goes straight into the (throwaway) PocketBase; bookings and
// special-needs requests go through the app, which encrypts what it stores.
import PocketBase from 'pocketbase';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { BURNER_NAME_MAX } from '../../src/lib/special-needs';
import { TEMPLATE_LIMITS } from '../../src/lib/template';
import { TICKET_LIMITS } from '../../src/lib/tickets';

export const TEXTS = {
	houseLong:
		'Die wunderbare Waldhütte am Seeufer mit Blick auf den Brahmsee und die Feuerstelle (Nordseite)',
	houseCompound: 'Kuschelzeltplatzverwaltungsgebäude',
	houseShort: 'A',
	roomLong:
		'Schlafsaal mit den vielen knarzenden Etagenbetten unter dem Dach, gleich neben der Treppe',
	burnerLong: 'Captain Glitterbeard von Hamburg-Altona, Keeper of the Disco Ball & Moop Patrol',
	burnerWord: 'Supercalifragilisticexpialidocious',
	burnerEmoji: '🦄✨ Unicorn Queen ✨🦄',
	burnerMine: 'Sparkle Pony Extraordinaire',
	customerLong: 'Maximilian-Alexander Freiherr von und zu Musterstadt-Langenhagen-Ost',
	emailLong:
		'maximilian.alexander.freiherr.von.und.zu.musterstadt@a-very-long-subdomain.example.org',
	requestText:
		'I use a wheelchair, so I need step-free access from the parking area to the room and to a toilet. A lower bed would be great, too — thank you so much for sorting this out!'
};

/** Spot labels of the stress room, in the order of its beds. */
export const BED_LABELS = [
	'Upper 1',
	'Upper 2',
	'Lower 1',
	'Lower 2',
	'Hängematte oben links am Fenster',
	'Doppelbett-Fensterseite-Nord-mit-Blick-auf-den-See',
	'Kuschelzeltplatzverwaltungsbett',
	'1',
	'Sofa'
] as const;

for (const [what, value, max] of [
	['house name', TEXTS.houseLong, TEMPLATE_LIMITS.houseNameLength],
	['room name', TEXTS.roomLong, TEMPLATE_LIMITS.roomNameLength],
	['burner name', TEXTS.burnerLong, BURNER_NAME_MAX],
	['customer name', TEXTS.customerLong, TICKET_LIMITS.nameLength],
	['e-mail', TEXTS.emailLong, TICKET_LIMITS.emailLength],
	...BED_LABELS.map((label) => ['spot label', label, TEMPLATE_LIMITS.bedLabelLength] as const)
] as const) {
	if (value.length > max) throw new Error(`stress ${what} is longer than the app allows: ${value}`);
}

/** Where the setup project leaves the camp for the page tests. */
export const CAMP_FILE =
	process.env.LAYOUT_CAMP_FILE ||
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/layout-camp.json');

export interface StressCamp {
	houseId: string;
	houseName: string;
	roomId: string;
	/** Houses and rooms without the stress guest's spot (the "you already have a spot" banner). */
	otherHouseIds: string[];
	otherRoomIds: string[];
	/** Cookie values (not headers) for the browser: the ticket codes. */
	guestWithSpot: string;
	guestWithoutSpot: string;
	guestWithRequest: string;
	/** The booking round those codes were signed in for (cookie bookingRound). */
	guestRound: string;
	passCode: string;
	adminAuth: string;
	superuserAuth: string;
}

function uid(): string {
	return crypto.randomBytes(4).toString('hex');
}

export async function superuser(pbUrl: string, email: string, password: string) {
	const pb = new PocketBase(pbUrl);
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(email, password);
	return pb;
}

/** A ticket list as the ticket shop exports it: one ticket handed over, two new. */
export function stressTicketList(camp: StressCamp): string {
	const rows = [
		['Ticket code', 'E-mail', 'Name'],
		[camp.guestWithSpot, `new.${TEXTS.emailLong}`, `${TEXTS.customerLong} der Zweite`],
		[`${camp.guestWithSpot}-NEW`, TEXTS.emailLong, TEXTS.customerLong],
		[`${camp.guestWithoutSpot}-NEW`, 'oe@example.org', 'Ö']
	];
	return rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n') + '\n';
}

/** A layout file that renames the stress house's room and adds a long-named house. */
export function stressLayoutFile(camp: StressCamp): string {
	const beds = (labels: readonly string[]) => labels.map((label) => ({ label }));
	return JSON.stringify({
		format: 'cozynights-layout',
		version: '2.0',
		name: TEXTS.houseLong,
		houses: [
			{
				name: camp.houseName,
				x: 12,
				y: 330,
				rooms: [{ name: `${TEXTS.roomLong} (neu)`, room_number: 1, beds: beds(BED_LABELS) }]
			},
			{
				name: `${TEXTS.houseCompound}erweiterungsbau`,
				x: 700,
				y: 420,
				rooms: [{ name: TEXTS.roomLong, room_number: 2, beds: beds(BED_LABELS.slice(4)) }]
			}
		]
	});
}

/** A form post like a browser's (303/200 as HTML, not SvelteKit's JSON). */
async function post(
	base: string,
	path: string,
	fields: Record<string, string> | URLSearchParams,
	cookie = ''
) {
	const res = await fetch(base + path, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			accept: 'text/html',
			'content-type': 'application/x-www-form-urlencoded',
			origin: base,
			...(cookie ? { cookie } : {})
		},
		body: new URLSearchParams(fields).toString()
	});
	if (res.status >= 400) {
		throw new Error(`POST ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
	}
	return res;
}

/**
 * Signs a guest in like a browser does: the answer sets the ticket code and the
 * booking round it belongs to, and both ride along from then on. The smoke
 * suite runs first on the same stack and releases bookings, which starts a new
 * round — a code sent without its round counts as signed out.
 */
async function guestLogin(
	base: string,
	code: string
): Promise<{ code: string; round: string; header: string }> {
	const res = await post(base, '/?/login', { bookingCode: code });
	const pairs = res.headers.getSetCookie().map((c) => c.split(';')[0]);
	const value = (name: string) =>
		pairs.find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);
	const signedIn = value('bookingCode');
	if (!signedIn) throw new Error(`guest login with ${code} failed`);
	const round = value('bookingRound') ?? '0';
	return { code: signedIn, round, header: `bookingCode=${signedIn}; bookingRound=${round}` };
}

async function ticket(pb: PocketBase, customerName = 'Test Guest', email = '') {
	const code = `LAYOUT-${uid().toUpperCase()}`;
	const order = await pb
		.collection('orders')
		.create({ order_number: code, customer_name: customerName, ...(email ? { email } : {}) });
	return { code, order };
}

/** Approved admin (or superuser) session, as the app's `pb_auth` cookie value. */
async function adminSession(pb: PocketBase, role: 'admin' | 'superuser', email: string) {
	const password = crypto.randomBytes(24).toString('hex'); // never used: login is Google-only
	const record = await pb
		.collection('admins')
		.create({ email, password, passwordConfirm: password, role: 'pending' });
	await pb.collection('admins').update(record.id, { role, last_sign_in: new Date().toISOString() });
	const client = await pb.collection('admins').impersonate(record.id, 3600);
	const { token, record: model } = client.authStore;
	return encodeURIComponent(JSON.stringify({ token, record: model }));
}

async function setWindow(pb: PocketBase, fields: Record<string, unknown>) {
	await pb.collection('app_settings').update(APP_SETTINGS_ID, fields);
}

/**
 * The booking phase as the Control Center sets it. `opening` is Staging with
 * the opening timer armed, `closing` Live with the closing timer armed: they
 * bring the countdowns (start page, map, the bar on top of every page).
 * `reopening` is Closed with an opening armed — a window planned while booking
 * was closed, where guests read a countdown instead of "spots are final".
 */
export type Phase = 'staging' | 'live' | 'closed' | 'opening' | 'closing' | 'reopening';

export async function setPhase(pb: PocketBase, phase: Phase) {
	const inTwoDays = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
	await setWindow(pb, {
		is_booking_active: phase === 'live' || phase === 'closing',
		booking_closed: phase === 'closed' || phase === 'reopening',
		booking_unlock_at: phase === 'opening' || phase === 'reopening' ? inTwoDays : '',
		booking_close_at: phase === 'closing' ? inTwoDays : '',
		booking_timer_paused: false
	});
}

export async function seedStressCamp(base: string, pb: PocketBase): Promise<StressCamp> {
	const tag = uid();
	// Houses on all four edges of the map (0–1000 × 0–700): their labels must
	// stay on the map. Far enough apart that labels don't cover each other.
	const house = await pb
		.collection('houses')
		.create({ name: `${TEXTS.houseLong.slice(0, 90)} ${tag}`, x: 12, y: 330 });
	const otherHouseIds: string[] = [];
	const otherRoomIds: string[] = [];
	for (const [name, x, y] of [
		[TEXTS.houseCompound, 990, 250],
		[TEXTS.houseShort, 520, 695],
		[`Villa Kunterbunt ${tag}`, 480, 6]
	] as const) {
		const other = await pb.collection('houses').create({ name, x, y });
		const room = await pb
			.collection('rooms')
			.create({ name: 'Dachboden', room_number: 1, house: other.id, amount_beds: 2 });
		for (const label of ['Upper 1', 'Lower 1']) {
			await pb.collection('beds').create({ label, room: room.id, enabled: true, occupied: false });
		}
		otherHouseIds.push(other.id);
		otherRoomIds.push(room.id);
	}
	const room = await pb.collection('rooms').create({
		name: TEXTS.roomLong,
		room_number: TEMPLATE_LIMITS.roomNumber,
		house: house.id,
		amount_beds: BED_LABELS.length
	});
	const beds: Record<string, string> = {};
	for (const label of BED_LABELS) {
		const bed = await pb.collection('beds').create({
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: label === 'Upper 1',
			is_special: label.startsWith('Doppelbett')
		});
		beds[label] = bed.id;
	}

	// Bookings: other guests with awkward burner names, and "me".
	await setPhase(pb, 'live');
	const book = async (label: string, burnerName: string, customer?: string, email?: string) => {
		const t = await ticket(pb, customer, email);
		const session = await guestLogin(base, t.code);
		await post(
			base,
			`/room/${room.id}?/bookBed`,
			{ bedId: beds[label], guestName: burnerName },
			session.header
		);
		return { ...t, cookie: session.code, round: session.round };
	};
	await book('Upper 2', TEXTS.burnerLong);
	await book('Lower 1', TEXTS.burnerWord);
	await book('Kuschelzeltplatzverwaltungsbett', 'Ö');
	await book('1', TEXTS.burnerEmoji);
	const mine = await book('Lower 2', TEXTS.burnerMine, TEXTS.customerLong, TEXTS.emailLong);
	const passCode = (await pb.collection('orders').getOne(mine.order.id)).pass_code as string;

	const guestWithoutSpot = (await guestLogin(base, (await ticket(pb)).code)).code;

	// A special-needs request (pending), written through the app like a guest does.
	await setWindow(pb, { special_requests_open: true });
	const asker = await ticket(pb, TEXTS.customerLong, TEXTS.emailLong);
	const requester = await guestLogin(base, asker.code);
	const form = new URLSearchParams({
		text: TEXTS.requestText,
		burnerName: TEXTS.burnerLong,
		consent: 'yes'
	});
	for (const need of ['lower_bunk', 'step_free', 'near_toilet', 'power'])
		form.append('needs', need);
	await post(base, '/special-needs?/save', form, requester.header);

	return {
		houseId: house.id,
		houseName: house.name as string,
		roomId: room.id,
		otherHouseIds,
		otherRoomIds,
		guestWithSpot: mine.cookie,
		guestWithoutSpot,
		guestWithRequest: requester.code,
		// Nothing in the seed releases bookings, so every sign-in above got the same round.
		guestRound: mine.round,
		passCode,
		adminAuth: await adminSession(pb, 'admin', `layout-admin-${tag}@mauersegler.art`),
		superuserAuth: await adminSession(
			pb,
			'superuser',
			`a.very.long.crew.address.for.the.layout.test.${tag}@mauersegler.art`
		)
	};
}
