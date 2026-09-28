<!--
@component
The moment a swap goes through (/swaps, after "Hold to swap"): the two spot
tickets lift off, arc past each other and land on each other's place, a spark
bursts where they cross, and fireworks rise from the spot that is the guest's
now. Then the overlay says where they sleep and offers the new room and the
booking pass.

With reduced motion the tickets are simply shown swapped and there are no
fireworks. Escape or Close ends it; the page behind has already reloaded.
-->
<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import SuccessFireworks from '$lib/components/SuccessFireworks.svelte';
	import type { Point } from '$lib/fx/fireworks';
	import SwapTicket from './SwapTicket.svelte';
	import type { SwapSpot } from '$lib/swaps';

	let {
		gave,
		gained,
		name = '',
		passCode = '',
		onclose
	}: {
		/** The spot the guest gave away. */
		gave: SwapSpot;
		/** The spot that is theirs now. */
		gained: SwapSpot;
		/** The other guest's burner name. */
		name?: string;
		/** The guest's booking pass (XXXX-XXXX-XXXX), when they have one. */
		passCode?: string;
		onclose: () => void;
	} = $props();

	const CROSS_MS = 1250;
	const SPARK_AT_MS = 560;

	let calm = $state(false);
	let crossing = $state(false);
	let spark = $state(false);
	let landed = $state(false);
	let fireworks = $state(false);
	let origin = $state<Point | null>(null);
	let gainedEl = $state<HTMLDivElement>();
	let closeButton = $state<HTMLButtonElement>();
	let timers: ReturnType<typeof setTimeout>[] = [];
	let previousFocus: HTMLElement | null = null;

	onMount(() => {
		calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		previousFocus = document.activeElement as HTMLElement | null;
		document.body.style.overflow = 'hidden';
		try {
			navigator.vibrate?.([30, 60, 30]);
		} catch {
			/* no vibration on this device */
		}
		if (calm) {
			void land();
			return;
		}
		// One frame on the old places first, so the flight is seen from the start.
		requestAnimationFrame(() => {
			crossing = true;
			timers.push(setTimeout(() => (spark = true), SPARK_AT_MS));
			timers.push(setTimeout(land, CROSS_MS));
		});
	});

	onDestroy(() => {
		timers.forEach(clearTimeout);
		if (typeof window === 'undefined') return;
		document.body.style.overflow = '';
		if (previousFocus?.isConnected) previousFocus.focus();
	});

	async function land() {
		landed = true;
		await tick();
		if (!calm && gainedEl) {
			const box = gainedEl.getBoundingClientRect();
			origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			fireworks = true;
		}
		closeButton?.focus();
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && landed) {
			event.preventDefault();
			onclose();
		}
	}
</script>

<svelte:window onkeydown={keydown} />

<div
	class="trade-overlay"
	class:calm
	role="dialog"
	aria-modal="true"
	aria-labelledby="trade-title"
	transition:fade={{ duration: calm ? 0 : 200 }}
>
	<div class="glow" aria-hidden="true"></div>
	<p class="kicker"><span aria-hidden="true">🔁</span> Swap</p>
	<h2 id="trade-title" class:shown={landed}>
		{landed ? 'Swapped!' : 'Swapping…'}
	</h2>

	<div class="stage" class:crossing class:landed>
		<div class="slot">
			<div class="flyer gave">
				<!-- the colours swap too: turquoise is "mine" everywhere in the app -->
				<SwapTicket
					spot={gave}
					kicker={landed ? 'Theirs now' : 'You give'}
					tone={landed ? 'theirs' : 'mine'}
				/>
			</div>
		</div>
		<div class="slot">
			<div class="flyer gained" bind:this={gainedEl}>
				<SwapTicket
					spot={gained}
					kicker={landed ? 'Yours now' : 'You get'}
					tone={landed ? 'mine' : 'theirs'}
				/>
			</div>
		</div>
		<span class="spark" class:burst={spark} aria-hidden="true">
			{#each Array(12) as _, i (i)}
				<i style="--a: {i * 30}deg; --d: {i % 2 ? 70 : 110}px"></i>
			{/each}
		</span>
	</div>

	{#if landed}
		<div class="landed-text" in:fade={{ duration: calm ? 0 : 400, delay: calm ? 0 : 150 }}>
			<p>
				You sleep in <strong>{gained.label}</strong> now.
				{#if name}<strong>{name}</strong>{:else}The other guest{/if} got {gave.spot ||
					'your old spot'}. Your burner name came along, your booking pass updates by itself, and
				you both get the usual message about your new spot.
			</p>
			<div class="actions">
				<a class="btn-go" href="/room/{gained.roomId}">Go to my new room</a>
				{#if passCode}
					<a class="btn-quiet" href="/pass/{passCode}">🎫 Booking pass</a>
				{/if}
				<button type="button" class="btn-quiet" bind:this={closeButton} onclick={onclose}>
					Close
				</button>
			</div>
		</div>
	{/if}
	<p class="sr-only" aria-live="polite" data-layout-ignore>
		{landed ? `Swapped. Your spot is ${gained.label} now.` : 'Swapping your spots…'}
	</p>
</div>

{#if fireworks}
	<SuccessFireworks zIndex={1001} {origin} ondone={() => (fireworks = false)} />
{/if}

<style>
	.trade-overlay {
		--gap: clamp(0.75rem, 4vw, 2rem);
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: max(1.25rem, env(safe-area-inset-top)) 1rem max(1.5rem, env(safe-area-inset-bottom));
		background: rgba(2, 6, 12, 0.94);
		color: #fff;
		overflow-y: auto;
		overscroll-behavior: contain;
		text-align: center;
	}
	.glow {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			radial-gradient(40% 30% at 30% 45%, rgba(45, 212, 191, 0.16), transparent 70%),
			radial-gradient(40% 30% at 70% 55%, rgba(56, 189, 248, 0.18), transparent 70%);
	}
	.kicker {
		position: relative;
		margin: 0;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 3px;
		text-transform: uppercase;
		color: var(--swap, #38bdf8);
	}
	h2 {
		position: relative;
		margin: 0;
		font-size: clamp(2rem, 10vw, 3.4rem);
		font-weight: 900;
		letter-spacing: -0.04em;
		line-height: 1;
		transition:
			transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
			color 0.4s ease;
	}
	h2.shown {
		transform: scale(1.06);
		background: linear-gradient(90deg, #2dd4bf, #38bdf8, #fde68a);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	/* The two tickets side by side; `crossing` flies each to the other's
	   place (the percentage is the ticket's own width, both are equally
	   wide), in two arcs, the new spot in front. */
	.stage {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--gap);
		width: min(100%, 560px);
		margin: 0.5rem 0;
	}
	.slot {
		min-width: 0;
	}
	.flyer {
		text-align: left;
		will-change: transform;
	}
	.flyer.gained {
		position: relative;
		z-index: 2;
	}
	.crossing .gave {
		animation: cross-right 1.25s cubic-bezier(0.65, 0, 0.35, 1) forwards;
	}
	.crossing .gained {
		animation: cross-left 1.25s cubic-bezier(0.65, 0, 0.35, 1) forwards;
	}
	@keyframes cross-right {
		0% {
			transform: translate(0, 0) rotate(0);
		}
		20% {
			transform: translate(0, 10px) rotate(-3deg) scale(0.96);
		}
		55% {
			transform: translate(calc(55% + var(--gap) / 2), 56px) rotate(9deg) scale(0.9);
		}
		100% {
			transform: translate(calc(100% + var(--gap)), 0) rotate(0) scale(0.94);
			opacity: 0.75;
		}
	}
	@keyframes cross-left {
		0% {
			transform: translate(0, 0) rotate(0);
		}
		20% {
			transform: translate(0, -10px) rotate(3deg) scale(1.02);
		}
		55% {
			transform: translate(calc(-55% - var(--gap) / 2), -64px) rotate(-9deg) scale(1.12);
		}
		100% {
			transform: translate(calc(-100% - var(--gap)), 0) rotate(0) scale(1.06);
		}
	}
	/* Landed: the new spot glows in the swap colour (a filter on the wrapper:
	   the ticket's notches are a mask, which would cut a box-shadow off). */
	.landed .gained {
		filter: drop-shadow(0 0 16px rgba(45, 212, 191, 0.6));
	}

	/* The spark where the tickets cross: twelve streaks fly out and fade. */
	.spark {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
		pointer-events: none;
		z-index: 3;
	}
	.spark i {
		position: absolute;
		left: -2px;
		top: -2px;
		width: 4px;
		height: 14px;
		border-radius: 2px;
		background: linear-gradient(#fde68a, #38bdf8);
		opacity: 0;
		transform: rotate(var(--a)) translateY(0);
	}
	.spark.burst i {
		animation: streak 0.75s ease-out forwards;
	}
	@keyframes streak {
		0% {
			opacity: 1;
			transform: rotate(var(--a)) translateY(0) scaleY(0.4);
		}
		100% {
			opacity: 0;
			transform: rotate(var(--a)) translateY(calc(-1 * var(--d))) scaleY(1);
		}
	}

	.landed-text {
		position: relative;
		max-width: 520px;
	}
	.landed-text p {
		margin: 0 0 1.25rem;
		color: #cbd5e1;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.landed-text strong {
		color: #fff;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}
	.btn-go,
	.btn-quiet {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0 1.3rem;
		border-radius: 12px;
		font: inherit;
		font-weight: 900;
		font-size: 0.85rem;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-decoration: none;
		cursor: pointer;
	}
	.btn-go {
		border: none;
		background: linear-gradient(90deg, #2dd4bf, var(--swap, #38bdf8));
		color: #04121c;
	}
	.btn-quiet {
		border: 2px solid #475569;
		background: transparent;
		color: #cbd5e1;
	}
	.btn-quiet:hover,
	.btn-go:hover {
		filter: brightness(1.1);
	}
	.btn-go:focus-visible,
	.btn-quiet:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	/* Phones: one ticket above the other, and they swap up and down. */
	@media (max-width: 460px) {
		.stage {
			grid-template-columns: minmax(0, 1fr);
			width: min(100%, 320px);
		}
		.crossing .gave {
			animation-name: cross-down;
		}
		.crossing .gained {
			animation-name: cross-up;
		}
	}
	@keyframes cross-down {
		0% {
			transform: translate(0, 0) rotate(0);
		}
		55% {
			transform: translate(48px, calc(55% + var(--gap) / 2)) rotate(6deg) scale(0.9);
		}
		100% {
			transform: translate(0, calc(100% + var(--gap))) rotate(0) scale(0.94);
			opacity: 0.75;
		}
	}
	@keyframes cross-up {
		0% {
			transform: translate(0, 0) rotate(0);
		}
		55% {
			transform: translate(-48px, calc(-55% - var(--gap) / 2)) rotate(-6deg) scale(1.1);
		}
		100% {
			transform: translate(0, calc(-100% - var(--gap))) rotate(0) scale(1.04);
		}
	}

	/* Reduced motion: the tickets are simply shown swapped. */
	.calm .stage {
		direction: rtl;
	}
	.calm .slot {
		direction: ltr;
	}
	.calm h2,
	.calm .flyer {
		transition: none;
		animation: none;
	}
</style>
