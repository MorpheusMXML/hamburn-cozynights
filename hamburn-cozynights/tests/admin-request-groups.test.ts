// tests/admin-request-groups.test.ts — the group steps on /admin/requests
// (docs/admin/special-needs.md, "Groups"): approve all waiting, decline the
// group, book spots for the group, take a request out of its group. Who may
// use them, how they check the ids they get (also the planner's bed_ fields),
// and what they answer the page — a warning when a group booking worked only
// in part. The steps themselves: tests/request-groups.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
		PB_ADMIN_EMAIL: 'admin@test.com',
		PB_ADMIN_PASSWORD: 'password'
	}
}));

import { FakePb } from './fake-pb';
import { createLookupHash, encrypt } from '../src/lib/server/crypto';
import { APP_SETTINGS_ID } from '../src/lib/server/constants';
import { BedUnavailableError, BookingService } from '../src/lib/server/booking';
import { actions, load } from '../src/routes/admin/requests/+page.server';

const admin = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: 'Crew',
	role: 'admin' as const,
	isSuperuser: false
};

const GROUP_ACTIONS = ['approveGroup', 'declineGroup', 'assignGroup', 'removeFromGroup'] as const;

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return data;
}

/** A room of three spots (B3 marked ♿) and a group of three waiting requests. */
function camp() {
	const pb = new FakePb();
	pb.seed('app_settings', {
		id: APP_SETTINGS_ID,
		is_booking_active: false,
		special_requests_open: true
	});
	const house = pb.seed('houses', { name: 'Villa' });
	const room = pb.seed('rooms', { name: 'Dorm', room_number: 2, house: house.id });
	const beds = ['B1', 'B2', 'B3'].map((label) =>
		pb.seed('beds', {
			label,
			room: room.id,
			enabled: true,
			occupied: false,
			is_locked: false,
			is_special: label === 'B3',
			order: ''
		})
	);
	const group = pb.seed('request_groups', { code: 'KM7PQ2XR', name: encrypt('Neon Owls') });
	const requests = [1, 2, 3].map((n) => {
		const code = `HB-${1000 + n}`;
		const order = pb.seed('orders', {
			order_number: code,
			order_hash: createLookupHash(code),
			customer_name: `Member ${n}`,
			email: `member${n}@example.com`,
			burner_name: ''
		});
		return pb.seed('special_requests', {
			order: order.id,
			status: 'pending',
			request_group: group.id
		});
	});
	return { pb, beds, group, requests };
}

type Camp = ReturnType<typeof camp>;

/** Runs one action of the page like SvelteKit does; `any` like the other action tests. */
async function run(
	c: Camp,
	name: keyof typeof actions,
	fields: Record<string, string>,
	who: typeof admin | null = admin
): Promise<any> {
	return actions[name]({
		request: { formData: async () => form(fields) },
		locals: { pb: c.pb, adminPb: c.pb, admin: who }
	} as any);
}

const row = (c: Camp, collection: string, id: string): any =>
	c.pb.rows(collection).find((r) => r.id === id)!;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the group steps on the requests page', () => {
	it('are for admins only', async () => {
		const c = camp();
		for (const name of GROUP_ACTIONS) {
			const result = await run(
				c,
				name,
				{ id: c.group.id, [`bed_${c.requests[0].id}`]: c.beds[0].id },
				null
			);
			expect(result.status).toBe(403);
		}
		expect(c.pb.rows('special_requests').map((r) => r.status)).toEqual([
			'pending',
			'pending',
			'pending'
		]);
		expect(c.pb.rows('admin_events')).toHaveLength(0);
	});

	it('refuse an id that is no record id', async () => {
		const c = camp();
		for (const name of GROUP_ACTIONS) {
			for (const id of ['', 'not an id', 'ABCDEFGHIJKLMNO', `${c.group.id}x`]) {
				const result = await run(c, name, { id });
				expect(result.status).toBe(400);
				expect(result.data.error).toBe(
					name === 'removeFromGroup'
						? 'No request was selected. Reload the page.'
						: 'No group was selected. Reload the page.'
				);
			}
		}
	});

	it('refuse a planner field that looks forged, and book nothing', async () => {
		const c = camp();
		const forged: Record<string, string>[] = [
			{ bed_short: c.beds[0].id },
			{ bed_: c.beds[0].id },
			{ [`bed_${c.requests[0].id.toUpperCase()}`]: c.beds[0].id },
			{ [`bed_${c.requests[0].id}x`]: c.beds[0].id },
			{ [`bed_${c.requests[0].id}`]: 'not a bed' },
			{ [`bed_${c.requests[0].id}`]: `${c.beds[0].id} ` }
		];
		for (const fields of forged) {
			const result = await run(c, 'assignGroup', {
				id: c.group.id,
				[`bed_${c.requests[1].id}`]: c.beds[1].id,
				...fields
			});
			expect(result.status).toBe(400);
			expect(result.data.error).toBe('No request was selected. Reload the page.');
		}
		expect(c.beds.map((bed) => row(c, 'beds', bed.id).order)).toEqual(['', '', '']);
	});

	it('approve every waiting request and answer how many', async () => {
		const c = camp();
		row(c, 'special_requests', c.requests[2].id).status = 'declined';
		const result = await run(c, 'approveGroup', { id: c.group.id });
		expect(result).toEqual({ success: true, changed: 2 });
		expect(c.pb.rows('special_requests').map((r) => r.status)).toEqual([
			'approved',
			'approved',
			'declined'
		]);
	});

	it('explain when nothing in the group waits for the step', async () => {
		const c = camp();
		for (const request of c.requests) row(c, 'special_requests', request.id).status = 'declined';
		const result = await run(c, 'approveGroup', { id: c.group.id });
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/^Nothing to change/);
	});

	it('decline the group, keep crew-booked spots and answer both counts', async () => {
		const c = camp();
		// Member 1: approved, the crew booked B1 for the request (fixed).
		const first = row(c, 'special_requests', c.requests[0].id);
		Object.assign(first, { status: 'approved', bed: c.beds[0].id });
		Object.assign(row(c, 'beds', c.beds[0].id), { order: first.order, occupied: true });
		const result = await run(c, 'declineGroup', { id: c.group.id });
		expect(result).toEqual({ success: true, changed: 2, skipped: 1 });
		expect(c.pb.rows('special_requests').map((r) => r.status)).toEqual([
			'approved',
			'declined',
			'declined'
		]);
	});

	it('book the picked spots, ♿ included, and leave "Keep as is" rows alone', async () => {
		const c = camp();
		const result = await run(c, 'assignGroup', {
			id: c.group.id,
			[`bed_${c.requests[0].id}`]: c.beds[2].id,
			[`bed_${c.requests[1].id}`]: c.beds[0].id,
			[`bed_${c.requests[2].id}`]: ''
		});
		expect(result).toEqual({ success: true, booked: 2, approved: 2, failed: [] });
		expect(c.beds.map((bed) => row(c, 'beds', bed.id).order)).toEqual([
			c.requests[1].order,
			'',
			c.requests[0].order
		]);
		expect(c.pb.rows('special_requests').map((r) => r.status)).toEqual([
			'approved',
			'approved',
			'pending'
		]);
	});

	it('refuse a booking without a single pick', async () => {
		const c = camp();
		const result = await run(c, 'assignGroup', {
			id: c.group.id,
			[`bed_${c.requests[0].id}`]: '',
			[`bed_${c.requests[1].id}`]: ''
		});
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('Pick a spot for at least one member.');
	});

	it('warn with who was not booked and why when a booking fails on the way', async () => {
		const c = camp();
		const real = BookingService.prototype.bookBed;
		vi.spyOn(BookingService.prototype, 'bookBed')
			.mockImplementationOnce(async function (this: BookingService, ...args) {
				return real.apply(this, args);
			})
			.mockRejectedValueOnce(new BedUnavailableError('This spot is already claimed.'));
		const result = await run(c, 'assignGroup', {
			id: c.group.id,
			[`bed_${c.requests[0].id}`]: c.beds[0].id,
			[`bed_${c.requests[1].id}`]: c.beds[1].id
		});
		expect(result.success).toBe(true);
		expect(result.booked).toBe(1);
		expect(result.failed).toHaveLength(1);
		expect(result.warning).toBe(
			'1 of 2 spots booked. Not booked: Member 2: This spot is already claimed. Pick another spot.'
		);
		expect(row(c, 'beds', c.beds[0].id).order).toBe(c.requests[0].order);
		expect(row(c, 'beds', c.beds[1].id).order).toBe('');
	});

	it('book nothing when a picked spot was taken since the page loaded', async () => {
		const c = camp();
		Object.assign(row(c, 'beds', c.beds[1].id), { occupied: true });
		const result = await run(c, 'assignGroup', {
			id: c.group.id,
			[`bed_${c.requests[0].id}`]: c.beds[0].id,
			[`bed_${c.requests[1].id}`]: c.beds[1].id
		});
		expect(result.status).toBe(409);
		expect(result.data.error).toMatch(/is not free anymore, so nothing was booked/);
		expect(row(c, 'beds', c.beds[0].id).order).toBe('');
	});

	it('take a request out of its group and keep it as it is', async () => {
		const c = camp();
		const result = await run(c, 'removeFromGroup', { id: c.requests[0].id });
		expect(result).toEqual({ success: true });
		expect(row(c, 'special_requests', c.requests[0].id)).toMatchObject({
			status: 'pending',
			request_group: ''
		});
		const again = await run(c, 'removeFromGroup', { id: c.requests[0].id });
		expect(again.status).toBe(409);
	});
});

describe('the requests page', () => {
	it('loads the groups and every ♿ spot with its state, never cached', async () => {
		const c = camp();
		const headers: Record<string, string> = {};
		const data: any = await load({
			locals: { pb: c.pb, adminPb: c.pb, admin },
			setHeaders: (h: Record<string, string>) => Object.assign(headers, h)
		} as any);
		expect(headers['cache-control']).toBe('no-store');
		expect(data.groups).toEqual([
			expect.objectContaining({
				id: c.group.id,
				name: 'Neon Owls',
				code: 'KM7P-Q2XR',
				memberIds: c.requests.map((r) => r.id)
			})
		]);
		expect(data.specialSpots.map((spot: any) => [spot.spot, spot.state])).toEqual([['B3', 'free']]);
		expect(data.requests.map((r: any) => r.groupId)).toEqual([c.group.id, c.group.id, c.group.id]);
	});

	it('the step that books a single request answers whether it approved it', async () => {
		const c = camp();
		const result = await run(c, 'assign', { id: c.requests[0].id, bedId: c.beds[2].id });
		expect(result).toEqual({ success: true, approved: true });
	});
});
