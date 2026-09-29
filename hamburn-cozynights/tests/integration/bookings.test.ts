// tests/integration/bookings.test.ts — who booked which spot, read from the
// real PocketBase (docs/admin/bookings.md): the scoped filters PocketBase has
// to accept (a room, a house, the whole camp), the chunked read of the tickets
// behind the spots, crew-taken spots and ♿ assignments, and the check-in the
// bookings list writes with the admin's own session. The rows' shape and
// masking are covered by tests/bookings.test.ts; the pages over HTTP by the
// smoke test.
import { describe, it, expect, beforeAll } from 'vitest';
import type PocketBase from 'pocketbase';
import { readBookings } from '../../src/lib/server/bookings';
import { BookingService } from '../../src/lib/server/booking';
import { encrypt } from '../../src/lib/server/crypto';
import { createAdmin, seedHouse, seedTicket, serviceAccount, uid } from '../stack-helpers';

let su: PocketBase;

beforeAll(async () => {
	su = await serviceAccount();
});

describe('reading the bookings from the real PocketBase', () => {
	it('reads one room, one house or the whole camp, with the ticket behind each spot', async () => {
		const { house, room, beds } = await seedHouse(su, 3);
		const other = await seedHouse(su, 1);
		const guest = await seedTicket(su);
		await su.collection('orders').update(guest.order.id, {
			email: 'crew-test@example.org',
			burner_name: encrypt('Glitter Owl')
		});
		await su.collection('beds').update(beds[0].id, { occupied: true, order: guest.order.id });
		// taken by the crew, no ticket
		await su.collection('beds').update(beds[1].id, { occupied: true });
		const neighbour = await seedTicket(su);
		await su
			.collection('beds')
			.update(other.beds[0].id, { occupied: true, order: neighbour.order.id });

		const inRoom = await readBookings(su, { roomId: room.id });
		expect(inRoom.map((row) => row.bedId).sort()).toEqual([beds[0].id, beds[1].id].sort());
		const booked = inRoom.find((row) => row.bedId === beds[0].id)!;
		expect(booked).toMatchObject({
			roomId: room.id,
			houseId: house.id,
			house: house.name,
			guest: {
				orderId: guest.order.id,
				name: 'Test Guest',
				burnerName: 'Glitter Owl',
				email: 'c•••@example.org'
			},
			checkIn: null
		});
		// PocketBase stamps the booking (pb_hooks/cozy_booked.pb.js).
		expect(booked.bookedAt).not.toBe('');
		expect(JSON.stringify(inRoom)).not.toContain(guest.code);
		expect(inRoom.find((row) => row.bedId === beds[1].id)?.guest).toBeNull();

		const inHouse = await readBookings(su, { houseId: house.id });
		expect(inHouse.map((row) => row.bedId).sort()).toEqual(inRoom.map((row) => row.bedId).sort());
		const camp = await readBookings(su);
		const ids = camp.map((row) => row.bedId);
		expect(ids).toEqual(expect.arrayContaining([beds[0].id, beds[1].id, other.beds[0].id]));
		// the free spot is no booking
		expect(ids).not.toContain(beds[2].id);
	});

	it('reads the tickets of many spots in chunks (more ids than one filter holds)', async () => {
		const { room, beds } = await seedHouse(su, 60);
		const tickets = [];
		for (const bed of beds) {
			const ticket = await seedTicket(su);
			await su.collection('beds').update(bed.id, { occupied: true, order: ticket.order.id });
			tickets.push(ticket);
		}
		const rows = await readBookings(su, { roomId: room.id });
		expect(rows).toHaveLength(60);
		expect(rows.every((row) => row.guest?.name === 'Test Guest')).toBe(true);
		expect(new Set(rows.map((row) => row.guest?.orderId))).toEqual(
			new Set(tickets.map((ticket) => ticket.order.id))
		);
	});

	it('marks a spot the crew assigned to an approved special-needs request', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		await su.collection('beds').update(beds[0].id, {
			is_special: true,
			occupied: true,
			order: ticket.order.id
		});
		await su.collection('special_requests').create({
			order: ticket.order.id,
			bed: beds[0].id,
			status: 'approved',
			consent_at: new Date().toISOString(),
			needs: encrypt(`step_free ${uid()}`)
		});
		const [row] = await readBookings(su, { roomId: room.id });
		expect(row).toMatchObject({ special: true, viaRequest: true });
		// what the guest asked for never leaves the request
		expect(JSON.stringify(row)).not.toContain('step_free');
	});

	it('shows the check-in the list writes with the admin session, and its undo', async () => {
		const { room, beds } = await seedHouse(su, 1);
		const ticket = await seedTicket(su);
		await su.collection('beds').update(beds[0].id, { occupied: true, order: ticket.order.id });
		const admin = await createAdmin(su, 'admin');
		const crew = new BookingService(admin.client);

		expect((await crew.checkIn(ticket.order.id, admin.email)).status).toBe('checkedin');
		const [checked] = await readBookings(su, { roomId: room.id });
		expect(checked.checkIn).toMatchObject({ by: admin.email });
		expect(checked.checkIn?.at).not.toBe('');

		expect((await crew.undoCheckIn(ticket.order.id)).status).toBe('undone');
		const [undone] = await readBookings(su, { roomId: room.id });
		expect(undone.checkIn).toBeNull();
	});
});
