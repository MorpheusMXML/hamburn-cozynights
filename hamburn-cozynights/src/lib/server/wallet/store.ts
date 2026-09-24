// src/lib/server/wallet/store.ts
/**
 * The wallet passes that are out there, and the Apple devices that follow
 * them (collections wallet_passes and wallet_devices,
 * pb_migrations/1759950000_wallet_passes.js). Only the app's service account
 * reads or writes them.
 */
import type { ClientResponseError } from 'pocketbase';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { WalletPlatform } from './config';

export interface WalletPassRecord {
	id: string;
	order: string;
	platform: WalletPlatform;
	serial: string;
	hash: string;
	pushed_hash: string;
	changed_at: string;
	attempts: number;
	next_try: string;
	last_error: string;
}

export interface WalletDeviceRecord {
	id: string;
	pass: string;
	device: string;
	push_token: string;
}

const PASSES = 'wallet_passes';
const DEVICES = 'wallet_devices';

function status(err: unknown): number | undefined {
	return (err as ClientResponseError | undefined)?.status;
}

export async function findWalletPass(
	adminPb: TypedPocketBase,
	platform: WalletPlatform,
	serial: string
): Promise<WalletPassRecord | null> {
	try {
		return await adminPb
			.collection(PASSES)
			.getFirstListItem<WalletPassRecord>(
				adminPb.filter('platform = {:platform} && serial = {:serial}', { platform, serial }),
				{ requestKey: null }
			);
	} catch (err) {
		if (status(err) === 404) return null;
		throw err;
	}
}

/**
 * Notes a wallet pass that was just handed out with this content: from now on
 * the sync keeps it up to date. `delivered`: the platform already has exactly
 * this content (a fresh download, a Google object just written).
 */
export async function recordWalletPass(
	adminPb: TypedPocketBase,
	input: {
		platform: WalletPlatform;
		serial: string;
		order: string;
		hash: string;
		delivered: boolean;
	}
): Promise<WalletPassRecord> {
	const now = new Date().toISOString();
	const existing = await findWalletPass(adminPb, input.platform, input.serial);
	const fields = (known: WalletPassRecord | null) => ({
		order: input.order,
		hash: input.hash,
		...(known?.hash === input.hash ? {} : { changed_at: now }),
		...(input.delivered
			? { pushed_hash: input.hash, attempts: 0, next_try: '', last_error: '' }
			: {})
	});
	if (existing) {
		return adminPb.collection(PASSES).update<WalletPassRecord>(existing.id, fields(existing));
	}
	try {
		return await adminPb.collection(PASSES).create<WalletPassRecord>({
			platform: input.platform,
			serial: input.serial,
			...fields(null)
		});
	} catch (err) {
		// Two downloads at once: the other one created it.
		const created = await findWalletPass(adminPb, input.platform, input.serial);
		if (!created) throw err;
		return adminPb.collection(PASSES).update<WalletPassRecord>(created.id, fields(created));
	}
}

export async function listWalletPasses(adminPb: TypedPocketBase): Promise<WalletPassRecord[]> {
	return adminPb
		.collection(PASSES)
		.getFullList<WalletPassRecord>({ sort: 'created', requestKey: null });
}

export async function updateWalletPass(
	adminPb: TypedPocketBase,
	id: string,
	fields: Partial<Omit<WalletPassRecord, 'id'>>
): Promise<void> {
	await adminPb.collection(PASSES).update(id, fields, { requestKey: null });
}

// --- Apple devices -----------------------------------------------------------------

async function findDevice(
	adminPb: TypedPocketBase,
	passId: string,
	device: string
): Promise<WalletDeviceRecord | null> {
	try {
		return await adminPb
			.collection(DEVICES)
			.getFirstListItem<WalletDeviceRecord>(
				adminPb.filter('pass = {:pass} && device = {:device}', { pass: passId, device }),
				{ requestKey: null }
			);
	} catch (err) {
		if (status(err) === 404) return null;
		throw err;
	}
}

/** A device follows a pass from now on. @returns whether it is new (Apple wants 201 then). */
export async function registerDevice(
	adminPb: TypedPocketBase,
	passId: string,
	device: string,
	pushToken: string
): Promise<boolean> {
	const known = await findDevice(adminPb, passId, device);
	if (known) {
		if (known.push_token !== pushToken) {
			await adminPb.collection(DEVICES).update(known.id, { push_token: pushToken });
		}
		return false;
	}
	try {
		await adminPb.collection(DEVICES).create({ pass: passId, device, push_token: pushToken });
		return true;
	} catch (err) {
		// registered twice at once
		if (await findDevice(adminPb, passId, device)) return false;
		throw err;
	}
}

/** @returns whether the device followed the pass */
export async function unregisterDevice(
	adminPb: TypedPocketBase,
	passId: string,
	device: string
): Promise<boolean> {
	const known = await findDevice(adminPb, passId, device);
	if (!known) return false;
	await adminPb.collection(DEVICES).delete(known.id);
	return true;
}

export async function devicesOfPass(
	adminPb: TypedPocketBase,
	passId: string
): Promise<WalletDeviceRecord[]> {
	return adminPb.collection(DEVICES).getFullList<WalletDeviceRecord>({
		filter: adminPb.filter('pass = {:pass}', { pass: passId }),
		requestKey: null
	});
}

export async function deleteDevices(adminPb: TypedPocketBase, ids: string[]): Promise<void> {
	for (const id of ids) {
		await adminPb
			.collection(DEVICES)
			.delete(id, { requestKey: null })
			.catch((err) => {
				if (status(err) !== 404) throw err;
			});
	}
}

/**
 * The Apple passes a device follows that changed after `since` (ms since the
 * epoch, the tag this answer gave it last time), and the new tag.
 */
export async function passesOfDevice(
	adminPb: TypedPocketBase,
	device: string,
	since: number
): Promise<{ serials: string[]; lastUpdated: number }> {
	const rows = await adminPb
		.collection(DEVICES)
		.getFullList<WalletDeviceRecord & { expand?: { pass?: WalletPassRecord } }>({
			filter: adminPb.filter('device = {:device}', { device }),
			expand: 'pass',
			requestKey: null
		});
	let lastUpdated = 0;
	const serials: string[] = [];
	for (const row of rows) {
		const pass = row.expand?.pass;
		if (!pass || pass.platform !== 'apple') continue;
		const changed = Date.parse(pass.changed_at) || 0;
		lastUpdated = Math.max(lastUpdated, changed);
		if (changed > since) serials.push(pass.serial);
	}
	return { serials, lastUpdated };
}
