// src/lib/pocketbase.ts
import PocketBase from 'pocketbase';
import { browser } from '$app/environment'; // Importiere browser check

export const pb = new PocketBase('http://127.0.0.1:8090');

// Nur im Browser ausführen
if (browser) {
    pb.authStore.loadFromCookie(document.cookie);
    pb.authStore.onChange(() => {
       document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
    });
}