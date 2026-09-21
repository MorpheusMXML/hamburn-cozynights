<script lang="ts">
	import LockHintHost from '$lib/components/admin/LockHintHost.svelte';
	import AdminNav from '$lib/components/admin/AdminNav.svelte';

	// Get data from server (admin session; null on the login page)
	export let data;
</script>

<div class="admin-layout" class:with-nav={!!data.admin}>
	{#if data.admin}
		<AdminNav
			email={data.admin.email}
			isSuperuser={data.isSuperuser}
			counts={data.navCounts}
			phase={data.booking?.phase ?? 'staging'}
		/>
	{/if}

	<main class="admin-content">
		<slot />
	</main>
</div>

<!-- Explains a greyed-out control of the locked camp layout when it is tried. -->
<LockHintHost />

<style>
	:global(body) {
		margin: 0;
		font-family: 'Inter', system-ui, sans-serif;
		background-color: #0a0a0a;
		color: #e5e5e5;
		overflow-x: hidden;
	}

	.admin-layout {
		min-height: calc(100vh - var(--booking-bar-height, 0px));
		min-height: calc(100dvh - var(--booking-bar-height, 0px));
		display: flex;
		flex-direction: column;
		background: radial-gradient(circle at top right, #111, #050505);
	}

	.admin-content {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	/* From 1100 px the menu is a sidebar next to the page (AdminNav). */
	@media (min-width: 1100px) {
		.admin-layout.with-nav {
			flex-direction: row;
			align-items: flex-start;
		}
		.with-nav .admin-content {
			flex: 1 1 auto;
		}
	}

	@media (max-width: 640px) {
		.admin-content {
			padding: 1rem;
		}
	}
</style>
