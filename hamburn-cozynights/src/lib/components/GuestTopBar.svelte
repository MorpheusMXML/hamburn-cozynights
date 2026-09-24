<!--
@component
The guest top bar: one sticky line over every booking page (the map, the
houses and rooms, the roulette, special needs, Telegram), rendered by the
root layout. Left, the Hamburn wordmark (the way back to the map) and the
booking phase pill fused with the countdown ("opens in 1d 23:59:57",
"closes in …"): one button, tap for the exact Berlin time. Middle, the wish
chips of the map and the roulette — only the wishes some spot in the camp
answers (the page's `availableFilters`) — with what they found. Right, the ♿
special-needs link, Help & FAQ, Sign out and the version badge.

The bar reports its height (`height`), so a full-screen page can subtract
it. On a phone the right group is icons, the chips take a row of their own
and the wordmark makes room on the map. The map's phase panel counts down
itself and hides the map: there the bar shows neither the countdown nor the
chips, unless the guest put the panel away to look around.
-->
<script lang="ts" module>
	import { writable } from 'svelte/store';

	/**
	 * Closed: the guest put the map's phase panel away to look around, so the
	 * map is usable again. The map page sets it in the browser only (a module
	 * store on the server would be shared between requests) and clears it
	 * when it leaves.
	 */
	export const mapLookingAround = writable(false);
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CountdownDigits from './CountdownDigits.svelte';
	import VersionBadge from './VersionBadge.svelte';
	import { SPOT_FILTERS, readFilters, type SpotFilter } from '$lib/accommodation';
	import {
		countdownKind,
		formatBerlin,
		formatDuration,
		mapCovered,
		PHASE_ICONS,
		PHASE_LABELS,
		resyncDelay,
		showCountdownBar,
		toMs,
		type BookingPhase,
		type PhaseTransition
	} from '$lib/booking-phase';

	let {
		phase = 'staging',
		next = null,
		signedIn = false,
		specialNeeds = null,
		height = $bindable(0)
	}: {
		phase?: BookingPhase;
		next?: PhaseTransition | null;
		/** A ticket is signed in on this device: the Sign out button shows. */
		signedIn?: boolean;
		/** Requests are open, and whether this ticket sent one: the ♿ link. */
		specialNeeds?: { open: boolean; requestSent: boolean } | null;
		/** The bar's rendered height in px, for the layout's --booking-bar-height. */
		height?: number;
	} = $props();

	const URGENT_MS = 60 * 60 * 1000;

	let now = $state(Date.now());
	let ticker: ReturnType<typeof setInterval> | undefined;
	let reduceMotion = $state(false);
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		ticker = setInterval(() => (now = Date.now()), 1000);
	});
	onDestroy(() => clearInterval(ticker));

	let pathname = $derived(page.url.pathname);
	let onMap = $derived(pathname === '/map');

	// ---- the phase and the countdown ---------------------------------------
	let kind = $derived(countdownKind(phase, next));
	let countdown = $derived(showCountdownBar(phase, next, pathname, $mapLookingAround));
	let target = $derived(toMs(next?.at));
	let remaining = $derived(target === null ? 0 : target - now);
	let urgent = $derived(kind === 'closes' && remaining < URGENT_MS);
	let phaseName = $derived(PHASE_LABELS[phase].replace('Live Booking', 'Live').toUpperCase());
	let countdownLabel = $derived(
		remaining <= 0
			? kind === 'closes'
				? 'closing…'
				: 'opening…'
			: kind === 'closes'
				? 'closes in'
				: 'opens in'
	);
	let spoken = $derived(
		`Booking phase: ${PHASE_LABELS[phase]}.` +
			(countdown && next
				? ` Booking ${countdownLabel}${remaining > 0 ? ` ${formatDuration(remaining)}` : ''}.`
				: '')
	);

	// Once the time has come, ask the server for the phase it has switched to
	// (the pages then lock or open by themselves). This clock may run ahead of
	// the server's: while the phase hasn't changed yet, ask again, more slowly.
	// Only while the bar shows the countdown: under the map's phase panel the
	// panel's own timer asks, so the switch is fetched once, not twice.
	let waitingFor = '';
	let attempts = 0;
	let lastReload = 0;
	$effect(() => {
		if (!browser || !countdown || !next || remaining > 0) return;
		if (waitingFor !== next.at) {
			waitingFor = next.at;
			attempts = 0;
			lastReload = 0;
		}
		if (now - lastReload >= resyncDelay(attempts)) {
			lastReload = now;
			attempts += 1;
			invalidateAll();
		}
	});

	let open = $state(false);
	let phaseRoot: HTMLElement | undefined = $state();
	function closeOnOutside(event: MouseEvent) {
		if (open && phaseRoot && !phaseRoot.contains(event.target as Node)) open = false;
	}
	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}

	// ---- the wishes ---------------------------------------------------------
	// The map and the roulette put the wishes in the URL (`?w=`) and say which
	// filters some spot in the camp answers; other pages offer none.
	let wishes = $derived(readFilters(page.data.wishes));
	let offered = $derived(readFilters(page.data.availableFilters));
	let wishFit = $derived(typeof page.data.wishFit === 'string' ? page.data.wishFit : '');
	let chips = $derived(
		offered.length > 0 && !mapCovered(phase, next, pathname, $mapLookingAround)
			? SPOT_FILTERS.filter((filter) => offered.includes(filter.value))
			: []
	);
	function wishLink(filter: SpotFilter, on: boolean): string {
		const chosen = on ? wishes.filter((wish) => wish !== filter) : [...wishes, filter];
		return chosen.length > 0 ? `${pathname}?w=${chosen.join(',')}` : pathname;
	}

	// ---- the quick access ---------------------------------------------------
	let special = $derived(
		phase !== 'staging' && !!specialNeeds && (specialNeeds.open || specialNeeds.requestSent)
	);
	let specialLabel = $derived(
		specialNeeds?.requestSent ? 'My special-needs request' : 'Ask for a special-needs spot'
	);
	let specialShort = $derived(specialNeeds?.requestSent ? 'My request' : 'Special-needs spot');
</script>

<svelte:window onclick={closeOnOutside} onkeydown={closeOnEscape} />

<!-- data-layout-overlay: the sticky bar lies over what scrolled under it on purpose. -->
<header
	class="guest-topbar"
	class:on-map={onMap}
	class:has-chips={chips.length > 0}
	data-layout-overlay
	bind:clientHeight={height}
>
	{#if onMap}
		<span class="wordmark">Hamburn</span>
	{:else}
		<a class="wordmark" href="/map" title="Back to the camp map">Hamburn</a>
	{/if}

	<div class="bar-phase" bind:this={phaseRoot}>
		{#if countdown && next}
			<button
				type="button"
				class="phase-btn"
				aria-expanded={open}
				aria-controls="guest-phase-details"
				aria-label={spoken}
				title="Tap for the exact time"
				onclick={() => (open = !open)}
			>
				<span class="phase-pill state-chip" data-state={phase}>
					<span class="state-dot" aria-hidden="true"></span>
					<span class="phase-icon" aria-hidden="true">{PHASE_ICONS[phase]}</span>
					<span class="phase-name">{phaseName}</span>
				</span>
				<span class="countdown {kind}" class:urgent>
					<span class="countdown-label">{countdownLabel}</span>
					{#if remaining > 0}
						<span class="countdown-time"><CountdownDigits ms={remaining} /></span>
					{/if}
				</span>
				<span class="chevron" class:open aria-hidden="true">
					<svg viewBox="0 0 12 12" width="10" height="10"
						><path
							d="M2.5 4.5 6 8l3.5-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/></svg
					>
				</span>
			</button>
		{:else}
			<span class="phase-pill state-chip phase-only" data-state={phase} title={spoken}>
				<span class="state-dot" aria-hidden="true"></span>
				<span class="phase-icon" aria-hidden="true">{PHASE_ICONS[phase]}</span>
				<span class="phase-name">{phaseName}</span>
			</span>
		{/if}
	</div>

	{#if open && countdown && next}
		<div
			id="guest-phase-details"
			class="details {kind}"
			role="status"
			transition:fly={{ y: -8, duration: reduceMotion ? 0 : 220, easing: cubicOut }}
		>
			{#if kind === 'closes'}
				<strong>Live Booking ends {formatBerlin(next.at)}</strong>
				<span
					>Berlin time. Until then you can book, change or release your spot; after that, bookings
					are final.</span
				>
			{:else}
				<strong>Booking opens {formatBerlin(next.at)}</strong>
				<span>Berlin time. The map unlocks by itself, no need to reload.</span>
			{/if}
		</div>
	{/if}

	{#if chips.length > 0}
		<nav class="wish-chips" aria-label="What are you looking for?">
			{#each chips as filter (filter.value)}
				{@const on = wishes.includes(filter.value)}
				<a
					class="wish"
					class:on
					href={wishLink(filter.value, on)}
					data-sveltekit-noscroll
					aria-current={on ? 'true' : undefined}
					aria-label={filter.label}
					title={filter.hint ? `${filter.label} — ${filter.hint}` : filter.label}
				>
					<span class="wish-icon" aria-hidden="true">{filter.icon}</span>
					<span class="wish-label">{filter.label}</span>
				</a>
			{/each}
			{#if wishes.length > 0}
				{#if wishFit}
					<span class="wish-fit" role="status">{wishFit}</span>
				{/if}
				<a class="wish-clear" href={pathname} data-sveltekit-noscroll>Clear</a>
			{/if}
		</nav>
	{/if}

	<div class="bar-quick">
		{#if special}
			<a
				class="quick-link special"
				href="/special-needs"
				aria-current={pathname === '/special-needs' ? 'page' : undefined}
				aria-label={specialLabel}
				title={specialLabel}
			>
				<span class="quick-icon" aria-hidden="true">♿</span>
				<span class="quick-text">{specialShort}</span>
			</a>
		{/if}
		<a
			class="quick-link"
			href="/docs/guide/"
			target="_blank"
			rel="noopener"
			aria-label="Help and FAQ (opens in a new tab)"
			title="Help & FAQ (opens in a new tab)"
		>
			<span class="quick-icon ring" aria-hidden="true">?</span>
			<span class="quick-text">Help &amp; FAQ</span>
		</a>
		{#if signedIn}
			<!-- The start page's action: it clears the ticket cookie and goes back there. -->
			<form method="POST" action="/?/signOut" class="signout-form">
				<button type="submit" class="quick-link signout" aria-label="Sign out" title="Sign out">
					<span class="quick-icon" aria-hidden="true">⏏</span>
					<span class="quick-text">Sign out</span>
				</button>
			</form>
		{/if}
		<VersionBadge size="nav" />
	</div>
</header>

<style>
	.guest-topbar {
		position: sticky;
		top: 0;
		/* Over the page's own floating boxes; under its dialogs (100 and up). */
		z-index: 90;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
		padding: 0.35rem 0.75rem;
		min-width: 0;
		box-sizing: border-box;
		background: rgba(8, 8, 8, 0.88);
		backdrop-filter: blur(12px) saturate(1.4);
		-webkit-backdrop-filter: blur(12px) saturate(1.4);
		border-bottom: 1px solid #1f1f1f;
		font-family: 'Inter', system-ui, sans-serif;
		color: #d4d4d4;
	}

	/* ---- the wordmark ------------------------------------------------------ */
	.wordmark {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		min-height: 36px;
		font-size: 1rem;
		font-weight: 900;
		letter-spacing: -0.5px;
		text-transform: uppercase;
		text-decoration: none;
		background: linear-gradient(to right, #2dd4bf, #f472b6);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}
	a.wordmark:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
		border-radius: 6px;
	}

	/* ---- the phase and the countdown --------------------------------------- */
	.bar-phase {
		display: flex;
		align-items: center;
		min-width: 0;
		flex: 0 1 auto;
	}
	.phase-btn {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.5rem;
		max-width: 100%;
		min-height: 36px;
		padding: 0.15rem 0.5rem 0.15rem 0.2rem;
		border-radius: 999px;
		border: 1px solid transparent;
		background: transparent;
		color: #d4d4d4;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: border-color 0.25s;
	}
	.phase-btn:hover,
	.phase-btn:focus-visible {
		border-color: #333;
	}
	.phase-btn:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 2px;
	}
	.phase-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 26px;
		padding: 0 0.55rem;
		border-radius: 999px;
		font-size: 0.62rem;
		letter-spacing: 1.1px;
		box-sizing: border-box;
	}
	.phase-only {
		min-height: 30px;
	}
	.phase-pill .state-dot {
		width: 6px;
		height: 6px;
	}
	.phase-icon {
		font-size: 0.8rem;
	}

	.countdown {
		--accent: var(--state-filling);
		--accent-soft: var(--state-filling-soft);
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
		white-space: nowrap;
	}
	/* The closing countdown wears the live phase's yellow, never pink (♿ only). */
	.countdown.closes {
		--accent: var(--state-live);
		--accent-soft: var(--state-live-soft);
	}
	.countdown.urgent {
		--accent: var(--state-full);
		--accent-soft: var(--state-full-soft);
	}
	.countdown-label {
		font-size: 0.6rem;
		font-weight: 900;
		letter-spacing: 1.1px;
		text-transform: uppercase;
		color: #9a9a9a;
	}
	.countdown-time {
		font-size: 0.82rem;
		font-weight: 800;
		color: var(--accent);
		text-shadow: 0 0 12px var(--accent-soft);
	}
	.chevron {
		display: inline-flex;
		color: #777;
		transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.chevron.open {
		transform: rotate(180deg);
	}

	/* Anchored to the sticky bar, so it never runs past the screen edge. */
	.details {
		--accent: var(--state-filling);
		position: absolute;
		top: calc(100% - 2px);
		left: 12px;
		right: 12px;
		max-width: 360px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.8rem 1rem;
		border-radius: 14px;
		border: 1px solid #262626;
		border-top: 2px solid var(--accent);
		background: rgba(10, 10, 10, 0.94);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
		font-size: 0.8rem;
		line-height: 1.45;
		color: #b5b5b5;
		z-index: 1;
	}
	.details.closes {
		--accent: var(--state-live);
	}
	.details strong {
		color: #fff;
		font-size: 0.85rem;
	}

	/* ---- the wish chips ------------------------------------------------------ */
	/* Takes what is left between the phase and the quick access and wraps
	   inside itself; when less than a few chips' worth is left (tablets), the
	   row goes under the others as a whole instead of one chip per line. */
	.wish-chips {
		flex: 1 1 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-width: min(100%, 28rem);
	}
	.wish {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 28px;
		padding: 0 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 999px;
		box-sizing: border-box;
		font-size: 0.72rem;
		color: #dbe3ea;
		text-decoration: none;
		background: rgba(255, 255, 255, 0.04);
		white-space: nowrap;
	}
	.wish:hover,
	.wish:focus-visible {
		border-color: rgba(45, 212, 191, 0.7);
		color: #eafcff;
	}
	.wish:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.wish.on {
		background: rgba(45, 212, 191, 0.18);
		border-color: rgba(45, 212, 191, 0.8);
		color: #b8fff4;
		font-weight: 700;
	}
	.wish-fit {
		min-width: 0;
		font-size: 0.7rem;
		color: #9fb3c8;
		overflow-wrap: anywhere;
	}
	.wish-clear {
		font-size: 0.72rem;
		color: #2dd4bf;
	}

	/* ---- the quick access ---------------------------------------------------- */
	.bar-quick {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		margin-left: auto;
	}
	.signout-form {
		display: flex;
	}
	.quick-link {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 36px;
		padding: 0 0.7rem;
		border-radius: 10px;
		border: 1px solid #262626;
		background: #0f0f0f;
		color: #b5b5b5;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		box-sizing: border-box;
	}
	.quick-link:hover,
	.quick-link:focus-visible {
		color: #fff;
		border-color: #2dd4bf;
	}
	.quick-link:focus-visible {
		outline: 2px solid #2dd4bf;
		outline-offset: 1px;
	}
	.quick-link[aria-current='page'] {
		border-color: rgba(45, 212, 191, 0.45);
		background: rgba(45, 212, 191, 0.1);
	}
	/* Pink is the special-needs colour, and this link is nothing else. */
	.quick-link.special {
		border-color: var(--state-special);
		color: #f9a8d4;
	}
	.quick-link.special:hover,
	.quick-link.special:focus-visible {
		background: var(--state-special-soft);
		color: #fff;
	}
	.quick-link.signout {
		border-color: rgba(248, 113, 113, 0.5);
		color: #f5a3a3;
	}
	.quick-link.signout:hover,
	.quick-link.signout:focus-visible {
		border-color: var(--state-full);
		background: var(--state-full-soft);
		color: #fff;
	}
	.quick-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.9rem;
		line-height: 1;
	}
	.quick-icon.ring {
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		border: 1px solid currentColor;
		font-size: 0.75rem;
	}

	/* ---- narrow screens ------------------------------------------------------ */
	/* Tablets and below: the quick access is its icons (the words stay for
	   readers and tooltips), so the phase and the icons share the first row. */
	@media (max-width: 900px) {
		.quick-link {
			width: 34px;
			padding: 0;
			justify-content: center;
		}
		.quick-text {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.quick-icon {
			font-size: 1rem;
		}
		.bar-quick {
			gap: 0.3rem;
		}
	}
	/* Phones and small tablets: the chips take a row of their own, below. */
	@media (max-width: 640px) {
		.wish-chips {
			order: 10;
			flex-basis: 100%;
			justify-content: flex-start;
		}
	}
	/* Phones: the pill is its icon, the countdown its digits (the accent says
	   which way it counts, the tap the exact time), the chips their icons; the
	   version badge lives in the footer too. On the map the wordmark is a label
	   only, and wherever chips show (the map, the roulette, which has its own
	   way back) it would push the icons onto a row of their own: it goes, so
	   the phase, the icons and the chips fit two rows at 320 px. */
	@media (max-width: 480px) {
		.phase-name,
		.countdown-label,
		.wish-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.phase-pill {
			padding: 0 0.45rem;
		}
		.phase-btn {
			gap: 0.3rem 0.35rem;
		}
		.wish {
			width: 32px;
			padding: 0;
			justify-content: center;
		}
		.wish-chips {
			gap: 0.25rem;
		}
		.on-map .wordmark,
		.has-chips .wordmark {
			display: none;
		}
		.bar-quick :global(.version-badge) {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.phase-btn,
		.chevron {
			transition: none;
		}
	}
</style>
