// tests/notify-messages.test.ts — the texts PocketBase sends to guests
// (pb_hooks/lib/notify.js), for every combination of a spot change and news
// about a special-needs request. A message goes out once per settled state,
// so news that a text leaves out is lost for good. Delivery itself:
// tests/integration/notifications.test.ts and special-needs.test.ts.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import vm from 'vm';

/** notify.js is a CommonJS module for PocketBase's JSVM; load it the same way here. */
function loadNotify() {
	const source = fs.readFileSync(new URL('../pb_hooks/lib/notify.js', import.meta.url), 'utf8');
	const module = { exports: {} as Record<string, any> };
	vm.runInNewContext(
		source,
		{ module, exports: module.exports, console },
		{ filename: 'notify.js' }
	);
	return module.exports;
}
const notify = loadNotify();

const cfg = { appUrl: 'https://cozy.test', label: '' };
const spot = {
	bedId: 'bed1',
	roomId: 'room1',
	spot: 'B1',
	room: 'Dorm #1',
	house: 'Villa',
	label: 'B1 · Dorm #1 · Villa'
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
