<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import FairyBackground from '$lib/components/FairyBackground.svelte';
	import BurnerTrail from '$lib/components/BurnerTrail.svelte';
	import DialogHost from '$lib/components/DialogHost.svelte';
	import LegalLinks from '$lib/components/LegalLinks.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	// Full-screen pages place the legal links themselves.
	const OWN_LEGAL_LINKS = new Set(['/', '/map']);
	let footer = $derived(!OWN_LEGAL_LINKS.has(page.url.pathname));
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<FairyBackground />
<BurnerTrail />

<div class="app-root">
	{@render children()}
	{#if footer}
		<footer class="site-footer"><LegalLinks /></footer>
	{/if}
</div>

<DialogHost />

<style>
	.app-root {
		position: relative;
		z-index: 1;
	}

	.site-footer {
		display: flex;
		justify-content: center;
		padding: 1.25rem 1rem max(1.25rem, env(safe-area-inset-bottom));
	}
</style>
