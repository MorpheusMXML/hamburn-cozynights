// src/lib/server/crew-ticket.ts
import type { TypedPocketBase } from '$lib/pocketbase-types';
import { APPROVED_ROLES, isAdminDomainEmail } from './admin-auth';

/**
 * Whether a ticket belongs to the crew: its e-mail address is the address of an
 * approved admin or superuser account. Only such a ticket books a blocked 🔒 spot
 * on the guest pages (room page, roulette); a blocked spot is broken or out of
 * service, and the crew still takes one on purpose for themselves (Max,
 * 2026-10-12). An admin session changes nothing: someone else's ticket never
 * books a blocked spot, whoever is signed in to the admin area, and a crew
 * ticket books one without being signed in there. Spots for special-needs
 * requests are booked on /admin/requests instead.
 */
export async function isCrewTicket(
	adminPb: TypedPocketBase,
	order: { email?: string } | null | undefined
): Promise<boolean> {
	const email = String(order?.email ?? '')
		.trim()
		.toLowerCase();
	// Every admin account has an address of the admin domain: any other ticket
	// needs no lookup.
	if (!email || !isAdminDomainEmail(email)) return false;
	try {
		// The crew is a handful of accounts: read them all, keep the approved ones.
		const admins = await adminPb.collection('admins').getFullList({ fields: 'email,role' });
		return admins.some(
			(admin) =>
				APPROVED_ROLES.includes(String(admin.role)) &&
				String(admin.email ?? '')
					.trim()
					.toLowerCase() === email
		);
	} catch (err) {
		console.error('[Booking] Looking up the crew accounts failed:', (err as Error)?.message);
		return false;
	}
}
