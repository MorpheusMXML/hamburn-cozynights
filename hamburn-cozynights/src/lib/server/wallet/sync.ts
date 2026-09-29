// src/lib/server/wallet/sync.ts
/**
 * Keeps the wallet passes up to date. Every SYNC_SECONDS the app works out
 * what each pass that is out there should show now — the spot, the burner
 * name, voided after a hand-over — and tells the platform when that differs
 * from what it was last told: Apple gets a push for every device that follows
 * the pass (the device then fetches the new pass from the web service),
 * Google gets the object written again.
 *
 * State based like the guest messages (pb_hooks/lib/notify.js): whoever
 * changed a booking — a guest, an admin, the server's CLI, PocketBase's own
 * hooks — the next run sees it, and nothing has to remember to call this.
 * A failed push is tried again after 1, 5, 15 and 60 minutes, then hourly.
 */
import { APP_SETTINGS_ID } from '$lib/server/constants';
import { getAdminPb } from '$lib/server/pocketbase';
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { pushPassUpdates } from './apns';
import { walletConfig, walletPlatforms, type WalletConfig } from './config';
import { contentHash, loadContents, type WalletContent, type WalletExtras } from './content';
import { writeGoogleObject } from './google';
import {
	deleteDevices,
	devicesOfPass,
	listWalletPasses,
	updateWalletPass,
	type WalletPassRecord
} from './store';

export const SYNC_SECONDS = 30;
const RETRY_MINUTES = [1, 5, 15, 60];

export interface SyncReport {
	passes: number;
	changed: number;
	pushed: number;
	failed: number;
}

function retryAt(attempts: number, now: number): string {
	const minutes = RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1] ?? 60;
	return new Date(now + minutes * 60_000).toISOString();
}

function due(row: WalletPassRecord, now: number): boolean {
	return !row.next_try || (Date.parse(row.next_try.replace(' ', 'T')) || 0) <= now;
}

/**
 * Publishes which wallet buttons exist (app_settings.wallet_platforms, read by
 * PocketBase for its messages) and reads whether Telegram is on.
 */
async function settingsRound(
	adminPb: TypedPocketBase,
	config: WalletConfig
): Promise<WalletExtras> {
	const platforms = walletPlatforms(config).join(',');
	const settings = await adminPb
		.collection('app_settings')
		.getOne(APP_SETTINGS_ID, { requestKey: null })
		.catch(() => null);
	if (settings && (settings.wallet_platforms ?? '') !== platforms) {
		await adminPb
			.collection('app_settings')
			.update(APP_SETTINGS_ID, { wallet_platforms: platforms }, { requestKey: null })
			.catch((err) =>
				console.error('[Wallet] Could not publish the wallet platforms:', (err as Error)?.message)
			);
	}
	return { telegram: /^[A-Za-z0-9_]{5,32}$/.test(settings?.telegram_bot ?? '') };
}

/** Tells one platform about one pass. @returns what to store about it */
async function push(
	adminPb: TypedPocketBase,
	config: WalletConfig,
	row: WalletPassRecord,
	content: WalletContent,
	extras: WalletExtras
): Promise<{ ok: boolean; error: string }> {
	if (row.platform === 'apple' && config.apple) {
		const devices = await devicesOfPass(adminPb, row.id);
		// No device follows it (yet): whoever registers later fetches the current pass.
		if (devices.length === 0) return { ok: true, error: '' };
		const results = await pushPassUpdates(
			config.apple,
			devices.map((device) => device.push_token)
		);
		const gone = devices.filter((d) => results.get(d.push_token)?.outcome === 'gone');
		if (gone.length > 0)
			await deleteDevices(
				adminPb,
				gone.map((d) => d.id)
			);
		const failed = [...results.values()].filter((r) => r.outcome === 'failed');
		return failed.length === 0
			? { ok: true, error: '' }
			: { ok: false, error: `push: ${failed[0].detail}`.slice(0, 500) };
	}
	if (row.platform === 'google' && config.google) {
		try {
			await writeGoogleObject(config.google, content, config, extras, 'update');
			return { ok: true, error: '' };
		} catch (err) {
			return { ok: false, error: String((err as Error)?.message || err).slice(0, 500) };
		}
	}
	// the platform is switched off in this environment: leave the record as it is
	return { ok: false, error: '' };
}

/** One run over every wallet pass. */
export async function syncWalletPasses(
	adminPb: TypedPocketBase,
	config: WalletConfig = walletConfig(),
	now: number = Date.now()
): Promise<SyncReport> {
	const report: SyncReport = { passes: 0, changed: 0, pushed: 0, failed: 0 };
	const extras = await settingsRound(adminPb, config);
	const rows = await listWalletPasses(adminPb);
	report.passes = rows.length;
	if (rows.length === 0) return report;

	const contents = await loadContents(
		adminPb,
		[...new Set(rows.map((row) => row.serial))],
		config.origin
	);
	const stamp = new Date(now).toISOString();

	for (const row of rows) {
		const content = contents.get(row.serial);
		if (!content) continue;
		const hash = contentHash(content, config, extras);
		const fields: Partial<Omit<WalletPassRecord, 'id'>> = {};
		if (hash !== row.hash) {
			fields.hash = hash;
			fields.changed_at = stamp;
			report.changed++;
		}
		if (hash !== row.pushed_hash && (hash !== row.hash || due(row, now))) {
			const result = await push(adminPb, config, row, content, extras).catch((err) => ({
				ok: false,
				error: String((err as Error)?.message || err).slice(0, 500)
			}));
			if (result.ok) {
				Object.assign(fields, { pushed_hash: hash, attempts: 0, next_try: '', last_error: '' });
				report.pushed++;
			} else if (result.error) {
				const attempts = (row.attempts || 0) + 1;
				Object.assign(fields, {
					attempts,
					next_try: retryAt(attempts, now),
					last_error: result.error
				});
				report.failed++;
				console.warn(
					`[Wallet] ${row.platform} pass ${content.code.slice(0, 4)}… not updated (attempt ${attempts}): ${result.error}`
				);
			}
		}
		if (Object.keys(fields).length > 0) await updateWalletPass(adminPb, row.id, fields);
	}
	return report;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Starts the sync (once per process, only when a wallet is set up). */
export function startWalletSync(): void {
	if (timer) return;
	const config = walletConfig();
	if (walletPlatforms(config).length === 0) return;
	const tick = async () => {
		if (running) return; // the last run is still busy
		running = true;
		try {
			await syncWalletPasses(await getAdminPb(), config);
		} catch (err) {
			console.error('[Wallet] Sync failed:', (err as Error)?.message);
		} finally {
			running = false;
		}
	};
	timer = setInterval(tick, SYNC_SECONDS * 1000);
	timer.unref?.();
	setTimeout(tick, 5_000).unref?.();
	console.log(
		`[Wallet] ${walletPlatforms(config).join(' + ')} wallet passes on; sync every ${SYNC_SECONDS} s`
	);
}
