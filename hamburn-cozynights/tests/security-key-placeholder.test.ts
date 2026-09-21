// tests/security-key-placeholder.test.ts — the sample value of .env.example (or
// any "aaaa…" typed in a hurry) is refused: it is a placeholder, not a key.
import { describe, it, expect, vi } from 'vitest';
import { assertEncryptionKey, encrypt } from '../src/lib/server/crypto';

vi.mock('$env/dynamic/private', () => ({
	env: { ENCRYPTION_KEY: '0'.repeat(64) }
}));

describe('ENCRYPTION_KEY placeholder', () => {
	it('refuses 64 times the same character although it is valid hex', () => {
		expect(() => assertEncryptionKey()).toThrow(/placeholder/);
		expect(() => encrypt('Dusty Nomad')).toThrow(/placeholder/);
	});
});
