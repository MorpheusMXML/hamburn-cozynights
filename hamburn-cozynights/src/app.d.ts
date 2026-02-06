// src/app.d.ts
import type PocketBase from 'pocketbase'; // <--- WICHTIG: Import für den 'user' Typ
import type { TypedPocketBase } from '$lib/pocketbase-types'; // <--- WICHTIG: Deine generierten Typen

declare global {
	namespace App {
		// interface Error {}
		
		interface Locals {
			// Hier nutzen wir TypedPocketBase statt dem Standard-PocketBase
			// Damit funktionieren Dinge wie .getFullList<HousesResponse>()
			pb: TypedPocketBase;
			orderNumber: string | null;
			burner_Name?: string; // Optional, falls du den Namen des Gastes irgendwo speichern möchtest
			
			// Hier nutzen wir den importierten PocketBase Typ
			user?: PocketBase['authStore']['model'];
		}

		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};