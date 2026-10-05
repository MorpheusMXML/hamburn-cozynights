// tests/stack-helpers.ts — shared by tests/integration and tests/smoke.
// Connection details come from scripts/test-stack.sh (throwaway PocketBase).
// The QR picture readers at the end serve tests/pass-qr-hook.test.ts too.
import PocketBase, { ClientResponseError } from 'pocketbase';
import crypto from 'crypto';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { expect } from 'vitest';
import decodeQR from 'qr/decode.js';

export const PB_TEST_URL = process.env.PB_TEST_URL || '';

/** PocketBase answers with one of these when an API rule or hook says no. */
const REFUSED = [400, 401, 403, 404];

/** The request must be refused by PocketBase (not merely fail for another reason). */
export async function expectRefused(promise: Promise<unknown>): Promise<void> {
	const outcome = await promise.then(
		() => 'it was allowed',
		(err) => err
	);
	expect(outcome).toBeInstanceOf(ClientResponseError);
	expect(REFUSED).toContain((outcome as ClientResponseError).status);
}

/** A client without any session: what a guest's browser could do at most. */
export function anonymous(): PocketBase {
	const pb = new PocketBase(PB_TEST_URL);
	pb.autoCancellation(false);
	return pb;
}

/** The app's service account (superuser), as created by scripts/test-stack.sh. */
export async function serviceAccount(): Promise<PocketBase> {
	if (!PB_TEST_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
		throw new Error(
			'PB_TEST_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are not set — run these tests with `npm run test:integration` or `npm run test:smoke`.'
		);
	}
	const pb = anonymous();
	await pb
		.collection('_superusers')
		.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
	return pb;
}

/** Short unique suffix: tests share one database and must not collide. */
export function uid(): string {
	return crypto.randomBytes(4).toString('hex');
}

export type Role = 'pending' | 'admin' | 'superuser';

/**
 * Creates an `admins` record the way the server does (always born `pending`,
 * approved by a later update) and returns it with a signed-in client — the
 * stand-in for "this person signed in with Google" (incl. `last_sign_in`).
 */
export async function createAdmin(su: PocketBase, role: Role) {
	const password = crypto.randomBytes(24).toString('hex'); // never used: password login is off
	const record = await su.collection('admins').create({
		email: `test-${role}-${uid()}@mauersegler.art`,
		password,
		passwordConfirm: password,
		role: 'pending'
	});
	// A real Google sign-in records last_sign_in (pb_hooks/admins_oauth_guard.pb.js);
	// without it the app asks for a fresh sign-in (weekly check).
	await su.collection('admins').update(record.id, {
		...(role !== 'pending' ? { role } : {}),
		last_sign_in: new Date().toISOString()
	});

	const client = await su.collection('admins').impersonate(record.id, 3600);
	client.autoCancellation(false);
	return { id: record.id, email: record.email as string, client };
}

/** The `pb_auth` cookie the app sets after a successful admin sign-in. */
export function adminCookie(client: PocketBase): string {
	const { token, record } = client.authStore;
	return 'pb_auth=' + encodeURIComponent(JSON.stringify({ token, record }));
}

/** One house with one room and `bedCount` free, enabled beds. */
export async function seedHouse(su: PocketBase, bedCount = 2) {
	const tag = uid();
	const house = await su.collection('houses').create({ name: `Test House ${tag}`, x: 10, y: 20 });
	const room = await su
		.collection('rooms')
		.create({ name: `Test Room ${tag}`, room_number: 1, house: house.id, amount_beds: bedCount });
	const beds = [];
	for (let i = 1; i <= bedCount; i++) {
		beds.push(
			await su
				.collection('beds')
				.create({ label: `Bed ${tag}-${i}`, room: room.id, enabled: true, occupied: false })
		);
	}
	return { house, room, beds };
}

/**
 * A ticket as it arrives from the ticket shop import: plain `order_number`, no
 * hash yet (the app adds the hash on first login).
 */
export async function seedTicket(su: PocketBase) {
	const code = `TEST-${uid()}`;
	const order = await su
		.collection('orders')
		.create({ order_number: code, customer_name: 'Test Guest' });
	return { code, order };
}

const COMPOSE_FILE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../docker-compose.test.yml'
);

/** Runs `cozy-admin` in the stack's PocketBase, like an operator on the server. */
export function cozyAdmin(args: string[]): string {
	const run = spawnSync(
		'docker',
		[
			'compose',
			'-f',
			COMPOSE_FILE,
			'exec',
			'-T',
			'pocketbase',
			'/usr/local/bin/pocketbase',
			'cozy-admin',
			...args,
			'--dir=/pb_data',
			'--hooksDir=/pb_hooks',
			'--migrationsDir=/pb_migrations',
			'--encryptionEnv=PB_ENCRYPTION_KEY'
		],
		{ encoding: 'utf8' }
	);
	const output = `${run.stdout}${run.stderr}`;
	if (run.status !== 0) throw new Error(`cozy-admin ${args.join(' ')} failed:\n${output}`);
	return output;
}

export type PngChunk = { type: string; data: Buffer; crc: number };

/** The chunks of a PNG, in order; throws when the signature is not a PNG's. */
export function pngChunks(png: Uint8Array): PngChunk[] {
	const buf = Buffer.from(png);
	if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		throw new Error('not a PNG');
	}
	const chunks: PngChunk[] = [];
	for (let p = 8; p < buf.length;) {
		const length = buf.readUInt32BE(p);
		chunks.push({
			type: buf.toString('ascii', p + 4, p + 8),
			data: buf.subarray(p + 8, p + 8 + length),
			crc: buf.readUInt32BE(p + 8 + length)
		});
		p += 12 + length;
	}
	return chunks;
}

/**
 * The pixels of a black-and-white PNG as the app (src/lib/server/png.ts) and
 * PocketBase (pb_hooks/lib/passqr.js) write it: 1-bit greyscale, filter type 0
 * on every row. `rows` is the inflated image data, filter bytes included.
 */
export function readMonochromePng(png: Uint8Array): {
	width: number;
	height: number;
	rows: Buffer;
} {
	const chunks = pngChunks(png);
	const header = chunks.find((c) => c.type === 'IHDR')?.data;
	if (!header) throw new Error('no IHDR');
	const width = header.readUInt32BE(0);
	const height = header.readUInt32BE(4);
	if (header[8] !== 1 || header[9] !== 0 || header[12] !== 0) {
		throw new Error('not a 1-bit greyscale PNG without interlace');
	}
	const rows = zlib.inflateSync(
		Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
	);
	const rowBytes = Math.ceil(width / 8) + 1;
	if (rows.length !== rowBytes * height) throw new Error('image data of the wrong size');
	for (let y = 0; y < height; y++) {
		if (rows[y * rowBytes] !== 0) throw new Error(`row ${y}: filter ${rows[y * rowBytes]}`);
	}
	return { width, height, rows };
}

/** What the QR code in such a PNG says, read the way a phone's camera reads it. */
export function decodeQrPng(png: Uint8Array): string {
	const { width, height, rows } = readMonochromePng(png);
	const rowBytes = Math.ceil(width / 8) + 1;
	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// a set bit is white
			const white = (rows[y * rowBytes + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
			rgb.fill(white ? 255 : 0, (y * width + x) * 3, (y * width + x) * 3 + 3);
		}
	}
	return decodeQR({ width, height, data: rgb });
}
