// tests/message-texts.test.ts — message texts (docs/admin/notifications.md,
// "Message texts"): the checks of a changed text, the catalogue with the
// stored texts on top, and saving, resetting and previewing through the admin
// page, against the in-memory PocketBase stand-in. The catalogue and the
// preview come from PocketBase's routes, played here by notify.js itself.
// What PocketBase sends with a stored text: tests/notify-messages.test.ts and
// tests/integration/notifications.test.ts.
import { describe, it, expect } from 'vitest';
import type { TypedPocketBase } from '../src/lib/pocketbase-types';
import { FakePb } from './fake-pb';
import { loadHookModule } from './hook-module';
import {
	MESSAGE_TEXT_MAX,
	checkMessageText,
	cleanMessageText,
	isMessageTextKey,
	mergeTexts,
	placeholdersIn
} from '../src/lib/message-texts';
import {
	MessageTextError,
	listMessageTexts,
	resetMessageText,
	saveMessageText
} from '../src/lib/server/message-texts';
import { actions } from '../src/routes/admin/messages/+page.server';
import { POST as previewEndpoint } from '../src/routes/admin/messages/preview/+server';

const texts = loadHookModule('lib/texts.js');
const notify = loadHookModule('lib/notify.js');
const catalogue = { groups: texts.GROUPS, placeholders: texts.PLACEHOLDERS, items: texts.TEXTS };
const SIGNATURE = '— The CozyNights crew';

const admin = {
	id: 'a1',
	email: 'crew@mauersegler.art',
	name: 'Crew',
	role: 'admin' as const,
	isSuperuser: false
};

type Stack = FakePb & {
	send: (path: string, options?: { body?: { texts?: Record<string, string> } }) => Promise<unknown>;
};

/** The stand-in, answering the two routes of pb_hooks/cozy_notify.pb.js as well. */
function stack(): Stack {
	const pb = new FakePb() as Stack;
	pb.send = async (path, options = {}) => {
		if (path === '/api/cozy/texts') return catalogue;
		if (path === '/api/cozy/texts/preview') {
			const stored = Object.fromEntries(pb.rows('message_texts').map((r) => [r.key, r.text]));
			return notify.previewMessages({
				appUrl: 'https://cozy.test',
				label: '',
				texts: { ...stored, ...(options.body?.texts ?? {}) }
			});
		}
		throw new Error(`unexpected route ${path}`);
	};
	return pb;
}

/** The stand-in where the server code expects the SDK. */
const db = (pb: Stack) => pb as unknown as TypedPocketBase;

/** A request event as the actions and the endpoint see it (only what they read). */
const event = (pb: Stack, request: Request, session: typeof admin | null = admin) =>
	({ locals: { admin: session, adminPb: db(pb) }, request }) as never;

function form(fields: Record<string, string>): Request {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.append(key, value);
	return new Request('http://cozy.test/admin/messages', { method: 'POST', body: data });
}

describe('a changed text', () => {
	it('is cleaned like a request text and checked against its placeholders', () => {
		expect(cleanMessageText('  Hi {name},\r\n\r\n\r\n  see you  ')).toBe('Hi {name},\n\nsee you');
		expect(placeholdersIn('{spot} and {spot} at {roomUrl}')).toEqual(['spot', 'roomUrl']);
		expect(isMessageTextKey('mail.booked.subject')).toBe(true);
		expect(isMessageTextKey('Mail Subject')).toBe(false);

		const entry = { placeholders: ['spot', 'roomUrl'] };
		expect(checkMessageText(entry, 'Your spot {spot}: {roomUrl}')).toBe('');
		expect(checkMessageText(entry, '')).toContain('Reset to default');
		expect(checkMessageText(entry, 'x'.repeat(MESSAGE_TEXT_MAX + 1))).toContain('at most');
		expect(checkMessageText(entry, 'Hi {name}')).toBe(
			'This text cannot use {name}. It can use: {spot}, {roomUrl}.'
		);
		expect(checkMessageText({ placeholders: [] }, 'Hi {name}')).toBe(
			'This text cannot use {name}. It has no placeholders.'
		);
	});

	it('is shown on top of the default, in the order of the catalogue', () => {
		const merged = mergeTexts(catalogue, [
			{
				key: 'mail.signature',
				text: '— Your crew',
				updated_by: admin.email,
				updated: '2026-09-19 10:00:00.000Z'
			},
			{ key: 'not.in.catalogue', text: 'ignored' }
		]);
		expect(merged.map((item) => item.key)).toEqual(
			texts.TEXTS.map((entry: { key: string }) => entry.key)
		);
		const signature = merged.find((item) => item.key === 'mail.signature')!;
		expect(signature).toMatchObject({
			custom: true,
			value: '— Your crew',
			text: SIGNATURE,
			updatedBy: admin.email
		});
		const other = merged.find((item) => item.key === 'mail.footer')!;
		expect(other).toMatchObject({ custom: false, value: other.text, updatedBy: '' });
	});
});

describe('saving and resetting', () => {
	it('stores a changed text with who changed it, and tells the crew', async () => {
		const pb = stack();
		expect(await saveMessageText(db(pb), admin, 'mail.signature', ' — Your Cozy crew 🌙 ')).toBe(
			'— Your Cozy crew 🌙'
		);
		expect(pb.rows('message_texts')).toMatchObject([
			{ key: 'mail.signature', text: '— Your Cozy crew 🌙', updated_by: admin.email }
		]);
		expect(pb.rows('admin_events')).toMatchObject([
			{ action: 'message_text_changed', actor: admin.email, subject: 'mail.signature' }
		]);

		// changed again: the same record
		await saveMessageText(db(pb), admin, 'mail.signature', '— Your crew');
		expect(pb.rows('message_texts')).toHaveLength(1);
		expect(pb.rows('message_texts')[0].text).toBe('— Your crew');

		const { items } = await listMessageTexts(db(pb));
		expect(items.find((item) => item.key === 'mail.signature')).toMatchObject({
			custom: true,
			value: '— Your crew'
		});
	});

	it('refuses unknown texts, empty texts and placeholders the text may not use', async () => {
		const pb = stack();
		await expect(saveMessageText(db(pb), admin, 'nope', 'x')).rejects.toThrow(MessageTextError);
		await expect(saveMessageText(db(pb), admin, 'mail.nope', 'x')).rejects.toThrow(
			/does not exist/
		);
		await expect(saveMessageText(db(pb), admin, 'mail.signature', '  ')).rejects.toThrow(
			/Enter a text/
		);
		await expect(saveMessageText(db(pb), admin, 'mail.signature', 'Bye {name}')).rejects.toThrow(
			/cannot use \{name\}/
		);
		expect(pb.rows('message_texts')).toEqual([]);
	});

	it('treats the default text itself as a reset', async () => {
		const pb = stack();
		await saveMessageText(db(pb), admin, 'mail.signature', '— Your crew');
		await saveMessageText(db(pb), admin, 'mail.signature', SIGNATURE);
		expect(pb.rows('message_texts')).toEqual([]);
		expect(pb.rows('admin_events').map((e) => e.action)).toEqual([
			'message_text_changed',
			'message_text_reset'
		]);
		// nothing stored: nothing to reset, no event
		expect(await resetMessageText(db(pb), admin, 'mail.signature')).toBe(false);
		expect(pb.rows('admin_events')).toHaveLength(2);
	});
});

describe('the admin page', () => {
	it('saves and resets through its actions, for admins only', async () => {
		const pb = stack();
		const saved = await actions.save(
			event(pb, form({ key: 'tg.connected.stop', text: 'Send /stop to leave.' }))
		);
		expect(saved).toEqual({
			success: true,
			key: 'tg.connected.stop',
			text: 'Send /stop to leave.'
		});

		const refused = (await actions.save(
			event(pb, form({ key: 'tg.connected.stop', text: 'Bye {spot}' }))
		)) as { status: number; data: { error: string } };
		expect(refused.status).toBe(400);
		expect(refused.data.error).toContain('cannot use {spot}');

		const reset = await actions.reset(event(pb, form({ key: 'tg.connected.stop' })));
		expect(reset).toEqual({ success: true, key: 'tg.connected.stop', removed: true });
		expect(pb.rows('message_texts')).toEqual([]);

		const noSession = (await actions.save(
			event(pb, form({ key: 'tg.connected.stop', text: 'x' }), null)
		)) as { status: number };
		expect(noSession.status).toBe(403);
	});

	it('previews whole messages with the texts as typed, on top of the stored ones', async () => {
		const pb = stack();
		await saveMessageText(db(pb), admin, 'mail.signature', '— Your crew');
		const url = 'http://cozy.test/admin/messages/preview';
		const request = new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				texts: { 'mail.booked.subject': 'Dein Platz: {spot}', 'Bad Key': 'x', 'mail.footer': 42 }
			})
		});
		const response = await previewEndpoint(event(pb, request));
		expect(response.status).toBe(200);
		const preview = await response.json();
		const booked = preview.mail.find((m: { id: string }) => m.id === 'booked');
		expect(booked.subject).toBe('Dein Platz: B1 · Dorm #2 · Villa');
		expect(booked.text).toContain('— Your crew');
		expect(booked.text).toContain('You get this e-mail because');
		expect(preview.telegram[0].text).toContain('Connected!');

		await expect(
			previewEndpoint(event(pb, new Request(url, { method: 'POST' }), null))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			previewEndpoint(event(pb, new Request(url, { method: 'POST', body: 'not json' })))
		).rejects.toMatchObject({ status: 400 });
	});
});

describe('the hand-over e-mail (a ticket passed on)', () => {
	it('has its texts like every other message: in the catalogue, editable, in the preview', async () => {
		const pb = stack();
		expect(catalogue.groups.map((g: { id: string }) => g.id)).toContain('mail.handed_over');
		await saveMessageText(db(pb), admin, 'mail.handed_over.intro', 'this ticket is yours now:');
		// the pass line may only use the pass placeholders
		await expect(
			saveMessageText(db(pb), admin, 'mail.handed_over.pass', 'Hi {name}: {passUrl}')
		).rejects.toThrow(/cannot use \{name\}/);

		const request = new Request('http://cozy.test/admin/messages/preview', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ texts: { 'mail.handed_over.pass': 'Your pass: {passUrl}' } })
		});
		const preview = await (await previewEndpoint(event(pb, request))).json();
		const handedOver = preview.mail.find((m: { id: string }) => m.id === 'handed_over');
		expect(handedOver.text).toContain('this ticket is yours now:');
		expect(handedOver.text).toContain('Your pass: https://cozy.test/pass/AAAA-BBBB-CCCC');
	});
});
