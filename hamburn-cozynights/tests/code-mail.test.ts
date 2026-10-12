// tests/code-mail.test.ts — "send me my code" ($lib/server/code-mail): a row
// for PocketBase's mail run only for an address with a paid ticket, at most
// one per 30 minutes and three a day.
import { describe, it, expect } from 'vitest';
import { CODE_MAIL_LIMITS, requestCodeMail } from '../src/lib/server/code-mail';
import type { TypedPocketBase } from '../src/lib/pocketbase-types';

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-10-20T18:00:00Z');

/** Just the reads and the write requestCodeMail makes, with the filters it sends. */
function fakePb(orders: Record<string, unknown>[], sentAt: number[] = []) {
	const rows = sentAt.map((at) => ({
		email: 'guest@example.org',
		created: new Date(at).toISOString().replace('T', ' ')
	}));
	const filters: string[] = [];
	const pb = {
		filter: (expr: string, params: Record<string, unknown>) =>
			expr.replace(/\{:(\w+)\}/g, (_, k) => JSON.stringify(params[k])),
		collection: (name: string) => ({
			getList: async (_page: number, _per: number, options: { filter: string }) => {
				filters.push(options.filter);
				if (name === 'orders') {
					const items = orders.filter(
						(o) => options.filter.includes(JSON.stringify(o.email)) && !o.unpaid && !!o.order_number
					);
					return { totalItems: items.length, items };
				}
				const since = /created >= "([^"]+)"/.exec(options.filter)?.[1] ?? '';
				const items = rows
					.filter((r) => r.created >= since)
					.sort((a, b) => b.created.localeCompare(a.created));
				return { totalItems: items.length, items };
			},
			create: async (data: Record<string, unknown>) => {
				rows.push({ email: String(data.email), created: String(data.due) });
				return data;
			}
		})
	};
	return { pb: pb as unknown as TypedPocketBase, rows, filters };
}

const PAID = { email: 'guest@example.org', order_number: 'PAID1' };

describe('requestCodeMail', () => {
	it('queues a mail for an address with a paid ticket', async () => {
		const { pb, rows } = fakePb([PAID]);
		expect(await requestCodeMail(pb, 'guest@example.org', NOW)).toBe('queued');
		expect(rows).toHaveLength(1);
	});

	it('writes nothing for an unknown address or an unpaid ticket', async () => {
		const unknown = fakePb([PAID]);
		expect(await requestCodeMail(unknown.pb, 'nobody@example.org', NOW)).toBe('no-ticket');
		const unpaid = fakePb([{ ...PAID, unpaid: true }]);
		expect(await requestCodeMail(unpaid.pb, 'guest@example.org', NOW)).toBe('no-ticket');
		expect(unknown.rows).toHaveLength(0);
		expect(unpaid.rows).toHaveLength(0);
		expect(unknown.filters[0]).toContain('unpaid != true');
	});

	it('waits 30 minutes between two mails to one address', async () => {
		const { pb, rows } = fakePb([PAID], [NOW - 10 * MINUTE]);
		expect(await requestCodeMail(pb, 'guest@example.org', NOW)).toBe('too-soon');
		expect(
			await requestCodeMail(pb, 'guest@example.org', NOW - 10 * MINUTE + CODE_MAIL_LIMITS.gap)
		).toBe('queued');
		expect(rows).toHaveLength(2);
	});

	it('sends at most three a day', async () => {
		const { pb } = fakePb(
			[PAID],
			[NOW - 20 * 60 * MINUTE, NOW - 10 * 60 * MINUTE, NOW - 2 * 60 * MINUTE]
		);
		expect(await requestCodeMail(pb, 'guest@example.org', NOW)).toBe('too-soon');
		// the oldest of the three falls out of the day
		expect(await requestCodeMail(pb, 'guest@example.org', NOW + 5 * 60 * MINUTE)).toBe('queued');
	});

	it('writes one row for two asks at the same moment', async () => {
		const { pb, rows } = fakePb([PAID]);
		const answers = await Promise.all([
			requestCodeMail(pb, 'guest@example.org', NOW),
			requestCodeMail(pb, 'guest@example.org', NOW)
		]);
		expect(answers.sort()).toEqual(['queued', 'too-soon']);
		expect(rows).toHaveLength(1);
	});
});
