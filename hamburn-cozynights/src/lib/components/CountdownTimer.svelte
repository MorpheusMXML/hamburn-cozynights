<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import CountdownDigits from './CountdownDigits.svelte';
	import { formatBerlin, resyncDelay, toMs } from '$lib/booking-phase';

	/**
	 * The big countdown box: on the start page between the title and the
	 * ticket-code field (until booking opens, and while it is live until it
	 * closes), and on the guest map until booking opens. The page around it
	 * sets the digit size with --countdown-digits.
	 */
	export let targetDate: string;
	/** Counting down to the opening of booking, or to its closing. */
	export let kind: 'opens' | 'closes' = 'opens';

	const dispatch = createEventDispatcher<{ elapsed: void }>();
	/** The last hour before booking closes turns the box red. */
	const URGENT_MS = 60 * 60 * 1000;

	let now = Date.now();
	let interval: ReturnType<typeof setInterval> | undefined;
	let elapsedFor = '';
	let attempts = 0;
	let lastElapsed = 0;

	onMount(() => {
		interval = setInterval(() => (now = Date.now()), 1000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});

	$: target = toMs(targetDate);
	$: remaining = target === null ? 0 : target - now;
	$: urgent = kind === 'closes' && remaining < URGENT_MS;
	// Tell the page, so it can reload its data and open (or close) the booking;
	// again after a while if the server hasn't switched yet (this clock runs ahead).
	$: if (browser && target !== null && remaining <= 0) {
		if (elapsedFor !== targetDate) {
			elapsedFor = targetDate;
			attempts = 0;
			lastElapsed = 0;
		}
		if (now - lastElapsed >= resyncDelay(attempts)) {
			lastElapsed = now;
			attempts += 1;
			dispatch('elapsed');
		}
	}

	$: targetLabel = formatBerlin(targetDate);
</script>

<div class="countdown-wrapper {kind}" class:urgent in:fade>
	<div class="timezone-badge">BERLIN TIME</div>
	<span class="label"
		>{kind === 'closes' ? 'LIVE BOOKING ENDS' : 'BOOKING OPENS'} {targetLabel.toUpperCase()}</span
	>
	<span class="timer" role="timer" aria-live="off">
		{#if target === null}
			…
		{:else if remaining <= 0}
			ANY MOMENT NOW...
		{:else}
			<CountdownDigits ms={remaining} />
		{/if}
	</span>
</div>

<style>
	.countdown-wrapper {
		--accent: #fb923c;
		--accent-rgb: 251, 146, 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(0, 0, 0, 0.85);
		padding: 1.75rem clamp(1rem, 5vw, 2.5rem) 1.25rem;
		border-radius: 16px;
		border: 2px solid var(--accent);
		box-shadow:
			0 0 30px rgba(var(--accent-rgb), 0.15),
			inset 0 0 15px rgba(var(--accent-rgb), 0.1);
		min-width: min(240px, 100%);
		max-width: 100%;
		text-align: center;
		position: relative;
		overflow: hidden;
		transition:
			border-color 0.4s,
			box-shadow 0.4s;
	}
	.countdown-wrapper.closes {
		--accent: #f472b6;
		--accent-rgb: 244, 114, 182;
	}
	.countdown-wrapper.urgent {
		--accent: #f87171;
		--accent-rgb: 248, 113, 113;
	}
	.timezone-badge {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		background: var(--accent);
		color: #000;
		font-size: 0.65rem;
		font-weight: 900;
		padding: 2px 10px;
		border-radius: 0 0 8px 8px;
		letter-spacing: 1px;
		white-space: nowrap;
	}
	.label {
		font-size: 0.75rem;
		font-weight: 900;
		color: #b0b0b0;
		letter-spacing: 1.5px;
		line-height: 1.5;
		margin-top: 5px;
		margin-bottom: 5px;
		/* On phones the date wraps: two even lines, not a lonely "01:04". */
		text-wrap: balance;
	}
	.timer {
		font-size: var(--countdown-digits, clamp(1.25rem, 6.5vw, 1.75rem));
		font-weight: 900;
		color: var(--accent);
		font-family: 'JetBrains Mono', monospace;
		text-shadow: 0 0 15px rgba(var(--accent-rgb), 0.6);
		white-space: nowrap;
	}
</style>
