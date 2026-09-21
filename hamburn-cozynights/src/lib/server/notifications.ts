import crypto from 'crypto';
import type { ClientResponseError } from 'pocketbase';
import type { GuestNotifyResponse, OrdersResponse, TypedPocketBase } from '$lib/pocketbase-types';
import type { BookingSettings } from '$lib/server/settings';

/**
 * Guest side of the booking notifications. Sending happens in PocketBase
 * (pb_hooks/cozy_notify.pb.js): e-mail to the address imported with the
 * ticket, and Telegram messages to a chat the guest linked here. This module
 * only reads the state for the guest pages and starts / ends a Telegram link.
 */

/** How long a "connect Telegram" link works. */
export const TELEGRAM_LINK_MINUTES = 30;

export interface GuestNotifyStatus {
	/** Where confirmations go, masked ("m•••@example.com"); "" = no e-mail. */
	email: string;
	/** Telegram updates: the bot, and whether this ticket has a chat linked. */
	telegram: { bot: string; connected: boolean } | null;
}

/** "max@example.com" → "m•••@example.com": enough to recognise, not to harvest. */
export function maskEmail(email: string | undefined | null): string {
	const value = String(email || '');
	const at = value.lastIndexOf('@');
	if (at < 1) return value ? '•••' : '';
	return value.charAt(0) + '•••' + value.slice(at);
}

/**
 * A one-time token for the t.me deep link. Base64url fits Telegram's start
 * parameter (A–Z, a–z, 0–9, _ and -, at most 64 characters); only its SHA-256
 * is stored, PocketBase compares the hash of what the bot receives.
 */
export function telegramLinkToken(): { token: string; hash: string } {
	const token = crypto.randomBytes(24).toString('base64url');
	return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}

export function telegramDeepLink(bot: string, token: string): string {
	return `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(token)}`;
}

function isNotFound(err: unknown): boolean {
	return (err as ClientResponseError | undefined)?.status === 404;
}

async function findGuestNotify(
	adminPb: TypedPocketBase,
	orderId: string
): Promise<GuestNotifyResponse | null> {
	try {
		return await adminPb
			.collection('guest_notify')
			.getFirstListItem(adminPb.filter('order = {:orderId}', { orderId }));
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

/** What the guest pages show about confirmations for this ticket. */
export async function getGuestNotifyStatus(
	adminPb: TypedPocketBase,
	order: OrdersResponse,
	settings: Pick<BookingSettings, 'notifyMail' | 'telegramBot'>
): Promise<GuestNotifyStatus> {
	const email = settings.notifyMail ? maskEmail(order.email) : '';
	if (!settings.telegramBot) return { email, telegram: null };
	const record = await findGuestNotify(adminPb, order.id);
	return { email, telegram: { bot: settings.telegramBot, connected: !!record?.tg_chat } };
}

/**
 * Stores a fresh one-time token for this ticket and returns the t.me link.
 * The bot links the chat when the guest taps START (pb_hooks/lib/notify.js).
 */
export async function startTelegramLink(
	adminPb: TypedPocketBase,
	orderId: string,
	bot: string
): Promise<string> {
	const { token, hash } = telegramLinkToken();
	const data = {
		tg_token_hash: hash,
		tg_token_exp: new Date(Date.now() + TELEGRAM_LINK_MINUTES * 60 * 1000).toISOString()
	};
	const existing = await findGuestNotify(adminPb, orderId);
	if (existing) {
		await adminPb.collection('guest_notify').update(existing.id, data);
	} else {
		try {
			await adminPb.collection('guest_notify').create({ order: orderId, ...data });
		} catch (err) {
			// PocketBase created it in the meantime (a booking change): use that one.
			const created = await findGuestNotify(adminPb, orderId);
			if (!created) throw err;
			await adminPb.collection('guest_notify').update(created.id, data);
		}
	}
	return telegramDeepLink(bot, token);
}

/** Stops Telegram updates for this ticket (the bot can be blocked as well). */
export async function disconnectTelegram(adminPb: TypedPocketBase, orderId: string): Promise<void> {
	const record = await findGuestNotify(adminPb, orderId);
	if (!record) return;
	await adminPb.collection('guest_notify').update(record.id, {
		tg_chat: '',
		tg_new: false,
		tg_spot: '',
		tg_label: '',
		tg_req: '',
		tg_token_hash: '',
		tg_token_exp: ''
	});
}

/**
 * How long ✨ Leave No Trace on the roulette holds a ticket's pending message back
 * (docs/admin/notifications.md, "One message per change").
 */
export const RESPIN_HOLD_MINUTES = 10;

/**
 * Postpones the message PocketBase has queued for this ticket.
 *
 * Guest messages are state based: every change marks the ticket as due, and a
 * delivery run sends one message about the difference once the ticket has been
 * quiet for about ten seconds (pb_hooks/lib/notify.js). Leave No Trace releases
 * the spot before the guest spins a new one, and spinning takes longer than
 * that settle time — so without this the guest gets "released" and then
 * "booked" for one respin. Pushing the mark out keeps the release quiet until
 * the new booking marks the ticket again (one "changed" message), or until the
 * hold runs out and the release is the news after all.
 *
 * Never throws: a notification problem must not break a release. At worst the
 * guest gets the two messages they got before.
 * @returns whether a queued message was held back
 */
export async function holdGuestMessage(
	adminPb: TypedPocketBase,
	orderId: string,
	minutes: number = RESPIN_HOLD_MINUTES
): Promise<boolean> {
	try {
		const record = await findGuestNotify(adminPb, orderId);
		// Nobody to tell (no address, no linked chat), or nothing queued.
		if (!record?.due) return false;
		await adminPb.collection('guest_notify').update(record.id, {
			due: new Date(Date.now() + minutes * 60 * 1000).toISOString()
		});
		return true;
	} catch (err) {
		console.error(
			`[Notify] Could not hold the release message of order ${orderId}:`,
			(err as Error)?.message
		);
		return false;
	}
}
