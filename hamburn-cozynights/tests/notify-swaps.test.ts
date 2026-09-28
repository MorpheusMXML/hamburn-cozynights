// tests/notify-swaps.test.ts — what guests get about swap requests
// (pb_hooks/lib/notify.js): the other guest hears someone would like to swap,
// the asker hears a "no", and after a yes both get "Swap done!" instead of
// "maybe the crew moved you". The asker's own words never go out. Delivery
// against a real PocketBase with Mailpit and the Telegram mock:
// tests/integration/swaps.test.ts.
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

const notify = loadHookModule('lib/notify.js');

const cfg = { appUrl: 'https://cozy.test', label: '' };
const mine = {
	bedId: 'bed1',
	roomId: 'room1',
	spot: 'B1',
	room: 'Dorm #1',
	house: 'Villa',
	label: 'B1 · Dorm #1 · Villa'
};
const offered = {
	bedId: 'bed7',
	roomId: 'room2',
	spot: 'B7',
	room: 'Loft #1',
	house: 'Hut',
	label: 'B7 · Loft #1 · Hut',
	bed: 'Upper bunk · above B6',
	features: ''
};
const until = 'Thu 1 Oct 18:00 (Berlin)';
const pass = { code: 'AAAA-BBBB-CCCC', url: 'https://cozy.test/pass/AAAA-BBBB-CCCC' };
const none = { kind: '', status: '', fixed: false };

describe('someone would like to swap', () => {
	it('tells the other guest by e-mail which spots would change, and where to answer', () => {
		const m = notify.swapMail(cfg, 'ask', mine, offered, 'Bo', until);
		expect(m.subject).toBe('🔁 Swap request for your spot B1 · Dorm #1 · Villa');
		expect(m.text).toContain('Hi Bo,\n\na fellow burner would love to swap spots with you.');
		expect(m.text).toContain('You would get: B7 · Loft #1 · Hut\n🛏 Upper bunk · above B6');
		expect(m.text).toContain('They would get your spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain(
			'answer in the app (sign in with your ticket code): https://cozy.test/swaps — the request is open until Thu 1 Oct 18:00 (Berlin).'
		);
		expect(m.text).toContain('Nothing changes unless you say yes.');
		expect(m.html).toContain('<a href="https://cozy.test/swaps"');
		// no bed line when nobody wrote the bed down
		const plain = notify.swapMail(cfg, 'ask', mine, { ...offered, bed: '' }, 'Bo', until);
		expect(plain.text).not.toContain('🛏');
	});

	it('does the same on Telegram, with a button to answer', () => {
		const text = notify.swapTelegram(cfg, 'ask', mine, offered, until);
		expect(text).toBe(
			'🔁 Swap request! A fellow burner would love to trade spots with you.\n\n' +
				'You would get: B7 · Loft #1 · Hut\n🛏 Upper bunk · above B6\n' +
				'They would get your spot: B1 · Dorm #1 · Villa\n\n' +
				'Read their few words and answer in the app — open until Thu 1 Oct 18:00 (Berlin):\n' +
				'https://cozy.test/swaps\n\nNothing changes unless you say yes.'
		);
	});

	it('never carries the asker’s note: the messages have no place for it', () => {
		// swapMail/swapTelegram take the two spots and the time, nothing a guest wrote
		expect(notify.swapMail.length).toBe(6);
		expect(notify.swapTelegram.length).toBe(5);
		const source = notify.deliverSwap.toString();
		expect(source).not.toMatch(/getString\('note'\)/);
	});
});

describe('no swap', () => {
	it('tells the asker kindly, by e-mail and on Telegram', () => {
		const m = notify.swapMail(cfg, 'no', mine, offered, 'Ada', until);
		expect(m.subject).toBe('No swap this time');
		expect(m.text).toContain(
			'the guest in B7 · Loft #1 · Hut would rather keep their spot, so nothing changed.'
		);
		expect(m.text).toContain(
			'You keep your spot, B1 · Dorm #1 · Villa. Other spots may be free or up for a swap: https://cozy.test/map'
		);
		expect(notify.swapTelegram(cfg, 'no', mine, offered, until)).toBe(
			'🔁 No swap this time: the guest in B7 · Loft #1 · Hut keeps their spot. You keep yours, B1 · Dorm #1 · Villa.'
		);
	});
});

describe('swap done', () => {
	it('is "Swap done!" for both, with the new spot, the pass and the old spot', () => {
		const m = notify.guestMail(cfg, 'swapped', mine, 'B7 · Loft #1 · Hut', 'Ada', pass, none);
		expect(m.subject).toBe('🔁 Swap done! Your CozyNights spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('your swap went through — this is your spot now:');
		expect(m.text).toContain('  Spot:     B1');
		expect(m.text).toContain('Your old spot, B7 · Loft #1 · Hut, belongs to the other guest now.');
		expect(m.text).toContain(pass.url);
		expect(m.text).not.toContain('the crew had to move you');

		const tg = notify.guestTelegram(cfg, 'swapped', mine, 'B7 · Loft #1 · Hut', pass, none);
		expect(tg).toContain('🔁 Swap done! Your CozyNights spot now:\nB1 · Dorm #1 · Villa');
		expect(tg).toContain('Your old spot, B7 · Loft #1 · Hut, is theirs now.');
		expect(tg).toContain('Change or release it: https://cozy.test/room/room1');
		expect(tg).not.toContain('the crew had to move you');
	});

	it('is recognised from the accepted request with exactly these two spots', () => {
		const rows = [
			{
				id: 'r1',
				status: 'accepted',
				from_order: 'ada',
				from_bed: 'b1',
				to_order: 'bo',
				to_bed: 'b2'
			}
		];
		const calls: unknown[] = [];
		const app = {
			findRecordsByFilter: (
				_c: string,
				_f: string,
				_s: string,
				_l: number,
				_o: number,
				p: Record<string, string>
			) => {
				calls.push(p);
				return rows.filter(
					(r) =>
						(r.from_order === p.order && r.from_bed === p.before && r.to_bed === p.now) ||
						(r.to_order === p.order && r.to_bed === p.before && r.from_bed === p.now)
				);
			}
		};
		expect(notify.swappedFrom(app, 'ada', 'b1', 'b2')).toBe(true); // the asker
		expect(notify.swappedFrom(app, 'bo', 'b2', 'b1')).toBe(true); // the one who said yes
		expect(notify.swappedFrom(app, 'ada', 'b9', 'b2')).toBe(false); // moved in between
		expect(notify.swappedFrom(app, 'ada', '', 'b2')).toBe(false); // nothing told before
		expect(calls).toHaveLength(3);
		// a database from before swap requests: an ordinary change
		const old = {
			findRecordsByFilter: () => {
				throw new Error('missing collection');
			}
		};
		expect(notify.swappedFrom(old, 'ada', 'b1', 'b2')).toBe(false);
	});
});

describe('the crew chat', () => {
	it('hears when swap requests are paused or on again', () => {
		const event = (action: string) => ({
			getString: (key: string) => ({ action, actor: 'crew@example.org', subject: '' })[key] ?? '',
			id: 'e1'
		});
		expect(notify.eventText(event('swaps_off'))).toMatch(
			/^🔁 Swap requests turned OFF by crew@example.org/
		);
		expect(notify.eventText(event('swaps_on'))).toBe(
			'🔁 Swap requests turned on again by crew@example.org'
		);
	});
});
