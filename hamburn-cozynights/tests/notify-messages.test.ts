// tests/notify-messages.test.ts — the texts PocketBase sends to guests
// (pb_hooks/lib/notify.js), for every combination of a spot change and news
// about a special-needs request. A message goes out once per settled state,
// so news that a text leaves out is lost for good. Delivery itself:
// tests/integration/notifications.test.ts and special-needs.test.ts.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { loadHookModule, HOOKS_DIR } from './hook-module';

// notify.js is a CommonJS module for PocketBase's JSVM; loaded the same way here.
const notify = loadHookModule('lib/notify.js');

const cfg = { appUrl: 'https://cozy.test', label: '' };
const spot = {
	bedId: 'bed1',
	roomId: 'room1',
	spot: 'B1',
	room: 'Dorm #1',
	house: 'Villa',
	label: 'B1 · Dorm #1 · Villa',
	// what the crew wrote down about the bed (pb_hooks/lib/beds.js)
	bed: 'Lower bunk · below B2',
	features: '🔥 Heated · 🔌 Power socket'
};
const pass = { code: 'AAAA-BBBB-CCCC', url: 'https://cozy.test/pass/AAAA-BBBB-CCCC' };

type Req = { kind: string; status: string; fixed: boolean };
const none: Req = { kind: '', status: '', fixed: false };

function mail(kind: string, withSpot: boolean, req: Req, previous = '') {
	const m = notify.guestMail(cfg, kind, withSpot ? spot : null, previous, 'Ada', pass, req);
	return { subject: m.subject as string, text: m.text as string };
}

function telegram(kind: string, withSpot: boolean, req: Req, previous = '') {
	return notify.guestTelegram(cfg, kind, withSpot ? spot : null, previous, pass, req) as string;
}

describe('spot messages without a request stay as they were', () => {
	it('booked, changed, released', () => {
		const booked = mail('booked', true, none);
		expect(booked.subject).toBe('Your CozyNights spot: B1 · Dorm #1 · Villa');
		expect(booked.text).toContain('To change or release it');
		expect(booked.text).toContain(pass.url);

		const changed = mail('changed', true, none, 'B9 · Loft #2 · Hut');
		expect(changed.text).toContain('Before: B9 · Loft #2 · Hut');
		expect(changed.text).toContain("If you didn't change it yourself, the crew had to move you.");

		const released = mail('released', false, none, 'B1 · Dorm #1 · Villa');
		expect(released.subject).toBe('Your CozyNights spot was released');
		expect(released.text).toContain('While booking is open you can pick a new spot');

		for (const m of [booked, changed, released]) expect(m.text).not.toMatch(/special-needs/);
		expect(telegram('booked', true, none)).toContain('Change or release it');
	});
});

// The kind of bed (for a bunk bed: where the other level is) and what is at
// the spot: two more rows in the e-mail, one 🛏 line under the spot on
// Telegram — only when the crew wrote them down on the layout.
describe('the bed and what is at it', () => {
	const BED_LINE = '🛏 Lower bunk · below B2 · 🔥 Heated · 🔌 Power socket';
	// the same spot on a layout where nobody wrote the bed down
	const plain = {
		bedId: spot.bedId,
		roomId: spot.roomId,
		spot: spot.spot,
		room: spot.room,
		house: spot.house,
		label: spot.label
	};

	it('has its rows in the e-mail, text and HTML, lined up with the others', () => {
		const m = notify.guestMail(cfg, 'booked', spot, '', 'Ada', pass, none);
		expect(m.text).toContain(
			'\n  House:    Villa\n  Room:     Dorm #1\n  Spot:     B1\n  Bed:      Lower bunk · below B2\n  Features: 🔥 Heated · 🔌 Power socket\n'
		);
		const cell = (name: string, value: string) =>
			`<td style="padding:4px 16px 4px 0;color:#6b6478">${name}</td><td style="padding:4px 0;font-weight:bold">${value}</td>`;
		expect(m.html).toContain(cell('Bed', 'Lower bunk · below B2'));
		expect(m.html).toContain(cell('Features', '🔥 Heated · 🔌 Power socket'));
		// in the messages that show the spot as well
		for (const kind of ['changed', 'handed_over']) {
			expect(mail(kind, true, none, 'B9').text).toContain('Bed:      Lower bunk · below B2');
		}
		expect(mail('', true, { kind: 'approved', status: 'approved', fixed: true }).text).toContain(
			'Features: 🔥 Heated · 🔌 Power socket'
		);
	});

	it('is one 🛏 line right under the spot on Telegram', () => {
		expect(telegram('booked', true, none)).toContain(
			'✨ Your CozyNights spot is booked\nB1 · Dorm #1 · Villa\n' + BED_LINE + '\n\n'
		);
		expect(telegram('changed', true, none, 'B9 · Loft #2 · Hut')).toContain(
			'Now: B1 · Dorm #1 · Villa\n' + BED_LINE + '\nBefore: B9 · Loft #2 · Hut'
		);
		expect(telegram('connected', true, none)).toContain(
			'Your spot: B1 · Dorm #1 · Villa\nhttps://cozy.test/room/room1\n' + BED_LINE + '\n\n'
		);
		expect(
			telegram('booked', true, { kind: 'approved', status: 'approved', fixed: true })
		).toContain('booked this spot for you:\nB1 · Dorm #1 · Villa\n' + BED_LINE + '\n\n');
		// and under the bot's /pass reply
		const preview = notify.previewMessages(cfg);
		const passReply = preview.bot.find((m: { id: string }) => m.id === 'pass');
		expect(passReply.text).toContain(pass.url + '\n🛏 Lower bunk · below B2 · 🔥 Heated');
		expect(preview.telegram.find((m: { id: string }) => m.id === 'booked').text).toContain(
			'🛏 Lower bunk · below B2 · 🔥 Heated · 🔌 Power socket'
		);
	});

	it('is left out when the crew wrote nothing down', () => {
		const m = notify.guestMail(cfg, 'booked', plain, '', 'Ada', pass, none);
		expect(m.text).toContain('  Spot:     B1\n\n');
		expect(m.text).not.toContain('Bed:');
		expect(m.text).not.toContain('Features:');
		expect(m.html).not.toContain('>Bed<');
		expect(m.html).not.toContain('>Features<');
		for (const kind of ['booked', 'changed', 'connected']) {
			expect(notify.guestTelegram(cfg, kind, plain, 'B9', pass, none)).not.toContain('🛏');
		}
		// only one of the two known: the line is just that
		const onlyBed = { ...plain, bed: 'Single bed' };
		expect(notify.guestTelegram(cfg, 'booked', onlyBed, '', pass, none)).toContain(
			'\n🛏 Single bed\n\n'
		);
		const onlyFeatures = { ...plain, features: '🔌 Power socket' };
		const text = notify.guestMail(cfg, 'booked', onlyFeatures, '', 'Ada', pass, none).text;
		expect(text).toContain('  Spot:     B1\n  Features: 🔌 Power socket\n');
		expect(text).not.toContain('Bed:');
	});

	it('is a text the crew can change, with the bed as its placeholder', () => {
		const custom = { ...cfg, texts: { 'tg.bed': 'Dein Bett: {bed}' } };
		expect(notify.guestTelegram(custom, 'booked', spot, '', pass, none)).toContain(
			'\nDein Bett: Lower bunk · below B2 · 🔥 Heated · 🔌 Power socket\n'
		);
	});
});

describe('request news on its own', () => {
	it('received', () => {
		const m = mail('', false, { kind: 'received', status: 'pending', fixed: false });
		expect(m.subject).toBe('We got your special-needs request');
		expect(m.text).toContain('https://cozy.test/special-needs');
	});

	it('approved: without a spot the crew picks one, with a spot the guest keeps it', () => {
		const picking = mail('', false, { kind: 'approved', status: 'approved', fixed: false });
		expect(picking.text).toContain('They are picking a fitting spot for you');

		const keeping = mail('', true, { kind: 'approved', status: 'approved', fixed: false });
		expect(keeping.subject).toBe('Your special-needs request was approved');
		expect(keeping.text).toContain('You keep your current spot, B1 · Dorm #1 · Villa');
		expect(keeping.text).not.toContain('picking a fitting spot');
		expect(telegram('', true, { kind: 'approved', status: 'approved', fixed: false })).toContain(
			'You keep your current spot'
		);
	});

	it('declined: a guest with a spot keeps it, one without books like everyone else', () => {
		const keeps = mail('', true, { kind: 'declined', status: 'declined', fixed: false });
		expect(keeps.text).toContain('You keep your current spot, B1 · Dorm #1 · Villa.');
		expect(keeps.text).not.toContain('like everyone else');

		const books = mail('', false, { kind: 'declined', status: 'declined', fixed: false });
		expect(books.text).toContain('You can book a spot like everyone else when booking opens');
	});

	it('approved and the crew booked the spot the guest already holds', () => {
		const m = mail('', true, { kind: 'approved', status: 'approved', fixed: true });
		expect(m.subject).toBe('Your special-needs spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain(pass.url);
	});
});

describe('a spot change and request news in one message', () => {
	it('approved and booked by the crew', () => {
		const m = mail('booked', true, { kind: 'approved', status: 'approved', fixed: true });
		expect(m.subject).toBe('Your special-needs spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('the crew approved your special-needs request and booked this spot');
		expect(m.text).toContain('please contact the crew to change it');
		expect(m.text).not.toContain('To change or release it');
		expect(
			telegram('booked', true, { kind: 'approved', status: 'approved', fixed: true })
		).toContain('The crew booked this spot for you');
	});

	it('booked by the guest while the crew declines', () => {
		const m = mail('booked', true, { kind: 'declined', status: 'declined', fixed: false });
		expect(m.subject).toBe('Your CozyNights spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain(
			'The crew could not offer you a special-needs spot; you keep this spot.'
		);
		expect(
			telegram('booked', true, { kind: 'declined', status: 'declined', fixed: false })
		).toContain('could not offer you a special-needs spot');
	});

	it('booked by the guest while the crew approves without booking', () => {
		const m = mail('booked', true, { kind: 'approved', status: 'approved', fixed: false });
		expect(m.text).toContain('The crew approved your special-needs request. You keep this spot');
		expect(m.text).toContain('To change or release it');
	});

	it('released while a request arrives', () => {
		const m = mail('released', false, { kind: 'received', status: 'pending', fixed: false });
		expect(m.text).toContain('The crew got your special-needs request');
		expect(
			telegram('released', false, { kind: 'received', status: 'pending', fixed: false })
		).toContain('The crew got your special-needs request');
	});

	it('released while the request stays approved: the crew picks a new spot', () => {
		const m = mail('released', false, { kind: '', status: 'approved', fixed: false });
		expect(m.text).toContain('Your special-needs request is still approved');
		expect(m.text).not.toContain('you can pick a new spot');
	});

	it('moved by the crew', () => {
		const m = mail('changed', true, { kind: '', status: 'approved', fixed: true }, 'B9');
		expect(m.text).toContain('The crew moved you to this spot.');
		expect(m.text).toContain('please contact the crew to change it');
		expect(
			telegram('changed', true, { kind: '', status: 'approved', fixed: true }, 'B9')
		).toContain('The crew moved you to this spot');
	});
});

describe('what a channel remembers about a request', () => {
	it('tells a new request, a decision, and a request sent again after a withdrawal', () => {
		const kindOf = notify.requestKindOf;
		expect(kindOf('', { id: 'a', status: 'pending' })).toBe('received');
		expect(kindOf('a:pending', { id: 'a', status: 'pending' })).toBe('');
		expect(kindOf('a:pending', { id: 'a', status: 'approved' })).toBe('approved');
		expect(kindOf('a:approved', { id: 'a', status: 'declined' })).toBe('declined');
		expect(kindOf('a:pending', { id: 'b', status: 'pending' })).toBe('received');
		expect(kindOf('a:approved', null)).toBe('');
	});

	it('shows the request in the Telegram "connected" message', () => {
		expect(telegram('connected', false, { kind: '', status: 'pending', fixed: false })).toContain(
			'Your special-needs request: waiting for the crew'
		);
	});
});

describe('message texts from the catalogue (pb_hooks/lib/texts.js)', () => {
	const texts = loadHookModule('lib/texts.js');
	const source = fs.readFileSync(`${HOOKS_DIR}/lib/notify.js`, 'utf8');
	const entries: {
		key: string;
		group: string;
		label: string;
		placeholders: string[];
		text: string;
	}[] = texts.TEXTS;

	it('has unique keys with a label, a known group and only declared placeholders', () => {
		const keys = entries.map((entry) => entry.key);
		expect(new Set(keys).size).toBe(keys.length);
		const groups = new Set(texts.GROUPS.map((group: { id: string }) => group.id));
		const known = new Set(texts.PLACEHOLDERS.map((p: { name: string }) => p.name));
		for (const entry of entries) {
			expect(entry.key).toMatch(/^[a-z0-9_.]{1,80}$/);
			expect(entry.label).not.toBe('');
			expect(groups.has(entry.group), entry.key).toBe(true);
			const used = [...entry.text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
			expect(
				used.filter((name) => !entry.placeholders.includes(name)),
				entry.key
			).toEqual([]);
			expect(
				entry.placeholders.filter((name) => !used.includes(name)),
				entry.key
			).toEqual([]);
			expect(
				entry.placeholders.filter((name) => !known.has(name)),
				entry.key
			).toEqual([]);
		}
	});

	it('is what notify.js uses: every key once at least, and no key that is not in it', () => {
		const keys = new Set(entries.map((entry) => entry.key));
		for (const key of keys) expect(source, key).toContain(`'${key}'`);
		const referenced = [
			...source.matchAll(/\bT\('([a-z0-9_.]+)'\)|\bt\(cfg, '([a-z0-9_.]+)'/g)
		].map((match) => match[1] || match[2]);
		expect(referenced.length).toBeGreaterThan(50);
		for (const key of referenced) expect(keys.has(key), key).toBe(true);
	});

	it('sends a stored text instead of the default, with the placeholders filled in', () => {
		const custom = {
			...cfg,
			texts: {
				'mail.booked.subject': 'Dein Platz: {spot}',
				'mail.signature': '— Deine Crew',
				'tg.booked.intro': '✨ Gebucht: {spot}'
			}
		};
		const m = notify.guestMail(custom, 'booked', spot, '', 'Ada', pass, none);
		expect(m.subject).toBe('Dein Platz: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('— Deine Crew');
		expect(m.text).not.toContain('The CozyNights crew');
		expect(m.html).toContain('— Deine Crew');
		expect(notify.guestTelegram(custom, 'booked', spot, '', pass, none)).toContain(
			'✨ Gebucht: B1 · Dorm #1 · Villa'
		);
	});

	it('keeps the default for an empty stored text, and an unknown placeholder as written', () => {
		const custom = {
			...cfg,
			texts: { 'mail.booked.subject': '', 'mail.booked.intro': 'your spot {nope} is booked:' }
		};
		const m = notify.guestMail(custom, 'booked', spot, '', 'Ada', pass, none);
		expect(m.subject).toBe('Your CozyNights spot: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('your spot {nope} is booked:');
	});

	it('keeps the line breaks of a stored text in the HTML e-mail, escaped', () => {
		const custom = { ...cfg, texts: { 'mail.booked.change': 'Line one <b>\nLine two' } };
		const m = notify.guestMail(custom, 'booked', spot, '', 'Ada', pass, none);
		expect(m.text).toContain('Line one <b>\nLine two');
		expect(m.html).toContain('Line one &lt;b&gt;<br>Line two');
	});

	it('looks a text up with t(): stored or default, unknown keys refused', () => {
		const custom = { ...cfg, texts: { 'bot.help': 'Hallo! {appUrl}' } };
		expect(notify.t(custom, 'bot.help', { appUrl: 'https://x' })).toBe('Hallo! https://x');
		expect(notify.t(cfg, 'bot.stopped')).toBe(
			"🔕 Disconnected. You won't get updates here anymore. You can connect again on the booking page."
		);
		expect(() => notify.t(cfg, 'nope.nope')).toThrow(/unknown message text/);
	});

	it('shows every text in at least one preview message', () => {
		// Every text becomes a marker; it keeps its placeholders, because some
		// texts only appear through one (the request status words via {status}).
		const marker = (key: string) => `«${key}»`;
		const all = Object.fromEntries(
			entries.map((entry) => [
				entry.key,
				marker(entry.key) + entry.placeholders.map((name) => ` {${name}}`).join('')
			])
		);
		// The preview offers what this server can do; here: both.
		const preview = notify.previewMessages({
			...cfg,
			telegram: { guests: true },
			wallet: ['apple', 'google'],
			texts: all
		});
		const rendered = [
			...preview.mail.map((m: { subject: string; text: string }) => `${m.subject}\n${m.text}`),
			...preview.telegram.map((m: { text: string }) => m.text),
			...preview.bot.map((m: { text: string }) => m.text)
		].join('\n');
		for (const entry of entries) expect(rendered, entry.key).toContain(marker(entry.key));
		expect(preview.mail[0]).toMatchObject({ id: 'booked', title: 'Spot booked' });
		expect(preview.mail[0].html).toContain('<!doctype html>');
		expect(preview.telegram[0].id).toBe('connected');
		expect(preview.bot.map((m: { id: string }) => m.id)).toEqual([
			'help',
			'link_expired',
			'stopped',
			'not_connected',
			'pass',
			'pass_no_spot'
		]);
	});

	it('hands the catalogue to the admin page', () => {
		const catalogue = notify.textCatalogue();
		expect(catalogue.groups).toEqual(texts.GROUPS);
		expect(catalogue.placeholders).toEqual(texts.PLACEHOLDERS);
		expect(catalogue.items).toEqual(texts.TEXTS);
	});
});

describe('a ticket that was passed on', () => {
	it('tells the new holder the spot came with the ticket, not that they booked it', () => {
		const m = mail('handed_over', true, none);
		expect(m.subject).toBe('A CozyNights spot came with your ticket: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('this ticket was passed on to you, and it holds this spot:');
		expect(m.text).toContain('Spot:');
		expect(m.text).toContain('Dorm #1');
		// its own pass line: the seller may have passed the old link on
		expect(m.text).toContain(pass.url);
		expect(m.text).toContain('the pass of the holder before no longer works');
		expect(m.text).toContain('To change or release it');
		expect(m.text).not.toContain('your spot is booked');
	});

	it('still carries news about a special-needs request', () => {
		// One message per settled state: a request the new holder sent while
		// this message was still waiting would be lost if the text left it out.
		const received = mail('handed_over', true, {
			kind: 'received',
			status: 'pending',
			fixed: false
		});
		expect(received.text).toContain('The crew also got your special-needs request');
		expect(received.text).toContain('this ticket was passed on to you');
	});

	it('is in the preview for the crew, but not as a Telegram message', () => {
		const preview = notify.previewMessages({ appUrl: 'https://cozy.test', label: '' });
		const sample = preview.mail.find((m: { id: string }) => m.id === 'handed_over');
		expect(sample.subject).toContain('came with your ticket');
		// the hand-over cuts the Telegram link, so there is no such message
		expect(preview.telegram.some((m: { id: string }) => m.id === 'handed_over')).toBe(false);
	});
});

// Which message a channel gets is decided by the spot it last confirmed
// against the spot the ticket holds now — not by the events in between. That
// is what lets Leave No Trace hold the release back (holdGuestMessage in
// src/lib/server/notifications.ts, tests/respin.test.ts): while the guest
// spins, the channel still knows the old spot, so the new one is a change.
describe('✨ Leave No Trace & Respin ends in one message', () => {
	it('is "changed", not "released" and then "booked"', () => {
		const old = 'bed9';

		// Delivered while the guest is still rolling — the message to avoid.
		expect(notify.kindOf(old, '')).toBe('released');
		// Held back until the respin booked a spot: one message about the move.
		expect(notify.kindOf(old, 'bed1')).toBe('changed');
		// The roulette rolled the spot the ticket already had: no news at all.
		expect(notify.kindOf(old, old)).toBe('');
		// Nobody rolled and the hold ran out, so the release is the news; a
		// booking after that is a first spot again.
		expect(notify.kindOf('', 'bed1')).toBe('booked');
	});

	it('names the swept spot as the one before', () => {
		const m = mail('changed', true, none, 'B9 · Loft #2 · Hut');
		expect(m.subject).toBe('Your CozyNights spot changed: B1 · Dorm #1 · Villa');
		expect(m.text).toContain('Before: B9 · Loft #2 · Hut');

		const tg = telegram('changed', true, none, 'B9 · Loft #2 · Hut');
		expect(tg).toContain('Now: B1 · Dorm #1 · Villa');
		expect(tg).toContain('B9 · Loft #2 · Hut');
	});
});
