<script lang="ts">
    import type { PageData } from './$types';
    // WICHTIG: Wir importieren den page store, um sicher auf die URL zuzugreifen
    import { page } from '$app/stores';

    export let data: PageData;
</script>

<div style="max-width: 400px; margin: 50px auto; text-align: center; font-family: sans-serif;">
    <h1 style="margin-bottom: 20px;">Admin Login</h1>

    {#if $page.url.searchParams.get('fail')}
        <div style="background: #fee; color: #c00; padding: 10px; margin-bottom: 20px; border-radius: 4px;">
            Login fehlgeschlagen. Bitte erneut versuchen.
        </div>
    {/if}

    <div style="display: flex; flex-direction: column; gap: 10px;">
        {#if data.providers && data.providers.length > 0}
            {#each data.providers as provider}
                <form action="?/oauth2" method="POST">
                    <input type="hidden" name="provider" value={provider.name} />
                    <button type="submit" style="padding: 12px; cursor: pointer; width: 100%; font-size: 16px;">
                        Login mit {provider.displayName}
                    </button>
                </form>
            {/each}
        {:else}
            <p style="color: gray;">Keine Login-Methoden verfügbar.</p>
        {/if}
    </div>
</div>