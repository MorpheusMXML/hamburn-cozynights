<script lang="ts">
    import type { PageData, ActionData } from './$types';
    import { page } from '$app/stores';
    import { fade, fly } from 'svelte/transition';

    export let data: PageData;
    export let form: ActionData;

    // UI State: Toggle between login and registration form
    let showRegister = false;
</script>

<div class="login-wrapper">
    <div class="login-container" in:fly={{ y: 20, duration: 600 }}>
        <header class="login-header">
            <div class="laser-line-top"></div>
            <h1>{showRegister ? 'JOIN THE CREW ✨' : 'ADMIN PORTAL 🔐'}</h1>
            <p class="subtitle">Secure access to the Hamburn Control Center</p>
        </header>

        {#if form?.message || $page.url.searchParams.get('fail')}
            <div class="error-banner" in:fade>
                <span class="icon">🛑</span>
                <div class="msg-content">
                    {#if $page.url.searchParams.get('reason') === 'not_verified'}
                        <strong>SANCTUARY KEY INACTIVE! 🗝️</strong>
                        <p>Wait for a senior burner to verify your coordinates.</p>
                    {:else}
                        {form?.message || 'The playa says NO. Action failed.'}
                    {/if}
                </div>
            </div>
        {/if}

        {#if showRegister}
            <form action="?/register" method="POST" class="laser-form" in:fade>
                <div class="input-group">
                    <label for="email">EMAIL ADDRESS</label>
                    <input name="email" id="email" type="email" placeholder="burner@playa.com" required>
                </div>
                <div class="input-group">
                    <label for="password">PASSPHRASE</label>
                    <input name="password" id="password" type="password" placeholder="••••••••" required>
                </div>
                <div class="input-group">
                    <label for="passwordConfirm">CONFIRM PASSPHRASE</label>
                    <input name="passwordConfirm" id="passwordConfirm" type="password" placeholder="••••••••" required>
                </div>
                <button type="submit" class="btn-ignite">IGNITE ACCOUNT ✨</button>
            </form>
            <p class="toggle-text">
                ALREADY HAVE KEYS? <button type="button" class="btn-link" on:click={() => showRegister = false}>SIGN IN</button>
            </p>
        {:else}
            <form action="?/login" method="POST" class="laser-form" in:fade>
                <div class="input-group">
                    <label for="email">EMAIL ADDRESS</label>
                    <input name="email" id="email" type="email" placeholder="burner@playa.com" required>
                </div>
                <div class="input-group">
                    <label for="password">PASSPHRASE</label>
                    <input name="password" id="password" type="password" placeholder="••••••••" required>
                </div>
                <button type="submit" class="btn-ignite">ACCESS PORTAL ⚡️</button>
            </form>
            <p class="toggle-text">
                NEW BURNER? <button type="button" class="btn-link" on:click={() => showRegister = true}>CREATE ACCOUNT</button>
            </p>
        {/if}

        <div class="divider">
            <span>OR CONNECT VIA BEACON</span>
        </div>

        <div class="oauth-grid">
            {#if data.providers}
                {#each data.providers as provider}
                    <form action="?/oauth2" method="POST" class="oauth-form">
                        <input type="hidden" name="provider" value={provider.name} />
                        <button type="submit" class="btn-oauth">
                            {showRegister ? 'Register with' : 'Login with'} {provider.displayName}
                        </button>
                    </form>
                {/each}
            {/if}
        </div>
    </div>
</div>

<style>
    .login-wrapper {
        min-height: 80vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    }

    .login-container {
        width: 100%;
        max-width: 440px;
        background: #0f0f0f;
        border: 1px solid #222;
        border-radius: 16px;
        padding: 2.5rem;
        box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        position: relative;
        overflow: hidden;
    }

    .laser-line-top {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 2px;
        background: linear-gradient(90deg, transparent, #2dd4bf, #f472b6, transparent);
    }

    .login-header { text-align: center; margin-bottom: 2.5rem; }
    h1 { font-size: 1.5rem; font-weight: 900; color: #fff; margin: 0; letter-spacing: 1px; }
    .subtitle { font-size: 0.8rem; color: #666; margin-top: 0.5rem; font-weight: bold; }

    .error-banner {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 12px;
        padding: 1rem;
        margin-bottom: 2rem;
        display: flex;
        gap: 1rem;
        align-items: center;
        color: #f87171;
    }
    .msg-content strong { display: block; font-size: 0.75rem; letter-spacing: 1px; }
    .msg-content p { margin: 0.25rem 0 0 0; font-size: 0.8rem; opacity: 0.8; }

    .laser-form { display: flex; flex-direction: column; gap: 1.5rem; }
    
    .input-group { display: flex; flex-direction: column; gap: 0.5rem; }
    .input-group label { font-size: 0.65rem; font-weight: 900; color: #444; letter-spacing: 1.5px; }
    
    input {
        background: #050505;
        border: 1px solid #222;
        color: white;
        padding: 1rem;
        border-radius: 8px;
        font-size: 1rem;
        transition: all 0.3s;
    }
    input:focus { outline: none; border-color: #2dd4bf; box-shadow: 0 0 15px rgba(45, 212, 191, 0.2); }

    .btn-ignite {
        background: #2dd4bf;
        color: #000;
        border: none;
        padding: 1rem;
        border-radius: 8px;
        font-weight: 900;
        cursor: pointer;
        font-size: 0.9rem;
        letter-spacing: 1px;
        margin-top: 0.5rem;
        transition: all 0.3s;
        box-shadow: 0 0 20px rgba(45, 212, 191, 0.3);
    }
    .btn-ignite:hover { transform: scale(1.02); box-shadow: 0 0 30px rgba(45, 212, 191, 0.5); }

    .toggle-text { text-align: center; font-size: 0.75rem; color: #444; font-weight: 900; margin-top: 1.5rem; letter-spacing: 1px; }
    .btn-link { background: none; border: none; color: #f472b6; cursor: pointer; font-weight: 900; font-size: 0.75rem; padding: 0 5px; text-decoration: underline; }
    .btn-link:hover { color: #fff; }

    .divider {
        display: flex; align-items: center; text-align: center; margin: 2rem 0;
        color: #222; font-size: 0.6rem; font-weight: 900; letter-spacing: 2px;
    }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid #222; }
    .divider span { padding: 0 1rem; }

    .oauth-grid { display: flex; flex-direction: column; gap: 0.75rem; }
    .btn-oauth {
        width: 100%;
        background: transparent;
        border: 1px solid #333;
        color: #aaa;
        padding: 0.75rem;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 0.85rem;
        transition: all 0.2s;
    }
    .btn-oauth:hover { border-color: #666; color: #fff; background: rgba(255,255,255,0.05); }
</style>