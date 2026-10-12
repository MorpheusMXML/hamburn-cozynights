/**
 * "Send me my code": a guest who mistyped their ticket code gives the e-mail
 * address of their ticket, and PocketBase mails the codes of that address
 * (collection code_mails, pb_hooks/lib/notify.js deliverCodeMails).
 *
 * The visitor never learns whether the address belongs to a ticket: the start
 * page answers the same either way, and this runs after the answer. A row is
 * only written for an address with a paid ticket, at most one per address in
 * 30 minutes and three a day — nobody can flood a stranger's inbox or use up
 * the mail quota through it.
 */
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { withLock } from '$lib/server/booking';

const MINUTE = 60 * 1000;
export const CODE_MAIL_LIMITS = { gap: 30 * MINUTE, perDay: 3 } as const;

export type CodeMailOutcome = 'queued' | 'no-ticket' | 'too-soon';

/** PocketBase's date format, for filters on `created`. */
function pbDate(ms: number): string {
	return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * Queues the code e-mail for `email` (already checked and in lower case), if
 * a paid ticket has that address and the limits allow it. What happened is
 * for logs and tests only — never show it to the visitor.
 */
export async function requestCodeMail(
	adminPb: TypedPocketBase,
	email: string,
	now = Date.now()
): Promise<CodeMailOutcome> {
	return withLock(`codemail:${email}`, async () => {
		const tickets = await adminPb.collection('orders').getList(1, 1, {
			filter: adminPb.filter('email = {:email} && unpaid != true && order_number != ""', {
				email
			}),
			fields: 'id',
			requestKey: null
		});
		if (tickets.totalItems === 0) return 'no-ticket';

		const today = await adminPb.collection('code_mails').getList(1, 1, {
			filter: adminPb.filter('email = {:email} && created >= {:since}', {
				email,
				since: pbDate(now - 24 * 60 * MINUTE)
			}),
			sort: '-created',
			fields: 'created',
			requestKey: null
		});
		const last = Date.parse(String(today.items[0]?.created ?? '').replace(' ', 'T'));
		if (
			today.totalItems >= CODE_MAIL_LIMITS.perDay ||
			(!Number.isNaN(last) && now - last < CODE_MAIL_LIMITS.gap)
		) {
			return 'too-soon';
		}

		await adminPb
			.collection('code_mails')
			.create({ email, due: pbDate(now), attempts: 0 }, { requestKey: null });
		return 'queued';
	});
}
