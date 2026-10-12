// tests/notify-loop-health.test.ts — two things about the notification loop
// itself (pb_hooks/lib/notify.js): its heartbeat to COZY_HEARTBEAT_URL, so a
// hanging loop is noticed outside it, and one crew line instead of hundreds
// when many guest messages fail for good at once (sendPendingAlerts).
import { describe, expect, it } from 'vitest';
import { loadHookModule } from './hook-module';

type Row = Record<string, any>;

function record(row: Row) {
	return {
		id: row.id as string,
		getString: (field: string) => String(row[field] ?? ''),
		getInt: (field: string) => Number(row[field] ?? 0),
		get: (field: string) => row[field],
		set: (field: string, value: unknown) => {
			row[field] = value;
		}
	};
}

/** admin_events only, with the two filters sendPendingAlerts writes. */
function fakeApp(events: Row[]) {
	const store = new Map<string, unknown>();
	return {
		events,
		store: () => ({
			get: (key: string) => store.get(key),
			set: (key: string, value: unknown) => store.set(key, value)
		}),
		findRecordsByFilter(_collection: string, filter: string, _sort: string, limit: number) {
			const onlyFailed = filter.includes("action = 'guest_notice_failed'");
			return events
				.filter((e) => e.alert_status === 'pending')
				.filter((e) => !onlyFailed || e.action === 'guest_notice_failed')
				.slice(0, limit)
				.map(record);
		},
		save() {
			// records write straight into their rows
		}
	};
}

function loadNotify(posted: string[], status = 200) {
	return loadHookModule('lib/notify.js', {
		$http: {
			send: (req: { url: string; body?: string }) => {
				posted.push(req.body ? JSON.parse(req.body).text : req.url);
				return { statusCode: status };
			}
		}
	});
}

const cfg = (extra: Row = {}) => ({
	label: '',
	telegram: { token: '', chatId: '', threadId: '', apiBase: '', guests: false },
	legacyWebhook: 'https://chat.example.org/hook',
	heartbeatUrl: '',
	texts: {},
	...extra
});

const failed = (n: number): Row[] =>
	Array.from({ length: n }, (_, i) => ({
		id: `ev${i}`,
		action: 'guest_notice_failed',
		subject: `Ticket H•••${i}`,
		details: JSON.stringify({ channels: 'mail', attempts: 8, error: '550 quota exceeded' }),
		alert_status: 'pending',
		alert_attempts: 0,
		created: `2026-10-20 18:00:0${i % 10}.000Z`
	}));

describe('many guest messages failing at once', () => {
	it('tells the crew once, and marks every row as told', () => {
		const posted: string[] = [];
		const notify = loadNotify(posted);
		const app = fakeApp(failed(300));
		notify.sendPendingAlerts(app, cfg(), false);
		expect(posted).toHaveLength(1);
		expect(posted[0]).toMatch(/^📭 300 guest messages could not be delivered.*550 quota exceeded/);
		expect(app.events.every((e) => e.alert_status === 'sent')).toBe(true);
	});

	it('keeps one line per ticket for one or two, like before', () => {
		const posted: string[] = [];
		const notify = loadNotify(posted);
		notify.sendPendingAlerts(fakeApp(failed(2)), cfg(), false);
		expect(posted).toHaveLength(2);
		expect(posted[0]).toMatch(/Could not notify ticket/);
	});

	it('tries the batch again later when the crew chat is down', () => {
		const posted: string[] = [];
		const notify = loadNotify(posted, 502);
		const app = fakeApp(failed(5));
		notify.sendPendingAlerts(app, cfg(), false);
		expect(app.events.every((e) => e.alert_status === 'pending' && e.alert_attempts === 1)).toBe(
			true
		);
	});
});

describe('the heartbeat', () => {
	it('pings the URL, at most once every five minutes', () => {
		const posted: string[] = [];
		const notify = loadNotify(posted);
		const app = fakeApp([]);
		const withUrl = cfg({ heartbeatUrl: 'https://hc-ping.com/abc' });
		expect(notify.heartbeat(app, withUrl)).toBe(true);
		expect(notify.heartbeat(app, withUrl)).toBe(false);
		expect(posted).toEqual(['https://hc-ping.com/abc']);
	});

	it('does nothing without a URL', () => {
		const posted: string[] = [];
		const notify = loadNotify(posted);
		expect(notify.heartbeat(fakeApp([]), cfg())).toBe(false);
		expect(posted).toEqual([]);
	});
});
