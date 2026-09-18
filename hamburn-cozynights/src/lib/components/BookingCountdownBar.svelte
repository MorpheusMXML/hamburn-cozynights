<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import CountdownDigits from './CountdownDigits.svelte';
	import {
		countdownKind,
		formatBerlin,
		formatDuration,
		resyncDelay,
		toMs,
		type BookingPhase,
		type PhaseTransition
	} from '$lib/booking-phase';

	/**
	 * The slim countdown on top of every page: until booking opens, and while
	 * booking is live until it closes. Tap it for the exact time. The layout
	 * reserves its height (--booking-bar-height) while it is shown.
	 */
	export let phase: BookingPhase;
	export let next: PhaseTransition | null;

	const URGENT_MS = 60 * 60 * 1000;

	let now = Date.now();
	let ticker: ReturnType<typeof setInterval> | undefined;
	let reduceMotion = false;
	onMount(() => {
		reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		ticker = setInterval(() => (now = Date.now()), 1000);
	});
	onDestroy(() => clearInterval(ticker));

	$: kind = countdownKind(phase, next);
	$: target = toMs(next?.at);
	$: remaining = target === null ? 0 : target - now;
	$: urgent = kind === 'closes' && remaining < URGENT_MS;
	$: label =
		remaining <= 0
			? kind === 'closes'
				? 'Booking is closing…'
				: 'Booking is opening…'
			: kind === 'closes'
				? 'Booking closes in'
				: 'Booking opens in';

	// Once the time has come, reload the page data: the pages then open or
	// lock booking by themselves. The server decides, not this clock: while
	// it hasn't switched yet (this clock runs ahead), ask again.
	let waitingFor = '';
	let attempts = 0;
	let lastReload = 0;
	$: if (browser && kind && next && remaining <= 0) {
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
	}

	let open = false;
	let root: HTMLElement;
	function closeOnOutside(event: MouseEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
	function closeOnEscape(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}
</script>

<svelte:window on:click={closeOnOutside} on:keydown={closeOnEscape} />

{#if kind && next}
	<div class="booking-bar" bind:this={root}>
		<button
			type="button"
			class="pill {kind}"
			class:urgent
			aria-expanded={open}
			aria-controls="booking-countdown-details"
			aria-label={remaining > 0 ? `${label} ${formatDuration(remaining)}` : label}
			on:click={() => (open = !open)}
			in:fly={{ y: -16, duration: reduceMotion ? 0 : 450, easing: cubicOut }}
		>
			<span class="beacon" aria-hidden="true"></span>
			<span class="label">{label}</span>
			{#if remaining > 0}
				<span class="time"><CountdownDigits ms={remaining} /></span>
			{/if}
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

		{#if open}
			<div
				id="booking-countdown-details"
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
	</div>
{/if}

<style>
	.booking-bar {
		position: sticky;
		top: 0;
		z-index: 900;
		height: var(--booking-bar-height, 40px);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		box-sizing: border-box;
		pointer-events: none;
	}

	.pill {
		--accent: #fb923c;
		--accent-soft: rgba(251, 146, 60, 0.35);
		pointer-events: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		max-width: 100%;
		height: 30px;
		padding: 0 0.75rem 0 0.65rem;
		border-radius: 999px;
		border: 1px solid var(--accent-soft);
		background: rgba(8, 8, 8, 0.72);
		backdrop-filter: blur(12px) saturate(1.4);
		-webkit-backdrop-filter: blur(12px) saturate(1.4);
		box-shadow:
			0 6px 24px rgba(0, 0, 0, 0.45),
			0 0 18px -6px var(--accent-soft);
		color: #d4d4d4;
		font: inherit;
		cursor: pointer;
		transition:
			border-color 0.3s,
			box-shadow 0.3s,
			transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.pill:hover,
	.pill:focus-visible {
		border-color: var(--accent);
		transform: translateY(1px) scale(1.02);
	}
	.pill:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.pill.closes {
		--accent: #f472b6;
		--accent-soft: rgba(244, 114, 182, 0.35);
	}
	.pill.urgent {
		--accent: #f87171;
		--accent-soft: rgba(248, 113, 113, 0.5);
	}

	.beacon {
		position: relative;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}
	.beacon::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: var(--accent);
		animation: beacon 2.4s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
	.urgent .beacon::after {
		animation-duration: 1.2s;
	}
	@keyframes beacon {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		80%,
		100% {
			transform: scale(3);
			opacity: 0;
		}
	}

	.label {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 1.5px;
		text-transform: uppercase;
		color: #9a9a9a;
		white-space: nowrap;
	}
	.time {
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

	.details {
		--accent: #fb923c;
		position: absolute;
		top: calc(100% - 2px);
		left: 50%;
		translate: -50% 0;
		width: min(340px, calc(100vw - 24px));
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
		pointer-events: auto;
		text-align: left;
		font-size: 0.8rem;
		line-height: 1.45;
		color: #b5b5b5;
	}
	.details.closes {
		--accent: #f472b6;
	}
	.details strong {
		color: #fff;
		font-size: 0.85rem;
	}

	@media (max-width: 420px) {
		.pill {
			gap: 0.4rem;
			padding: 0 0.6rem 0 0.55rem;
		}
		.label {
			letter-spacing: 0.8px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.beacon::after {
			animation: none;
		}
		.pill,
		.chevron {
			transition: none;
		}
	}
</style>
