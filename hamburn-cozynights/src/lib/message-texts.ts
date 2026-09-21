// src/lib/message-texts.ts
/**
 * Message texts (docs/admin/notifications.md, "Message texts"): what guests
 * get by e-mail, on Telegram and from the bot. The sentences and their
 * defaults live in pb_hooks/lib/texts.js, and PocketBase sends them; on
 * /admin/messages the crew changes them. Pure code without server imports,
 * shared by the page, the server actions and the unit tests. Storage and
 * PocketBase's routes: $lib/server/message-texts.ts.
 */
import { cleanRequestText } from '$lib/special-needs';

export type MessageChannel = 'mail' | 'telegram' | 'bot';

export interface MessageGroup {
	id: string;
	channel: MessageChannel;
	title: string;
}

export interface MessagePlaceholder {
	name: string;
	meaning: string;
}

/** One sentence of the catalogue, with its default text. */
export interface MessageTextEntry {
	key: string;
	group: string;
	label: string;
	hint: string;
	/** The {placeholders} this text may use. */
	placeholders: string[];
	text: string;
}

/** What GET /api/cozy/texts answers. */
export interface TextCatalogue {
	groups: MessageGroup[];
	placeholders: MessagePlaceholder[];
	items: MessageTextEntry[];
}

/** A text as the admin page shows it: the default, and the stored text when the crew changed it. */
export interface MessageTextView extends MessageTextEntry {
	/** The text in use: the stored one, else the default. */
	value: string;
	custom: boolean;
	updatedBy: string;
	updatedAt: string;
}

/** Sample messages rendered by PocketBase (POST /api/cozy/texts/preview). */
export interface MessagePreview {
	mail: { id: string; title: string; subject: string; text: string; html: string }[];
	telegram: { id: string; title: string; text: string }[];
	bot: { id: string; title: string; text: string }[];
}

/** A stored text (collection message_texts), as far as the page needs it. */
export interface StoredMessageText {
	key: string;
	text: string;
	updated_by?: string;
	updated?: string;
}

/** The stored field allows 4000 characters; a sentence for guests is far shorter. */
export const MESSAGE_TEXT_MAX = 2000;

const KEY = /^[a-z0-9_.]{1,80}$/;
const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

export function isMessageTextKey(value: unknown): value is string {
	return typeof value === 'string' && KEY.test(value);
}

/** The names of the {placeholders} in a text, each once, in order. */
export function placeholdersIn(text: string): string[] {
	return [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

/**
 * A text as it is stored: normal line breaks, no control or invisible
 * formatting characters, single spaces, at most one empty line in a row —
 * the same rules as for what guests write in a request.
 */
export const cleanMessageText: (raw: unknown) => string = cleanRequestText;

/** Why a cleaned text can't be saved for this entry, or '' when it can. Written for the admin. */
export function checkMessageText(
	entry: Pick<MessageTextEntry, 'placeholders'>,
	text: string
): string {
	if (!text) return 'Enter a text. To go back to the default, use "Reset to default".';
	if (text.length > MESSAGE_TEXT_MAX) {
		return `Please keep it short: at most ${MESSAGE_TEXT_MAX} characters (now ${text.length}).`;
	}
	const unknown = placeholdersIn(text).filter((name) => !entry.placeholders.includes(name));
	if (unknown.length > 0) {
		const allowed = entry.placeholders.map((name) => `{${name}}`).join(', ');
		return `This text cannot use {${unknown[0]}}. ${
			allowed ? `It can use: ${allowed}.` : 'It has no placeholders.'
		}`;
	}
	return '';
}

/** The catalogue with the stored texts on top, in the catalogue's order. */
export function mergeTexts(
	catalogue: Pick<TextCatalogue, 'items'>,
	stored: StoredMessageText[]
): MessageTextView[] {
	const byKey = new Map(stored.map((record) => [record.key, record]));
	return catalogue.items.map((entry) => {
		const record = byKey.get(entry.key);
		const custom = !!record?.text;
		return {
			...entry,
			value: custom ? record!.text : entry.text,
			custom,
			updatedBy: custom ? record!.updated_by || '' : '',
			updatedAt: custom ? record!.updated || '' : ''
		};
	});
}
