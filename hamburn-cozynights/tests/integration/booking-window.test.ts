// tests/integration/booking-window.test.ts — the booking window against a real
// PocketBase: the migration's fields, the phase guard (pb_hooks/cozy_phase.pb.js:
// only superusers switch the phase right now) and the crew alerts for the
// window and the phase (pb_hooks/cozy_notify.pb.js, lib/notify.js).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { APP_SETTINGS_ID } from '../../src/lib/server/constants';
import { anonymous, createAdmin, expectRefused, serviceAccount } from '../stack-helpers';

const MOCK_URL = process.env.MOCK_URL || '';
const CREW_CHAT = '-1001234567890'; // docker-compose.test.yml
const DAY = 24 * 3600 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

let su: PocketBase;
let original: Record<string, unknown>;
const FIELDS = [
	'is_booking_active',
	'booking_closed',
	'booking_unlock_at',
	'booking_close_at',
	'booking_timer_paused'
] as const;

beforeAll(async () => {
	su = await serviceAccount();
	const settings = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
	original = Object.fromEntries(FIELDS.map((f) => [f, settings[f] ?? '']));
});

// Every test starts from Staging without a timer and leaves the settings as found.
async function reset(fields: Record<string, unknown> = {}) {
	await su.collection('app_settings').update(APP_SETTINGS_ID, {
		is_booking_active: false,
		booking_closed: false,
		booking_unlock_at: '',
		booking_close_at: '',
		booking_timer_paused: false,
		...fields
	});
}
afterEach(async () => {
	await su.collection('app_settings').update(APP_SETTINGS_ID, original);
});

/** Delivers every pending crew alert (a run sends at most 20) and returns what the crew got. */
async function crewTexts(): Promise<string[]> {
	for (let run = 0; run < 10; run++) {
		await su.send('/api/cozy/notify/flush?force=1', { method: 'POST' });
		const pending = await su
			.collection('admin_events')
			.getList(1, 1, { filter: "alert_status = 'pending'" });
		if (pending.totalItems === 0) break;
	}
	const sent: { chat_id: string; text: string }[] = await (
		await fetch(MOCK_URL + '/_mock/telegram/sent')
	).json();
	return sent.filter((m) => m.chat_id === CREW_CHAT).map((m) => m.text);
}

describe('booking window fields', () => {
	it('exist and are public to read, like the rest of app_settings', async () => {
		await reset({ booking_close_at: inDays(5), booking_timer_paused: true });
		const settings = await anonymous().collection('app_settings').getOne(APP_SETTINGS_ID);
		expect(settings.booking_close_at).toMatch(/^\d{4}-\d{2}-\d{2} /);
		expect(settings.booking_timer_paused).toBe(true);
		expect(settings.booking_closed).toBe(false);
	});
});

describe('phase guard', () => {
	it('lets an admin plan, arm and pause a future window', async () => {
		await reset();
		const admin = await createAdmin(su, 'admin');
		const settings = admin.client.collection('app_settings');
		await settings.update(APP_SETTINGS_ID, {
			booking_unlock_at: inDays(2),
			booking_close_at: inDays(4),
			booking_timer_paused: true
		});
		await settings.update(APP_SETTINGS_ID, { booking_timer_paused: false });
		await settings.update(APP_SETTINGS_ID, { booking_timer_paused: true });
	});

	it('refuses an admin who would switch the phase right now', async () => {
		await reset();
		const admin = await createAdmin(su, 'admin');
		const settings = admin.client.collection('app_settings');
		await expectRefused(settings.update(APP_SETTINGS_ID, { is_booking_active: true }));
		await expectRefused(settings.update(APP_SETTINGS_ID, { booking_closed: true }));
		// an opening time in the past = open right now
		await expectRefused(
			settings.update(APP_SETTINGS_ID, {
				booking_unlock_at: inDays(-1),
				booking_close_at: inDays(2)
			})
		);

		// … and from Live, closing right now
		await reset({ booking_unlock_at: inDays(-1), booking_close_at: inDays(2) });
		await expectRefused(settings.update(APP_SETTINGS_ID, { booking_close_at: inDays(-0.01) }));
		await expectRefused(settings.update(APP_SETTINGS_ID, { booking_unlock_at: '' }));
		// pausing while live keeps booking open, so it's fine once the phase is written down
		await settings.update(APP_SETTINGS_ID, { is_booking_active: true, booking_timer_paused: true });
		expect((await su.collection('app_settings').getOne(APP_SETTINGS_ID)).is_booking_active).toBe(
			true
		);
	});

	it('lets a superuser switch right now', async () => {
		await reset();
		const boss = await createAdmin(su, 'superuser');
		const settings = boss.client.collection('app_settings');
		await settings.update(APP_SETTINGS_ID, { is_booking_active: true });
		await settings.update(APP_SETTINGS_ID, { is_booking_active: false, booking_closed: true });
		await settings.update(APP_SETTINGS_ID, { booking_closed: false });
	});
});

describe('crew alerts', () => {
	it('report the window and every phase switch with the name of the admin', async () => {
		await reset();
		const admin = await createAdmin(su, 'admin');
		const boss = await createAdmin(su, 'superuser');
		await admin.client.collection('app_settings').update(APP_SETTINGS_ID, {
			booking_unlock_at: inDays(2),
			booking_close_at: inDays(4)
		});
		await admin.client
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { booking_timer_paused: true });
		const settings = boss.client.collection('app_settings');
		await settings.update(APP_SETTINGS_ID, { is_booking_active: true });
		await settings.update(APP_SETTINGS_ID, { is_booking_active: false, booking_closed: true });
		await settings.update(APP_SETTINGS_ID, { booking_closed: false });

		const texts = await crewTexts();
		const has = (start: string) => texts.some((t) => t.startsWith(`[TEST] ${start}`));
		expect(has(`⏰ Booking timer armed by ${admin.email}: opens `)).toBe(true);
		expect(has(`⏸️ Booking timer paused by ${admin.email} (times kept: opens `)).toBe(true);
		expect(texts).toContain(
			`[TEST] 🎪 LIVE BOOKING switched ON by ${boss.email} — guests can book now`
		);
		expect(texts).toContain(
			`[TEST] 🔒 Booking CLOSED by ${boss.email} — bookings are frozen, the layout stays locked`
		);
		expect(texts).toContain(
			`[TEST] 🛠 Back to STAGING MODE by ${boss.email} — booking is off, the layout can be edited again`
		);
	});

	it('announce an opening and a closing reached by the timer, once each', async () => {
		await reset({
			booking_unlock_at: new Date(Date.now() + 1500).toISOString(),
			booking_close_at: new Date(Date.now() + 3000).toISOString()
		});
		const stored = await su.collection('app_settings').getOne(APP_SETTINGS_ID);
		const announced = async (action: string, at: string) =>
			(
				await su.collection('admin_events').getFullList({
					filter: su.filter('action = {:action} && subject = {:at}', { action, at })
				})
			).length;

		await new Promise((resolve) => setTimeout(resolve, 1800));
		await crewTexts(); // the run that sees the opening
		expect(await announced('booking_opened_by_timer', stored.booking_unlock_at)).toBe(1);

		await new Promise((resolve) => setTimeout(resolve, 1500));
		const texts = await crewTexts(); // … and the closing
		await crewTexts(); // a later run repeats nothing
		expect(await announced('booking_opened_by_timer', stored.booking_unlock_at)).toBe(1);
		expect(await announced('booking_closed_by_timer', stored.booking_close_at)).toBe(1);
		expect(texts.some((t) => t.startsWith('[TEST] 🎪 Booking is LIVE now — go-live timer'))).toBe(
			true
		);
		expect(texts.some((t) => t.startsWith('[TEST] 🔒 Booking is CLOSED now — closing time'))).toBe(
			true
		);
	});
});
