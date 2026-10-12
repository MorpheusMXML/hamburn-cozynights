// tests/code-mail-offer.test.ts — the "send me my code" card opens by itself only once per device.
import { describe, it, expect } from 'vitest';
import { CODE_MAIL_OFFERED_KEY, firstCodeMailOffer } from '../src/lib/code-mail-offer';

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value)
	};
}

describe('the first "send me my code" offer on a device', () => {
	it('is the first only once: every later offer starts folded', () => {
		const storage = memoryStorage();
		expect(firstCodeMailOffer(() => storage)).toBe(true);
		expect(storage.items.get(CODE_MAIL_OFFERED_KEY)).toBe('1');
		expect(firstCodeMailOffer(() => storage)).toBe(false);
		expect(firstCodeMailOffer(() => storage)).toBe(false);
	});

	it('counts as the first when the device keeps nothing (private window, blocked storage)', () => {
		expect(
			firstCodeMailOffer(() => {
				throw new DOMException('blocked', 'SecurityError');
			})
		).toBe(true);
		const full = {
			getItem: () => null,
			setItem: () => {
				throw new DOMException('full', 'QuotaExceededError');
			}
		};
		expect(firstCodeMailOffer(() => full)).toBe(true);
		expect(firstCodeMailOffer(() => full)).toBe(true);
	});
});
