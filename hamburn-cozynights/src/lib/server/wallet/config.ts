// src/lib/server/wallet/config.ts
/**
 * Wallet passes (docs/admin/passes.md, "Wallet passes"): the booking pass in
 * Apple Wallet and Google Wallet. Everything is optional — without the
 * credentials below neither button appears and nothing is sent anywhere.
 *
 * The values come from the app's environment only (docker-compose.staging.yml
 * lists them; deploy/staging.env.template describes them). Certificates and
 * keys may be given as PEM text (line breaks written as \n) or base64 of the
 * PEM file, whichever fits into .env more easily.
 */
import crypto from 'crypto';
import { env } from '$env/dynamic/private';

export type WalletPlatform = 'apple' | 'google';

export interface AppleWalletConfig {
	passTypeId: string;
	teamId: string;
	/** The Pass Type ID certificate and its private key, PEM. */
	certPem: string;
	keyPem: string;
	/** Apple's WWDR intermediate certificate that signed it, PEM. */
	wwdrPem: string;
	/** Where pushes go; only tests change it. */
	apnsUrl: string;
}

export interface GoogleWalletConfig {
	issuerId: string;
	/** The service account that may write this issuer's passes. */
	clientEmail: string;
	privateKeyPem: string;
	/** Only tests change these. */
	apiUrl: string;
	tokenUrl: string;
}

export interface WalletEvent {
	/** "Hamburn 2026" */
	name: string;
	/**
	 * ISO date-times with their UTC offset, as written in the environment
	 * ("2026-10-01T14:00+02:00"); '' when not set. The offset stays: Google
	 * shows the times in the venue's local time from it.
	 */
	start: string;
	end: string;
	venueName: string;
	venueAddress: string;
	/** For "you're nearby" on the lock screen; null when not set. */
	location: { latitude: number; longitude: number } | null;
}

export interface WalletConfig {
	apple: AppleWalletConfig | null;
	google: GoogleWalletConfig | null;
	event: WalletEvent;
	/** Who issues the pass, as the wallets show it. */
	organization: string;
	/** The app's public address (ORIGIN), without a trailing slash. */
	origin: string;
}

type Env = Record<string, string | undefined>;

/**
 * A certificate or key from the environment: PEM (with real or escaped line
 * breaks) or base64 of it. '' when missing or not PEM after decoding.
 */
export function readPem(value: string | undefined): string {
	const raw = String(value || '').trim();
	if (!raw) return '';
	const text = raw.startsWith('-----BEGIN')
		? raw.replace(/\\n/g, '\n')
		: Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
	return /-----BEGIN [A-Z0-9 ]+-----/.test(text) ? text.trim() + '\n' : '';
}

// A date and time with seconds optional and the UTC offset required.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

function readDate(value: string | undefined): string {
	const raw = String(value || '').trim();
	if (!DATE_TIME.test(raw) || isNaN(Date.parse(raw))) return '';
	// Apple wants the seconds
	return raw.replace(/T(\d{2}:\d{2})(Z|[+-])/, 'T$1:00$2');
}

function readLocation(env: Env): WalletEvent['location'] {
	const latitude = Number(env.WALLET_VENUE_LATITUDE);
	const longitude = Number(env.WALLET_VENUE_LONGITUDE);
	if (!env.WALLET_VENUE_LATITUDE || !env.WALLET_VENUE_LONGITUDE) return null;
	if (!isFinite(latitude) || !isFinite(longitude)) return null;
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
	return { latitude, longitude };
}

/** Why a platform stays off, for the startup log. */
export interface WalletProblem {
	platform: WalletPlatform;
	message: string;
}

function readApple(env: Env, problems: WalletProblem[]): AppleWalletConfig | null {
	const given = ['WALLET_APPLE_PASS_TYPE_ID', 'WALLET_APPLE_TEAM_ID', 'WALLET_APPLE_CERT'].some(
		(name) => !!env[name]
	);
	if (!given) return null;
	const config = {
		passTypeId: String(env.WALLET_APPLE_PASS_TYPE_ID || '').trim(),
		teamId: String(env.WALLET_APPLE_TEAM_ID || '').trim(),
		certPem: readPem(env.WALLET_APPLE_CERT),
		keyPem: readPem(env.WALLET_APPLE_KEY),
		wwdrPem: readPem(env.WALLET_APPLE_WWDR),
		apnsUrl: (env.WALLET_APPLE_APNS_URL || 'https://api.push.apple.com').replace(/\/+$/, '')
	};
	const missing: string[] = [];
	if (!/^pass\.[A-Za-z0-9.-]+$/.test(config.passTypeId)) missing.push('WALLET_APPLE_PASS_TYPE_ID');
	if (!/^[A-Z0-9]{10}$/.test(config.teamId)) missing.push('WALLET_APPLE_TEAM_ID');
	if (!config.certPem) missing.push('WALLET_APPLE_CERT');
	if (!config.keyPem) missing.push('WALLET_APPLE_KEY');
	if (!config.wwdrPem) missing.push('WALLET_APPLE_WWDR');
	if (missing.length > 0) {
		problems.push({ platform: 'apple', message: `missing or invalid: ${missing.join(', ')}` });
		return null;
	}
	try {
		const cert = new crypto.X509Certificate(config.certPem);
		const key = crypto.createPrivateKey(config.keyPem);
		if (!cert.checkPrivateKey(key)) {
			problems.push({
				platform: 'apple',
				message: 'WALLET_APPLE_KEY does not belong to WALLET_APPLE_CERT'
			});
			return null;
		}
		new crypto.X509Certificate(config.wwdrPem);
	} catch (err) {
		problems.push({
			platform: 'apple',
			message: `certificate or key unreadable: ${(err as Error).message}`
		});
		return null;
	}
	return config;
}

function readGoogle(env: Env, problems: WalletProblem[]): GoogleWalletConfig | null {
	if (!env.WALLET_GOOGLE_ISSUER_ID && !env.WALLET_GOOGLE_SERVICE_ACCOUNT) return null;
	const issuerId = String(env.WALLET_GOOGLE_ISSUER_ID || '').trim();
	let account: { client_email?: unknown; private_key?: unknown } = {};
	try {
		const raw = String(env.WALLET_GOOGLE_SERVICE_ACCOUNT || '').trim();
		const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
		account = JSON.parse(json);
	} catch {
		/* reported below */
	}
	const clientEmail = typeof account.client_email === 'string' ? account.client_email : '';
	const privateKeyPem = typeof account.private_key === 'string' ? account.private_key : '';
	const missing: string[] = [];
	if (!/^\d{5,25}$/.test(issuerId)) missing.push('WALLET_GOOGLE_ISSUER_ID');
	if (!clientEmail || !privateKeyPem) missing.push('WALLET_GOOGLE_SERVICE_ACCOUNT');
	if (missing.length > 0) {
		problems.push({ platform: 'google', message: `missing or invalid: ${missing.join(', ')}` });
		return null;
	}
	try {
		crypto.createPrivateKey(privateKeyPem);
	} catch (err) {
		problems.push({
			platform: 'google',
			message: `service account key unreadable: ${(err as Error).message}`
		});
		return null;
	}
	return {
		issuerId,
		clientEmail,
		privateKeyPem,
		apiUrl: (env.WALLET_GOOGLE_API_URL || 'https://walletobjects.googleapis.com').replace(
			/\/+$/,
			''
		),
		tokenUrl: env.WALLET_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'
	};
}

/** The wallet configuration from an environment, and what keeps a platform off. */
export function parseWalletConfig(source: Env): {
	config: WalletConfig;
	problems: WalletProblem[];
} {
	const problems: WalletProblem[] = [];
	const origin = String(source.ORIGIN || '').replace(/\/+$/, '');
	const config: WalletConfig = {
		apple: readApple(source, problems),
		google: readGoogle(source, problems),
		event: {
			name: String(source.WALLET_EVENT_NAME || '').trim() || 'Hamburn',
			start: readDate(source.WALLET_EVENT_START),
			end: readDate(source.WALLET_EVENT_END),
			venueName: String(source.WALLET_VENUE_NAME || '').trim(),
			venueAddress: String(source.WALLET_VENUE_ADDRESS || '').trim(),
			location: readLocation(source)
		},
		organization: String(source.WALLET_ORGANIZATION || '').trim() || 'Hamburn · CozyNights',
		origin
	};
	// Apple fetches updates only over HTTPS; Google shows links to the pass.
	if (!/^https?:\/\//.test(origin)) {
		if (config.apple) problems.push({ platform: 'apple', message: 'ORIGIN is not set' });
		if (config.google) problems.push({ platform: 'google', message: 'ORIGIN is not set' });
		config.apple = null;
		config.google = null;
	}
	return { config, problems };
}

let cached: WalletConfig | null = null;

/** The app's wallet configuration (read once; the log says what stays off and why). */
export function walletConfig(): WalletConfig {
	if (cached) return cached;
	const { config, problems } = parseWalletConfig(env as Env);
	for (const problem of problems) {
		console.warn(
			`[Wallet] ${problem.platform === 'apple' ? 'Apple' : 'Google'} Wallet off: ${problem.message}`
		);
	}
	cached = config;
	return config;
}

/** For the tests: read the environment again on the next call. */
export function resetWalletConfig(): void {
	cached = null;
}

/** Which wallet buttons to show: [] when none is set up. */
export function walletPlatforms(config: WalletConfig = walletConfig()): WalletPlatform[] {
	const platforms: WalletPlatform[] = [];
	if (config.apple) platforms.push('apple');
	if (config.google) platforms.push('google');
	return platforms;
}
