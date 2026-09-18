<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import FairyBackground from '$lib/components/FairyBackground.svelte';
	import BurnerTrail from '$lib/components/BurnerTrail.svelte';
	import DialogHost from '$lib/components/DialogHost.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { page } from '$app/state';

	let { children } = $props();

	// Full-screen pages place the legal links and the credit themselves.
	const OWN_LEGAL_LINKS = new Set(['/', '/map']);
	let footer = $derived(!OWN_LEGAL_LINKS.has(page.url.pathname));

	// The floating creatures and the cursor trail are for the fun pages. Legal
	// texts, booking passes and the crew's phone scanner are read (or held up
	// to a QR code) for a while: no WebGL context and no 19 endless animations.
	const PLAIN_PAGES = /^\/(legal-notice|privacy|booking-rules|pass|admin\/check)(\/|$)/;
	let ambient = $derived(!PLAIN_PAGES.test(page.url.pathname));
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if ambient}
	<FairyBackground />
	<BurnerTrail />
{/if}

<div class="app-root">
	{@render children()}
	{#if footer}
		<SiteFooter />
	{/if}
</div>

<DialogHost />

<style>
	.app-root {
		position: relative;
		z-index: 1;
	}
</style>
