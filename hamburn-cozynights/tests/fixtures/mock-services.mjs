// tests/fixtures/mock-services.mjs — stand-ins for the outside services
// PocketBase talks to, for the throwaway test stack (docker-compose.test.yml).
// Plain Node, no dependencies. Never used outside tests.
//
// - Telegram Bot API:  POST /bot<token>/<method>  (getMe, sendMessage,
//   sendPhoto, setMyCommands, getUpdates incl. long polling, getWebhookInfo)
// - Google Wallet API: POST /oauth2/token, /walletobjects/v1/eventTicket{Class,Object}
//   (insert, replace, read) — the app's wallet passes without Google
// - Google OAuth2:     POST /oauth/token, GET /oauth/userinfo — the admins'
//   google provider is pointed here by the tests, so a real PocketBase
//   OAuth2 sign-in (hooks and guard included) runs without Google.
// - Test control:      /_mock/... (read what was sent and how often the Bot
//   API was called, inject bot updates, block a chat, take Telegram down,
//   slow it down or revoke the token, register OAuth users, reset)
import http from 'node:http';

const PORT = Number(process.env.PORT || 8081);
const BOT_TOKEN = process.env.MOCK_BOT_TOKEN || '123456:TEST-token';

let state;
function reset() {
	state = {
		sent: [], // sendMessage payloads
		updates: [], // pending getUpdates results
		nextUpdateId: 1000,
		blocked: new Set(),
		commands: null, // the last setMyCommands payload
		wallet: new Map(), // Google Wallet classes and objects by "kind/id"
		walletCalls: [], // { method, path } of every Wallet API call
		down: false,
		slowMs: 0, // sendMessage takes this long (a slow Telegram)
		unauthorized: false, // every Bot API call answers 401 (a revoked token)
		calls: {}, // Bot API calls per method
		oauthUsers: new Map() // code → user info
	};
}
reset();

function json(res, status, body) {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
}

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!raw) return {};
	if ((req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
		return Object.fromEntries(new URLSearchParams(raw));
	}
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function telegram(method, body, res) {
	if (state.down) return json(res, 502, { ok: false, error_code: 502, description: 'Bad Gateway' });
	switch (method) {
		case 'getMe':
			return json(res, 200, {
				ok: true,
				result: { id: 42, is_bot: true, first_name: 'Cozy Test', username: 'cozy_test_bot' }
			});
		case 'getWebhookInfo':
			return json(res, 200, { ok: true, result: { url: '', pending_update_count: 0 } });
		case 'sendMessage':
		case 'sendPhoto': {
			if (state.slowMs) await sleep(state.slowMs);
			const chat = String(body.chat_id);
			if (state.blocked.has(chat)) {
				return json(res, 403, {
					ok: false,
					error_code: 403,
					description: 'Forbidden: bot was blocked by the user'
				});
			}
			// A photo's caption is its text, so a test can read both the same way.
			const text = method === 'sendPhoto' ? String(body.caption || '') : String(body.text || '');
			state.sent.push({ ...body, method, text, chat_id: chat, at: Date.now() });
			return json(res, 200, { ok: true, result: { message_id: state.sent.length } });
		}
		case 'setMyCommands':
			state.commands = body;
			return json(res, 200, { ok: true, result: true });
		case 'getUpdates': {
			const offset = Number(body.offset || 0);
			// Telegram forgets everything below the offset (= confirmed).
			if (offset > 0) state.updates = state.updates.filter((u) => u.update_id >= offset);
			const deadline = Date.now() + Math.min(Number(body.timeout || 0), 5) * 1000;
			while (state.updates.length === 0 && Date.now() < deadline) await sleep(100);
			const limit = Number(body.limit || 100);
			return json(res, 200, { ok: true, result: state.updates.slice(0, limit) });
		}
		default:
			return json(res, 404, { ok: false, error_code: 404, description: 'Not Found' });
	}
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://mock');
	const body = await readBody(req);

	const bot = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
	if (bot) {
		state.calls[bot[2]] = (state.calls[bot[2]] || 0) + 1;
		if (bot[1] !== BOT_TOKEN || state.unauthorized) {
			return json(res, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
		}
		return telegram(bot[2], { ...Object.fromEntries(url.searchParams), ...body }, res);
	}

	// --- Google Wallet stand-in: an access token, then classes and objects
	if (url.pathname === '/oauth2/token' && req.method === 'POST') {
		return json(res, 200, { access_token: 'mock-wallet-token', expires_in: 3600 });
	}
	const wallet = /^\/walletobjects\/v1\/(eventTicketClass|eventTicketObject)(?:\/(.+))?$/.exec(
		url.pathname
	);
	if (wallet) {
		state.walletCalls.push({ method: req.method, path: url.pathname });
		if (req.headers.authorization !== 'Bearer mock-wallet-token') {
			return json(res, 401, { error: { status: 'UNAUTHENTICATED' } });
		}
		const [, kind, id] = wallet;
		const key = (value) => `${kind}/${decodeURIComponent(String(value))}`;
		if (req.method === 'POST') {
			if (state.wallet.has(key(body.id))) {
				return json(res, 409, { error: { status: 'ALREADY_EXISTS' } });
			}
			state.wallet.set(key(body.id), body);
			return json(res, 200, body);
		}
		if (req.method === 'PUT') {
			if (!state.wallet.has(key(id))) return json(res, 404, { error: { status: 'NOT_FOUND' } });
			state.wallet.set(key(id), body);
			return json(res, 200, body);
		}
		if (req.method === 'GET') {
			const found = state.wallet.get(key(id));
			return found ? json(res, 200, found) : json(res, 404, { error: { status: 'NOT_FOUND' } });
		}
		return json(res, 405, { error: { status: 'METHOD_NOT_ALLOWED' } });
	}

	// --- Google OAuth2 stand-in (the admins' sign-in)
	if (url.pathname === '/oauth/token' && req.method === 'POST') {
		if (!state.oauthUsers.has(body.code)) return json(res, 400, { error: 'invalid_grant' });
		return json(res, 200, {
			access_token: 'mock-' + body.code,
			token_type: 'Bearer',
			expires_in: 3600
		});
	}
	if (url.pathname === '/oauth/userinfo') {
		const token = String(req.headers.authorization || '').replace(/^Bearer mock-/, '');
		const user = state.oauthUsers.get(token);
		return user ? json(res, 200, user) : json(res, 401, { error: 'invalid_token' });
	}

	// --- test control
	switch (`${req.method} ${url.pathname}`) {
		case 'GET /_mock/health':
			return json(res, 200, { ok: true });
		case 'POST /_mock/reset':
			reset();
			return json(res, 200, { ok: true });
		case 'GET /_mock/telegram/sent':
			return json(res, 200, state.sent);
		case 'POST /_mock/telegram/update': {
			// a private message from a user to the bot
			const chatId = Number(body.chat_id);
			const update = {
				update_id: state.nextUpdateId++,
				message: {
					message_id: state.nextUpdateId,
					date: Math.floor(Date.now() / 1000),
					chat: { id: chatId, type: body.chat_type || 'private', first_name: 'Test' },
					from: { id: chatId, is_bot: false, first_name: 'Test' },
					text: String(body.text || '')
				}
			};
			state.updates.push(update);
			return json(res, 200, update);
		}
		case 'GET /_mock/telegram/pending':
			return json(res, 200, state.updates);
		case 'POST /_mock/telegram/block':
			state.blocked.add(String(body.chat_id));
			return json(res, 200, { ok: true });
		case 'POST /_mock/telegram/down':
			state.down = !!body.down;
			return json(res, 200, { ok: true });
		case 'GET /_mock/telegram/commands':
			return json(res, 200, state.commands);
		case 'GET /_mock/wallet':
			return json(res, 200, {
				calls: state.walletCalls,
				items: Object.fromEntries(state.wallet)
			});
		case 'GET /_mock/telegram/calls':
			return json(res, 200, state.calls);
		case 'POST /_mock/telegram/unauthorized':
			state.unauthorized = !!body.on;
			return json(res, 200, { ok: true });
		case 'POST /_mock/telegram/slow':
			state.slowMs = Number(body.ms || 0);
			return json(res, 200, { ok: true });
		case 'POST /_mock/oauth/user':
			// { code, sub, email, name, email_verified, hd }
			state.oauthUsers.set(String(body.code), {
				sub: body.sub,
				email: body.email,
				name: body.name,
				email_verified: body.email_verified !== false,
				hd: body.hd
			});
			return json(res, 200, { ok: true });
		default:
			return json(res, 404, { error: 'unknown mock route ' + url.pathname });
	}
});

server.listen(PORT, '0.0.0.0', () => console.log(`[mocks] listening on ${PORT}`));
