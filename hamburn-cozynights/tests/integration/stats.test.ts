// tests/integration/stats.test.ts — the Intel panel's numbers against the real
// PocketBase: every camp-wide count is a query PocketBase accepts on the real
// schema, each filter sorts records the way pb_hooks/lib/notify.js leaves them,
// and booking stamps written by the hooks come out as the right minute.
//
// Counts are camp-wide and the other files leave records behind, so these
// tests check which of their own records a filter selects, not totals.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { BookingService } from '../../src/lib/server/booking';
import {
	OPS_FILTERS,
	liveStatsSnapshot,
	readOpsStats,
	resetStatsCache,
	toMinute
} from '../../src/lib/server/stats';
import { createAdmin, seedHouse, seedTicket, serviceAccount } from '../stack-helpers';

let su: PocketBase;

beforeAll(async () => {
	su = await serviceAccount();
});
beforeEach(() => resetStatsCache());

/** Whether `filter` selects the record `id` in `collection`. */
async function selects(collection: string, filter: string, id: string): Promise<boolean> {
	const page = await su
		.collection(collection)
		.getList(1, 1, { filter: su.filter(`(${filter}) && id = {:id}`, { id }), fields: 'id' });
	return page.totalItems === 1;
}

const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

describe('the camp-wide counts in the real PocketBase', () => {
	it('reads every one of them: no filter refused, no collection missing', async () => {
		const ops = await readOpsStats(su);
		const counts = [
			...Object.values(ops.tickets),
			...Object.values(ops.requests),
			ops.messages.queued,
			ops.messages.retrying,
			ops.messages.failed,
			...Object.values(ops.crew)
		];
		expect(counts).toHaveLength(14);
		for (const count of counts) expect(typeof count).toBe('number');
	});

	it('sorts guest messages into waiting, retrying and given up', async () => {
		const record = async (fields: Record<string, unknown>) => {
			const { order } = await seedTicket(su);
			return su.collection('guest_notify').create({ order: order.id, ...fields });
		};
		const waiting = await record({ due: inAnHour(), attempts: 0 });
		const retrying = await record({ due: inAnHour(), attempts: 2, last_error: 'mail: 550' });
		const givenUp = await record({ due: '', attempts: 8, last_error: 'mail: 550' });
		const delivered = await record({
			due: '',
			attempts: 0,
			mail_sent: new Date().toISOString(),
			tg_chat: '900123'
		});

		const where = async (filter: string) => {
			const hits: string[] = [];
			for (const [name, rec] of Object.entries({ waiting, retrying, givenUp, delivered })) {
				if (await selects('guest_notify', filter, rec.id)) hits.push(name);
			}
			return hits;
		};
		expect(await where(OPS_FILTERS.queued)).toEqual(['waiting', 'retrying']);
		expect(await where(OPS_FILTERS.retrying)).toEqual(['retrying']);
		expect(await where(OPS_FILTERS.failed)).toEqual(['givenUp']);
		expect(await where(OPS_FILTERS.mailed)).toEqual(['delivered']);
		expect(await where(OPS_FILTERS.telegram)).toEqual(['delivered']);
	});

	it('counts tickets with an address and crew alerts by their state', async () => {
		const { order: plain } = await seedTicket(su);
		const { order: mailed } = await seedTicket(su);
		await su.collection('orders').update(mailed.id, { email: 'intel@example.com' });
		expect(await selects('orders', OPS_FILTERS.ticketsWithEmail, plain.id)).toBe(false);
		expect(await selects('orders', OPS_FILTERS.ticketsWithEmail, mailed.id)).toBe(true);

		const alert = (alert_status: string) =>
			su.collection('admin_events').create({ action: 'intel_test', actor: 'test', alert_status });
		const failed = await alert('failed');
		const pending = await alert('pending');
		const sent = await alert('sent');
		expect(await selects('admin_events', OPS_FILTERS.alertsFailed, failed.id)).toBe(true);
		expect(await selects('admin_events', OPS_FILTERS.alertsFailed, sent.id)).toBe(false);
		expect(await selects('admin_events', OPS_FILTERS.alertsQueued, pending.id)).toBe(true);
	});

	it('counts an access request apart from the approved admins', async () => {
		const before = await readOpsStats(su);
		await createAdmin(su, 'pending');
		await createAdmin(su, 'admin');
		const after = await readOpsStats(su);
		expect((after.crew.accessRequests ?? 0) - (before.crew.accessRequests ?? 0)).toBe(1);
		expect((after.crew.admins ?? 0) - (before.crew.admins ?? 0)).toBe(1);
	});
});

describe('booking stamps in the live snapshot', () => {
	it('carries the minute PocketBase stamped, per house, without the ticket', async () => {
		const { house, beds } = await seedHouse(su, 2);
		const { order } = await seedTicket(su);
		await new BookingService(su as never).bookBed(order as never, beds[0].id, 'Intel Guest');
		const bed = await su.collection('beds').getOne(beds[0].id);
		expect(bed.booked_at).toBeTruthy();

		const { stats } = await liveStatsSnapshot(su as never);
		const entry = stats.houses.find((candidate) => candidate.id === house.id);
		expect(entry).toMatchObject({ name: house.name, total: 2, booked: 1, occupied: 1 });
		expect(entry?.bookedAt).toEqual([toMinute(bed.booked_at)]);
		expect(entry?.checkedInAt).toEqual([]);
		expect(JSON.stringify(stats)).not.toContain(order.id);
	});
});
