<script lang="ts">
    import { page } from '$app/stores';
    // Wir holen uns die Daten vom Server (inkl. user & isVerified)
    export let data;
</script>

<div class="admin-layout">
    <header class="admin-header">
        <div class="logo-area">
            <a href="/admin" style="text-decoration: none; color: inherit; font-weight: bold;">
                Admin Dashboard
            </a>
            {#if !data.isVerified}
                <span class="badge-readonly">Nur Lesezugriff</span>
            {/if}
        </div>

        <div class="user-area">
            <span class="user-email">{data.user?.email}</span>
            
            <form action="/admin/login?/logout" method="POST" style="display: inline;">
                <button type="submit" class="logout-btn" title="Abmelden">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    <span>Abmelden</span>
                </button>
            </form>
        </div>
    </header>

    <main class="admin-content">
        <slot />
    </main>
</div>

<style>
    /* Minimalistisches Styling */
    :global(body) { margin: 0; font-family: sans-serif; background: #f9f9f9; }

    .admin-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 20px;
        background: #fff;
        border-bottom: 1px solid #eee;
        box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }

    .user-area {
        display: flex;
        align-items: center;
        gap: 15px;
        font-size: 0.9rem;
        color: #666;
    }

    .logout-btn {
        background: none;
        border: 1px solid #ddd;
        padding: 6px 12px;
        border-radius: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #555;
        font-size: 0.85rem;
        transition: all 0.2s;
    }

    .logout-btn:hover {
        background: #f0f0f0;
        color: #000;
        border-color: #ccc;
    }

    .badge-readonly {
        background: #fff8c5;
        color: #553000;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 0.75rem;
        margin-left: 10px;
        border: 1px solid #e3d081;
    }

    .admin-content {
        padding: 20px;
        max-width: 1200px;
        margin: 0 auto;
    }
</style>