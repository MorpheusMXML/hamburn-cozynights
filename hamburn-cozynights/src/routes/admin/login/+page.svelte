<script lang="ts">
    // HIER ist der Import erlaubt und nötig, da Client-Side Code
    import { pb } from '$lib/pocketbase'; 
    import { goto } from '$app/navigation';

    async function loginWith(provider: string) {
        try {
            // 1. Popup öffnen
            const authData = await pb.collection('users').authWithOAuth2({ provider });

            // 2. Cookie für den Server setzen (WICHTIG!)
            document.cookie = pb.authStore.exportToCookie({ httpOnly: false });

            // 3. Seite neu laden, damit der "Türsteher" (Schritt 1) uns reinlässt
            window.location.href = '/admin'; 
            
        } catch (err) {
            console.error(err);
            alert('Login fehlgeschlagen');
        }
    }
</script>

<div style="max-width: 400px; margin: 50px auto; text-align: center;">
    <h1>Admin Login</h1>
    <p>Bitte authentifizieren, um fortzufahren.</p>
    
    <button on:click={() => loginWith('google')} style="padding: 10px 20px; cursor: pointer;">
        Mit Google anmelden
    </button>
    
    <br><br>
    
    <button on:click={() => loginWith('github')} style="padding: 10px 20px; cursor: pointer;">
        Mit GitHub anmelden
    </button>
</div>