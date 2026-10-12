// tests/crew-ticket.test.ts — who books a blocked 🔒 spot on the guest pages.
import { describe, it, expect, vi } from 'vitest';
import { isCrewTicket } from '../src/lib/server/crew-ticket';

function fakePb(admins: { email: string; role?: string }[] | Error) {
	const getFullList = vi.fn(async () => {
		if (admins instanceof Error) throw admins;
		return admins;
	});
	const collection = vi.fn(() => ({ getFullList }));
	return { pb: { collection } as any, collection, getFullList };
}

describe('a crew ticket (blocked spots on the guest pages)', () => {
	it("is a ticket with an approved admin's or superuser's address", async () => {
		const { pb, collection } = fakePb([
			{ email: 'max@mauersegler.art', role: 'admin' },
			{ email: 'root@mauersegler.art', role: 'superuser' },
			{ email: 'newbie@mauersegler.art', role: 'pending' }
		]);
		expect(await isCrewTicket(pb, { email: 'max@mauersegler.art' })).toBe(true);
		expect(await isCrewTicket(pb, { email: 'root@mauersegler.art' })).toBe(true);
		expect(collection).toHaveBeenCalledWith('admins');
		// an access request still waiting (role pending) never counts
		expect(await isCrewTicket(pb, { email: 'newbie@mauersegler.art' })).toBe(false);
	});

	it('ignores case and spaces around the address', async () => {
		const { pb } = fakePb([{ email: 'Max@Mauersegler.art', role: 'admin' }]);
		expect(await isCrewTicket(pb, { email: '  max@MAUERSEGLER.art ' })).toBe(true);
	});

	it('is never a ticket with another address, and asks nobody for it', async () => {
		const { pb, getFullList } = fakePb([{ email: 'max@mauersegler.art', role: 'admin' }]);
		expect(await isCrewTicket(pb, { email: 'guest@example.org' })).toBe(false);
		expect(await isCrewTicket(pb, { email: '' })).toBe(false);
		expect(await isCrewTicket(pb, {})).toBe(false);
		expect(await isCrewTicket(pb, null)).toBe(false);
		expect(getFullList).not.toHaveBeenCalled();
	});

	it('is not a ticket of the admin domain that no approved account has', async () => {
		const { pb } = fakePb([{ email: 'max@mauersegler.art', role: 'admin' }]);
		// e.g. a removed admin
		expect(await isCrewTicket(pb, { email: 'newbie@mauersegler.art' })).toBe(false);
	});

	it('says no when the accounts cannot be read', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { pb } = fakePb(new Error('PocketBase down'));
		expect(await isCrewTicket(pb, { email: 'max@mauersegler.art' })).toBe(false);
		vi.restoreAllMocks();
	});
});
