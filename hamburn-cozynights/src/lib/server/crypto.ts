// src/lib/server/crypto.ts
import crypto from 'crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HASH_ALGORITHM = 'sha256';
const KEY_PATTERN = /^[0-9a-f]{64}$/i;
const KEY_ERROR = 'ENCRYPTION_KEY must be a 64-character hex string (32 bytes).';

/**
 * The configured key, or an error. Every code path that touches guest data
 * goes through here: there is no fallback key, so a container with a missing
 * or mistyped key cannot silently write data that a correctly configured one
 * can't read (or hash ticket codes that never match again).
 * @throws Error if ENCRYPTION_KEY is missing or invalid.
 */
function requireKeyHex(): string {
	const hex = env.ENCRYPTION_KEY || '';
	if (!KEY_PATTERN.test(hex)) throw new Error(KEY_ERROR);
	// 64 times the same character is a placeholder, never a generated key.
	if (/^(.)\1{63}$/.test(hex)) {
		throw new Error(
			'ENCRYPTION_KEY is a placeholder (one repeated character): generate one with `openssl rand -hex 32`.'
		);
	}
	return hex;
}

/** Checks the key once, e.g. at startup. @throws Error if it is unusable. */
export function assertEncryptionKey(): void {
	requireKeyHex();
}

/**
 * Encrypts a string using AES-256-GCM.
 * The result is a hex string containing IV, ciphertext, and authentication tag.
 * @param text The plaintext string to encrypt.
 * @returns A formatted string: `iv:tag:ciphertext`.
 * @throws Error if ENCRYPTION_KEY is missing or invalid.
 */
export function encrypt(text: string): string {
	const key = Buffer.from(requireKeyHex(), 'hex');

	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(text, 'utf8', 'hex');
	encrypted += cipher.final('hex');

	const tag = cipher.getAuthTag().toString('hex');

	// Format: iv(hex):tag(hex):ciphertext(hex)
	return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts a hex string (iv:tag:ciphertext) back to its original value.
 * @param encryptedText The formatted encrypted string to decrypt.
 * @returns The original plaintext string.
 * @throws Error if ENCRYPTION_KEY is invalid.
 */
export function decrypt(encryptedText: string): string {
	const key = Buffer.from(requireKeyHex(), 'hex');

	const [ivHex, tagHex, ciphertextHex] = encryptedText.split(':');
	if (!ivHex || !tagHex || !ciphertextHex) {
		// Fallback for non-encrypted data (useful during migration/local dev)
		return encryptedText;
	}

	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);

	let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
	decrypted += decipher.final('utf8');

	return decrypted;
}

/**
 * Creates a deterministic SHA-256 hash for database lookups.
 * Includes a salt derived from the ENCRYPTION_KEY for added security.
 * @param text The input string to hash (e.g., an order number).
 * @returns A deterministic hex hash.
 * @throws Error if ENCRYPTION_KEY is missing or invalid.
 */
export function createLookupHash(text: string): string {
	// The hex string itself is the HMAC key (not its bytes): existing hashes in
	// the database were made this way, changing it would orphan every ticket.
	return crypto.createHmac(HASH_ALGORITHM, requireKeyHex()).update(text).digest('hex');
}

/**
 * A secret derived from the key for one purpose (`label`) and one value, e.g.
 * the token Apple's devices send back with every request about a wallet pass.
 * Nothing to store: the same key, label and value always give the same token,
 * and a token for one purpose or value is useless for any other.
 * @returns 32 hex characters (128 bits)
 * @throws Error if ENCRYPTION_KEY is missing or invalid.
 */
export function derivedToken(label: string, value: string): string {
	const key = crypto
		.createHmac(HASH_ALGORITHM, Buffer.from(requireKeyHex(), 'hex'))
		.update(`cozynights:${label}`)
		.digest();
	return crypto.createHmac(HASH_ALGORITHM, key).update(value).digest('hex').slice(0, 32);
}
