// tests/swaps.test.ts — swap requests between guests (docs/admin/swaps.md): the
// rules in $lib/swaps and the service in $lib/server/swaps against an
// in-memory PocketBase. The swap itself (one transaction in PocketBase):
// tests/swap-hook.test.ts; against a real PocketBase with the messages:
// tests/integration/swaps.test.ts.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { decrypt, encrypt } from '../src/lib/server/crypto';
import { CHECKED_IN_NOTE } from '../src/lib/check-in';
import {
	SWAP_DAILY_MAX,
	SWAP_HOURS,
	SWAP_NOTE_MAX,
	cleanSwapNote,
	formatTimeLeft,
	outcomeText,
	pauseText,
	swapNoteProblem,
	swapVibe
} from '../src/lib/swaps';
import {
	acceptSwap,
	askForSwap,
	countIncoming,
	declineSwap,
	forgetSwaps,
	guestSwaps,
	roomSwaps,
	swapPause,
	SwapError,
	withdrawSwap
} from '../src/lib/server/swaps';

const LIVE = { phase: 'live' as const, swapsOff: false };
const HOUR = 60 * 60 * 1000;

/**
 * One house, one room, eight spots. Ada holds B1, Bo B2, Cy B3; Di holds B4,
 * the spot the crew booked for her approved special-needs request; Ed holds
 * the locked B5; Fi is checked in at B6; B7 and B8 are free.
 */
function camp() {
	const pb = new FakePb();
	const house = pb.seed('houses', { name: 'Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 2, house: house.id });
	// FakePb's rows are untyped; the service takes PocketBase records.
	const bed = (label: string, extra: Record<string, unknown> = {}): any =>
		pb.seed('beds', {
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: false,
			order: '',
			checked_in_at: '',
			bed_type: '',
			bunk_partner: '',
			...extra
		});
	const ticket = (code: string, name: string): any =>
		pb.seed('orders', {
			order_number: code,
			customer_name: `${name} Lovelace`,
			email: `${name.toLowerCase()}@example.com`,
			burner_name: encrypt(`${name} Sparkle`),
			no_swap_requests: false
		});
	const ada = ticket('HB-1', 'Ada');
	const bo = ticket('HB-2', 'Bo');
	const cy = ticket('HB-3', 'Cy');
	const di = ticket('HB-4', 'Di');
	const ed = ticket('HB-5', 'Ed');
	const fi = ticket('HB-6', 'Fi');
	const b1 = bed('B1', { occupied: true, order: ada.id });
	const b2 = bed('B2', { occupied: true, order: bo.id, bed_type: 'bunk_lower' });
	const b3 = bed('B3', { occupied: true, order: cy.id });
	const b4 = bed('B4', { occupied: true, order: di.id, is_special: true });
	const b5 = bed('B5', { occupied: true, order: ed.id, is_locked: true });
	const b6 = bed('B6', { occupied: true, order: fi.id, checked_in_at: '2026-10-29 18:00:00.000Z' });
	const b7 = bed('B7');
	const b8 = bed('B8');
	pb.seed('special_requests', { order: di.id, status: 'approved', bed: b4.id });
	const requests = () => pb.rows('swap_requests');
	const ask = (from: { id: string }, to: { id: string }, input = {}) =>
		askForSwap(pb as any, LIVE, from, to.id, { vibe: '', note: '', ...input });
	return { pb, room, ada, bo, cy, di, ed, fi, b1, b2, b3, b4, b5, b6, b7, b8, requests, ask };
}

async function refusal(promise: Promise<unknown>): Promise<SwapError> {
	const outcome = await promise.then(
		() => null,
		(err) => err
	);
	expect(outcome).toBeInstanceOf(SwapError);
	return outcome as SwapError;
}

describe('the rules ($lib/swaps)', () => {
	it('keeps a note to one clean line of at most 140 characters', () => {
		expect(cleanSwapNote('  Hi!\n\nWould   you\tswap? ')).toBe('Hi! Would you swap?');
		expect(cleanSwapNote('a'.repeat(300))).toHaveLength(SWAP_NOTE_MAX);
		expect(cleanSwapNote(42)).toBe('');
		// invisible characters go (a zero-width space, a bell)
		expect(cleanSwapNote(`x${String.fromCharCode(0x200b)}y${String.fromCharCode(7)}z`)).toBe(
			'x y z'
		);
	});

	it('refuses links in every shape, and nothing else', () => {
		for (const note of [
			'see https://evil.example',
			'www.example.org',
			'dm me on t.me/someone',
			'bit.ly/abc',
			'look at example.com'
		]) {
			expect(swapNoteProblem(note), note).toMatch(/Links/);
		}
		for (const note of ['Hi! Early bird here 🌅', 'B1 is by the window, e.g. sunny', '']) {
			expect(swapNoteProblem(note), note).toBe('');
		}
	});

	it('says how long a request has left, how it ended and why nobody can swap', () => {
		expect(formatTimeLeft(2 * 24 * HOUR + 5 * HOUR)).toBe('2 d 5 h');
		expect(formatTimeLeft(5 * HOUR + 12 * 60_000)).toBe('5 h 12 min');
		expect(formatTimeLeft(12 * 60_000)).toBe('12 min');
		expect(formatTimeLeft(20_000)).toBe('under a minute');
		expect(outcomeText({ status: 'void', ended: 'swapped' })).toMatch(/Another swap/);
		expect(outcomeText({ status: 'void', ended: 'moved' })).toMatch(/changed hands/);
		expect(outcomeText({ status: 'expired', ended: '' })).toMatch(/ran out/);
		expect(pauseText('off')).toMatch(/crew paused/);
		expect(pauseText('')).toBe('');
		expect(swapVibe('crew')?.icon).toBe('👯');
		expect(swapVibe('nope')).toBeUndefined();
		expect(swapPause({ phase: 'closed', swapsOff: false })).toBe('closed');
		expect(swapPause({ phase: 'live', swapsOff: true })).toBe('off');
		expect(swapPause(LIVE)).toBe('');
	});
});

describe('asking for a swap', () => {
	it('stores a request that waits 72 h, with the note encrypted, and queues the message', async () => {
		const c = camp();
		const id = await c.ask(c.ada, c.b2, { vibe: 'crew', note: '  Hi Bo!  Swap? ' });
		const [row] = c.requests();
		expect(row).toMatchObject({
			id,
			from_order: c.ada.id,
			from_bed: c.b1.id,
			to_order: c.bo.id,
			to_bed: c.b2.id,
			status: 'pending',
			vibe: 'crew',
			quiet: false
		});
		expect(row.note).not.toContain('Hi Bo');
		expect(decrypt(row.note)).toBe('Hi Bo! Swap?');
		const runs = Date.parse(row.expires_at) - Date.now();
		expect(runs).toBeGreaterThan(SWAP_HOURS * HOUR - 60_000);
		expect(runs).toBeLessThanOrEqual(SWAP_HOURS * HOUR);
		expect(row.notify_due).not.toBe('');
	});

	it('asks a spot that can’t be swapped just the same, quietly — the asker can’t tell', async () => {
		const c = camp();
		c.cy.no_swap_requests = true; // Cy paused swap requests
		// the crew-picked ♿ spot, the locked one, the checked-in one…
		for (const target of [c.b4, c.b5, c.b6]) await c.ask(c.ada, target);
		// …and a guest who paused requests
		await c.ask(c.bo, c.b3);
		const rows = c.requests();
		expect(rows).toHaveLength(4);
		for (const row of rows) {
			expect(row.status).toBe('pending');
			expect(row.quiet).toBe(true);
			expect(row.notify_due).toBe('');
		}
	});

	it('refuses what the guest can see and fix, and says why', async () => {
		const c = camp();
		expect(
			(
				await refusal(
					askForSwap(c.pb as any, { phase: 'staging', swapsOff: false }, c.ada, c.b2.id, {
						vibe: '',
						note: ''
					})
				)
			).message
		).toMatch(/while booking is open/);
		expect(
			(
				await refusal(
					askForSwap(c.pb as any, { phase: 'live', swapsOff: true }, c.ada, c.b2.id, {
						vibe: '',
						note: ''
					})
				)
			).status
		).toBe(403);
		const nobody: any = c.pb.seed('orders', { order_number: 'HB-9', customer_name: 'No Spot' });
		expect((await refusal(c.ask(nobody, c.b2))).message).toMatch(/Book a spot first/);
		expect((await refusal(c.ask(c.fi, c.b2))).message).toBe(CHECKED_IN_NOTE);
		expect((await refusal(c.ask(c.di, c.b2))).message).toMatch(/crew picked your spot/);
		expect((await refusal(c.ask(c.ed, c.b2))).message).toMatch(/set your spot aside/);
		expect((await refusal(c.ask(c.ada, c.b7))).message).toMatch(/free right now/);
		expect((await refusal(c.ask(c.ada, c.b1))).message).toMatch(/your own spot/);
		expect((await refusal(c.ask(c.ada, c.b2, { note: 'www.example.org' }))).status).toBe(400);
		expect(c.requests()).toHaveLength(0);
	});

	it('allows three open requests, one per spot, and no second ask after a no', async () => {
		const c = camp();
		await c.ask(c.ada, c.b2);
		expect((await refusal(c.ask(c.ada, c.b2))).message).toMatch(/asked for this spot already/);
		await c.ask(c.ada, c.b3);
		await c.ask(c.ada, c.b4);
		expect((await refusal(c.ask(c.ada, c.b5))).message).toMatch(/3 open swap requests/);

		const toBo = c.requests().find((r) => r.to_bed === c.b2.id)!;
		await declineSwap(c.pb as any, c.bo, toBo.id);
		expect((await refusal(c.ask(c.ada, c.b2))).message).toMatch(/said no to this swap/);
	});

	it(`stops at ${SWAP_DAILY_MAX} requests a day, taken back ones included`, async () => {
		const c = camp();
		for (let i = 0; i < SWAP_DAILY_MAX; i++) {
			const id = await c.ask(c.ada, c.b2);
			await withdrawSwap(c.pb as any, c.ada, id);
		}
		expect((await refusal(c.ask(c.ada, c.b2))).status).toBe(429);
	});
});

describe('the /swaps page', () => {
	it('shows the other guest a request with the note and burner name — and nothing else about anyone', async () => {
		const c = camp();
		await c.ask(c.ada, c.b2, { vibe: 'early', note: 'Early bird here!' });
		const bo = await guestSwaps(c.pb as any, c.bo);
		expect(bo.incoming).toHaveLength(1);
		expect(bo.incoming[0]).toMatchObject({
			direction: 'in',
			status: 'pending',
			name: 'Ada Sparkle',
			vibe: 'early',
			note: 'Early bird here!',
			mine: { spot: 'B2', room: 'Dorm #2', house: 'Villa', label: 'B2 · Dorm #2 · Villa' },
			other: { spot: 'B1', label: 'B1 · Dorm #2 · Villa' }
		});
		expect(bo.incoming[0].mine.bed).toBe('Lower bunk');
		const json = JSON.stringify(bo);
		for (const secret of ['HB-1', 'HB-2', 'Lovelace', '@example.com', 'quiet']) {
			expect(json).not.toContain(secret);
		}
		// and the asker sees their own request, waiting
		const ada = await guestSwaps(c.pb as any, c.ada);
		expect(ada.outgoing.map((v) => [v.status, v.name])).toEqual([['pending', 'Bo Sparkle']]);
		expect(ada.openOut).toBe(1);
	});

	it('never shows a quiet request to the guest it names', async () => {
		const c = camp();
		c.bo.no_swap_requests = true;
		await c.ask(c.ada, c.b2);
		expect((await guestSwaps(c.pb as any, c.bo)).incoming).toEqual([]);
		expect(await countIncoming(c.pb as any, c.bo.id)).toBe(0);
		expect(await refusal(declineSwap(c.pb as any, c.bo, c.requests()[0].id))).toMatchObject({
			status: 404
		});
		// the asker just waits, like for anybody who doesn't answer
		expect((await guestSwaps(c.pb as any, c.ada)).outgoing[0].status).toBe('pending');
	});

	it('hides requests the guest can’t say yes to, while their own spot can’t be swapped', async () => {
		const c = camp();
		await c.ask(c.ada, c.b2);
		expect(await countIncoming(c.pb as any, c.bo.id)).toBe(1);
		c.b2.checked_in_at = '2026-10-29 18:00:00.000Z';
		expect(await countIncoming(c.pb as any, c.bo.id)).toBe(0);
		expect((await guestSwaps(c.pb as any, c.bo)).incoming).toEqual([]);
	});

	it('ends requests that ran out or whose spots changed hands, and says so to the asker', async () => {
		const c = camp();
		const toBo = await c.ask(c.ada, c.b2);
		const toCy = await c.ask(c.ada, c.b3);
		const fromCy = await c.ask(c.cy, c.b2);
		c.requests().find((r) => r.id === toBo)!.expires_at = new Date(Date.now() - 1000).toISOString();
		// Cy moves to the free B7: Ada's request for B3 and Cy's own request end
		Object.assign(c.b3, { order: '', occupied: false });
		Object.assign(c.b7, { order: c.cy.id, occupied: true });

		const ada = await guestSwaps(c.pb as any, c.ada);
		const status = (id: string) => ada.outgoing.find((v) => v.id === id);
		expect(status(toBo)).toMatchObject({ status: 'expired' });
		expect(status(toCy)).toMatchObject({ status: 'void', ended: 'moved' });
		const cy = await guestSwaps(c.pb as any, c.cy);
		expect(cy.outgoing.find((v) => v.id === fromCy)).toMatchObject({
			status: 'void',
			ended: 'yours_moved'
		});
		expect(ada.openOut).toBe(0);
	});
});

describe('answering and taking back', () => {
	it('declines: the asker hears it with the next run; "pause" stops new requests', async () => {
		const c = camp();
		const id = await c.ask(c.ada, c.b2);
		c.requests()[0].notify_due = '';
		await declineSwap(c.pb as any, c.bo, id, { pause: true });
		expect(c.requests()[0]).toMatchObject({ status: 'declined' });
		expect(c.requests()[0].notify_due).not.toBe('');
		expect(c.bo.no_swap_requests).toBe(true);
		// only the guest it is addressed to can answer, only once
		expect((await refusal(declineSwap(c.pb as any, c.cy, id))).status).toBe(404);
		expect((await refusal(declineSwap(c.pb as any, c.bo, id))).message).toMatch(/isn’t open/);
	});

	it('takes back only the asker’s own open request', async () => {
		const c = camp();
		const id = await c.ask(c.ada, c.b2);
		expect((await refusal(withdrawSwap(c.pb as any, c.bo, id))).status).toBe(404);
		await withdrawSwap(c.pb as any, c.ada, id);
		expect(c.requests()[0]).toMatchObject({ status: 'withdrawn', notify_due: '' });
	});

	it('says yes through PocketBase, holding both tickets, and hands back both spots', async () => {
		const c = camp();
		const id = await c.ask(c.ada, c.b2);
		const calls: unknown[] = [];
		(c.pb as any).send = async (path: string, options: { body: Record<string, string> }) => {
			calls.push([path, options.body]);
			// what PocketBase does (pb_hooks/lib/swap.js)
			Object.assign(c.b1, { order: c.bo.id });
			Object.assign(c.b2, { order: c.ada.id });
			c.requests()[0].status = 'accepted';
			return { ok: true, voided: 0 };
		};
		const outcome = await acceptSwap(c.pb as any, LIVE, c.bo, id);
		expect(calls).toEqual([['/api/cozy/swap', { request: id, order: c.bo.id }]]);
		expect(outcome.gained.spot).toBe('B1');
		expect(outcome.gave.spot).toBe('B2');
	});

	it('turns PocketBase’s refusals into words, never saying which spot is special', async () => {
		const c = camp();
		const id = await c.ask(c.ada, c.b2);
		const refuse = (reason: string) => {
			(c.pb as any).send = async () => {
				throw Object.assign(new Error('refused'), { status: 409, response: { ok: false, reason } });
			};
		};
		refuse('moved');
		expect((await refusal(acceptSwap(c.pb as any, LIVE, c.bo, id))).message).toMatch(
			/changed hands/
		);
		// Ada's spot became special after she asked: Bo's is fine, so hers is the one
		refuse('fixed');
		const fixed = await refusal(acceptSwap(c.pb as any, LIVE, c.bo, id));
		expect(fixed.message).toBe('This swap isn’t possible any more. Nothing changed.');
		expect(c.requests()[0]).toMatchObject({ status: 'void', ended: 'yours_fixed' });
		// nobody says yes while swaps are paused
		const second = await c.ask(c.cy, c.b2);
		expect(
			(await refusal(acceptSwap(c.pb as any, { phase: 'live', swapsOff: true }, c.bo, second)))
				.status
		).toBe(403);
	});
});

describe('the room page and the hand-over', () => {
	it('offers swaps only for a spot the guest can give, with their open requests', async () => {
		const c = camp();
		await c.ask(c.ada, c.b2);
		const ada = await roomSwaps(c.pb as any, LIVE, c.ada, c.b1 as any);
		expect(ada.mine?.label).toBe('B1 · Dorm #2 · Villa');
		expect(ada.why).toBe('');
		expect(ada.asked).toEqual({ [c.b2.id]: c.requests()[0].id });
		expect(ada.openCount).toBe(1);

		const di = await roomSwaps(c.pb as any, LIVE, c.di, c.b4 as any);
		expect(di.mine).toBeNull();
		expect(di.why).toMatch(/crew picked/);
		const closed = await roomSwaps(
			c.pb as any,
			{ phase: 'closed', swapsOff: false },
			c.ada,
			c.b1 as any
		);
		expect(closed).toMatchObject({ pause: 'closed', mine: null });
	});

	it('forgets every request by or to a ticket that goes to a new holder', async () => {
		const c = camp();
		await c.ask(c.ada, c.b2);
		await c.ask(c.bo, c.b3);
		await c.ask(c.cy, c.b1);
		expect(await forgetSwaps(c.pb as any, c.bo.id)).toBe(2);
		expect(c.requests().map((r) => [r.from_order, r.to_order])).toEqual([[c.cy.id, c.ada.id]]);
	});
});
