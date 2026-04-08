// src/app.d.ts
import type PocketBase from 'pocketbase'; // <--- IMPORTANT: Import for the 'user' type 👤
import type { TypedPocketBase } from '$lib/pocketbase-types'; // <--- IMPORTANT: Your generated types 🛠️

declare global {
	namespace App {
		// interface Error {}
		
		interface Locals {
			// We use TypedPocketBase for full type safety in our collections ⚡️
			pb: TypedPocketBase;
			// The current burner's booking code from the cookie 🎫
			orderNumber: string | null;
			// Optional field for storing the guest name session-wide 📛
			burner_Name?: string; 
			
			// The PocketBase user model if authenticated 🔐
			user?: PocketBase['authStore']['model'];
		}

		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};