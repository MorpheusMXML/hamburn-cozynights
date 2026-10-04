// tests/crew-texts.test.ts — what the crew chat says about the ticket and
// template imports (pb_hooks/lib/notify.js eventText, run outside PocketBase).
import { describe, it, expect } from 'vitest';
import { loadHookModule } from './hook-module';

const { eventText, maskEmailsIn } = loadHookModule('lib/notify.js');

const event = (action: string, actor: string, subject: string, details: object) => ({
	getString: (field: string) =>
		({ action, actor, subject, details: JSON.stringify(details) })[field] ?? ''
});

describe('crew chat texts', () => {
	it('report a changed ticket with shortened code and addresses', () => {
		const text = eventText(
			event('ticket_updated', 'crew@mauersegler.art', 'abc', {
				ticket: 'H•••',
				emailChanged: true,
				emailFrom: 'm•••@gmail.com',
				emailTo: 'm•••@gmail.com',
				nameChanged: true,
				newHolder: true
			})
		);
		expect(text).toBe(
			'🎟️ Ticket H••• changed by crew@mauersegler.art: e-mail m•••@gmail.com → m•••@gmail.com; name; passed on: Telegram disconnected, new booking pass'
		);
	});

	it('say nothing about the address when only the name changed', () => {
		const text = eventText(
			event('ticket_updated', 'crew@mauersegler.art', 'abc', {
				ticket: 'H•••',
				emailChanged: false,
				emailFrom: 'a•••@x.de',
				emailTo: 'a•••@x.de',
				nameChanged: true
			})
		);
		expect(text).toBe('🎟️ Ticket H••• changed by crew@mauersegler.art: name');
	});

	it('report a ticket list import and an applied template', () => {
		expect(
			eventText(
				event('tickets_imported', 'max@mauersegler.art', '', {
					created: 12,
					updated: 3,
					newHolders: 1,
					failed: 0
				})
			)
		).toBe('📥 Ticket list imported by max@mauersegler.art: 12 new, 3 updated (1 passed on)');
		expect(
			eventText(
				event('template_imported', 'max@mauersegler.art', 'Camp', {
					created: { houses: 1, rooms: 2, spots: 8 },
					updated: { houses: 0, rooms: 1, spots: 0 },
					removed: { houses: 0, rooms: 0, spots: 2 },
					releasedBookings: 1,
					problems: 0,
					backup: 'pre-import-x.zip'
				})
			)
		).toBe(
			'🗺️ Layout template "Camp" applied by max@mauersegler.art: new 1 house(s), 2 room(s), 8 spot(s); changed 1 room(s); removed 2 spot(s); 1 booking(s) released; backup pre-import-x.zip'
		);
	});

	it('still read template events from before the review import', () => {
		expect(
			eventText(
				event('template_imported', 'max@mauersegler.art', 'Camp', {
					houses: 3,
					rooms: 4,
					beds: 9,
					releasedBookings: 2,
					backup: 'b.zip'
				})
			)
		).toBe(
			'🗺️ Layout template "Camp" imported by max@mauersegler.art: 3 houses, 4 rooms, 9 spots; 2 booking(s) released; backup b.zip'
		);
	});
});

describe('crew chat texts about message texts', () => {
	it('say who changed or reset which text', () => {
		expect(
			eventText(event('message_text_changed', 'crew@mauersegler.art', 'mail.signature', {}))
		).toBe('✏️ Message text changed by crew@mauersegler.art: mail.signature');
		expect(eventText(event('message_text_reset', 'crew@mauersegler.art', 'bot.help', {}))).toBe(
			'↩️ Message text reset to its default by crew@mauersegler.art: bot.help'
		);
	});
});

describe('crew chat texts about guests', () => {
	it('names a ticket it could not reach by its masked code, never by its holder', () => {
		// The crew chat runs on Telegram: this line may sit right below a
		// "🧡 New special-needs request", and the two must not add up to a person.
		const text = eventText(
			event('guest_notice_failed', 'server', 'Ticket H•••', {
				channels: 'e-mail a•••@x.de',
				attempts: 7,
				error: 'dial tcp: i/o timeout'
			})
		);
		expect(text).toBe(
			'📭 Could not notify ticket "Ticket H•••" (e-mail a•••@x.de) after 7 attempts: dial tcp: i/o timeout'
		);
	});

	it('shortens every address a mail server quotes back in its reply', () => {
		// The 📭 alert repeats the reply as it came; a rejection usually echoes
		// the recipient, which would name the guest the masked ticket leaves out.
		expect(maskEmailsIn('mail: 550 5.1.1 <anna.schmidt@example.com>: unknown')).toBe(
			'mail: 550 5.1.1 <a•••@example.com>: unknown'
		);
		expect(maskEmailsIn('mail: refused anna@x.de, bea@y.org | telegram: 400 x')).toBe(
			'mail: refused a•••@x.de, b•••@y.org | telegram: 400 x'
		);
		expect(maskEmailsIn('telegram: 400 Bad Request: chat not found')).toBe(
			'telegram: 400 Bad Request: chat not found'
		);
		expect(maskEmailsIn('')).toBe('');
		expect(maskEmailsIn(undefined)).toBe('');
	});

	it('says in words what a withdrawn special-needs request was', () => {
		const withdrawn = (status: string) =>
			eventText(event('special_request_withdrawn', 'server', '', { status }));
		expect(withdrawn('pending')).toBe(
			'🧡 A guest withdrew their special-needs request (was still waiting for a decision)'
		);
		expect(withdrawn('approved')).toBe(
			'🧡 A guest withdrew their special-needs request (had been approved)'
		);
		expect(withdrawn('declined')).toBe(
			'🧡 A guest withdrew their special-needs request (had been declined)'
		);
		// nothing stored, and never the stored word itself
		expect(withdrawn('')).toBe('🧡 A guest withdrew their special-needs request');
	});
});

describe('crew chat texts about request groups', () => {
	const CREW = 'crew@mauersegler.art';

	it('say that a new request started or joined a group, never which one', () => {
		const created = (details: object) =>
			eventText(event('special_request_new', 'guest', 'req123456789012', details));
		expect(created({ open: 3 })).toBe('🧡 New special-needs request — 3 waiting for a decision');
		expect(created({ open: 3, group: 'started' })).toBe(
			'🧡 New special-needs request (started a group) — 3 waiting for a decision'
		);
		expect(created({ open: 4, group: 'joined' })).toBe(
			'🧡 New special-needs request (joined a group) — 4 waiting for a decision'
		);
		expect(
			eventText(event('special_request_withdrawn', 'guest', '', { status: 'pending', group: true }))
		).toBe(
			'🧡 A guest withdrew their special-needs request (was still waiting for a decision) and left their group'
		);
	});

	it('count what a group step did, nothing more', () => {
		const group = 'grp123456789012';
		expect(
			eventText(event('request_group_approved', CREW, group, { changed: 3, skipped: 0 }))
		).toBe('✅ Request group approved by crew@mauersegler.art: 3 request(s)');
		expect(
			eventText(event('request_group_declined', CREW, group, { changed: 2, skipped: 0 }))
		).toBe('✋ Request group declined by crew@mauersegler.art: 2 request(s)');
		expect(
			eventText(event('request_group_declined', CREW, group, { changed: 2, skipped: 1 }))
		).toBe(
			'✋ Request group declined by crew@mauersegler.art: 2 request(s); 1 kept: spot booked by the crew'
		);
		expect(
			eventText(event('request_group_booked', CREW, group, { booked: 4, approved: 0, failed: 0 }))
		).toBe('👥 Spots booked for a request group by crew@mauersegler.art: 4');
		expect(
			eventText(event('request_group_booked', CREW, group, { booked: 3, approved: 2, failed: 1 }))
		).toBe(
			'👥 Spots booked for a request group by crew@mauersegler.art: 3 (2 request(s) approved on the way), 1 not booked'
		);
		expect(eventText(event('request_group_member_removed', CREW, 'req123456789012', {}))).toBe(
			'👥 A request was taken out of its group by crew@mauersegler.art'
		);
	});

	it('never print the group id, a name or a code from the details', () => {
		// Details only ever hold counts; even if something else slipped in, it
		// would not be printed.
		const details = { changed: 1, skipped: 0, booked: 1, name: 'Neon Owls', code: 'KM7PQ2XR' };
		for (const action of [
			'request_group_approved',
			'request_group_declined',
			'request_group_booked',
			'request_group_member_removed'
		]) {
			const text = eventText(event(action, CREW, 'grp123456789012', details));
			expect(text).not.toMatch(/Neon|KM7P|grp123/);
		}
	});
});
