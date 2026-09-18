<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';

	// Get data from server (admin session; null on the login page)
	export let data;

	let mounted = false;
	onMount(() => {
		mounted = true;
	});
</script>

<div class="admin-layout">
	{#if mounted && data.admin}
		<header class="admin-header" in:fly={{ y: -50, duration: 500 }}>
			<div class="logo-area">
				<a href="/admin" class="logo-link">
					<span class="logo-text">Hamburn</span>
					<span class="logo-badge">Admin</span>
				</a>
				{#if data.isSuperuser}
					<span class="badge-role">SUPERUSER ⚡️</span>
				{/if}
			</div>

			<div class="user-area">
				<div class="user-info">
					<span class="user-label">Burner:</span>
					<span class="user-email" title={data.admin.email}>{data.admin.email}</span>
				</div>

				<form action="/admin/logout" method="POST" class="logout-form">
					<button type="submit" class="logout-btn" title="Sign out">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
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
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: radial-gradient(circle at top right, #111, #050505);
	}

	.admin-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 1rem 2rem;
		background: rgba(15, 15, 15, 0.8);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid #222;
		position: sticky;
		top: 0;
		z-index: 100;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}

	/* Logo Area */
	.logo-area {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		min-width: 0;
	}
	.logo-link {
		min-height: 40px;
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: 10px;
		transition: transform 0.2s;
	}
	.logo-link:hover {
		transform: scale(1.02);
	}

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
		min-width: 0;
		margin-left: auto;
	}

	.user-info {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 0;
	}
	.logout-form {
		display: flex;
		flex-shrink: 0;
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
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.logout-btn {
		background: transparent;
		border: 1px solid #f87171;
		min-height: 40px;
		white-space: nowrap;
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

	.badge-role {
		background: rgba(45, 212, 191, 0.1);
		color: #2dd4bf;
		padding: 4px 12px;
		border-radius: 20px;
		font-size: 0.7rem;
		font-weight: 900;
		border: 1px solid #2dd4bf;
		white-space: nowrap;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}

	.admin-content {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
		box-sizing: border-box;
	}

	@media (max-width: 640px) {
		.admin-header {
			padding: 0.6rem 1rem;
		}
		.logo-text {
			font-size: 1.2rem;
		}
		.user-area {
			gap: 0.75rem;
		}
		.user-label {
			display: none;
		}
		.user-email {
			font-size: 0.75rem;
		}
		.logout-btn {
			min-height: 44px;
			padding: 0.5rem 0.9rem;
		}
		.admin-content {
			padding: 1rem;
		}
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
