// tests/integration/check-in.test.ts — the check-in at arrival in the real
// PocketBase: only approved admins (and the app's service account) can write
// it, pb_hooks/lib/booked.js drops it with its booking and lets a crew move
// take it along, a hand-over resets it, and it sends the guest nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { BookingService, CheckedInError } from '../../src/lib/server/booking';
import { changeTicket } from '../../src/lib/server/tickets';
import { maskedTicketLabel } from '../../src/lib/tickets';
import { actions as checkActions } from '../../src/routes/admin/check/+page.server';
import {
	anonymous,
	createAdmin,
	expectRefused,
	seedHouse,
	seedTicket,
	serviceAccount,
	uid
} from '../stack-helpers';

const MAILPIT_URL = process.env.MAILPIT_URL || '';

let su: PocketBase;
let booking: BookingService;

beforeAll(async () => {
	su = await serviceAccount();
	booking = new BookingService(su as any);
});

async function bed(id: string) {
	return su.collection('beds').getOne(id);
}

/** A ticket that holds the first of two spots. */
async function booked() {
	const { beds } = await seedHouse(su, 2);
	const ticket = await seedTicket(su);
	await booking.bookBed(ticket.order as any, beds[0].id, 'Arriving Guest');
	return { beds, ticket };
}

describe('who can check a guest in', () => {
	it('approved admins and superusers, with their own session', async () => {
		for (const role of ['admin', 'superuser'] as const) {
			const { beds, ticket } = await booked();
			const crew = await createAdmin(su, role);
			const outcome = await new BookingService(crew.client as any).checkIn(
				ticket.order.id,
				crew.email
			);
			expect(outcome.status).toBe('checkedin');
			const stored = await bed(beds[0].id);
			expect(stored.checked_in_by).toBe(crew.email);
			expect(Date.parse(stored.checked_in_at.replace(' ', 'T'))).toBeGreaterThan(
				Date.now() - 60_000
			);
		}
	});

	it('nobody without an approved admin session: no guest, no pending request', async () => {
		const { beds } = await booked();
		const checkIn = { checked_in_at: new Date().toISOString(), checked_in_by: 'x@y.z' };

		await expectRefused(anonymous().collection('beds').update(beds[0].id, checkIn));
		const pending = await createAdmin(su, 'pending');
		await expectRefused(pending.client.collection('beds').update(beds[0].id, checkIn));
		// guests can't even read who is checked in
		await expectRefused(anonymous().collection('beds').getOne(beds[0].id));
		expect(await anonymous().collection('beds').getFullList()).toEqual([]);

		expect((await bed(beds[0].id)).checked_in_at).toBe('');
	});
});

describe('the pass check at the gate', () => {
	it('names a ticket without a name by its masked code, never by the code itself', async () => {
		const { ticket } = await booked();
		// the label the CLI gives a ticket without a name; the code signs its guest in
		await su
			.collection('orders')
			.update(ticket.order.id, { customer_name: `Ticket ${ticket.code}` });
		const passCode = (await su.collection('orders').getOne(ticket.order.id)).pass_code as string;
		const crew = await createAdmin(su, 'admin');

		const body = new FormData();
		body.set('code', passCode);
		const answer: any = await (checkActions.checkin as any)({
			request: { formData: async () => body },
			locals: { admin: { email: crew.email, role: 'admin' }, pb: crew.client, adminPb: su }
		});

		expect(answer.result).toMatchObject({
			status: 'checkedin',
			ticketName: maskedTicketLabel(ticket.code)
		});
		expect(JSON.stringify(answer)).not.toContain(ticket.code);
	});
});

describe('the check-in follows the booking (pb_hooks/lib/booked.js)', () => {
	it('goes when the spot is released, whoever releases it', async () => {
		const { beds, ticket } = await booked();
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');

		// guests can't release it …
		await expect(booking.unbookOrder(ticket.order.id)).rejects.toBeInstanceOf(CheckedInError);
		expect((await bed(beds[0].id)).order).toBe(ticket.order.id);

		// … the crew can, and the check-in goes with the booking
		await booking.unbookOrder(ticket.order.id, { allowCheckedIn: true });
		const released = await bed(beds[0].id);
		expect(released).toMatchObject({ order: '', occupied: false, checked_in_at: '' });
		expect(released.checked_in_by).toBe('');
	});

	it('goes when the spot is freed in the database directly, or the ticket is deleted', async () => {
		const { beds, ticket } = await booked();
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		await su.collection('beds').update(beds[0].id, { occupied: false, order: null });
		expect((await bed(beds[0].id)).checked_in_at).toBe('');

		const second = await booked();
		await booking.checkIn(second.ticket.order.id, 'crew@mauersegler.art');
		await su.collection('orders').delete(second.ticket.order.id);
		expect(await bed(second.beds[0].id)).toMatchObject({
			order: '',
			occupied: false,
			checked_in_at: '',
			checked_in_by: ''
		});
	});

	it('comes along when the crew moves the guest', async () => {
		const { beds, ticket } = await booked();
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		const before = (await bed(beds[0].id)).checked_in_at;

		await expect(
			booking.bookBed(ticket.order as any, beds[1].id, 'Arriving Guest')
		).rejects.toBeInstanceOf(CheckedInError);
		await booking.bookBed(ticket.order as any, beds[1].id, 'Arriving Guest', {
			allowLocked: true,
			allowCheckedIn: true
		});
		expect(await bed(beds[1].id)).toMatchObject({
			order: ticket.order.id,
			checked_in_at: before,
			checked_in_by: 'crew@mauersegler.art'
		});
		expect(await bed(beds[0].id)).toMatchObject({ order: '', checked_in_at: '' });
	});

	it("can't exist on a free spot, and stays through a lock or a new burner name", async () => {
		const { beds, ticket } = await booked();
		await su
			.collection('beds')
			.update(beds[1].id, { checked_in_at: new Date().toISOString(), checked_in_by: 'x@y.z' });
		expect(await bed(beds[1].id)).toMatchObject({ checked_in_at: '', checked_in_by: '' });

		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		await su.collection('beds').update(beds[0].id, { is_locked: true });
		await booking.bookBed(ticket.order as any, beds[0].id, 'New Name', { allowLocked: true });
		expect((await bed(beds[0].id)).checked_in_by).toBe('crew@mauersegler.art');
	});

	it('is reset when the ticket goes to a new holder; the spot stays', async () => {
		const { beds, ticket } = await booked();
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		const outcome = await changeTicket(su as any, ticket.order.id, {
			email: `new-${uid()}@example.com`,
			name: 'New Holder',
			newHolder: true
		});
		expect(outcome.checkInReset).toBe(true);
		expect(await bed(beds[0].id)).toMatchObject({ order: ticket.order.id, checked_in_at: '' });
	});
});

describe('the guest', () => {
	it('gets no message about the check-in', async () => {
		const { beds, ticket } = await booked();
		const email = `arrival-${uid()}@example.com`;
		await su.collection('orders').update(ticket.order.id, { email });
		const flush = () => su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
		const mails = async () =>
			(
				await (
					await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
				).json()
			).messages?.length ?? 0;

		await flush();
		const before = await mails();
		expect(before).toBeGreaterThan(0); // the confirmation of the spot
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		await booking.undoCheckIn(ticket.order.id);
		await booking.checkIn(ticket.order.id, 'crew@mauersegler.art');
		await flush();
		expect(await mails()).toBe(before);
		expect((await bed(beds[0].id)).checked_in_by).toBe('crew@mauersegler.art');
	});
});
