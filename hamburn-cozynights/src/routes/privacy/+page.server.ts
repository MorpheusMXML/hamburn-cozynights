import type { PageServerLoad } from './$types';
import { getLegalInfo } from '$lib/server/legal';
import { getBookingSettings } from '$lib/server/settings';

export const load: PageServerLoad = async ({ locals }) => {
	const legal = getLegalInfo();
	// What this server sends to guests (published by PocketBase, see
	// pb_hooks/lib/notify.js): the policy only describes messages that exist.
	const settings = await getBookingSettings(locals.adminPb);
	const notify = { mail: settings.notifyMail, telegram: !!settings.telegramBot };
	const missing = [...legal.missing];
	if (notify.mail && !legal.mailProvider.length) missing.push('LEGAL_MAIL_PROVIDER');
	return { legal: { ...legal, missing }, notify };
};
