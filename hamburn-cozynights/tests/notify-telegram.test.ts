// tests/notify-telegram.test.ts — what pb_hooks/lib/notify.js keeps of a
// failed Bot API call, so the log, admin_events.alert_error and `cozy-admin
// notify test` / `notify status` can say what to fix. Run outside PocketBase
// with a stand-in for $http; tests/integration/notifications.test.ts sends
// through a real PocketBase to the Telegram mock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadHookModule } from './hook-module';

const http = { send: vi.fn() };
const notify = loadHookModule('lib/notify.js', { $http: http });

const TOKEN = '123456:TEST-token';
const CREW_CHAT = '-4012345678';
const SUPERGROUP = '-1004012345678';

function config(threadId = '') {
	return {
		label: '',
		telegram: {
			token: TOKEN,
			chatId: CREW_CHAT,
			threadId,
			apiBase: 'https://api.telegram.org',
			guests: true
		},
		legacyWebhook: ''
	};
}

/** Telegram's answer for a basic group that became a supergroup. */
function upgraded() {
	return {
		statusCode: 400,
		json: {
			ok: false,
			error_code: 400,
			description: 'Bad Request: group chat was upgraded to a supergroup chat',
			parameters: { migrate_to_chat_id: Number(SUPERGROUP) }
		}
	};
}

/** The Bot API method and JSON body of the nth call. */
function call(n = 0) {
	const request = http.send.mock.calls[n][0];
	return { url: String(request.url), body: JSON.parse(request.body) };
}

beforeEach(() => {
	http.send.mockReset();
});

describe('a group that became a supergroup', () => {
	it('keeps the new id and names TELEGRAM_CHAT_ID when it is the crew chat', () => {
		http.send.mockReturnValue(upgraded());
		const r = notify.telegramCall(config(), 'sendMessage', { chat_id: CREW_CHAT, text: 'hi' }, 10);
		expect(r.ok).toBe(false);
		expect(r.status).toBe(400);
		expect(r.migrateTo).toBe(SUPERGROUP);
		expect(r.description).toBe(
			'Bad Request: group chat was upgraded to a supergroup chat — the group is now a supergroup, set TELEGRAM_CHAT_ID=-1004012345678'
		);
	});

	it('names only the new id for any other chat', () => {
		http.send.mockReturnValue(upgraded());
		const r = notify.telegramCall(config(), 'sendMessage', { chat_id: '-4000000001', text: 'hi' });
		expect(r.migrateTo).toBe(SUPERGROUP);
		expect(r.description).toBe(
			'Bad Request: group chat was upgraded to a supergroup chat — the group is now a supergroup with the id -1004012345678'
		);
		expect(r.description).not.toContain('TELEGRAM_CHAT_ID');
	});

	it('puts the hint into the crew alert error, with the status', () => {
		http.send.mockReturnValue(upgraded());
		const r = notify.crewSend(config(), '🧪 Test');
		expect(r).toEqual({
			ok: false,
			error:
				'400 Bad Request: group chat was upgraded to a supergroup chat — the group is now a supergroup, set TELEGRAM_CHAT_ID=-1004012345678',
			migrateTo: SUPERGROUP
		});
		expect(call().body.chat_id).toBe(CREW_CHAT); // the configured id, never the new one
	});

	it('is noticed by the crew chat check without posting', () => {
		http.send.mockReturnValue(upgraded());
		const r = notify.crewCheck(config('7'));
		expect(r.ok).toBe(false);
		expect(r.migrateTo).toBe(SUPERGROUP);
		expect(r.error).toContain('set TELEGRAM_CHAT_ID=-1004012345678');
		const { url, body } = call();
		expect(url).toMatch(/\/sendChatAction$/);
		expect(body).toEqual({ chat_id: CREW_CHAT, message_thread_id: 7, action: 'typing' });
	});
});

describe('other answers stay as they were', () => {
	it('a sent message: no error, no new id', () => {
		http.send.mockReturnValue({ statusCode: 200, json: { ok: true, result: { message_id: 1 } } });
		expect(notify.crewSend(config('7'), 'hello')).toEqual({ ok: true, error: '', migrateTo: '' });
		expect(call().body).toEqual({
			chat_id: CREW_CHAT,
			message_thread_id: 7,
			text: 'hello',
			disable_web_page_preview: true
		});
		expect(notify.crewCheck(config())).toEqual({ ok: true, error: '', migrateTo: '' });
	});

	it('a missing chat or a rate limit: the description as Telegram sent it', () => {
		http.send.mockReturnValueOnce({
			statusCode: 400,
			json: { ok: false, description: 'Bad Request: chat not found' }
		});
		expect(notify.crewSend(config(), 'hello')).toEqual({
			ok: false,
			error: '400 Bad Request: chat not found',
			migrateTo: ''
		});

		http.send.mockReturnValueOnce({
			statusCode: 429,
			json: {
				ok: false,
				description: 'Too Many Requests: retry after 5',
				parameters: { retry_after: 5 }
			}
		});
		const r = notify.telegramCall(config(), 'sendMessage', { chat_id: CREW_CHAT });
		expect(r).toMatchObject({ retryAfter: 5, migrateTo: '' });
		expect(r.description).toBe('Too Many Requests: retry after 5');
	});

	it('a network error: never the bot token', () => {
		http.send.mockImplementation(() => {
			throw new Error(`Post "https://api.telegram.org/bot${TOKEN}/sendMessage": timeout`);
		});
		const r = notify.telegramCall(config(), 'sendMessage', { chat_id: CREW_CHAT });
		expect(r).toMatchObject({ ok: false, status: 0, migrateTo: '' });
		expect(r.description).not.toContain(TOKEN);
	});

	it('no token: no call at all', () => {
		const cfg = config();
		cfg.telegram.token = '';
		expect(notify.telegramCall(cfg, 'getMe', {})).toMatchObject({
			ok: false,
			description: 'no bot token',
			migrateTo: ''
		});
		expect(notify.crewCheck(cfg).ok).toBe(false);
		expect(http.send).not.toHaveBeenCalled();
	});
});
