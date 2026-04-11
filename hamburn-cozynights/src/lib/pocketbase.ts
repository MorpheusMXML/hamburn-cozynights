// src/lib/pocketbase.ts
import PocketBase from 'pocketbase';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

const PB_URL = env.PUBLIC_PB_URL || 'http://127.0.0.1:8090';

export const pb = new PocketBase(PB_URL);

// Initialize auth store from cookie in browser
if (browser) {
	pb.authStore.loadFromCookie(document.cookie);
	pb.authStore.onChange(() => {
		// Sync auth store to cookie for subsequent SSR requests
		document.cookie = pb.authStore.exportToCookie({ httpOnly: false, secure: false }); // secure: false for local dev, should be true in prod
	});
}
