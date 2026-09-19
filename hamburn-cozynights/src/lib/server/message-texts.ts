// src/lib/server/message-texts.ts
/**
 * Message texts against PocketBase (docs/admin/notifications.md, "Message
 * texts"). The catalogue with the defaults comes from PocketBase itself
 * (pb_hooks/lib/texts.js, served by pb_hooks/cozy_notify.pb.js), so the app
 * and the sender never disagree; what admins change is stored in the
 * collection message_texts and read by PocketBase when it sends. The preview
 * is rendered by PocketBase too: it is what the guest will get.
 */
import type { ClientResponseError } from 'pocketbase';
import type { MessageTextsResponse, TypedPocketBase } from '$lib/pocketbase-types';
import type { AdminSession } from '$lib/server/admin-auth';
import { logAdminEvent } from '$lib/server/admin-events';
import {
	checkMessageText,
	cleanMessageText,
	isMessageTextKey,
	mergeTexts,
	type MessagePreview,
	type MessageTextView,
	type TextCatalogue
} from '$lib/message-texts';

export type { MessagePreview, MessageTextView, TextCatalogue };

/** A change the page doesn't allow. `message` is written for whoever clicked. */
export class MessageTextError extends Error {
	constructor(
		message: string,
		public status = 400
	) {
		super(message);
		this.name = 'MessageTextError';
	}
}

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

/** The catalogue from PocketBase: groups, placeholders, every text with its default. */
export async function fetchTextCatalogue(adminPb: TypedPocketBase): Promise<TextCatalogue> {
	const result = (await adminPb.send('/api/cozy/texts', {
		method: 'GET',
		requestKey: null
	})) as Partial<TextCatalogue> | null;
	if (!result || !Array.isArray(result.items) || !Array.isArray(result.groups)) {
		throw new Error('unexpected answer from /api/cozy/texts');
	}
	return {
		groups: result.groups,
		placeholders: Array.isArray(result.placeholders) ? result.placeholders : [],
		items: result.items
	};
}

/** Everything the admin page shows: the catalogue with the stored texts on top. */
export async function listMessageTexts(adminPb: TypedPocketBase): Promise<{
	groups: TextCatalogue['groups'];
	placeholders: TextCatalogue['placeholders'];
	items: MessageTextView[];
}> {
	const [catalogue, stored] = await Promise.all([
		fetchTextCatalogue(adminPb),
		adminPb.collection('message_texts').getFullList({ requestKey: null })
	]);
	return {
		groups: catalogue.groups,
		placeholders: catalogue.placeholders,
		items: mergeTexts(catalogue, stored)
	};
}

async function findStored(
	adminPb: TypedPocketBase,
	key: string
): Promise<MessageTextsResponse | null> {
	try {
		return await adminPb
			.collection('message_texts')
			.getFirstListItem(adminPb.filter('key = {:key}', { key }), { requestKey: null });
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

/**
 * Stores a changed text; the default text itself is stored as "no change".
 * Returns the text as stored.
 * @throws {MessageTextError} for an unknown text or one that can't be sent
 */
export async function saveMessageText(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	key: string,
	rawText: unknown
): Promise<string> {
	if (!isMessageTextKey(key)) throw new MessageTextError('Unknown text. Reload the page.');
	const catalogue = await fetchTextCatalogue(adminPb);
	const entry = catalogue.items.find((item) => item.key === key);
	if (!entry) throw new MessageTextError('This text does not exist anymore. Reload the page.');

	const text = cleanMessageText(rawText);
	const problem = checkMessageText(entry, text);
	if (problem) throw new MessageTextError(problem);
	if (text === entry.text) {
		await resetMessageText(adminPb, admin, key);
		return text;
	}

	const data = { text, updated_by: admin.email };
	const existing = await findStored(adminPb, key);
	if (existing) {
		await adminPb.collection('message_texts').update(existing.id, data);
	} else {
		try {
			await adminPb.collection('message_texts').create({ key, ...data });
		} catch (err) {
			// Saved twice at once (a second tab): the unique index refused the
			// second record, so change the first instead.
			const raced = await findStored(adminPb, key);
			if (!raced) throw err;
			await adminPb.collection('message_texts').update(raced.id, data);
		}
	}
	await logAdminEvent(adminPb, admin, 'message_text_changed', key, {});
	return text;
}

/** Back to the default: deletes the stored text. Returns whether there was one. */
export async function resetMessageText(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	key: string
): Promise<boolean> {
	if (!isMessageTextKey(key)) throw new MessageTextError('Unknown text. Reload the page.');
	const existing = await findStored(adminPb, key);
	if (!existing) return false;
	await adminPb.collection('message_texts').delete(existing.id);
	await logAdminEvent(adminPb, admin, 'message_text_reset', key, {});
	return true;
}

/**
 * Sample messages rendered by PocketBase with `texts` (key → text; '' means
 * the default) on top of the stored ones — what the page shows while typing.
 */
export async function previewMessageTexts(
	adminPb: TypedPocketBase,
	texts: Record<string, string>
): Promise<MessagePreview> {
	return (await adminPb.send('/api/cozy/texts/preview', {
		method: 'POST',
		body: { texts },
		requestKey: null
	})) as MessagePreview;
}
