// src/lib/server/wallet/web-service.ts
/**
 * The checks every request of Apple's pass web service goes through
 * (src/routes/wallet/apple/v1): Apple Wallet must be set up, the pass type
 * must be ours, the serial a pass code, the device id plain, and — for
 * everything about one pass — the pass's own token in the Authorization
 * header. Answers are bare status codes, as Apple's devices expect them.
 */
import { error } from '@sveltejs/kit';
import { isPassCode } from '$lib/pass';
import { isAppleAuthorized } from './apple';
import { walletConfig, type AppleWalletConfig, type WalletConfig } from './config';

export function appleService(passType: string): { config: WalletConfig; apple: AppleWalletConfig } {
	const config = walletConfig();
	if (!config.apple || passType !== config.apple.passTypeId) throw error(404, 'Unknown pass type.');
	return { config, apple: config.apple };
}

export function checkSerial(serial: string): string {
	if (!isPassCode(serial)) throw error(404, 'Unknown pass.');
	return serial;
}

export function checkDevice(device: string): string {
	if (!/^[A-Za-z0-9._-]{1,128}$/.test(device)) throw error(404, 'Unknown device.');
	return device;
}

/** 401 unless the request carries this pass's token. */
export function requireAppleAuth(request: Request, serial: string): void {
	if (!isAppleAuthorized(request.headers.get('authorization'), serial)) {
		throw error(401, 'Unauthorized.');
	}
}

/** An empty answer with a status, e.g. 201 for a new registration. */
export function status(code: number, headers: Record<string, string> = {}): Response {
	return new Response(null, { status: code, headers: { 'cache-control': 'no-store', ...headers } });
}
