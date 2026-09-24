// src/lib/server/wallet/apple.ts
/**
 * Apple Wallet passes (.pkpass): pass.json, the images, manifest.json with
 * the SHA-1 of every file, and a detached PKCS #7 signature of the manifest
 * made with the Pass Type ID certificate, zipped. See docs/admin/passes.md,
 * "Wallet passes", and Apple's "Wallet Passes" developer documentation.
 *
 * Updates: the pass names this app as its web service (webServiceURL); the
 * devices that add it register here (src/routes/wallet/apple/v1) and are told
 * by a push when it changed (./apns.ts), then fetch the new pass from here.
 * That only works over HTTPS, so a pass made on plain HTTP has no web service.
 */
import crypto from 'crypto';
import forge from 'node-forge';
import { derivedToken } from '$lib/server/crypto';
import type { AppleWalletConfig, WalletConfig } from './config';
import type { WalletContent, WalletExtras } from './content';
import { createZip } from './zip';
import icon1 from './images/icon.png?inline';
import icon2 from './images/icon@2x.png?inline';
import icon3 from './images/icon@3x.png?inline';
import logo1 from './images/logo.png?inline';
import logo2 from './images/logo@2x.png?inline';
import logo3 from './images/logo@3x.png?inline';

export const PKPASS_TYPE = 'application/vnd.apple.pkpass';

/** Where the pass's web service lives (Apple adds /v1/...). */
export const APPLE_WEB_SERVICE_PATH = '/wallet/apple';

function dataUrlBytes(url: string): Buffer {
	return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

const IMAGES: Record<string, Buffer> = {
	'icon.png': dataUrlBytes(icon1),
	'icon@2x.png': dataUrlBytes(icon2),
	'icon@3x.png': dataUrlBytes(icon3),
	'logo.png': dataUrlBytes(logo1),
	'logo@2x.png': dataUrlBytes(logo2),
	'logo@3x.png': dataUrlBytes(logo3)
};

/**
 * The token Apple's devices send with every request about this pass
 * ("Authorization: ApplePass <token>"). Derived from the app's key, so it is
 * never stored; a token works for its own pass only.
 */
export function appleAuthToken(serial: string): string {
	return derivedToken('apple-wallet-pass', serial);
}

/** Compares a request's Authorization header with the pass's token, in constant time. */
export function isAppleAuthorized(header: string | null, serial: string): boolean {
	const match = /^ApplePass ([A-Za-z0-9]{16,128})$/.exec(String(header || '').trim());
	if (!match) return false;
	const given = Buffer.from(match[1]);
	const expected = Buffer.from(appleAuthToken(serial));
	return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function webServiceUrl(origin: string): string | null {
	return origin.startsWith('https://') ? origin + APPLE_WEB_SERVICE_PATH : null;
}

/** The day after the event: the pass shows as expired from then on. */
function expiry(end: string): string | null {
	if (!end) return null;
	return new Date(Date.parse(end) + 24 * 60 * 60 * 1000).toISOString();
}

type Field = Record<string, unknown> & { key: string; value: string };

/** pass.json for a booking pass (the eventTicket style). */
export function applePassJson(
	content: WalletContent,
	config: WalletConfig,
	apple: Pick<AppleWalletConfig, 'passTypeId' | 'teamId'>,
	extras: WalletExtras
): Record<string, unknown> {
	const { event } = config;
	const spot = content.spot;
	const where = spot ? [spot.spot, spot.room, spot.house].filter(Boolean).join(' · ') : '';

	const header: Field[] = [{ key: 'spot', label: 'SPOT', value: spot?.spot || '—' }];
	const primary: Field[] = [
		{
			key: 'room',
			label: content.voided ? 'PASS' : 'ROOM',
			value: content.voided ? 'No longer valid' : spot ? spot.room || '—' : 'No spot right now'
		}
	];
	const secondary: Field[] = spot
		? [
				{ key: 'house', label: 'HOUSE', value: spot.house || '—' },
				{ key: 'burner', label: 'BURNER', value: content.burnerName || 'Mystery Burner' }
			]
		: [
				{
					key: 'house',
					label: content.voided ? 'WHY' : 'WHAT NOW',
					value: content.voided ? 'The ticket has a new pass' : 'Pick a spot on the map'
				}
			];
	const auxiliary: Field[] = [{ key: 'event', label: 'EVENT', value: event.name }];
	if (event.start) {
		auxiliary.push({
			key: 'starts',
			label: 'STARTS',
			value: event.start,
			dateStyle: 'PKDateStyleMedium',
			timeStyle: 'PKDateStyleNone'
		});
	}
	if (event.end) {
		auxiliary.push({
			key: 'ends',
			label: 'ENDS',
			value: event.end,
			dateStyle: 'PKDateStyleMedium',
			timeStyle: 'PKDateStyleNone'
		});
	}

	const back: Field[] = [
		{
			// the whole spot in one field: its change is what the lock screen tells
			key: 'where',
			label: 'Your spot',
			value: content.voided
				? 'This pass no longer belongs to a ticket. If the ticket was passed on, its new holder has a new pass.'
				: where ||
					'Your ticket holds no spot right now. Pick one on the map while booking is open.',
			changeMessage: 'Your CozyNights spot: %@'
		},
		{ key: 'code', label: 'Pass code', value: content.code },
		{
			key: 'pass',
			label: 'The pass online',
			value: content.passUrl,
			attributedValue: `<a href="${content.passUrl}">Open the booking pass</a>`
		},
		{
			key: 'updates',
			label: 'Updates',
			value: extras.telegram
				? `This pass updates itself when your spot changes. Every change as a message on Telegram: ${config.origin}/telegram`
				: 'This pass updates itself when your spot changes.'
		},
		{
			key: 'arrival',
			label: 'At arrival',
			value: 'Show the QR code if the crew asks for your booking pass.'
		}
	];
	if (event.venueName || event.venueAddress) {
		back.push({
			key: 'venue',
			label: 'Where',
			value: [event.venueName, event.venueAddress].filter(Boolean).join('\n')
		});
	}
	back.push({ key: 'privacy', label: 'Privacy', value: `${config.origin}/privacy` });

	const pass: Record<string, unknown> = {
		formatVersion: 1,
		passTypeIdentifier: apple.passTypeId,
		teamIdentifier: apple.teamId,
		serialNumber: content.serial,
		organizationName: config.organization,
		description: `CozyNights booking pass · ${event.name}`,
		logoText: 'CozyNights',
		foregroundColor: 'rgb(255, 255, 255)',
		backgroundColor: 'rgb(10, 10, 10)',
		labelColor: 'rgb(45, 212, 191)',
		// A personal pass: its link shows the booking to whoever has it.
		sharingProhibited: true,
		barcodes: [
			{
				format: 'PKBarcodeFormatQR',
				message: content.passUrl,
				messageEncoding: 'iso-8859-1',
				altText: content.code
			}
		],
		eventTicket: {
			headerFields: header,
			primaryFields: primary,
			secondaryFields: secondary,
			auxiliaryFields: auxiliary,
			backFields: back
		}
	};

	const service = webServiceUrl(config.origin);
	if (service) {
		pass.webServiceURL = service;
		pass.authenticationToken = appleAuthToken(content.serial);
	}
	if (content.voided) pass.voided = true;
	if (event.start) {
		pass.relevantDate = event.start;
		pass.relevantDates = [{ startDate: event.start, endDate: event.end || event.start }];
	}
	const expires = expiry(event.end);
	if (expires) pass.expirationDate = expires;
	// Machine-readable details for the system (Siri suggestions, the lock screen)
	const semantics: Record<string, unknown> = {
		eventName: event.name,
		eventType: 'PKEventTypeSocialGathering'
	};
	if (event.venueName) semantics.venueName = event.venueName;
	if (event.start) semantics.eventStartDate = event.start;
	if (event.end) semantics.eventEndDate = event.end;
	if (event.location) semantics.venueLocation = event.location;
	if (spot && !content.voided) {
		semantics.seats = [{ seatSection: spot.house, seatRow: spot.room, seatNumber: spot.spot }];
	}
	pass.semantics = semantics;
	if (event.location && spot) {
		pass.locations = [
			{
				latitude: event.location.latitude,
				longitude: event.location.longitude,
				relevantText: `CozyNights: your spot is ${where}`
			}
		];
	}
	return pass;
}

/**
 * The detached PKCS #7 signature of manifest.json: SHA-256, signed with the
 * pass certificate's key, with that certificate and Apple's WWDR intermediate.
 */
export function signManifest(
	manifest: Buffer,
	apple: Pick<AppleWalletConfig, 'certPem' | 'keyPem' | 'wwdrPem'>,
	signedAt: Date = new Date()
): Buffer {
	// node-forge reads RSA keys as PKCS #1 or unencrypted PKCS #8; Node's crypto
	// reads anything and hands the key over as PKCS #1.
	const keyPem = crypto
		.createPrivateKey(apple.keyPem)
		.export({ type: 'pkcs1', format: 'pem' })
		.toString();
	const certificate = forge.pki.certificateFromPem(apple.certPem);
	const signed = forge.pkcs7.createSignedData();
	signed.content = forge.util.createBuffer(manifest.toString('binary'));
	signed.addCertificate(certificate);
	signed.addCertificate(forge.pki.certificateFromPem(apple.wwdrPem));
	signed.addSigner({
		key: forge.pki.privateKeyFromPem(keyPem),
		certificate,
		digestAlgorithm: forge.pki.oids.sha256,
		authenticatedAttributes: [
			{ type: forge.pki.oids.contentType, value: forge.pki.oids.data },
			{ type: forge.pki.oids.messageDigest },
			// node-forge's typings want a string here; it takes a Date as well
			{ type: forge.pki.oids.signingTime, value: signedAt as unknown as string }
		]
	});
	signed.sign({ detached: true });
	return Buffer.from(forge.asn1.toDer(signed.toAsn1()).getBytes(), 'binary');
}

/** The .pkpass file for this content. */
export function buildApplePass(
	content: WalletContent,
	config: WalletConfig,
	apple: AppleWalletConfig,
	extras: WalletExtras
): Buffer {
	const files: Record<string, Buffer> = {
		'pass.json': Buffer.from(JSON.stringify(applePassJson(content, config, apple, extras)), 'utf8'),
		...IMAGES
	};
	const manifest: Record<string, string> = {};
	for (const [name, data] of Object.entries(files)) {
		manifest[name] = crypto.createHash('sha1').update(data).digest('hex');
	}
	const manifestJson = Buffer.from(JSON.stringify(manifest), 'utf8');
	return createZip([
		...Object.entries(files).map(([name, data]) => ({ name, data })),
		{ name: 'manifest.json', data: manifestJson },
		{ name: 'signature', data: signManifest(manifestJson, apple) }
	]);
}
