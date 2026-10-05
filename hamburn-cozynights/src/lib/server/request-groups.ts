// src/lib/server/request-groups.ts
/**
 * Request groups against PocketBase (collection request_groups,
 * pb_migrations/1760550000_request_groups.js; docs/admin/special-needs.md,
 * "Groups"): guests who ask for spots together — an art project, a workshop,
 * a theme camp, a crew or friends. A guest starts a group or joins one with
 * its code from the request form.
 *
 * A group has no status of its own. "Approve all", "Decline group" and
 * "Book spots for the group" write each member's own request through
 * decideRequest and assignSpot ($lib/server/special-requests.ts), so the
 * guest messages, fixed spots and every other request rule work unchanged;
 * the crew still decides and books each request on its own too. PocketBase
 * deletes a group when its last request leaves it (pb_hooks/cozy_groups.pb.js).
 *
 * Privacy: members see the group's name and the burner names in it, never
 * anyone's ticket, e-mail, needs, text, status or spot. The name is stored
 * encrypted; names, group names and codes never go into messages, the log or
 * the audit log (one count-only event per group step).
 *
 * Locks: every step on a group runs under `group:<id>` (withLock,
 * $lib/server/booking.ts), taken before the ticket and spot locks of a
 * booking. Not re-entrant: nothing in here calls itself under the same key.
 */
import { randomInt } from 'node:crypto';
import type { ClientResponseError } from 'pocketbase';
import type {
	OrdersResponse,
	RequestGroupsResponse,
	SpecialRequestsResponse,
	TypedPocketBase
} from '$lib/pocketbase-types';
import type { AdminSession } from '$lib/server/admin-auth';
import { logAdminEvent, logGuestEvent } from '$lib/server/admin-events';
import {
	BedUnavailableError,
	BookingService,
	ReleaseFailedError,
	withLock
} from '$lib/server/booking';
import { encrypt } from '$lib/server/crypto';
import {
	assignSpot,
	decideRequest,
	findRequest,
	isSpotFixed,
	readNeeds,
	readSecret,
	RequestError,
	saveRequest,
	ticketName,
	toSpot
} from '$lib/server/special-requests';
import { PASS_ALPHABET } from '$lib/pass';
import {
	GROUP_CODE_LENGTH,
	GROUP_MAX,
	formatGroupCode,
	requestKinds,
	type AdminGroupView,
	type GuestGroupView,
	type RequestInput
} from '$lib/special-needs';

export type { AdminGroupView, GuestGroupView };

/** A refused group step on the request form, shown at the field it concerns. */
export class GroupFieldError extends RequestError {
	constructor(
		message: string,
		public field: 'groupName' | 'groupCode',
		status = 400
	) {
		super(message, status);
		this.name = 'GroupFieldError';
	}
}

/** The answer to a code no group has. The guest page counts these (rate limit). */
export const UNKNOWN_CODE = 'No group has this code. Check it with someone in the group.';

const IN_A_GROUP = 'You are in a group already. Leave it first, then start or join another one.';
const GROUP_FULL = `This group is full: a group can have at most ${GROUP_MAX} people. Please contact the crew.`;
const GROUP_GONE = "This group doesn't exist anymore. Ask for a new link, or start a group.";
const TAKEN_OUT = "You can't join this group. Please contact the crew.";
/** A group without a readable name (another ENCRYPTION_KEY). */
const UNREADABLE_NAME = '(unreadable name)';

type RequestWithOrder = SpecialRequestsResponse<{ order?: OrdersResponse }>;

function statusOf(err: unknown): number | undefined {
	return (err as ClientResponseError | undefined)?.status;
}

function isNotFound(err: unknown): boolean {
	return statusOf(err) === 404;
}

/** The unique index on the code refused a new group (a clash of two random codes). */
function isCodeClash(err: unknown): boolean {
	const refused = err as ClientResponseError | undefined;
	return refused?.status === 400 && !!refused.response?.data?.code;
}

/** A group by id, or null when it is gone. */
async function findGroup(
	adminPb: TypedPocketBase,
	groupId: string
): Promise<RequestGroupsResponse | null> {
	try {
		return await adminPb.collection('request_groups').getOne(groupId);
	} catch (err) {
		if (isNotFound(err)) return null;
		throw err;
	}
}

/** The crew took this ticket out of the group: its code doesn't let it back in. */
function wasTakenOut(group: RequestGroupsResponse, orderId: string): boolean {
	return Array.isArray(group.removed) && group.removed.includes(orderId);
}

/** The requests in a group, oldest first, with their tickets. */
async function membersOf(adminPb: TypedPocketBase, groupId: string): Promise<RequestWithOrder[]> {
	return adminPb.collection('special_requests').getFullList<RequestWithOrder>({
		filter: adminPb.filter('request_group = {:group}', { group: groupId }),
		sort: 'created',
		expand: 'order'
	});
}

async function countMembers(adminPb: TypedPocketBase, groupId: string): Promise<number> {
	const page = await adminPb.collection('special_requests').getList(1, 1, {
		filter: adminPb.filter('request_group = {:group}', { group: groupId }),
		fields: 'id',
		requestKey: null
	});
	return page.totalItems;
}

/** How the crew calls a member in the planner and its messages. */
function memberName(request: RequestWithOrder): string {
	const order = request.expand?.order;
	return (
		(order ? ticketName(order) : '') ||
		readSecret(request.burner_name) ||
		readSecret(order?.burner_name) ||
		'Ticket without a name'
	);
}

/** A new group with a random code; a clash with an existing code rolls again. */
async function createGroup(adminPb: TypedPocketBase, name: string): Promise<RequestGroupsResponse> {
	for (let attempt = 0; ; attempt++) {
		const code = Array.from(
			{ length: GROUP_CODE_LENGTH },
			() => PASS_ALPHABET[randomInt(PASS_ALPHABET.length)]
		).join('');
		try {
			return await adminPb.collection('request_groups').create({ code, name: encrypt(name) });
		} catch (err) {
			if (attempt < 5 && isCodeClash(err)) continue;
			throw err;
		}
	}
}

/**
 * Saves the guest's request with what the form says about a group: keep it,
 * no group, start one, or join one by its code. The ticket comes from the
 * session, never from the form.
 * - start: a new group with the request in it (also for a request that
 *   waits already);
 * - join: the request goes into the group with this code; the group's size
 *   is checked and written under the group's lock; a ticket the crew took out
 *   of the group can't join it again;
 * - 'already': the request is in this group already.
 * Like any edit, an edit that starts or joins a group tells nobody; a new
 * request tells the crew chat that it started or joined a group.
 * @throws {GroupFieldError} unknown code, full group, in another group already,
 *   taken out of this group by the crew
 * @throws {RequestError} when the crew has already decided on the request
 */
export async function saveGuestRequest(
	adminPb: TypedPocketBase,
	order: Pick<OrdersResponse, 'id'>,
	input: RequestInput
): Promise<{ saved: 'created' | 'updated'; group: 'started' | 'joined' | 'already' | null }> {
	const existing = await findRequest(adminPb, order.id);
	const choice = input.group;

	if (choice.mode === 'keep' || choice.mode === 'none') {
		return { saved: await saveRequest(adminPb, order, input), group: null };
	}

	if (choice.mode === 'start') {
		if (existing?.request_group) throw new GroupFieldError(IN_A_GROUP, 'groupName', 409);
		const created = await createGroup(adminPb, choice.name);
		try {
			const saved = await saveRequest(adminPb, order, input, {
				requestGroup: created.id,
				groupEvent: 'started'
			});
			return { saved, group: 'started' };
		} catch (err) {
			// Nobody is in it: no empty group with a name stays behind.
			await adminPb
				.collection('request_groups')
				.delete(created.id)
				.catch(() => {});
			throw err;
		}
	}

	let target: RequestGroupsResponse;
	try {
		target = await adminPb
			.collection('request_groups')
			.getFirstListItem(adminPb.filter('code = {:code}', { code: choice.code }));
	} catch (err) {
		if (isNotFound(err)) throw new GroupFieldError(UNKNOWN_CODE, 'groupCode');
		throw err;
	}
	if (existing?.request_group === target.id) {
		return { saved: await saveRequest(adminPb, order, input), group: 'already' };
	}
	if (existing?.request_group) throw new GroupFieldError(IN_A_GROUP, 'groupCode', 409);
	// Not UNKNOWN_CODE: the code is right, so it doesn't count as a miss.
	if (wasTakenOut(target, order.id)) throw new GroupFieldError(TAKEN_OUT, 'groupCode', 403);

	return withLock(`group:${target.id}`, async () => {
		// Fresh under the lock: the crew may have taken this ticket out meanwhile.
		const group = await findGroup(adminPb, target.id);
		if (!group) throw new GroupFieldError(GROUP_GONE, 'groupCode', 409);
		if (wasTakenOut(group, order.id)) throw new GroupFieldError(TAKEN_OUT, 'groupCode', 403);
		if ((await countMembers(adminPb, target.id)) >= GROUP_MAX) {
			throw new GroupFieldError(GROUP_FULL, 'groupCode', 409);
		}
		try {
			const saved = await saveRequest(adminPb, order, input, {
				requestGroup: target.id,
				groupEvent: 'joined'
			});
			return { saved, group: 'joined' as const };
		} catch (err) {
			// The relation refused a group that its last member just left.
			const status = statusOf(err);
			if (
				!(err instanceof RequestError) &&
				(status === 400 || status === 404) &&
				!(await findGroup(adminPb, target.id))
			) {
				throw new GroupFieldError(GROUP_GONE, 'groupCode', 409);
			}
			throw err;
		}
	});
}

/**
 * What the guest sees of their group, or null when the request is in none.
 * Only the group's name, its code and link, and the burner names in it: the
 * request's own name, else "A fellow burner". The own entry first, the others
 * by name.
 * @param origin the app's origin, for the invite link
 */
export async function getGuestGroup(
	adminPb: TypedPocketBase,
	orderId: string,
	origin: string
): Promise<GuestGroupView | null> {
	const request = await findRequest(adminPb, orderId);
	if (!request?.request_group) return null;
	const group = await findGroup(adminPb, request.request_group);
	if (!group) return null;

	// Only the fields the names come from: nothing else of anyone is read. Never
	// the booking's name: it only exists once the crew booked a spot, so it
	// would tell the others who got one.
	const rows = await adminPb.collection('special_requests').getFullList<SpecialRequestsResponse>({
		filter: adminPb.filter('request_group = {:group}', { group: group.id }),
		fields: 'id,order,burner_name'
	});
	const members = rows
		.map((row) => ({
			name: readSecret(row.burner_name) || 'A fellow burner',
			you: row.order === orderId
		}))
		.sort(
			(a, b) =>
				Number(b.you) - Number(a.you) || a.name.localeCompare(b.name, 'en', { numeric: true })
		);

	return {
		name: readSecret(group.name) || UNREADABLE_NAME,
		code: formatGroupCode(group.code),
		link: `${origin}/special-needs?group=${group.code}`,
		members,
		max: GROUP_MAX,
		full: members.length >= GROUP_MAX
	};
}

/**
 * The guest leaves their group: always possible, in every status and while
 * requests are closed (it withdraws consent). A request that was only about
 * the group (nothing ticked) is deleted, like a withdrawal; one with own needs
 * stays with the crew, without the group. PocketBase deletes the group when
 * it is empty now.
 * @returns what happened, and how many are still in the group
 * @throws {RequestError} 404 when the ticket's request is in no group
 */
export async function leaveGroup(
	adminPb: TypedPocketBase,
	orderId: string
): Promise<{ outcome: 'left' | 'withdrawn'; members: number }> {
	const request = await findRequest(adminPb, orderId);
	const groupId = request?.request_group;
	if (!request || !groupId) throw new RequestError('You are not in a group.', 404);

	return withLock(`group:${groupId}`, async () => {
		let outcome: 'left' | 'withdrawn';
		if (requestKinds(readNeeds(request.needs)).groupOnly) {
			await adminPb.collection('special_requests').delete(request.id);
			await logGuestEvent(adminPb, 'special_request_withdrawn', request.id, {
				status: request.status,
				group: true
			});
			outcome = 'withdrawn';
		} else {
			await adminPb.collection('special_requests').update(request.id, { request_group: '' });
			outcome = 'left';
		}
		const members = await countMembers(adminPb, groupId).catch(() => 0);
		return { outcome, members };
	});
}

/** Every group with its members for the admin area, oldest first. */
export async function listGroups(adminPb: TypedPocketBase): Promise<AdminGroupView[]> {
	const [groups, grouped] = await Promise.all([
		adminPb.collection('request_groups').getFullList({ sort: 'created' }),
		adminPb.collection('special_requests').getFullList({
			filter: 'request_group != ""',
			fields: 'id,request_group',
			sort: 'created'
		})
	]);
	const members = new Map<string, string[]>();
	for (const request of grouped) {
		const list = members.get(request.request_group) ?? [];
		list.push(request.id);
		members.set(request.request_group, list);
	}
	return groups
		.map((group) => ({
			id: group.id,
			name: readSecret(group.name) || UNREADABLE_NAME,
			code: formatGroupCode(group.code),
			created: group.created,
			memberIds: members.get(group.id) ?? []
		}))
		.filter((group) => group.memberIds.length > 0);
}

/**
 * Approves every waiting request of the group, or declines every request that
 * isn't declined yet — except those whose spot the crew booked (release it
 * first): they are counted as skipped. Requests the crew already decided stay
 * as they are on approve. Each guest gets their own message (PocketBase); the
 * crew chat gets one line for the group.
 * @throws {RequestError} 409 when nothing in the group waits for this
 */
export async function decideGroup(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	groupId: string,
	decision: 'approved' | 'declined'
): Promise<{ changed: number; skipped: number }> {
	return withLock(`group:${groupId}`, async () => {
		const members = await membersOf(adminPb, groupId);
		let changed = 0;
		let skipped = 0;
		const log = () =>
			logAdminEvent(
				adminPb,
				admin,
				decision === 'approved' ? 'request_group_approved' : 'request_group_declined',
				groupId,
				{ changed, skipped }
			);

		try {
			for (const member of members) {
				if (member.status === decision) continue;
				if (decision === 'approved' && member.status !== 'pending') continue;
				if (
					decision === 'declined' &&
					member.status === 'approved' &&
					(await isSpotFixed(adminPb, member.order))
				) {
					skipped++;
					continue;
				}
				try {
					await decideRequest(adminPb, admin, member.id, decision, { log: false });
					changed++;
				} catch (err) {
					if (!(err instanceof RequestError)) throw err;
					skipped++;
				}
			}
		} catch (err) {
			// What changed before the failure still gets its line in the crew chat.
			if (changed > 0) await log();
			throw err;
		}

		if (changed === 0) {
			throw new RequestError(
				'Nothing to change: no request in this group waits for this. Reload the page.',
				409
			);
		}
		await log();
		return { changed, skipped };
	});
}

/**
 * Books the picked spots for the group's members — whatever the booking
 * phase, ♿ and locked spots included — and approves waiting requests on the
 * way, like assignSpot does for one request. Every pick is checked first
 * (members, duplicates, declined requests, free spots): one problem and
 * nothing is booked. Then it books one member after the other and doesn't
 * roll back: a member whose booking fails (the spot was taken meanwhile, the
 * request withdrawn) ends up in `failed`, the others stay booked.
 * @param picks request id → bed id; an empty bed id or the member's current
 *   spot changes nothing ("Keep as is")
 * @throws {RequestError} when a check fails; nothing was booked then
 */
export async function assignGroup(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	groupId: string,
	picks: { requestId: string; bedId: string }[]
): Promise<{
	booked: number;
	approved: number;
	failed: { requestId: string; name: string; message: string }[];
}> {
	return withLock(`group:${groupId}`, async () => {
		if (!(await findGroup(adminPb, groupId))) {
			throw new RequestError("This group doesn't exist anymore. Reload the page.", 404);
		}
		const members = await membersOf(adminPb, groupId);
		const byId = new Map(members.map((member) => [member.id, member]));
		const booking = new BookingService(adminPb);

		// Rows left on "Keep as is" change nothing; each member counts once.
		const chosen: { member: RequestWithOrder; bedId: string }[] = [];
		const seen = new Set<string>();
		for (const pick of picks) {
			if (!pick.bedId || seen.has(pick.requestId)) continue;
			seen.add(pick.requestId);
			const member = byId.get(pick.requestId);
			if (!member) {
				throw new RequestError(
					'Someone left the group meanwhile, so nothing was booked. Reload the page.',
					409
				);
			}
			const current = await booking.getBedForOrder(member.order);
			if (current?.id === pick.bedId) continue;
			chosen.push({ member, bedId: pick.bedId });
		}
		if (chosen.length === 0) throw new RequestError('Pick a spot for at least one member.', 400);

		const beds = new Set<string>();
		for (const { bedId } of chosen) {
			if (beds.has(bedId)) {
				throw new RequestError(
					'Two members got the same spot. Pick a different one for each.',
					400
				);
			}
			beds.add(bedId);
		}
		for (const { member } of chosen) {
			if (member.status === 'declined') {
				throw new RequestError(
					`${memberName(member)}'s request is declined: approve it first, or leave their spot on Keep as is.`,
					409
				);
			}
		}
		// Fresh reads: a spot taken since the page loaded stops everything.
		for (const { member, bedId } of chosen) {
			let bed;
			try {
				bed = await adminPb
					.collection('beds')
					.getOne<Parameters<typeof toSpot>[0]>(bedId, { expand: 'room,room.house' });
			} catch (err) {
				if (isNotFound(err)) {
					throw new RequestError(
						"A picked spot doesn't exist anymore, so nothing was booked. Reload the page and pick again.",
						409
					);
				}
				throw err;
			}
			const free = !bed.order ? !bed.occupied : bed.order === member.order;
			if (bed.enabled === false || !free) {
				throw new RequestError(
					`${toSpot(bed).label} is not free anymore, so nothing was booked. Reload the page and pick again.`,
					409
				);
			}
		}

		let booked = 0;
		let approved = 0;
		const failed: { requestId: string; name: string; message: string }[] = [];
		for (const { member, bedId } of chosen) {
			try {
				const outcome = await assignSpot(adminPb, admin, member.id, bedId, { log: false });
				booked++;
				if (outcome.approved) approved++;
			} catch (err) {
				failed.push({ requestId: member.id, name: memberName(member), message: failure(err) });
			}
		}
		await logAdminEvent(adminPb, admin, 'request_group_booked', groupId, {
			booked,
			approved,
			failed: failed.length
		});
		return { booked, approved, failed };
	});
}

/** Why one member's booking failed, in the words of the single booking (admin/requests). */
function failure(err: unknown): string {
	if (err instanceof RequestError) return err.message;
	if (err instanceof BedUnavailableError) return `${err.message} Pick another spot.`;
	if (err instanceof ReleaseFailedError) return err.message;
	if (isNotFound(err)) return "Something here doesn't exist anymore.";
	console.error('[RequestGroups] Booking a member failed:', (err as Error)?.message);
	return 'The server could not book this spot.';
}

/**
 * The crew takes a request out of its group (a stranger joined with a leaked
 * code, or someone asked for it). The request stays as it is; the guest sees
 * it on their page and gets no message. The group remembers the ticket, so
 * its code doesn't let it back in, not even after a withdrawal and a new
 * request. PocketBase deletes the group when it is empty now.
 * @throws {RequestError} when the request is gone or in no group
 */
export async function removeFromGroup(
	adminPb: TypedPocketBase,
	admin: AdminSession,
	requestId: string
): Promise<void> {
	let request: SpecialRequestsResponse;
	try {
		request = await adminPb.collection('special_requests').getOne(requestId);
	} catch (err) {
		if (isNotFound(err)) {
			throw new RequestError(
				'This request does not exist anymore. The guest may have withdrawn it. Reload the page.',
				404
			);
		}
		throw err;
	}
	const groupId = request.request_group;
	if (!groupId) {
		throw new RequestError('This request is not in a group anymore. Reload the page.', 409);
	}
	await withLock(`group:${groupId}`, async () => {
		// The ticket first, then the request: PocketBase can then still delete a
		// group that is empty now.
		const group = await findGroup(adminPb, groupId);
		if (group && !wasTakenOut(group, request.order)) {
			const removed = Array.isArray(group.removed) ? group.removed : [];
			await adminPb.collection('request_groups').update(groupId, {
				removed: [...removed, request.order]
			});
		}
		await adminPb.collection('special_requests').update(request.id, { request_group: '' });
	});
	await logAdminEvent(adminPb, admin, 'request_group_member_removed', request.id, {});
}
