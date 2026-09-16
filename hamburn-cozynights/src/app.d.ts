// src/app.d.ts
import type { TypedPocketBase } from '$lib/pocketbase-types'; // <--- IMPORTANT: Your generated types 🛠️
import type { AdminSession } from '$lib/server/admin-auth';

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

			// Signed-in admin (Google, invited via scripts/cozy-admin.sh), else null 🔐
			admin: AdminSession | null;
		}

		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
