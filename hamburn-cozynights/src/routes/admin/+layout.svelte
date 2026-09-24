<script lang="ts">
	import LockHintHost from '$lib/components/admin/LockHintHost.svelte';
	import AdminNav from '$lib/components/admin/AdminNav.svelte';

	// Get data from server (admin session; null on the login page). The booking
	// phase and its next switch come from the root layout's load.
	export let data;
</script>

<div class="admin-layout" class:with-nav={!!data.admin}>
	{#if data.admin}
		<AdminNav
			email={data.admin.email}
			isSuperuser={data.isSuperuser}
			counts={data.navCounts}
			phase={data.booking?.phase ?? 'staging'}
			next={data.booking?.next ?? null}
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

	/*
	 * The admin bar (AdminNav → AdminStatus) carries the phase and the countdown
	 * itself, so the slim guest countdown that the root layout puts on top of
	 * every page stays away from /admin: no height reserved, the bar hidden.
	 * Anchored to this layout's root, so it never touches a guest page; the
	 * `div` outranks the root layout's own (scoped) height rule.
	 * TODO(root layout): render no BookingCountdownBar under /admin instead.
	 */
	:global(div.app-root.has-booking-bar:has(> .admin-layout)) {
		--booking-bar-height: 0px;
	}
	:global(.app-root:has(> .admin-layout) > .booking-bar) {
		display: none;
	}

	.admin-layout {
		min-height: 100vh;
		min-height: 100dvh;
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

	/* From 1100 px the menu is a sidebar next to the page and the status bar
	   spans the page's column above it (both rendered by AdminNav). */
	@media (min-width: 1100px) {
		.admin-layout.with-nav {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			grid-template-rows: auto 1fr;
			align-items: start;
		}
		.admin-layout.with-nav > :global(.admin-topbar) {
			grid-column: 2;
			grid-row: 1;
			align-self: stretch;
		}
		.admin-layout.with-nav > :global(.admin-sidebar) {
			grid-column: 1;
			grid-row: 1 / span 2;
		}
		.with-nav .admin-content {
			grid-column: 2;
			grid-row: 2;
		}
	}

	@media (max-width: 640px) {
		.admin-content {
			padding: 1rem;
		}
	}
</style>
