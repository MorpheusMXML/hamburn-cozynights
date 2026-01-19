<script lang="ts">
    import type { PageData, ActionData } from './$types';
    import { page } from '$app/stores';

    export let data: PageData;
    export let form: ActionData; // Für Fehlermeldungen vom Server
</script>

<pre style="background: #eee; padding: 10px; font-size: 10px;">
    DEBUG DATA: {JSON.stringify(data, null, 2)}
</pre>

<div style="max-width: 400px; margin: 50px auto; padding: 20px; font-family: sans-serif; border: 1px solid #ddd; border-radius: 8px;">
    <h1 style="text-align: center;">Admin Login</h1>

    {#if form?.message || $page.url.searchParams.get('fail')}
        <div style="background: #fee; color: #c00; padding: 10px; margin-bottom: 20px; border-radius: 4px; text-align: center;">
            {form?.message || 'Login fehlgeschlagen. Bitte erneut versuchen.'}
        </div>
    {/if}

    {#if data.enableEmail}
        <form action="?/login" method="POST" style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 30px;">
            <div>
                <label for="email" style="display: block; margin-bottom: 5px;">Email</label>
                <input name="email" type="email" placeholder="admin@example.com" required style="width: 100%; padding: 8px; box-sizing: border-box;" />
            </div>
            
            <div>
                <label for="password" style="display: block; margin-bottom: 5px;">Passwort</label>
                <input name="password" type="password" placeholder="******" required style="width: 100%; padding: 8px; box-sizing: border-box;" />
            </div>

            <button type="submit" style="padding: 10px; background: #333; color: white; border: none; cursor: pointer; border-radius: 4px;">
                Anmelden
            </button>
        </form>
        
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
    {/if}

    <div style="display: flex; flex-direction: column; gap: 10px;">
        {#if data.providers && data.providers.length > 0}
            {#each data.providers as provider}
                <form action="?/oauth2" method="POST">
                    <input type="hidden" name="provider" value={provider.name} />
                    <button type="submit" style="padding: 10px; width: 100%; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 4px; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <strong>{provider.displayName}</strong>
                    </button>
                </form>
            {/each}
        {:else if !data.enableEmail}
            <p style="text-align: center; color: gray;">Keine Login-Methoden im Backend aktiviert.</p>
        {/if}
    </div>
</div>