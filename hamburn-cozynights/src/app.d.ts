// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		 interface Locals {
			// Das hier definiert, dass locals.pb existiert!
			pb: import('pocketbase').default;
			user?: PocketBase['authStore']['model'];
		 }
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
