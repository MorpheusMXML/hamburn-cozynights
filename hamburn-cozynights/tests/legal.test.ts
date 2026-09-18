import { describe, it, expect } from 'vitest';
import { REQUIRED_LEGAL_VARS, parseLegalEnv } from '../src/lib/server/legal';

describe('legal page settings (LEGAL_* in .env)', () => {
	it('reports every required variable when nothing is set', () => {
		const info = parseLegalEnv({});
		expect(info.missing).toEqual(REQUIRED_LEGAL_VARS);
		expect(info.address).toEqual([]);
		expect(info.logRetentionDays).toBe(14);
		expect(info.deletionPeriod).toMatch(/vier Wochen/);
	});

	it('splits multi-line values at "|" and trims them', () => {
		const info = parseLegalEnv({
			LEGAL_NAME: ' Musterverein e.V. ',
			LEGAL_ADDRESS: 'Musterstraße 1 | 20095 Hamburg',
			LEGAL_EMAIL: 'hallo@example.org',
			LEGAL_HOSTER: 'Hosting GmbH|Serverweg 2|12345 Rechenstadt'
		});
		expect(info.missing).toEqual([]);
		expect(info.name).toBe('Musterverein e.V.');
		expect(info.address).toEqual(['Musterstraße 1', '20095 Hamburg']);
		expect(info.hoster).toHaveLength(3);
	});

	it('uses the general address for privacy requests unless one is set', () => {
		expect(parseLegalEnv({ LEGAL_EMAIL: 'a@example.org' }).privacyEmail).toBe('a@example.org');
		expect(
			parseLegalEnv({ LEGAL_EMAIL: 'a@example.org', LEGAL_PRIVACY_EMAIL: 'p@example.org' })
				.privacyEmail
		).toBe('p@example.org');
	});

	it('only accepts web links for the participation terms', () => {
		expect(parseLegalEnv({}).termsUrl).toBe('');
		expect(parseLegalEnv({ LEGAL_TERMS_URL: 'https://example.org/tb' }).termsUrl).toBe(
			'https://example.org/tb'
		);
		expect(parseLegalEnv({ LEGAL_TERMS_URL: 'javascript:alert(1)' }).termsUrl).toBe('');
		expect(parseLegalEnv({ LEGAL_TERMS_URL: 'example.org/tb' }).termsUrl).toBe('');
	});

	it('falls back to 14 days for an invalid log retention', () => {
		expect(parseLegalEnv({ LEGAL_LOG_RETENTION_DAYS: '7' }).logRetentionDays).toBe(7);
		expect(parseLegalEnv({ LEGAL_LOG_RETENTION_DAYS: 'zwei' }).logRetentionDays).toBe(14);
		expect(parseLegalEnv({ LEGAL_LOG_RETENTION_DAYS: '0' }).logRetentionDays).toBe(14);
	});
});
