// src/lib/server/wallet/google.ts
/**
 * Google Wallet passes: an event ticket class per environment (event name,
 * dates, venue, logo) and one event ticket object per booking pass (the spot
 * as section / row / seat, the burner name, the QR code). The app writes both
 * through the Google Wallet API with its service account; "Add to Google
 * Wallet" is a link with a signed token that names the object. A change of
 * the object reaches every phone that saved it, so updates are one PATCH.
 */
import crypto from 'crypto';
import type { GoogleWalletConfig, WalletConfig } from './config';
import type { WalletContent, WalletExtras } from './content';

const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const SAVE_URL = 'https://pay.google.com/gp/v/save/';
const REQUEST_TIMEOUT_MS = 10_000;

export class GoogleWalletError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

function base64url(input: Buffer | string): string {
	return Buffer.from(input).toString('base64url');
}

/** A JWT signed with the service account's key (RS256). */
export function signJwt(claims: Record<string, unknown>, privateKeyPem: string): string {
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const payload = base64url(JSON.stringify(claims));
	const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKeyPem);
	return `${header}.${payload}.${base64url(signature)}`;
}

/** "test-cozynights.hamburn.de" → "test-cozynights-hamburn-de": this environment in ids. */
export function environmentSlug(origin: string): string {
	let host = origin;
	try {
		host = new URL(origin).host;
	} catch {
		/* use it as it is */
	}
	return (
		host
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'cozynights'
	);
}

export function googleClassId(
	google: Pick<GoogleWalletConfig, 'issuerId'>,
	origin: string
): string {
	return `${google.issuerId}.cozynights-${environmentSlug(origin)}`;
}

export function googleObjectId(
	google: Pick<GoogleWalletConfig, 'issuerId'>,
	origin: string,
	serial: string
): string {
	return `${google.issuerId}.${environmentSlug(origin)}-${serial}`;
}

function text(value: string) {
	return { defaultValue: { language: 'en', value } };
}

/** The day after the event, as Google's DateTime. */
function dayAfter(end: string): string | null {
	return end ? new Date(Date.parse(end) + 24 * 60 * 60 * 1000).toISOString() : null;
}

/** The class: what all passes of this environment share. */
export function googleClass(
	google: Pick<GoogleWalletConfig, 'issuerId'>,
	config: WalletConfig
): Record<string, unknown> {
	const { event } = config;
	const cls: Record<string, unknown> = {
		id: googleClassId(google, config.origin),
		issuerName: config.organization,
		reviewStatus: 'UNDER_REVIEW',
		eventName: text(`${event.name} · CozyNights`),
		logo: {
			sourceUri: { uri: `${config.origin}/wallet/google-logo.png` },
			contentDescription: text('CozyNights')
		},
		hexBackgroundColor: '#0a0a0a',
		// One Google account per pass: a forwarded link can't be saved by someone else too.
		multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
		customSectionLabel: text('House'),
		customRowLabel: text('Room'),
		customSeatLabel: text('Spot')
	};
	if (event.venueName || event.venueAddress) {
		cls.venue = {
			name: text(event.venueName || event.name),
			address: text(event.venueAddress || event.venueName)
		};
	}
	if (event.start || event.end) {
		cls.dateTime = {
			...(event.start ? { start: event.start } : {}),
			...(event.end ? { end: event.end } : {})
		};
	}
	return cls;
}

/** The object: one booking pass. */
export function googleObject(
	google: Pick<GoogleWalletConfig, 'issuerId'>,
	content: WalletContent,
	config: WalletConfig,
	extras: WalletExtras
): Record<string, unknown> {
	const spot = content.spot;
	const where = spot ? [spot.spot, spot.room, spot.house].filter(Boolean).join(' · ') : '';
	// "Upper bunk · above B1 · 🔥 Heated": only when the crew wrote it down.
	const bed = spot && !content.voided ? [spot.bed, spot.features].filter(Boolean).join(' · ') : '';
	const modules = [
		{
			id: 'where',
			header: 'Your spot',
			body: content.voided
				? 'This pass no longer belongs to a ticket. If the ticket was passed on, its new holder has a new pass.'
				: where || 'Your ticket holds no spot right now. Pick one on the map while booking is open.'
		},
		...(bed ? [{ id: 'bed', header: 'Your bed', body: bed }] : []),
		{
			id: 'arrival',
			header: 'At arrival',
			body: 'Show the QR code if the crew asks for your booking pass. This pass updates itself when your spot changes.'
		}
	];
	const links = [{ id: 'pass', uri: content.passUrl, description: 'Booking pass' }];
	if (extras.telegram) {
		links.push({
			id: 'telegram',
			uri: `${config.origin}/telegram`,
			description: 'Every change on Telegram'
		});
	}
	const object: Record<string, unknown> = {
		id: googleObjectId(google, config.origin, content.serial),
		classId: googleClassId(google, config.origin),
		state: content.voided ? 'INACTIVE' : 'ACTIVE',
		ticketNumber: content.code,
		barcode: { type: 'QR_CODE', value: content.passUrl, alternateText: content.code },
		hexBackgroundColor: '#0a0a0a',
		textModulesData: modules,
		linksModuleData: { uris: links }
	};
	if (spot && !content.voided) {
		object.seatInfo = {
			...(spot.house ? { section: text(spot.house) } : {}),
			...(spot.room ? { row: text(spot.room) } : {}),
			seat: text(spot.spot || '—')
		};
		if (content.burnerName) object.ticketHolderName = content.burnerName;
	}
	const until = dayAfter(config.event.end);
	if (until) object.validTimeInterval = { end: { date: until } };
	return object;
}

/** "Add to Google Wallet": a link with a signed token naming the (existing) object. */
export function googleSaveUrl(
	google: Pick<GoogleWalletConfig, 'issuerId' | 'clientEmail' | 'privateKeyPem'>,
	origin: string,
	serial: string
): string {
	const jwt = signJwt(
		{
			iss: google.clientEmail,
			aud: 'google',
			typ: 'savetowallet',
			iat: Math.floor(Date.now() / 1000),
			origins: [origin],
			payload: { eventTicketObjects: [{ id: googleObjectId(google, origin, serial) }] }
		},
		google.privateKeyPem
	);
	return SAVE_URL + jwt;
}

// --- the API -------------------------------------------------------------------

type Token = { value: string; expires: number };
const tokens = new Map<string, Token>();

/** An access token for the Wallet API (service account, JWT bearer grant), cached. */
export async function googleAccessToken(google: GoogleWalletConfig): Promise<string> {
	const cached = tokens.get(google.clientEmail);
	if (cached && cached.expires > Date.now() + 60_000) return cached.value;
	const now = Math.floor(Date.now() / 1000);
	const assertion = signJwt(
		{ iss: google.clientEmail, scope: SCOPE, aud: google.tokenUrl, iat: now, exp: now + 3600 },
		google.privateKeyPem
	);
	const res = await fetch(google.tokenUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const json = (await res.json().catch(() => ({}))) as {
		access_token?: string;
		expires_in?: number;
		error?: string;
	};
	if (!res.ok || !json.access_token) {
		throw new GoogleWalletError(`token: HTTP ${res.status} ${json.error ?? ''}`.trim(), res.status);
	}
	tokens.set(google.clientEmail, {
		value: json.access_token,
		expires: Date.now() + (json.expires_in ?? 3600) * 1000
	});
	return json.access_token;
}

/** One Wallet API call; resolves to the answer's JSON, throws GoogleWalletError. */
async function api(
	google: GoogleWalletConfig,
	method: 'GET' | 'POST' | 'PUT' | 'PATCH',
	path: string,
	body?: unknown
): Promise<Record<string, unknown>> {
	const res = await fetch(`${google.apiUrl}/walletobjects/v1${path}`, {
		method,
		headers: {
			authorization: `Bearer ${await googleAccessToken(google)}`,
			...(body ? { 'content-type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	const json = (await res.json().catch(() => ({}))) as {
		error?: { message?: string; status?: string };
	};
	if (!res.ok) {
		if (res.status === 401) tokens.delete(google.clientEmail);
		const reason = json.error?.status || json.error?.message || '';
		throw new GoogleWalletError(
			`${method} ${path.split('/')[1]}: HTTP ${res.status} ${reason}`.trim(),
			res.status
		);
	}
	return json as Record<string, unknown>;
}

/**
 * Creates the resource, or replaces it when it exists. `prefer`: which call
 * to try first — 'create' for a new pass, 'update' for one that was saved.
 */
async function upsert(
	google: GoogleWalletConfig,
	kind: 'eventTicketClass' | 'eventTicketObject',
	resource: Record<string, unknown>,
	prefer: 'create' | 'update' = 'create'
): Promise<void> {
	const create = () => api(google, 'POST', `/${kind}`, resource);
	const update = () =>
		api(google, 'PUT', `/${kind}/${encodeURIComponent(String(resource.id))}`, resource);
	const retry = (status: number) => (err: unknown) => {
		if (!(err instanceof GoogleWalletError) || err.status !== status) throw err;
		return prefer === 'create' ? update() : create();
	};
	if (prefer === 'create') await create().catch(retry(409));
	else await update().catch(retry(404));
}

// The class is written once per process and whenever the event details change.
const classWritten = new Map<string, string>();

export async function ensureGoogleClass(
	google: GoogleWalletConfig,
	config: WalletConfig
): Promise<void> {
	const cls = googleClass(google, config);
	const fingerprint = JSON.stringify(cls);
	if (classWritten.get(String(cls.id)) === fingerprint) return;
	await upsert(google, 'eventTicketClass', cls);
	classWritten.set(String(cls.id), fingerprint);
}

/** Writes the pass's object as the content says now (creates it if needed). */
export async function writeGoogleObject(
	google: GoogleWalletConfig,
	content: WalletContent,
	config: WalletConfig,
	extras: WalletExtras,
	prefer: 'create' | 'update' = 'create'
): Promise<void> {
	await ensureGoogleClass(google, config);
	await upsert(google, 'eventTicketObject', googleObject(google, content, config, extras), prefer);
}

/** For the tests: forget cached tokens and written classes. */
export function resetGoogleCaches(): void {
	tokens.clear();
	classWritten.clear();
}
