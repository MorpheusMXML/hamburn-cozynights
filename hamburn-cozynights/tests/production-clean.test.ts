// Production shows and sends nothing of the test setup: no [STAGING] marker,
// no staging address, no test wording in the sender or the top bar. The
// booking phase "Staging" (the crew's setup mode) is not meant here: it stays,
// guests just read "In Preparation" in the top bar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PHASE_PILL_LABELS } from '../src/lib/booking-phase';
import { EVENT_YEAR } from '../src/lib/event';

const root = path.resolve(__dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
/** The lines that take effect: comments and blank lines dropped. */
const activeLines = (text: string) =>
	text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

describe('production stack', () => {
	const compose = read('docker-compose.production.yml');
	const template = read('deploy/production.env.template');

	it('never passes an environment marker to PocketBase', () => {
		expect(activeLines(compose).some((line) => /\bCOZY_ENV_LABEL\s*:/.test(line))).toBe(false);
	});

	it('links messages to the production address only', () => {
		expect(compose).toMatch(/^\s+COZY_APP_URL: https:\/\/cozynights\.hamburn\.de\s*$/m);
		expect(activeLines(compose).join('\n')).not.toMatch(/test-cozynights/);
	});

	it('has no marker, staging address or test sender in its .env template', () => {
		expect(template).not.toMatch(/^\s*#?\s*COZY_ENV_LABEL\s*=/m);
		const active = activeLines(template).join('\n');
		expect(active).not.toMatch(/test-cozynights/);
		expect(active).toMatch(/^MAIL_FROM_NAME=CozyNights$/m);
		expect(active).not.toMatch(/^MAIL_FROM_NAME=.*(staging|test)/im);
	});
});

describe('what guests read', () => {
	it('names the setup phase "In Preparation" in the top bars', () => {
		expect(PHASE_PILL_LABELS.staging).toBe('In Preparation');
		for (const label of Object.values(PHASE_PILL_LABELS)) {
			expect(label).not.toMatch(/staging|test/i);
		}
	});

	it('knows the year of the event', () => {
		expect(Number.isInteger(EVENT_YEAR)).toBe(true);
		expect(EVENT_YEAR).toBeGreaterThanOrEqual(2026);
		expect(EVENT_YEAR).toBeLessThan(2100);
	});
});
