<script lang="ts">
    import type { PageData, ActionData } from './$types';
    import { page } from '$app/stores';

    export let data: PageData;
    export let form: ActionData;

    // UI-State: Soll das Registrieren-Formular angezeigt werden?
    let showRegister = false;
</script>

<div style="max-width: 400px; margin: 50px auto; font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
    <h1 style="text-align: center;">{showRegister ? 'Join the Crew ✨' : 'Admin Portal 🔐'}</h1>

    {#if form?.message || $page.url.searchParams.get('fail')}
        <div style="background: #fee; color: #c00; padding: 10px; margin-bottom: 20px; border-radius: 4px; text-align: center;">
            {#if $page.url.searchParams.get('reason') === 'not_verified'}
                <strong>House key not active! 🗝️</strong><br>
                Please wait for a senior burner to verify your access.
            {:else}
                {form?.message || 'The playa says no. Action failed.'}
            {/if}
        </div>
    {/if}

    {#if showRegister}
        <form action="?/register" method="POST" style="display: flex; flex-direction: column; gap: 10px;">
            <input name="email" type="email" placeholder="Email Address" required style="padding: 10px;">
            <input name="password" type="password" placeholder="Passphrase" required style="padding: 10px;">
            <input name="passwordConfirm" type="password" placeholder="Confirm Passphrase" required style="padding: 10px;">
            <button type="submit" style="padding: 10px; background: #222; color: #fff; cursor: pointer;">Register ✨</button>
        </form>
        <p style="text-align: center; font-size: 0.9em;">
            Already have keys? <button on:click={() => showRegister = false} style="border:none; background:none; color:blue; cursor:pointer; text-decoration:underline;">Sign In</button>
        </p>
    {:else}
        <form action="?/login" method="POST" style="display: flex; flex-direction: column; gap: 10px;">
            <input name="email" type="email" placeholder="Email Address" required style="padding: 10px;">
            <input name="password" type="password" placeholder="Passphrase" required style="padding: 10px;">
            <button type="submit" style="padding: 10px; background: #222; color: #fff; cursor: pointer;">Sign In ⚡️</button>
        </form>
        <p style="text-align: center; font-size: 0.9em;">
            New burner? <button on:click={() => showRegister = true} style="border:none; background:none; color:blue; cursor:pointer; text-decoration:underline;">Create Account</button>
        </p>
    {/if}

    <hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">

    <div style="display: flex; flex-direction: column; gap: 10px;">
        {#if data.providers}
            {#each data.providers as provider}
                <form action="?/oauth2" method="POST">
                    <input type="hidden" name="provider" value={provider.name} />
                    <button type="submit" style="padding: 10px; width: 100%; cursor: pointer; border: 1px solid #ccc; background: #fff;">
                        {showRegister ? 'Register' : 'Login'} with {provider.displayName}
                    </button>
                </form>
            {/each}
        {/if}
    </div>
</div>