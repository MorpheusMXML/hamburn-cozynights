// tests/wallet.test.ts — Apple Wallet and Google Wallet passes
// (src/lib/server/wallet): the configuration, what a pass shows, the signed
// .pkpass, Google's class, object and save link, the pushes to Apple and the
// sync that keeps passes up to date. Apple and Google are stand-ins here: an
// HTTP/2 server for the push service and an HTTP server for the Wallet API.
// The routes run against a real PocketBase in tests/integration/wallet.test.ts.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import forge from 'node-forge';
import { encrypt } from '../src/lib/server/crypto';
import { findPass } from '../src/lib/server/pass';
import { encodeMonochromePng } from '../src/lib/server/png';
import { parseWalletConfig, readPem, walletPlatforms } from '../src/lib/server/wallet/config';
import {
	contentFromLookup,
	contentHash,
	loadContents,
	type WalletContent
} from '../src/lib/server/wallet/content';
import { createZip, readZip } from '../src/lib/server/wallet/zip';
import {
	appleAuthToken,
	applePassJson,
	buildApplePass,
	isAppleAuthorized
} from '../src/lib/server/wallet/apple';
import {
	environmentSlug,
	googleClass,
	googleObject,
	googleSaveUrl,
	resetGoogleCaches
} from '../src/lib/server/wallet/google';
import { pushPassUpdates } from '../src/lib/server/wallet/apns';
import {
	passesOfDevice,
	recordWalletPass,
	registerDevice,
	unregisterDevice
} from '../src/lib/server/wallet/store';
import { syncWalletPasses } from '../src/lib/server/wallet/sync';
import { FakePb } from './fake-pb';
import {
	applePushService,
	b64,
	googleWalletApi,
	testCredentials,
	testWalletConfig,
	testWalletEnv
} from './wallet-fixtures';

const extras = { telegram: true };

/** The same spot with what the crew wrote down: a lower bunk with a socket, in a heated room. */
const STACKED = {
	house: 'Villa',
	room: 'Dorm #2',
	spot: 'B1',
	bed: 'Lower bunk · below B2',
	features: '🔥 Heated · 🔌 Power socket'
};

function content(overrides: Partial<WalletContent> = {}): WalletContent {
	return {
		...contentFromLookup(
			'AAAABBBBCCCC',
			{ spot: { house: 'Villa', room: 'Dorm #2', spot: 'B1' }, burnerName: 'Sunny' },
			'https://cozy.test'
		),
		...overrides
	};
}

describe('wallet configuration', () => {
	it('is off without any wallet values, and says nothing about it', () => {
		const { config, problems } = parseWalletConfig({ ORIGIN: 'https://cozy.test' });
		expect(config.apple).toBeNull();
		expect(config.google).toBeNull();
		expect(problems).toEqual([]);
		expect(walletPlatforms(config)).toEqual([]);
	});

	it('reads both wallets from base64 or PEM with escaped line breaks', () => {
		const c = testCredentials();
		const config = testWalletConfig({
			WALLET_APPLE_CERT: c.certPem.replace(/\n/g, '\\n'),
			WALLET_GOOGLE_SERVICE_ACCOUNT: c.serviceAccount
		});
		expect(config.apple?.passTypeId).toBe('pass.test.cozynights');
		expect(config.apple?.apnsUrl).toBe('https://api.push.apple.com');
		expect(config.google?.clientEmail).toBe('cozy-wallet@cozy-test.iam.gserviceaccount.com');
		expect(walletPlatforms(config)).toEqual(['apple', 'google']);
		expect(readPem(b64(c.certPem))).toBe(c.certPem.trim() + '\n');
		expect(readPem('not a pem')).toBe('');
	});

	it('keeps a wallet off when a value is missing or wrong, and says why', () => {
		const c = testCredentials();
		const missing = parseWalletConfig(testWalletEnv({ WALLET_APPLE_KEY: '' }));
		expect(missing.config.apple).toBeNull();
		expect(missing.problems[0]).toMatchObject({ platform: 'apple' });
		expect(missing.problems[0].message).toContain('WALLET_APPLE_KEY');

		const foreign = parseWalletConfig(testWalletEnv({ WALLET_APPLE_KEY: b64(c.otherKeyPem) }));
		expect(foreign.config.apple).toBeNull();
		expect(foreign.problems[0].message).toContain('does not belong');

		const team = parseWalletConfig(testWalletEnv({ WALLET_APPLE_TEAM_ID: 'short' }));
		expect(team.problems[0].message).toContain('WALLET_APPLE_TEAM_ID');

		const google = parseWalletConfig(testWalletEnv({ WALLET_GOOGLE_SERVICE_ACCOUNT: 'e30=' }));
		expect(google.config.google).toBeNull();
		expect(google.problems[0]).toMatchObject({ platform: 'google' });

		const noOrigin = parseWalletConfig(testWalletEnv({ ORIGIN: '' }));
		expect(walletPlatforms(noOrigin.config)).toEqual([]);
		expect(noOrigin.problems.map((p) => p.message)).toEqual([
			'ORIGIN is not set',
			'ORIGIN is not set'
		]);
	});

	it('keeps the event times with their offset, and ignores times without one', () => {
		const config = testWalletConfig({ WALLET_EVENT_END: '2026-10-04' });
		expect(config.event.start).toBe('2026-10-01T14:00:00+02:00');
		expect(config.event.end).toBe('');
		expect(config.event.location).toBeNull();
		const located = testWalletConfig({
			WALLET_VENUE_LATITUDE: '54.1',
			WALLET_VENUE_LONGITUDE: '10.07'
		});
		expect(located.event.location).toEqual({ latitude: 54.1, longitude: 10.07 });
	});
});

describe('what a wallet pass shows', () => {
	it('is the pass page: spot and burner name, or nothing but the code', () => {
		expect(content()).toMatchObject({
			serial: 'AAAABBBBCCCC',
			code: 'AAAA-BBBB-CCCC',
			passUrl: 'https://cozy.test/pass/AAAA-BBBB-CCCC',
			voided: false,
			spot: { house: 'Villa', room: 'Dorm #2', spot: 'B1' },
			burnerName: 'Sunny'
		});
		const noSpot = contentFromLookup(
			'AAAABBBBCCCC',
			{ spot: null, burnerName: 'Sunny' },
			'https://x'
		);
		expect(noSpot).toMatchObject({ voided: false, spot: null, burnerName: '' });
		const voided = contentFromLookup('AAAABBBBCCCC', null, 'https://x');
		expect(voided).toMatchObject({ voided: true, spot: null });
	});

	it('carries the kind of bed and the features at the spot, only when the crew wrote them down', () => {
		// findPass says '' for both when nobody said: the pass then has no such keys.
		expect(content().spot).toEqual({ house: 'Villa', room: 'Dorm #2', spot: 'B1' });
		const blank = contentFromLookup(
			'AAAABBBBCCCC',
			{ spot: { ...STACKED, bed: '', features: '' }, burnerName: 'Sunny' },
			'https://cozy.test'
		);
		expect(blank.spot).toEqual({ house: 'Villa', room: 'Dorm #2', spot: 'B1' });
		const stacked = contentFromLookup(
			'AAAABBBBCCCC',
			{ spot: STACKED, burnerName: 'Sunny' },
			'https://cozy.test'
		);
		expect(stacked.spot).toEqual(STACKED);
		const bedOnly = contentFromLookup(
			'AAAABBBBCCCC',
			{ spot: { ...STACKED, features: '' }, burnerName: 'Sunny' },
			'https://cozy.test'
		);
		expect(bedOnly.spot).toEqual({ ...STACKED, features: undefined });
		expect(bedOnly.spot).not.toHaveProperty('features');
	});

	it('changes its fingerprint with the spot, the offers and the event, and only then', () => {
		const config = testWalletConfig();
		const base = contentHash(content(), config, extras);
		expect(contentHash(content(), config, extras)).toBe(base);
		expect(
			contentHash(
				content({ spot: { house: 'Villa', room: 'Dorm #2', spot: 'B2' } }),
				config,
				extras
			)
		).not.toBe(base);
		// The bed or the features change (the guest moved to the upper bunk, the
		// crew wrote down the socket): the wallets are told.
		const stacked = contentHash(content({ spot: STACKED }), config, extras);
		expect(stacked).not.toBe(base);
		expect(
			contentHash(content({ spot: { ...STACKED, bed: 'Upper bunk · above B2' } }), config, extras)
		).not.toBe(stacked);
		expect(
			contentHash(content({ spot: { ...STACKED, features: '🔥 Heated' } }), config, extras)
		).not.toBe(stacked);
		expect(contentHash(content(), config, { telegram: false })).not.toBe(base);
		expect(
			contentHash(content(), testWalletConfig({ WALLET_EVENT_NAME: 'Hamburn 2027' }), extras)
		).not.toBe(base);
	});
});

describe('zip and png', () => {
	it('writes a ZIP that reads back file by file', () => {
		const files = [
			{ name: 'pass.json', data: Buffer.from('{"a":1}') },
			{ name: 'icon@2x.png', data: crypto.randomBytes(3000) }
		];
		const archive = createZip(files);
		expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
		const read = readZip(archive);
		expect([...read.keys()]).toEqual(['pass.json', 'icon@2x.png']);
		expect(read.get('icon@2x.png')).toEqual(files[1].data);
		expect(() => createZip([{ name: '../evil', data: Buffer.alloc(1) }])).toThrow(/bad file name/);
	});

	it('draws a black-and-white PNG pixel by pixel', () => {
		const pixels = [
			[true, false, false],
			[false, true, false]
		];
		const png = encodeMonochromePng(pixels);
		expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(png.readUInt32BE(16)).toBe(3); // width
		expect(png.readUInt32BE(20)).toBe(2); // height
		const idatAt = png.indexOf('IDAT');
		const raw = zlib.inflateSync(
			png.subarray(idatAt + 4, idatAt + 4 + png.readUInt32BE(idatAt - 4))
		);
		// row 0: filter byte, then 0b011xxxxx (black, white, white); row 1: 0b101xxxxx
		expect(raw[0]).toBe(0);
		expect(raw[1] >> 5).toBe(0b011);
		expect(raw[3] >> 5).toBe(0b101);
	});
});

/** The signed attributes and signature of a detached PKCS #7 signature. */
function signerOf(signature: Buffer) {
	const asn1 = forge.asn1.fromDer(signature.toString('binary'));
	const message = forge.pkcs7.messageFromAsn1(asn1) as any;
	const signerInfo = message.rawCapture.signerInfos[0];
	const [, , digestAlgorithm, signedAttrs, , signatureValue] = signerInfo.value;
	// The signature covers the attributes DER-encoded as a SET (tag 0x31).
	const asSet = forge.asn1.create(
		forge.asn1.Class.UNIVERSAL,
		forge.asn1.Type.SET,
		true,
		signedAttrs.value
	);
	const attributes: Record<string, string> = {};
	for (const attribute of signedAttrs.value) {
		const oid = forge.asn1.derToOid(attribute.value[0].value);
		attributes[forge.pki.oids[oid] ?? oid] = attribute.value[1].value[0].value;
	}
	return {
		certificates: message.certificates.map((c: forge.pki.Certificate) =>
			forge.pki.certificateToPem(c)
		) as string[],
		digest: forge.pki.oids[forge.asn1.derToOid(digestAlgorithm.value[0].value)],
		signedBytes: Buffer.from(forge.asn1.toDer(asSet).getBytes(), 'binary'),
		signature: Buffer.from(signatureValue.value, 'binary'),
		attributes
	};
}

describe('Apple Wallet pass', () => {
	const config = testWalletConfig();

	it('shows the spot like the pass page, with the QR code of the pass link', () => {
		const pass = applePassJson(content(), config, config.apple!, extras) as any;
		expect(pass).toMatchObject({
			formatVersion: 1,
			passTypeIdentifier: 'pass.test.cozynights',
			teamIdentifier: 'TESTTEAM01',
			serialNumber: 'AAAABBBBCCCC',
			sharingProhibited: true,
			webServiceURL: 'https://cozy.test/wallet/apple',
			authenticationToken: appleAuthToken('AAAABBBBCCCC'),
			barcodes: [
				{
					format: 'PKBarcodeFormatQR',
					message: 'https://cozy.test/pass/AAAA-BBBB-CCCC',
					messageEncoding: 'iso-8859-1',
					altText: 'AAAA-BBBB-CCCC'
				}
			],
			relevantDates: [
				{ startDate: '2026-10-01T14:00:00+02:00', endDate: '2026-10-04T12:00:00+02:00' }
			],
			expirationDate: '2026-10-05T10:00:00.000Z',
			semantics: {
				eventName: 'Hamburn 2026',
				venueName: 'Brahmsee',
				seats: [{ seatSection: 'Villa', seatRow: 'Dorm #2', seatNumber: 'B1' }]
			}
		});
		expect(pass.voided).toBeUndefined();
		const t = pass.eventTicket;
		expect(t.headerFields[0]).toMatchObject({ key: 'spot', value: 'B1' });
		expect(t.primaryFields[0]).toMatchObject({ key: 'room', value: 'Dorm #2' });
		expect(t.secondaryFields.map((f: any) => f.value)).toEqual(['Villa', 'Sunny']);
		const where = t.backFields.find((f: any) => f.key === 'where');
		expect(where).toMatchObject({
			value: 'B1 · Dorm #2 · Villa',
			changeMessage: 'Your CozyNights spot: %@'
		});
		expect(JSON.stringify(pass)).toContain('https://cozy.test/telegram');
		expect(
			JSON.stringify(applePassJson(content(), config, config.apple!, { telegram: false }))
		).not.toContain('/telegram');
	});

	it('tells the kind of bed and what is at the spot on the back, when the crew wrote them down', () => {
		const pass = applePassJson(content({ spot: STACKED }), config, config.apple!, extras) as any;
		const back = pass.eventTicket.backFields;
		// right after the spot, before the code
		expect(back.slice(0, 4).map((f: any) => f.key)).toEqual(['where', 'bed', 'features', 'code']);
		expect(back[1]).toEqual({ key: 'bed', label: 'Bed', value: 'Lower bunk · below B2' });
		expect(back[2]).toEqual({
			key: 'features',
			label: 'At your spot',
			value: '🔥 Heated · 🔌 Power socket'
		});
		// the front stays as it was: the spot, the room, the house, the burner
		expect(pass.eventTicket.headerFields[0].value).toBe('B1');
		expect(pass.semantics.seats).toEqual([
			{ seatSection: 'Villa', seatRow: 'Dorm #2', seatNumber: 'B1' }
		]);

		// Only the bed known: one field. Nothing known: neither.
		const bedOnly = applePassJson(
			content({ spot: { ...STACKED, features: undefined } }),
			config,
			config.apple!,
			extras
		) as any;
		expect(bedOnly.eventTicket.backFields.slice(0, 3).map((f: any) => f.key)).toEqual([
			'where',
			'bed',
			'code'
		]);
		const plain = applePassJson(content(), config, config.apple!, extras) as any;
		const keys = plain.eventTicket.backFields.map((f: any) => f.key);
		expect(keys).not.toContain('bed');
		expect(keys).not.toContain('features');
		expect(JSON.stringify(plain)).not.toMatch(/At your spot|"Bed"/);
	});

	it('says so when the ticket holds no spot, and is void after a hand-over', () => {
		const empty = applePassJson(
			content({ spot: null, burnerName: '' }),
			config,
			config.apple!,
			extras
		) as any;
		expect(empty.eventTicket.primaryFields[0].value).toBe('No spot right now');
		expect(empty.voided).toBeUndefined();
		expect(empty.semantics.seats).toBeUndefined();

		const voided = applePassJson(
			content({ spot: null, voided: true }),
			config,
			config.apple!,
			extras
		) as any;
		expect(voided.voided).toBe(true);
		expect(voided.eventTicket.primaryFields[0]).toMatchObject({
			label: 'PASS',
			value: 'No longer valid'
		});
	});

	it('has no web service on plain HTTP: Apple only talks to HTTPS', () => {
		const local = testWalletConfig({ ORIGIN: 'http://127.0.0.1:3290' });
		const pass = applePassJson(content(), local, local.apple!, extras) as any;
		expect(pass.webServiceURL).toBeUndefined();
		expect(pass.authenticationToken).toBeUndefined();
	});

	it('is a signed .pkpass: manifest with SHA-1, detached SHA-256 signature with the WWDR certificate', () => {
		const c = testCredentials();
		const files = readZip(buildApplePass(content(), config, config.apple!, extras));
		expect([...files.keys()].sort()).toEqual(
			[
				'icon.png',
				'icon@2x.png',
				'icon@3x.png',
				'logo.png',
				'logo@2x.png',
				'logo@3x.png',
				'manifest.json',
				'pass.json',
				'signature'
			].sort()
		);
		const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8'));
		expect(Object.keys(manifest).sort()).toEqual(
			[...files.keys()].filter((n) => n !== 'manifest.json' && n !== 'signature').sort()
		);
		for (const [name, sha1] of Object.entries(manifest)) {
			expect(crypto.createHash('sha1').update(files.get(name)!).digest('hex'), name).toBe(sha1);
		}
		// the images are real PNGs, the icon 38 points wide
		expect(files.get('icon@2x.png')!.readUInt32BE(16)).toBe(76);

		const signer = signerOf(files.get('signature')!);
		expect(signer.digest).toBe('sha256');
		expect(signer.certificates).toHaveLength(2);
		expect(signer.certificates.map((p) => p.trim())).toContain(c.wwdrPem.trim());
		expect(Object.keys(signer.attributes).sort()).toEqual(
			['contentType', 'messageDigest', 'signingTime'].sort()
		);
		expect(Buffer.from(signer.attributes.messageDigest, 'binary')).toEqual(
			crypto.createHash('sha256').update(files.get('manifest.json')!).digest()
		);
		const publicKey = new crypto.X509Certificate(c.certPem).publicKey;
		expect(crypto.verify('sha256', signer.signedBytes, publicKey, signer.signature)).toBe(true);
	});

	it('verifies with OpenSSL against the root, like a device checks it (when OpenSSL is there)', () => {
		const c = testCredentials();
		const files = readZip(buildApplePass(content(), config, config.apple!, extras));
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cozy-pkpass-'));
		try {
			fs.writeFileSync(path.join(dir, 'manifest.json'), files.get('manifest.json')!);
			fs.writeFileSync(path.join(dir, 'signature'), files.get('signature')!);
			fs.writeFileSync(path.join(dir, 'root.pem'), c.rootPem);
			let output: string;
			try {
				output = execFileSync(
					'openssl',
					[
						'cms',
						'-verify',
						'-binary',
						'-inform',
						'DER',
						'-in',
						'signature',
						'-content',
						'manifest.json',
						'-CAfile',
						'root.pem',
						'-purpose',
						'any',
						'-out',
						'/dev/null'
					],
					{ cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }
				).toString();
			} catch (err) {
				const e = err as { code?: string; stderr?: Buffer };
				if (e.code === 'ENOENT') return; // no OpenSSL on this machine
				throw new Error(`openssl cms -verify failed: ${e.stderr?.toString() ?? err}`);
			}
			expect(output).toBe('');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("takes the device's token for its own pass only", () => {
		const token = appleAuthToken('AAAABBBBCCCC');
		expect(token).toMatch(/^[0-9a-f]{32}$/);
		expect(appleAuthToken('AAAABBBBCCCC')).toBe(token);
		expect(appleAuthToken('DDDDEEEEFFFF')).not.toBe(token);
		expect(isAppleAuthorized(`ApplePass ${token}`, 'AAAABBBBCCCC')).toBe(true);
		expect(isAppleAuthorized(`ApplePass ${token}`, 'DDDDEEEEFFFF')).toBe(false);
		expect(isAppleAuthorized(`Bearer ${token}`, 'AAAABBBBCCCC')).toBe(false);
		expect(isAppleAuthorized(null, 'AAAABBBBCCCC')).toBe(false);
	});
});

describe('Google Wallet pass', () => {
	const config = testWalletConfig();

	it('names class and objects by issuer and environment', () => {
		expect(environmentSlug('https://test-cozynights.hamburn.de')).toBe(
			'test-cozynights-hamburn-de'
		);
		const cls = googleClass(config.google!, config) as any;
		expect(cls).toMatchObject({
			id: '3388000000012345678.cozynights-cozy-test',
			reviewStatus: 'UNDER_REVIEW',
			multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
			logo: { sourceUri: { uri: 'https://cozy.test/wallet/google-logo.png' } },
			venue: {
				name: { defaultValue: { value: 'Brahmsee' } },
				address: { defaultValue: { value: 'Am See 1, 24631 Langwedel' } }
			},
			dateTime: { start: '2026-10-01T14:00:00+02:00', end: '2026-10-04T12:00:00+02:00' },
			customSeatLabel: { defaultValue: { value: 'Spot' } }
		});
		expect(cls.seatLabel).toBeUndefined();
	});

	it('shows house, room and spot as section, row and seat, and goes inactive when void', () => {
		const object = googleObject(config.google!, content(), config, extras) as any;
		expect(object).toMatchObject({
			id: '3388000000012345678.cozy-test-AAAABBBBCCCC',
			classId: '3388000000012345678.cozynights-cozy-test',
			state: 'ACTIVE',
			ticketNumber: 'AAAA-BBBB-CCCC',
			ticketHolderName: 'Sunny',
			barcode: {
				type: 'QR_CODE',
				value: 'https://cozy.test/pass/AAAA-BBBB-CCCC',
				alternateText: 'AAAA-BBBB-CCCC'
			},
			seatInfo: {
				section: { defaultValue: { value: 'Villa' } },
				row: { defaultValue: { value: 'Dorm #2' } },
				seat: { defaultValue: { value: 'B1' } }
			},
			validTimeInterval: { end: { date: '2026-10-05T10:00:00.000Z' } }
		});
		expect(object.linksModuleData.uris.map((u: any) => u.id)).toEqual(['pass', 'telegram']);

		const voided = googleObject(
			config.google!,
			content({ spot: null, voided: true }),
			config,
			extras
		) as any;
		expect(voided.state).toBe('INACTIVE');
		expect(voided.seatInfo).toBeUndefined();
		expect(voided.ticketHolderName).toBeUndefined();
	});

	it('tells the kind of bed and what is at the spot in its own module, when the crew wrote them down', () => {
		const object = googleObject(config.google!, content({ spot: STACKED }), config, extras) as any;
		expect(object.textModulesData.map((m: any) => m.id)).toEqual(['where', 'bed', 'arrival']);
		expect(object.textModulesData[1]).toEqual({
			id: 'bed',
			header: 'Your bed',
			body: 'Lower bunk · below B2 · 🔥 Heated · 🔌 Power socket'
		});
		// the seat stays the spot's label
		expect(object.seatInfo.seat.defaultValue.value).toBe('B1');

		const featuresOnly = googleObject(
			config.google!,
			content({ spot: { ...STACKED, bed: undefined } }),
			config,
			extras
		) as any;
		expect(featuresOnly.textModulesData[1]).toMatchObject({
			id: 'bed',
			body: '🔥 Heated · 🔌 Power socket'
		});

		const plain = googleObject(config.google!, content(), config, extras) as any;
		expect(plain.textModulesData.map((m: any) => m.id)).toEqual(['where', 'arrival']);
		expect(JSON.stringify(plain)).not.toContain('Your bed');
	});

	it('saves through a link with a signed token that names the object', () => {
		const c = testCredentials();
		const url = googleSaveUrl(config.google!, config.origin, 'AAAABBBBCCCC');
		expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
		const [header, payload, signature] = url.slice(url.lastIndexOf('/') + 1).split('.');
		expect(
			crypto.verify(
				'RSA-SHA256',
				Buffer.from(`${header}.${payload}`),
				c.googlePublicPem,
				Buffer.from(signature, 'base64url')
			)
		).toBe(true);
		expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
			iss: 'cozy-wallet@cozy-test.iam.gserviceaccount.com',
			aud: 'google',
			typ: 'savetowallet',
			origins: ['https://cozy.test'],
			payload: { eventTicketObjects: [{ id: '3388000000012345678.cozy-test-AAAABBBBCCCC' }] }
		});
	});
});

describe('Apple pushes', () => {
	it('tells every device, and says which tokens are dead', async () => {
		const service = await applePushService((token) =>
			token.startsWith('dead') ? 410 : token.startsWith('bad') ? 500 : 200
		);
		try {
			const config = testWalletConfig({ WALLET_APPLE_APNS_URL: service.url });
			const results = await pushPassUpdates(config.apple!, [
				'aaaa0000aaaa0000',
				'dead0000dead0000',
				'bad00000bad00000',
				'not-a-token'
			]);
			expect(results.get('aaaa0000aaaa0000')).toMatchObject({ outcome: 'sent', detail: '200' });
			expect(results.get('dead0000dead0000')).toMatchObject({
				outcome: 'gone',
				detail: '410 Unregistered'
			});
			expect(results.get('bad00000bad00000')?.outcome).toBe('failed');
			expect(results.get('not-a-token')?.outcome).toBe('gone');
			expect(service.seen.map((s) => s.token).sort()).toEqual(
				['aaaa0000aaaa0000', 'bad00000bad00000', 'dead0000dead0000'].sort()
			);
			for (const push of service.seen) {
				expect(push).toMatchObject({ topic: 'pass.test.cozynights', body: '{}' });
			}
		} finally {
			service.close();
		}
	});

	it('fails the batch, without throwing, when the service is unreachable', async () => {
		const config = testWalletConfig({ WALLET_APPLE_APNS_URL: 'http://127.0.0.1:1' });
		const results = await pushPassUpdates(config.apple!, ['aaaa0000aaaa0000']);
		expect(results.get('aaaa0000aaaa0000')?.outcome).toBe('failed');
	});
});

// --- the records and the sync ------------------------------------------------------

/**
 * One quiet house with one heated room and a bunk bed: B1 below (with a
 * socket), B2 above. The ticket sleeps in B1.
 */
function seedCamp(pb: FakePb) {
	const house = pb.seed('houses', { name: 'Villa', features: ['quiet'] });
	const room = pb.seed('rooms', {
		name: 'Dorm',
		room_number: 2,
		house: house.id,
		features: ['heated']
	});
	const beds = ['B1', 'B2'].map((label) => pb.seed('beds', { label, room: room.id, order: '' }));
	Object.assign(beds[0], { bed_type: 'bunk_lower', bunk_partner: beds[1].id, features: 'power' });
	Object.assign(beds[1], { bed_type: 'bunk_upper', bunk_partner: beds[0].id });
	const order = pb.seed('orders', {
		order_number: 'HB-1',
		pass_code: 'AAAABBBBCCCC',
		burner_name: encrypt('Sunny')
	});
	beds[0].order = order.id;
	pb.seed('app_settings', { id: 'appsettings0123', telegram_bot: 'cozy_test_bot' });
	return { house, room, beds, order };
}

describe('wallet records', () => {
	it('notes a handed-out pass once per platform and serial', async () => {
		const pb = new FakePb();
		const first = await recordWalletPass(pb as any, {
			platform: 'apple',
			serial: 'AAAABBBBCCCC',
			order: 'o1',
			hash: 'h1',
			delivered: true
		});
		expect(first).toMatchObject({ hash: 'h1', pushed_hash: 'h1' });
		const again = await recordWalletPass(pb as any, {
			platform: 'apple',
			serial: 'AAAABBBBCCCC',
			order: 'o1',
			hash: 'h2',
			delivered: false
		});
		expect(again.id).toBe(first.id);
		expect(again).toMatchObject({ hash: 'h2', pushed_hash: 'h1' });
		expect(pb.rows('wallet_passes')).toHaveLength(1);
	});

	it('keeps the devices of a pass, their newest token, and what changed since a tag', async () => {
		const pb = new FakePb();
		const pass = await recordWalletPass(pb as any, {
			platform: 'apple',
			serial: 'AAAABBBBCCCC',
			order: 'o1',
			hash: 'h1',
			delivered: true
		});
		expect(await registerDevice(pb as any, pass.id, 'device1', 'aaaa0000aaaa0000')).toBe(true);
		expect(await registerDevice(pb as any, pass.id, 'device1', 'bbbb0000bbbb0000')).toBe(false);
		expect(pb.rows('wallet_devices')).toHaveLength(1);
		expect(pb.rows('wallet_devices')[0].push_token).toBe('bbbb0000bbbb0000');

		const changed = Date.parse(pb.rows('wallet_passes')[0].changed_at);
		expect(await passesOfDevice(pb as any, 'device1', 0)).toEqual({
			serials: ['AAAABBBBCCCC'],
			lastUpdated: changed
		});
		expect((await passesOfDevice(pb as any, 'device1', changed)).serials).toEqual([]);
		expect(await unregisterDevice(pb as any, pass.id, 'device1')).toBe(true);
		expect(await unregisterDevice(pb as any, pass.id, 'device1')).toBe(false);
	});
});

describe('the wallet sync', () => {
	let apple: Awaited<ReturnType<typeof applePushService>>;
	let google: Awaited<ReturnType<typeof googleWalletApi>>;

	beforeAll(async () => {
		apple = await applePushService((token) => (token.startsWith('dead') ? 410 : 200));
		google = await googleWalletApi();
	});
	afterAll(() => {
		apple.close();
		google.close();
	});
	beforeEach(() => {
		resetGoogleCaches();
		apple.seen.length = 0;
		google.calls.length = 0;
		google.store.clear();
		google.fail(0);
	});

	const syncConfig = () => testWalletConfig({ WALLET_APPLE_APNS_URL: apple.url, ...google.urls });

	it('reads the content of many passes the way the pass page does', async () => {
		const pb = new FakePb();
		const { order } = seedCamp(pb);
		const contents = await loadContents(
			pb as any,
			['AAAABBBBCCCC', 'ZZZZYYYYXXXX'],
			'https://cozy.test'
		);
		expect(contents.get('AAAABBBBCCCC')).toMatchObject({
			voided: false,
			spot: {
				house: 'Villa',
				room: 'Dorm #2',
				spot: 'B1',
				// the other level of the bunk bed, and the house's, the room's and the
				// spot's features together, in the catalogue's order
				bed: 'Lower bunk · below B2',
				features: '🔥 Heated · 🤫 Quiet zone · 🔌 Power socket'
			},
			burnerName: 'Sunny'
		});
		expect(contents.get('ZZZZYYYYXXXX')?.voided).toBe(true);
		expect(order.id).toBeTruthy();
		// word for word what the pass page reads for one pass
		expect(contents.get('AAAABBBBCCCC')).toEqual(
			contentFromLookup(
				'AAAABBBBCCCC',
				await findPass(pb as any, 'AAAABBBBCCCC'),
				'https://cozy.test'
			)
		);
	});

	it('pushes a move to Apple devices and to Google, and forgets dead devices', async () => {
		const pb = new FakePb();
		const { beds, order } = seedCamp(pb);
		const config = syncConfig();
		const now = Date.parse('2026-09-25T12:00:00Z');

		// First run: nothing was pushed yet — Google gets class and object, the
		// Apple devices a push, and the published platforms are set.
		const applePass = pb.seed('wallet_passes', {
			platform: 'apple',
			serial: 'AAAABBBBCCCC',
			order: order.id,
			hash: '',
			pushed_hash: ''
		});
		pb.seed('wallet_passes', {
			platform: 'google',
			serial: 'AAAABBBBCCCC',
			order: order.id,
			hash: '',
			pushed_hash: ''
		});
		pb.seed('wallet_devices', {
			pass: applePass.id,
			device: 'phone',
			push_token: 'aaaa0000aaaa0000'
		});
		pb.seed('wallet_devices', {
			pass: applePass.id,
			device: 'watch',
			push_token: 'dead0000dead0000'
		});

		const first = await syncWalletPasses(pb as any, config, now);
		expect(first).toEqual({ passes: 2, changed: 2, pushed: 2, failed: 0 });
		expect(apple.seen.map((s) => s.token).sort()).toEqual(['aaaa0000aaaa0000', 'dead0000dead0000']);
		expect(pb.rows('wallet_devices').map((d) => d.device)).toEqual(['phone']);
		expect(pb.rows('app_settings')[0].wallet_platforms).toBe('apple,google');
		const object = google.store.get('eventTicketObject/3388000000012345678.cozy-test-AAAABBBBCCCC');
		expect(object.seatInfo.seat.defaultValue.value).toBe('B1');
		expect(google.store.has('eventTicketClass/3388000000012345678.cozynights-cozy-test')).toBe(
			true
		);
		for (const row of pb.rows('wallet_passes')) expect(row.pushed_hash).toBe(row.hash);

		// Nothing changed: nothing is sent.
		apple.seen.length = 0;
		google.calls.length = 0;
		expect(await syncWalletPasses(pb as any, config, now + 30_000)).toEqual({
			passes: 2,
			changed: 0,
			pushed: 0,
			failed: 0
		});
		expect(apple.seen).toEqual([]);
		expect(google.calls.filter((c) => c.path !== '/token')).toEqual([]);

		// The guest moves: both wallets hear about it.
		beds[0].order = '';
		beds[1].order = order.id;
		beds[1].updated = '2026-09-25 12:01:00.000Z';
		const moved = await syncWalletPasses(pb as any, config, now + 60_000);
		expect(moved).toMatchObject({ changed: 2, pushed: 2 });
		expect(apple.seen.map((s) => s.token)).toEqual(['aaaa0000aaaa0000']);
		const movedObject = google.store.get(
			'eventTicketObject/3388000000012345678.cozy-test-AAAABBBBCCCC'
		);
		expect(movedObject.seatInfo.seat.defaultValue.value).toBe('B2');
		// the upper bunk now, above a B1 nobody holds: the free partner is still named
		expect(movedObject.textModulesData.find((m: any) => m.id === 'bed')).toMatchObject({
			body: 'Upper bunk · above B1 · 🔥 Heated · 🤫 Quiet zone'
		});
		expect(pb.rows('wallet_passes')[0].changed_at).toBe(new Date(now + 60_000).toISOString());
	});

	it('voids the pass of a ticket that was handed over', async () => {
		const pb = new FakePb();
		const { order } = seedCamp(pb);
		pb.seed('wallet_passes', {
			platform: 'google',
			serial: 'AAAABBBBCCCC',
			order: order.id,
			hash: '',
			pushed_hash: ''
		});
		await syncWalletPasses(pb as any, syncConfig());
		order.pass_code = 'NEWNEWNEWNEW';
		await syncWalletPasses(pb as any, syncConfig());
		const object = google.store.get('eventTicketObject/3388000000012345678.cozy-test-AAAABBBBCCCC');
		expect(object.state).toBe('INACTIVE');
		expect(object.seatInfo).toBeUndefined();
	});

	it('tries a failed update again later, not on every run', async () => {
		const pb = new FakePb();
		const { order } = seedCamp(pb);
		pb.seed('wallet_passes', {
			platform: 'google',
			serial: 'AAAABBBBCCCC',
			order: order.id,
			hash: '',
			pushed_hash: ''
		});
		const config = syncConfig();
		const now = Date.parse('2026-09-25T12:00:00Z');
		google.fail(500);
		expect(await syncWalletPasses(pb as any, config, now)).toMatchObject({ failed: 1, pushed: 0 });
		const row = pb.rows('wallet_passes')[0];
		expect(row).toMatchObject({ attempts: 1, next_try: new Date(now + 60_000).toISOString() });
		expect(row.last_error).toContain('HTTP 500');

		google.calls.length = 0;
		expect(await syncWalletPasses(pb as any, config, now + 30_000)).toMatchObject({
			failed: 0,
			pushed: 0
		});
		expect(google.calls).toEqual([]); // still waiting

		google.fail(0);
		expect(await syncWalletPasses(pb as any, config, now + 61_000)).toMatchObject({ pushed: 1 });
		expect(pb.rows('wallet_passes')[0]).toMatchObject({
			attempts: 0,
			next_try: '',
			last_error: ''
		});
	});

	it('leaves the records of a wallet that is switched off alone', async () => {
		const pb = new FakePb();
		const { order } = seedCamp(pb);
		pb.seed('wallet_passes', {
			platform: 'apple',
			serial: 'AAAABBBBCCCC',
			order: order.id,
			hash: '',
			pushed_hash: ''
		});
		const googleOnly = testWalletConfig({
			WALLET_APPLE_CERT: '',
			WALLET_APPLE_PASS_TYPE_ID: '',
			WALLET_APPLE_TEAM_ID: '',
			...google.urls
		});
		expect(googleOnly.apple).toBeNull();
		const report = await syncWalletPasses(pb as any, googleOnly);
		expect(report).toMatchObject({ changed: 1, pushed: 0, failed: 0 });
		expect(pb.rows('wallet_passes')[0].pushed_hash).toBe('');
		expect(pb.rows('app_settings')[0].wallet_platforms).toBe('google');
	});
});
