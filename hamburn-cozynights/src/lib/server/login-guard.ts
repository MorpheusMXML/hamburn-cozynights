/**
 * How the start page slows down guessing ticket codes (docs/reference/security.md,
 * "Guessing ticket codes"). Ticket codes are short — a pretix order code has
 * five characters — so wrong codes are counted per connection, and the steps
 * get stricter:
 *
 * - 3 wrong codes: the page offers to e-mail the ticket code (`offerMail`).
 * - 5: for 30 minutes the code only works together with the ticket's e-mail
 *   address (`needEmail`).
 * - 10: 15 minutes of nothing (`blockedFor`).
 * - 13: three hours of nothing.
 *
 * A connection is an IPv4 address or an IPv6 /64 — one machine can pick any
 * address of its /64, so counting single IPv6 addresses would count nothing.
 * Wrong codes count for three hours after the last one; a right code doesn't
 * reset the count (a guesser with a ticket of their own could reset it
 * between guesses otherwise).
 *
 * Over everyone: more than 200 wrong codes within 10 minutes is an attack,
 * not typos — for 30 minutes every sign-in needs the e-mail address too, and
 * the crew hears about it once.
 *
 * State lives in this one server process like the other limiters
 * ($lib/server/rate-limit); a restart forgets it.
 */
import { isIP } from 'node:net';

const MINUTE = 60 * 1000;

export const LOGIN_STEPS = { offerMail: 3, needEmail: 5, block: 10, longBlock: 13 } as const;
export const LOGIN_TIMES = {
	window: 180 * MINUTE,
	needEmail: 30 * MINUTE,
	block: 15 * MINUTE,
	longBlock: 180 * MINUTE,
	everyoneWindow: 10 * MINUTE,
	everyoneLock: 30 * MINUTE
} as const;
export const EVERYONE_LIMIT = 200;

/** What the start page asks of the next sign-in from a connection. */
export interface LoginStep {
	/** Milliseconds until it may try again; 0 = it may. */
	blockedFor: number;
	/** The code only works together with the ticket's e-mail address. */
	needEmail: boolean;
	/** Offer to e-mail the code. */
	offerMail: boolean;
}

/**
 * The connection a request comes from: an IPv4 address, or the /64 of an IPv6
 * address (an IPv4 address written as IPv6 counts as IPv4).
 */
export function connectionKey(address: string): string {
	const value = address.trim();
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
	if (mapped && isIP(mapped[1]) === 4) return mapped[1];
	if (isIP(value) === 4) return value;
	if (isIP(value) !== 6) return 'unknown';

	const [head, tail = ''] = value.toLowerCase().split('::');
	const front = head ? head.split(':') : [];
	const back = value.includes('::') ? (tail ? tail.split(':') : []) : [];
	const groups = value.includes('::')
		? [...front, ...Array(8 - front.length - back.length).fill('0'), ...back]
		: front;
	return `${groups
		.slice(0, 4)
		.map((g) => g.padStart(4, '0'))
		.join(':')}::/64`;
}

interface Connection {
	failures: number[];
	blockedUntil: number;
	needEmailUntil: number;
	/** The 15-minute stop was given (it comes once per count). */
	stopped: boolean;
}

export class LoginGuard {
	private connections = new Map<string, Connection>();
	private everyone: number[] = [];
	private everyoneUntil = 0;

	/** `onEveryoneLock` hears once per lock that the 200 were passed, with the count. */
	constructor(private readonly onEveryoneLock: (failures: number) => void = () => {}) {}

	/** What the next sign-in from `key` has to do. */
	step(key: string, now = Date.now()): LoginStep {
		const c = this.current(key, now);
		const needEmail = now < (c?.needEmailUntil ?? 0) || now < this.everyoneUntil;
		return {
			blockedFor: Math.max(0, (c?.blockedUntil ?? 0) - now),
			needEmail,
			offerMail: needEmail || (c?.failures.length ?? 0) >= LOGIN_STEPS.offerMail
		};
	}

	/**
	 * Counts a sign-in attempt as wrong before its code is looked up, so
	 * parallel guesses can't all slip in under a step. Returns the undo for an
	 * attempt that turns out right.
	 */
	attempt(key: string, now = Date.now()): () => void {
		const c = this.current(key, now) ?? {
			failures: [],
			blockedUntil: 0,
			needEmailUntil: 0,
			stopped: false
		};
		const before = { ...c, failures: undefined };
		c.failures.push(now);
		const count = c.failures.length;
		if (count >= LOGIN_STEPS.needEmail) c.needEmailUntil = now + LOGIN_TIMES.needEmail;
		if (count >= LOGIN_STEPS.longBlock) {
			c.blockedUntil = now + LOGIN_TIMES.longBlock;
		} else if (count >= LOGIN_STEPS.block && !c.stopped) {
			c.blockedUntil = now + LOGIN_TIMES.block;
			c.stopped = true;
		}
		const after = { ...c, failures: undefined };
		this.connections.set(key, c);
		this.countForEveryone(now);
		if (this.connections.size > 20_000) this.prune(now);

		let undone = false;
		return () => {
			if (undone) return;
			undone = true;
			const i = c.failures.lastIndexOf(now);
			if (i >= 0) c.failures.splice(i, 1);
			// Only what this attempt set: a parallel wrong one may have set more.
			if (c.blockedUntil === after.blockedUntil) c.blockedUntil = before.blockedUntil;
			if (c.needEmailUntil === after.needEmailUntil) c.needEmailUntil = before.needEmailUntil;
			if (c.stopped === after.stopped) c.stopped = before.stopped;
			const j = this.everyone.lastIndexOf(now);
			if (j >= 0) this.everyone.splice(j, 1);
		};
	}

	/** Whether every sign-in needs the e-mail address right now. */
	everyoneLocked(now = Date.now()): boolean {
		return now < this.everyoneUntil;
	}

	private current(key: string, now: number): Connection | undefined {
		const c = this.connections.get(key);
		if (!c) return undefined;
		c.failures = c.failures.filter((at) => now - at < LOGIN_TIMES.window);
		if (!c.failures.length && now >= c.blockedUntil && now >= c.needEmailUntil) {
			// nothing left to remember: the stop comes again with the next 10
			this.connections.delete(key);
			return undefined;
		}
		return c;
	}

	private countForEveryone(now: number) {
		this.everyone.push(now);
		const from = now - LOGIN_TIMES.everyoneWindow;
		let drop = 0;
		while (drop < this.everyone.length && this.everyone[drop] <= from) drop++;
		// Past the limit the exact number doesn't matter: keep the list short.
		drop = Math.max(drop, this.everyone.length - 1000);
		if (drop > 0) this.everyone.splice(0, drop);
		if (this.everyone.length > EVERYONE_LIMIT && now >= this.everyoneUntil) {
			this.everyoneUntil = now + LOGIN_TIMES.everyoneLock;
			try {
				this.onEveryoneLock(this.everyone.length);
			} catch {
				// telling the crew must never fail a sign-in
			}
		}
	}

	private prune(now: number) {
		for (const key of [...this.connections.keys()]) this.current(key, now);
	}
}
