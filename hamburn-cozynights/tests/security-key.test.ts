// tests/security-key.test.ts — a missing or mistyped ENCRYPTION_KEY must be
// refused by every function, never replaced by a built-in fallback (which
// would hash ticket codes that no correctly configured server can find).
import { describe, it, expect, vi } from 'vitest';
import { assertEncryptionKey, createLookupHash, decrypt, encrypt } from '../src/lib/server/crypto';

vi.mock('$env/dynamic/private', () => ({
	env: { ENCRYPTION_KEY: 'too-short' }
}));

describe('ENCRYPTION_KEY validation', () => {
	it('refuses an invalid key at startup', () => {
		expect(() => assertEncryptionKey()).toThrow(/64-character hex/);
	});

	it('never falls back to a default salt for lookup hashes', () => {
		expect(() => createLookupHash('HAM-2025-ABCD')).toThrow(/64-character hex/);
	});

	it('neither encrypts nor decrypts with it', () => {
		expect(() => encrypt('Dusty Nomad')).toThrow(/64-character hex/);
		expect(() => decrypt('00:11:22')).toThrow(/64-character hex/);
	});
});
