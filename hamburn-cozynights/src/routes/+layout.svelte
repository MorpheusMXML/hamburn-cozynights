<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import FairyBackground from '$lib/components/FairyBackground.svelte';
	import BurnerTrail from '$lib/components/BurnerTrail.svelte';
	import DialogHost from '$lib/components/DialogHost.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import BookingCountdownBar from '$lib/components/BookingCountdownBar.svelte';
	import { showCountdownBar } from '$lib/booking-phase';
	import { refreshOnReturn } from '$lib/refresh-on-return';
	import { page } from '$app/state';

	let { children, data } = $props();

	// Full-screen pages place the legal links and the credit themselves.
	const OWN_LEGAL_LINKS = new Set(['/', '/map']);
	let footer = $derived(!OWN_LEGAL_LINKS.has(page.url.pathname));

	// The floating creatures and the cursor trail are for the fun pages. Legal
	// texts, booking passes and the crew's phone scanner are read (or held up
	// to a QR code) for a while: no WebGL context and no 19 endless animations.
	const PLAIN_PAGES = /^\/(legal-notice|privacy|booking-rules|pass|admin\/check)(\/|$)/;
	let ambient = $derived(!PLAIN_PAGES.test(page.url.pathname));
	// The start page always shows the big countdown itself, the map while it is Staging.
	let bar = $derived(
		showCountdownBar(data.booking?.phase ?? 'staging', data.booking?.next, page.url.pathname)
	);

	// The pages that show the phase and the spots ask the server again when the
	// guest comes back to a tab that sat in the background (see the module).
	// The crew's pages have their own live numbers and open forms, so they don't.
	const REFRESH_ON_RETURN = /^\/(map|house\/|room\/|random-bed)/;
	$effect(() => {
		if (!REFRESH_ON_RETURN.test(page.url.pathname)) return;
		return refreshOnReturn();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if ambient}
	<FairyBackground />
	<BurnerTrail />
{/if}

<div class="app-root" class:has-booking-bar={bar}>
	{#if bar && data.booking}
		<BookingCountdownBar phase={data.booking.phase} next={data.booking.next} />
	{/if}
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
		/* Full-screen pages subtract it: calc(100dvh - var(--booking-bar-height)). */
		--booking-bar-height: 0px;
	}
	.app-root.has-booking-bar {
		--booking-bar-height: 40px;
	}
</style>
