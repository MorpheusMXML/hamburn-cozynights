import PocketBase from 'pocketbase';

// Ersetze die URL ggf. mit deiner Produktions-URL, falls du nicht lokal arbeitest
export const pb = new PocketBase('http://127.0.0.1:8090');

// Optional: Auth-Store automatisch laden/speichern (für Logins wichtig)
 pb.authStore.loadFromCookie(document.cookie);
pb.authStore.onChange(() => {
   document.cookie = pb.authStore.exportToCookie({ httpOnly: false });
});