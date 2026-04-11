// src/lib/server/crypto.ts
import crypto from 'crypto';
import { env } from '$env/dynamic/private';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HASH_ALGORITHM = 'sha256';

/**
 * Encrypts a string using AES-256-GCM.
 * The result is a hex string containing IV, ciphertext, and authentication tag.
 */
export function encrypt(text: string): string {
	const key = Buffer.from(env.ENCRYPTION_KEY || '', 'hex');
	if (key.length !== 32)
		throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');

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
 */
export function decrypt(encryptedText: string): string {
	const key = Buffer.from(env.ENCRYPTION_KEY || '', 'hex');
	if (key.length !== 32)
		throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');

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
 */
export function createLookupHash(text: string): string {
	const salt = env.ENCRYPTION_KEY || 'default_salt';
	return crypto.createHmac(HASH_ALGORITHM, salt).update(text).digest('hex');
}
