import PocketBase from 'pocketbase';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import type { TypedPocketBase } from '$lib/pocketbase-types';

const PB_URL = publicEnv.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

// Global singleton instance
export const adminPb = new PocketBase(PB_URL) as TypedPocketBase;

/**
 * Returns an authenticated admin instance.
 * Re-authenticates only if the token is missing or invalid.
 */
export async function getAdminPb(): Promise<TypedPocketBase> {
    if (adminPb.authStore.isValid) {
        return adminPb;
    }

    const email = privateEnv.PB_ADMIN_EMAIL;
    const password = privateEnv.PB_ADMIN_PASSWORD;

    if (!email || !password) {
        console.error('[PocketBase] CRITICAL: Missing PB_ADMIN_EMAIL or PB_ADMIN_PASSWORD in environment.');
        return adminPb;
    }

    try {
        try {
            // New PocketBase (v0.23+) uses _superusers
            await adminPb.collection('_superusers').authWithPassword(email, password);
        } catch {
            // Old PocketBase uses .admins
            await adminPb.admins.authWithPassword(email, password);
        }
        console.log(`[PocketBase] Successfully authenticated as admin (${email})`);
    } catch (err: any) {
        console.error(`[PocketBase] Authentication FAILED for ${email}: ${err.message}`);
    }

    return adminPb;
}
