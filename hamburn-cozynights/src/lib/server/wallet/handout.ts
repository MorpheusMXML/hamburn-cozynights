// src/lib/server/wallet/handout.ts
/**
 * Handing a wallet pass out: /pass/<code>/wallet/apple and …/google. Anyone
 * with the pass link may add it to a wallet — it shows what the pass page
 * shows — with the pass page's limit on unknown codes.
 */
import { error } from '@sveltejs/kit';
import { getBookingSettings } from '$lib/server/settings';
import { requirePass, type PassLookup } from '$lib/server/pass';
import { walletConfig, type WalletConfig, type WalletPlatform } from './config';
import { contentFromLookup, contentHash, type WalletContent, type WalletExtras } from './content';
import { recordWalletPass } from './store';

export interface Handout {
	config: WalletConfig;
	pass: PassLookup;
	content: WalletContent;
	extras: WalletExtras;
	hash: string;
}

const NAMES: Record<WalletPlatform, string> = { apple: 'Apple Wallet', google: 'Google Wallet' };

export async function prepareHandout(
	event: {
		params: { code?: string };
		locals: App.Locals;
		getClientAddress: () => string;
	},
	platform: WalletPlatform
): Promise<Handout> {
	const config = walletConfig();
	if (!config[platform]) throw error(404, `${NAMES[platform]} passes are not available here.`);
	const pass = await requirePass(event);
	const content = contentFromLookup(pass.code, pass, config.origin);
	const { telegramBot } = await getBookingSettings(event.locals.pb);
	const extras = { telegram: !!telegramBot };
	return { config, pass, content, extras, hash: contentHash(content, config, extras) };
}

/**
 * Notes the handed-out pass for the sync. A failure here only means this pass
 * won't be updated later; the guest still gets it now.
 */
export async function noteHandout(
	adminPb: App.Locals['adminPb'],
	platform: WalletPlatform,
	handout: Handout
): Promise<void> {
	try {
		await recordWalletPass(adminPb, {
			platform,
			serial: handout.content.serial,
			order: handout.pass.order.id,
			hash: handout.hash,
			delivered: true
		});
	} catch (err) {
		console.error(`[Wallet] Could not note the ${platform} pass:`, (err as Error)?.message);
	}
}
