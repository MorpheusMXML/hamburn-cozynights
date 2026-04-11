// tests/security.test.ts
import { describe, it, expect, vi } from 'vitest';
import { encrypt, decrypt, createLookupHash } from '../src/lib/server/crypto';

// Mock environment variables
vi.mock('$env/dynamic/private', () => ({
	env: {
		ENCRYPTION_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
	}
}));

describe('Security Utilities', () => {
	it('should encrypt and decrypt correctly', () => {
		const secret = 'Dusty Nomad #123';
		const encrypted = encrypt(secret);
		expect(encrypted).toContain(':');

		const decrypted = decrypt(encrypted);
		expect(decrypted).toBe(secret);
	});

	it('should produce deterministic lookup hashes', () => {
		const orderNumber = 'HAM-2025-ABCD';
		const hash1 = createLookupHash(orderNumber);
		const hash2 = createLookupHash(orderNumber);

		expect(hash1).toBe(hash2);
		expect(hash1).toHaveLength(64); // SHA-256 hex length
	});

	it('should fallback gracefully for non-encrypted strings', () => {
		const plain = 'regular_string';
		expect(decrypt(plain)).toBe(plain);
	});
});
