<script lang="ts">
    import { page } from '$app/stores';
    import { onMount } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    
    // Get data from server (includes user & isVerified)
    export let data;

    let mounted = false;
    onMount(() => {
        mounted = true;
    });
</script>

<div class="admin-layout">
    {#if mounted}
    <header class="admin-header" in:fly={{ y: -50, duration: 500 }}>
        <div class="logo-area">
            <a href="/admin" class="logo-link">
                <span class="logo-text">Hamburn</span>
                <span class="logo-badge">Admin</span>
            </a>
            {#if !data.isVerified}
                <span class="badge-readonly">READ ONLY 👁️</span>
            {/if}
        </div>

        <div class="user-area">
            <div class="user-info">
                <span class="user-label">Burner:</span>
                <span class="user-email">{data.user?.email}</span>
            </div>
            
            <form action="/admin/logout" method="POST" style="display: inline;">
                <button type="submit" class="logout-btn" title="Sign Out">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    <span>Eject 🚀</span>
                </button>
            </form>
        </div>
    </header>
    {/if}

    <main class="admin-content">
        <slot />
    </main>
</div>

<style>
    :global(body) { 
        margin: 0; 
        font-family: 'Inter', system-ui, sans-serif; 
        background-color: #0a0a0a; 
        color: #e5e5e5;
        overflow-x: hidden;
    }

    .admin-layout {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: radial-gradient(circle at top right, #111, #050505);
    }

    .admin-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 2rem;
        background: rgba(15, 15, 15, 0.8);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid #222;
        position: sticky;
        top: 0;
        z-index: 100;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }

    /* Logo Area */
    .logo-link {
        text-decoration: none;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: transform 0.2s;
    }
    .logo-link:hover { transform: scale(1.02); }

    .logo-text {
        font-weight: 900;
        font-size: 1.5rem;
        letter-spacing: -1px;
        background: linear-gradient(to right, #2dd4bf, #f472b6);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-transform: uppercase;
    }

    .logo-badge {
        background: #222;
        color: #888;
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #333;
        text-transform: uppercase;
        font-weight: bold;
    }

    /* User Area */
    .user-area {
        display: flex;
        align-items: center;
        gap: 2rem;
    }

    .user-info {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    }

    .user-label {
        font-size: 0.65rem;
        color: #666;
        text-transform: uppercase;
        font-weight: bold;
        letter-spacing: 1px;
    }

    .user-email {
        font-size: 0.85rem;
        color: #2dd4bf;
        font-family: monospace;
    }

    .logout-btn {
        background: transparent;
        border: 1px solid #f87171;
        padding: 0.5rem 1.25rem;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f87171;
        font-size: 0.85rem;
        font-weight: bold;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
    }

    .logout-btn:hover {
        background: rgba(248, 113, 113, 0.1);
        box-shadow: 0 0 15px rgba(248, 113, 113, 0.3);
        transform: translateY(-1px);
    }

    .badge-readonly {
        background: rgba(251, 191, 36, 0.1);
        color: #fbbf24;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.7rem;
        font-weight: 900;
        border: 1px solid #fbbf24;
        margin-left: 1rem;
        box-shadow: 0 0 10px rgba(251, 191, 36, 0.2);
        animation: pulse 2s infinite;
    }

    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.6; }
        100% { opacity: 1; }
    }

    .admin-content {
        padding: 2rem;
        max-width: 1400px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
    }

    /* Laser Line Effect */
    .admin-header::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 0;
        width: 100%;
        height: 1px;
        background: linear-gradient(90deg, transparent, #2dd4bf, #f472b6, transparent);
        opacity: 0.5;
    }
</style>