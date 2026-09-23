// src/lib/server/wallet/apns.ts
/**
 * Pushes for Apple Wallet passes: an empty notification to every device that
 * registered the pass, over HTTP/2 to Apple's push service, signed in with
 * the Pass Type ID certificate (Wallet takes no token-based push). The device
 * then asks this app's web service what changed and fetches the new pass.
 */
import http2 from 'http2';
import type { AppleWalletConfig } from './config';

export type PushOutcome =
	/** Apple took it. */
	| 'sent'
	/** The token is dead (device gone, pass removed): forget the registration. */
	| 'gone'
	/** Try again later (network, Apple busy, a certificate problem). */
	| 'failed';

export interface PushResult {
	outcome: PushOutcome;
	/** Status and Apple's reason, for the log (no token, no secret). */
	detail: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

function outcomeOf(status: number, reason: string): PushOutcome {
	if (status === 200) return 'sent';
	// 410: the token stopped being valid for this topic; 400 BadDeviceToken:
	// it never was. Either way nothing will ever reach it.
	if (status === 410 || (status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(reason))) {
		return 'gone';
	}
	return 'failed';
}

/**
 * Sends one push per token. Never throws: a connection problem fails every
 * token of this batch, to be tried again by the next sync.
 */
export async function pushPassUpdates(
	apple: Pick<AppleWalletConfig, 'apnsUrl' | 'certPem' | 'keyPem' | 'passTypeId'>,
	tokens: string[]
): Promise<Map<string, PushResult>> {
	const results = new Map<string, PushResult>();
	const wanted = [...new Set(tokens.filter((token) => /^[0-9A-Fa-f]{16,200}$/.test(token)))];
	for (const token of tokens) {
		if (!wanted.includes(token))
			results.set(token, { outcome: 'gone', detail: 'not a push token' });
	}
	if (wanted.length === 0) return results;

	let session: http2.ClientHttp2Session;
	try {
		session = http2.connect(apple.apnsUrl, { cert: apple.certPem, key: apple.keyPem });
	} catch (err) {
		for (const token of wanted) {
			results.set(token, { outcome: 'failed', detail: `connect: ${(err as Error).message}` });
		}
		return results;
	}
	// Connection errors also reach the requests; this only keeps them from
	// becoming an uncaught 'error' event.
	session.on('error', () => {});

	try {
		await Promise.all(
			wanted.map(
				(token) =>
					new Promise<void>((resolve) => {
						const settle = (result: PushResult) => {
							if (!results.has(token)) results.set(token, result);
							resolve();
						};
						let request: http2.ClientHttp2Stream;
						try {
							request = session.request({
								':method': 'POST',
								':path': `/3/device/${token}`,
								'apns-topic': apple.passTypeId,
								'content-type': 'application/json'
							});
						} catch (err) {
							settle({ outcome: 'failed', detail: `request: ${(err as Error).message}` });
							return;
						}
						request.setTimeout(REQUEST_TIMEOUT_MS, () => {
							request.close(http2.constants.NGHTTP2_CANCEL);
							settle({ outcome: 'failed', detail: 'timeout' });
						});
						let status = 0;
						let body = '';
						request.on('response', (headers) => {
							status = Number(headers[':status']) || 0;
						});
						request.setEncoding('utf8');
						request.on('data', (chunk: string) => {
							if (body.length < 1000) body += chunk;
						});
						request.on('end', () => {
							let reason = '';
							try {
								reason = String(JSON.parse(body || '{}').reason || '');
							} catch {
								/* not JSON */
							}
							settle({
								outcome: outcomeOf(status, reason),
								detail: `${status}${reason ? ` ${reason}` : ''}`
							});
						});
						request.on('error', (err) =>
							settle({ outcome: 'failed', detail: `stream: ${err.message}` })
						);
						request.end('{}');
					})
			)
		);
	} finally {
		session.close();
	}
	return results;
}
