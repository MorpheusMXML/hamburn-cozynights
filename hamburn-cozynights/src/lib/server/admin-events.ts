import type { TypedPocketBase } from '$lib/pocketbase-types';
import type { AdminSession } from '$lib/server/admin-auth';

/** Admin actions the app records itself (the crew chat text is in pb_hooks/lib/notify.js). */
export type AdminEventAction = 'bookings_cleared' | 'template_imported' | 'house_deleted';

/**
 * Adds an entry to the audit log (collection admin_events); PocketBase posts
 * it to the crew Telegram chat. Admin access and booking phase changes are
 * logged by PocketBase itself (pb_hooks/cozy_notify.pb.js) — this is for what
 * only the app sees as one action.
 *
 * Never throws: the action has already happened when this runs.
 */
export async function logAdminEvent(
	adminPb: TypedPocketBase,
	admin: AdminSession | null,
	action: AdminEventAction,
	subject: string,
	details: Record<string, unknown>
): Promise<void> {
	try {
		await adminPb.collection('admin_events').create({
			action,
			actor: admin?.email ?? '',
			subject,
			details
		});
	} catch (err) {
		console.error(`[AdminEvents] Could not record ${action}:`, (err as Error)?.message);
	}
}
