// tests/wallet-fixtures.ts — throwaway credentials for the wallet tests,
// made fresh for every run: a root CA, an intermediate standing in for
// Apple's WWDR certificate, a "Pass Type ID" certificate signed by it, and a
// Google service account key. Nothing here is a real secret or talks to
// Apple or Google.
import crypto from 'crypto';
import http from 'http';
import http2 from 'http2';
import forge from 'node-forge';
import { parseWalletConfig, type WalletConfig } from '../src/lib/server/wallet/config';

export interface TestCredentials {
	rootPem: string;
	wwdrPem: string;
	certPem: string;
	keyPem: string;
	/** Another key: does not belong to certPem. */
	otherKeyPem: string;
	googleKeyPem: string;
	googlePublicPem: string;
	serviceAccount: string;
}

function rsa(): { privateKey: string; publicKey: string } {
	return crypto.generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});
}

function certificate(options: {
	cn: string;
	publicKeyPem: string;
	issuerCn: string;
	issuerKeyPem: string;
	ca: boolean;
	serial: string;
}): string {
	const cert = forge.pki.createCertificate();
	cert.publicKey = forge.pki.publicKeyFromPem(options.publicKeyPem);
	cert.serialNumber = options.serial;
	cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
	cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
	cert.setSubject([{ name: 'commonName', value: options.cn }]);
	cert.setIssuer([{ name: 'commonName', value: options.issuerCn }]);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: options.ca },
		{
			name: 'keyUsage',
			keyCertSign: options.ca,
			cRLSign: options.ca,
			digitalSignature: true
		}
	]);
	cert.sign(forge.pki.privateKeyFromPem(options.issuerKeyPem), forge.md.sha256.create());
	return forge.pki.certificateToPem(cert);
}

let cached: TestCredentials | null = null;

export function testCredentials(): TestCredentials {
	if (cached) return cached;
	const root = rsa();
	const wwdr = rsa();
	const pass = rsa();
	const other = rsa();
	const google = rsa();
	const rootPem = certificate({
		cn: 'CozyNights Test Root',
		publicKeyPem: root.publicKey,
		issuerCn: 'CozyNights Test Root',
		issuerKeyPem: root.privateKey,
		ca: true,
		serial: '01'
	});
	const wwdrPem = certificate({
		cn: 'CozyNights Test WWDR',
		publicKeyPem: wwdr.publicKey,
		issuerCn: 'CozyNights Test Root',
		issuerKeyPem: root.privateKey,
		ca: true,
		serial: '02'
	});
	const certPem = certificate({
		cn: 'Pass Type ID: pass.test.cozynights',
		publicKeyPem: pass.publicKey,
		issuerCn: 'CozyNights Test WWDR',
		issuerKeyPem: wwdr.privateKey,
		ca: false,
		serial: '03'
	});
	cached = {
		rootPem,
		wwdrPem,
		certPem,
		keyPem: pass.privateKey,
		otherKeyPem: other.privateKey,
		googleKeyPem: google.privateKey,
		googlePublicPem: google.publicKey,
		serviceAccount: JSON.stringify({
			type: 'service_account',
			client_email: 'cozy-wallet@cozy-test.iam.gserviceaccount.com',
			private_key: google.privateKey
		})
	};
	return cached;
}

export const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A complete environment for both wallets (URLs of stand-ins may be given). */
export function testWalletEnv(
	overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
	const c = testCredentials();
	return {
		ORIGIN: 'https://cozy.test',
		WALLET_APPLE_PASS_TYPE_ID: 'pass.test.cozynights',
		WALLET_APPLE_TEAM_ID: 'TESTTEAM01',
		WALLET_APPLE_CERT: b64(c.certPem),
		WALLET_APPLE_KEY: b64(c.keyPem),
		WALLET_APPLE_WWDR: b64(c.wwdrPem),
		WALLET_GOOGLE_ISSUER_ID: '3388000000012345678',
		WALLET_GOOGLE_SERVICE_ACCOUNT: b64(c.serviceAccount),
		WALLET_EVENT_NAME: 'Hamburn 2026',
		WALLET_EVENT_START: '2026-10-01T14:00+02:00',
		WALLET_EVENT_END: '2026-10-04T12:00+02:00',
		WALLET_VENUE_NAME: 'Brahmsee',
		WALLET_VENUE_ADDRESS: 'Am See 1, 24631 Langwedel',
		...overrides
	};
}

export function testWalletConfig(overrides: Record<string, string | undefined> = {}): WalletConfig {
	const { config, problems } = parseWalletConfig(testWalletEnv(overrides));
	if (problems.length > 0) throw new Error(problems.map((p) => p.message).join('; '));
	return config;
}

// --- stand-ins for Apple's push service and Google's Wallet API -----------------

interface PushSeen {
	token: string;
	topic: string;
	body: string;
}

export async function applePushService(statusOf: (token: string) => number) {
	const seen: PushSeen[] = [];
	const server = http2.createServer();
	server.on('stream', (stream, headers) => {
		let body = '';
		stream.setEncoding('utf8');
		stream.on('data', (chunk) => (body += chunk));
		stream.on('end', () => {
			const token = String(headers[':path']).replace('/3/device/', '');
			seen.push({ token, topic: String(headers['apns-topic']), body });
			const status = statusOf(token);
			stream.respond({ ':status': status, 'content-type': 'application/json' });
			stream.end(
				status === 200
					? ''
					: JSON.stringify({ reason: status === 410 ? 'Unregistered' : 'InternalServerError' })
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

interface GoogleCall {
	method: string;
	path: string;
	body: any;
}

export async function googleWalletApi() {
	const calls: GoogleCall[] = [];
	const store = new Map<string, any>();
	let failWith = 0;
	const server = http.createServer(async (req, res) => {
		let raw = '';
		for await (const chunk of req) raw += chunk;
		const url = new URL(req.url!, 'http://google');
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (url.pathname === '/token') {
			calls.push({
				method: 'POST',
				path: '/token',
				body: Object.fromEntries(new URLSearchParams(raw))
			});
			return reply(200, { access_token: 'test-access', expires_in: 3600 });
		}
		const body = raw ? JSON.parse(raw) : null;
		calls.push({ method: req.method!, path: url.pathname, body });
		if (req.headers.authorization !== 'Bearer test-access') return reply(401, { error: {} });
		if (failWith) return reply(failWith, { error: { status: 'INTERNAL' } });
		const m = /^\/walletobjects\/v1\/(\w+)(?:\/(.+))?$/.exec(url.pathname);
		if (!m) return reply(404, {});
		const [, kind, id] = m;
		const key = (i: string) => `${kind}/${decodeURIComponent(i)}`;
		if (req.method === 'POST') {
			if (store.has(key(body.id))) return reply(409, { error: { status: 'ALREADY_EXISTS' } });
			store.set(key(body.id), body);
			return reply(200, body);
		}
		if (req.method === 'PUT') {
			if (!store.has(key(id))) return reply(404, { error: { status: 'NOT_FOUND' } });
			store.set(key(id), body);
			return reply(200, body);
		}
		return reply(405, {});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		urls: {
			WALLET_GOOGLE_API_URL: `http://127.0.0.1:${port}`,
			WALLET_GOOGLE_TOKEN_URL: `http://127.0.0.1:${port}/token`
		},
		calls,
		store,
		fail: (status: number) => (failWith = status),
		close: () => server.close()
	};
}
