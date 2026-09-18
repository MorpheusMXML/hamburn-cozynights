// src/app.d.ts
import type { TypedPocketBase } from '$lib/pocketbase-types'; // <--- IMPORTANT: Your generated types 🛠️
import type { AdminSession, PendingAdmin } from '$lib/server/admin-auth';

declare global {
	namespace App {
		// interface Error {}

		interface Locals {
			// Per-request connection; carries the admin's token when signed in ⚡️
			pb: TypedPocketBase;
			// Dedicated service-account instance for secure server-side operations 🛡️
			adminPb: TypedPocketBase;
			// The current burner's booking code from the cookie 🎫
			orderNumber: string | null;
			// Optional field for storing the guest name session-wide 📛
			burner_Name?: string;

			// Signed-in, approved admin (Google sign-in), else null 🔐
			admin: AdminSession | null;
			// Signed in with Google, access request not approved yet (no rights) ⏳
			pendingAdmin: PendingAdmin | null;
			// The session was valid, but the last Google sign-in is older than a week 📅
			adminSignInExpired?: boolean;
		}

		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
