/**
 * The signature on the guest session cookie.
 *
 * The cookie carries the ticket code and an HMAC over the code and the booking
 * round it was signed in for: `CODE.signature`. Only the server can write one,
 * so a made-up cookie is turned down before anything asks PocketBase, and a
 * guessed ticket code gets no answer through the cookie (docs/reference/security.md).
 * The key is derived from ENCRYPTION_KEY; a new key signs every guest out once.
 *
 * Plain Node without SvelteKit imports, so tests can use it directly.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const INFO = 'cozynights guest session v1';

/** The signing key, derived from the 64-character hex ENCRYPTION_KEY. */
export function guestSessionKey(encryptionKeyHex: string): Buffer {
	return Buffer.from(
		hkdfSync('sha256', Buffer.from(encryptionKeyHex, 'hex'), Buffer.alloc(0), INFO, 32)
	);
}

/** The cookie value for a ticket code signed in for `round`. */
export function signGuestCode(key: Buffer, code: string, round: number): string {
	const mac = createHmac('sha256', key).update(`${code}\n${round}`).digest('base64url');
	return `${code}.${mac}`;
}

/**
 * The ticket code of a cookie value, or null when the value was not signed by
 * this server for this round. Ticket codes never contain a dot.
 */
export function readSignedGuestCode(key: Buffer, value: string, round: number): string | null {
	const dot = value.lastIndexOf('.');
	if (dot <= 0) return null;
	const code = value.slice(0, dot);
	const given = Buffer.from(value);
	const expected = Buffer.from(signGuestCode(key, code, round));
	return given.length === expected.length && timingSafeEqual(given, expected) ? code : null;
}
