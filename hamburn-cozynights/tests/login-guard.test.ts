// tests/login-guard.test.ts — the steps against guessing ticket codes
// ($lib/server/login-guard): per connection, and over everyone.
import { describe, it, expect, vi } from 'vitest';
import {
	EVERYONE_LIMIT,
	LOGIN_TIMES,
	LoginGuard,
	connectionKey
} from '../src/lib/server/login-guard';

const MINUTE = 60 * 1000;

/** `n` wrong codes from `key`, one second apart, starting at `from`; returns the time after. */
function wrong(guard: LoginGuard, key: string, n: number, from: number): number {
	let at = from;
	for (let i = 0; i < n; i++) guard.attempt(key, (at += 1000));
	return at;
}

describe('connectionKey', () => {
	it('keeps an IPv4 address, also written as IPv6', () => {
		expect(connectionKey('203.0.113.7')).toBe('203.0.113.7');
		expect(connectionKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
	});

	it('counts an IPv6 address by its /64', () => {
		const a = connectionKey('2a01:4f8:c0c:1234:aaaa:bbbb:cccc:dddd');
		expect(a).toBe('2a01:04f8:0c0c:1234::/64');
		expect(connectionKey('2a01:4f8:c0c:1234::1')).toBe(a);
		expect(connectionKey('2A01:04F8:0C0C:1234:1:2:3:4')).toBe(a);
		expect(connectionKey('2a01:4f8:c0c:1235::1')).not.toBe(a);
		expect(connectionKey('::1')).toBe('0000:0000:0000:0000::/64');
	});

	it('names anything else "unknown"', () => {
		expect(connectionKey('')).toBe('unknown');
		expect(connectionKey('not an address')).toBe('unknown');
	});
});

describe('LoginGuard, one connection', () => {
	it('offers the e-mail after 3 wrong codes, asks for it after 5', () => {
		const guard = new LoginGuard();
		let at = wrong(guard, 'a', 2, 0);
		expect(guard.step('a', at)).toEqual({ blockedFor: 0, needEmail: false, offerMail: false });
		at = wrong(guard, 'a', 1, at);
		expect(guard.step('a', at)).toEqual({ blockedFor: 0, needEmail: false, offerMail: true });
		at = wrong(guard, 'a', 2, at);
		expect(guard.step('a', at)).toEqual({ blockedFor: 0, needEmail: true, offerMail: true });
		// the code-and-address step lasts 30 minutes after the last wrong code
		expect(guard.step('a', at + LOGIN_TIMES.needEmail - 1).needEmail).toBe(true);
		expect(guard.step('a', at + LOGIN_TIMES.needEmail).needEmail).toBe(false);
	});

	it('stops 15 minutes after 10 wrong codes, then three hours after 3 more', () => {
		const guard = new LoginGuard();
		let at = wrong(guard, 'a', 10, 0);
		expect(guard.step('a', at).blockedFor).toBe(LOGIN_TIMES.block);
		at += LOGIN_TIMES.block;
		expect(guard.step('a', at).blockedFor).toBe(0);
		at = wrong(guard, 'a', 2, at);
		expect(guard.step('a', at).blockedFor).toBe(0);
		at = wrong(guard, 'a', 1, at);
		expect(guard.step('a', at).blockedFor).toBe(LOGIN_TIMES.longBlock);
	});

	it('forgets wrong codes three hours after the last one', () => {
		const guard = new LoginGuard();
		const at = wrong(guard, 'a', 4, 0);
		expect(guard.step('a', at + LOGIN_TIMES.window + 1000)).toEqual({
			blockedFor: 0,
			needEmail: false,
			offerMail: false
		});
	});

	it('counts other connections apart', () => {
		const guard = new LoginGuard();
		const at = wrong(guard, 'a', 10, 0);
		expect(guard.step('b', at)).toEqual({ blockedFor: 0, needEmail: false, offerMail: false });
	});

	it('takes back an attempt that was right, but not what a parallel wrong one set', () => {
		const guard = new LoginGuard();
		let at = wrong(guard, 'a', 2, 0);
		const right = guard.attempt('a', (at += 1000));
		right();
		expect(guard.step('a', at).offerMail).toBe(false);

		// The 10th attempt is a right code, a wrong one runs in parallel: the
		// stop moves to the next wrong code instead of getting lost.
		at = wrong(guard, 'a', 7, at);
		const tenth = guard.attempt('a', (at += 1000));
		guard.attempt('a', (at += 1000));
		tenth();
		expect(guard.step('a', at).blockedFor).toBe(0);
		at = wrong(guard, 'a', 1, at);
		expect(guard.step('a', at).blockedFor).toBe(LOGIN_TIMES.block);

		// Undoing an earlier attempt never lifts the three-hour stop a later one set.
		const other = new LoginGuard();
		let t = wrong(other, 'b', 9, 0);
		const early = other.attempt('b', (t += 1000));
		t = wrong(other, 'b', 3, t);
		early();
		expect(other.step('b', t).blockedFor).toBe(LOGIN_TIMES.longBlock);
	});
});

describe('LoginGuard, everyone', () => {
	it('asks everyone for the e-mail for 30 minutes past 200 wrong codes, and tells the crew once', () => {
		const told = vi.fn();
		const guard = new LoginGuard(told);
		let at = 0;
		for (let i = 0; i < EVERYONE_LIMIT; i++) guard.attempt(`guesser-${i}`, (at += 100));
		expect(guard.step('someone', at).needEmail).toBe(false);
		guard.attempt('guesser-last', (at += 100));
		expect(guard.everyoneLocked(at)).toBe(true);
		expect(guard.step('someone', at)).toEqual({ blockedFor: 0, needEmail: true, offerMail: true });
		expect(told).toHaveBeenCalledTimes(1);
		expect(told).toHaveBeenCalledWith(EVERYONE_LIMIT + 1);

		for (let i = 0; i < 50; i++) guard.attempt(`more-${i}`, (at += 100));
		expect(told).toHaveBeenCalledTimes(1);
		expect(guard.everyoneLocked(at + LOGIN_TIMES.everyoneLock)).toBe(false);
	});

	it('does not add up typos spread over more than 10 minutes', () => {
		const guard = new LoginGuard();
		let at = 0;
		for (let i = 0; i < EVERYONE_LIMIT * 2; i++) guard.attempt(`typo-${i}`, (at += 4 * MINUTE));
		expect(guard.everyoneLocked(at)).toBe(false);
	});
});
