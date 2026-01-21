<script lang="ts">
    import type { PageData, ActionData } from './$types';
    import { page } from '$app/stores';

    export let data: PageData;
    export let form: ActionData;

    // UI-State: Soll das Registrieren-Formular angezeigt werden?
    let showRegister = false;
</script>

<div style="max-width: 400px; margin: 50px auto; font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
    <h1 style="text-align: center;">{showRegister ? 'Account erstellen' : 'Admin Login'}</h1>

    {#if form?.message || $page.url.searchParams.get('fail')}
        <div style="background: #fee; color: #c00; padding: 10px; margin-bottom: 20px; border-radius: 4px; text-align: center;">
            {#if $page.url.searchParams.get('reason') === 'not_verified'}
                <strong>Account noch nicht freigeschaltet!</strong><br>
                Bitte warten Sie, bis ein Admin Ihren Account verifiziert hat.
            {:else}
                {form?.message || 'Aktion fehlgeschlagen.'}
            {/if}
        </div>
    {/if}

    {#if showRegister}
        <form action="?/register" method="POST" style="display: flex; flex-direction: column; gap: 10px;">
            <input name="email" type="email" placeholder="Email Adresse" required style="padding: 10px;">
            <input name="password" type="password" placeholder="Passwort" required style="padding: 10px;">
            <input name="passwordConfirm" type="password" placeholder="Passwort wiederholen" required style="padding: 10px;">
            <button type="submit" style="padding: 10px; background: #222; color: #fff; cursor: pointer;">Registrieren</button>
        </form>
        <p style="text-align: center; font-size: 0.9em;">
            Bereits einen Account? <button on:click={() => showRegister = false} style="border:none; background:none; color:blue; cursor:pointer; text-decoration:underline;">Anmelden</button>
        </p>
    {:else}
        <form action="?/login" method="POST" style="display: flex; flex-direction: column; gap: 10px;">
            <input name="email" type="email" placeholder="Email Adresse" required style="padding: 10px;">
            <input name="password" type="password" placeholder="Passwort" required style="padding: 10px;">
            <button type="submit" style="padding: 10px; background: #222; color: #fff; cursor: pointer;">Anmelden</button>
        </form>
        <p style="text-align: center; font-size: 0.9em;">
            Neu hier? <button on:click={() => showRegister = true} style="border:none; background:none; color:blue; cursor:pointer; text-decoration:underline;">Account erstellen</button>
        </p>
    {/if}

    <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">

    <div style="display: flex; flex-direction: column; gap: 10px;">
        {#if data.providers}
            {#each data.providers as provider}
                <form action="?/oauth2" method="POST">
                    <input type="hidden" name="provider" value={provider.name} />
                    <button type="submit" style="padding: 10px; width: 100%; cursor: pointer; border: 1px solid #ccc; background: #fff;">
                        {showRegister ? 'Registrieren' : 'Login'} mit {provider.displayName}
                    </button>
                </form>
            {/each}
        {/if}
    </div>
</div>