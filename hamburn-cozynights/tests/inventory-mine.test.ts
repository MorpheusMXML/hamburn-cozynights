// tests/inventory-mine.test.ts — the map points out the house that holds the guest's spot
import { describe, it, expect } from 'vitest';
import { InventoryService } from '../src/lib/server/inventory';

const data: Record<string, unknown[]> = {
	houses: [
		{ id: 'h1', name: 'Villa' },
		{ id: 'h2', name: 'Waldhütten', kind: 'hut_group' }
	],
	rooms: [
		{ id: 'r1', house: 'h1', room_number: 1 },
		{ id: 'r2', house: 'h2', room_number: 1 }
	],
	beds: [
		{ id: 'b1', room: 'r1', label: 'B1', occupied: true, order: 'other-order' },
		{ id: 'b2', room: 'r2', label: 'B1', occupied: true, order: 'my-order' },
		{ id: 'b3', room: 'r2', label: 'B2', occupied: false, order: '' }
	]
};
const pb = { collection: (name: string) => ({ getFullList: async () => data[name] }) };

describe("getFullTree and the guest's own house", () => {
	it("marks only the house that holds the ticket's spot", async () => {
		const tree = await new InventoryService(pb as any).getFullTree({ orderId: 'my-order' });
		expect(tree.map((house) => [house.name, house.mine])).toEqual([
			['Villa', false],
			['Waldhütten', true]
		]);
	});

	it('still never hands out whose spot is whose', async () => {
		const tree = await new InventoryService(pb as any).getFullTree({ orderId: 'my-order' });
		const beds = tree.flatMap((house) => house.rooms.flatMap((room) => room.beds));
		expect(beds.every((bed) => bed.order === '')).toBe(true);
	});

	it('marks nothing without a ticket or without a spot', async () => {
		for (const options of [undefined, {}, { orderId: '' }, { orderId: 'no-spot-yet' }]) {
			const tree = await new InventoryService(pb as any).getFullTree(options);
			expect(tree.some((house) => house.mine)).toBe(false);
		}
	});
});
