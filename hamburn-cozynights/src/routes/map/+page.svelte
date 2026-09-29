<script lang="ts" module>
	import type { BookingPhase } from '$lib/booking-phase';

	/**
	 * Closed: once a guest looked around, coming back from a house leaves the
	 * panel away. Remembered with the phase it happened in, so a new phase
	 * (booking opened again, a window was armed) greets them with it again.
	 */
	let lookedAroundIn: BookingPhase | null = null;
</script>

<script lang="ts">
	import type { PageData } from './$types';
	import Map from '$lib/components/Map.svelte';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import PassTicket from '$lib/components/PassTicket.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { mapLookingAround } from '$lib/components/GuestTopBar.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';

	export let data: PageData;
	$: ({ isBookingActive, phase, guestPhase, bookingUnlockAt } = data);

	// What the guest is looking for. The wishes live in the URL, so the map can
	// be shared, works without JavaScript and survives a reload; the chips to
	// pick them are in the top bar (GuestTopBar, from the page data).
	$: wishes = data.wishes;

	// A panel covers the blurred map whenever guests can't book. It counts down
	// while booking is not open yet — Staging, and Closed with an opening armed,
	// where the spots are anything but final — and says BOOKING CLOSED once
	// nothing is planned any more. In Closed the guest can put it away and look
	// around (houses stay open, read-only).
	$: notOpenYet = guestPhase === 'staging';
	let lookingAround = data.phase === lookedAroundIn;
	let panelPhase = data.phase;
	$: if (phase !== panelPhase) {
		panelPhase = phase;
		lookingAround = false;
	}
	$: showPanel = guestPhase !== 'live' && !(phase === 'closed' && lookingAround);

	function lookAround() {
		lookingAround = true;
		lookedAroundIn = phase;
	}
	// Tells the top bar the map is usable again (countdown and chips), in the
	// browser only: the store is a module, shared between requests on the server.
	$: if (browser) mapLookingAround.set(lookingAround);
	onDestroy(() => {
		if (browser) mapLookingAround.set(false);
	});

	onMount(() => {
		// Force a fresh fetch when entering the page
		invalidateAll();
	});

	let clickCount = 0;
	let lastClickTime = 0;
	let isShaking = false;
	let shakeTimeout: ReturnType<typeof setTimeout>;

	function handleReloadSensors() {
		const now = Date.now();
		if (now - lastClickTime < 300) {
			clickCount++;
		} else {
			clickCount = 1;
		}
		lastClickTime = now;

		if (clickCount > 3) {
			isShaking = true;
			clearTimeout(shakeTimeout);
			shakeTimeout = setTimeout(() => {
				isShaking = false;
			}, 500);
		}

		invalidateAll();
	}
</script>

<svelte:head>
	<title>Camp map · CozyNights</title>
</svelte:head>

<!-- The phase, the countdown, the wish chips and the quick access are in the
     top bar over the page (GuestTopBar, rendered by the root layout). -->
<div class="page-container">
	{#if data.houses}
		<div class="map-container">
			<Map
				houses={data.houses}
				isEditorMode={false}
				isBookingActive={data.isBookingActive}
				phase={data.phase}
				dimmed={showPanel}
				wishes={wishes.length > 0}
			/>
		</div>
	{:else}
		<div class="loading">Igniting Sensors...</div>
	{/if}

	{#if showPanel}
		<div class="phase-overlay">
			<div class="phase-panel">
				{#if notOpenYet}
					{#if bookingUnlockAt}
						<div class="timer-wrapper">
							<h2 class="laser-text pink">IGNITION IN</h2>
							<CountdownTimer targetDate={bookingUnlockAt} on:elapsed={() => invalidateAll()} />
						</div>
					{/if}

					<p class="phase-note">
						Booking is not open yet. {bookingUnlockAt
							? 'This page unlocks by itself when the countdown ends.'
							: 'The crew is still setting up the houses. Check back soon.'}
					</p>
				{:else}
					<h2 class="laser-text closed">BOOKING CLOSED</h2>

					<p class="phase-note">
						Spots are final now: nothing can be booked, changed or released anymore.
						{#if data.noSpot}Your ticket holds no spot. If you need one, please contact the crew.{/if}
					</p>

					<!-- Final: the spot of the ticket signed in here, as a small ticket. While
					     a countdown runs, the panel stays short — the spot is on its room page,
					     and a taller panel reaches into the legal links below the map. -->
					{#if data.pass}
						<PassTicket pass={data.pass} />
					{/if}
				{/if}

				{#if data.specialNeeds?.requestSent}
					<a class="special-needs-cta" href="/special-needs">
						<span aria-hidden="true">♿</span> See your special-needs request
					</a>
				{:else if data.specialNeeds?.open && notOpenYet}
					<!-- Before booking opens only, as the guides say. Once it has closed the
					     ♿ button at the top of the map is the way in, and the final panel with
					     the pass ticket has no room left: with a line more, LOOK AROUND slid
					     under the legal links at 320 px (Linux fonts, CI run 35621290451). -->
					<a class="special-needs-cta" href="/special-needs">
						<span aria-hidden="true">♿</span> Need a special-needs spot? Ask the crew now
					</a>
				{/if}

				{#if phase === 'closed'}
					<!-- Closed: the houses stay open, read-only. -->
					<button class="panel-button" on:click={lookAround}>
						<span class="icon">🗺️</span>
						LOOK AROUND
					</button>
				{:else}
					<button class="panel-button" class:smashed={isShaking} on:click={handleReloadSensors}>
						<span class="icon">📡</span>
						RELOAD SENSORS
						{#if clickCount > 5}
							<span class="warning-text">CALIBRATING INTENSELY!</span>
						{/if}
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- One column: the roulette button stacks on top of the legal links and
	     the credit, so the two never cover each other. -->
	<div class="bottom-dock">
		{#if data.houses && isBookingActive}
			<a href="/random-bed" class="random-btn pulsing-laser">
				<span class="icon">🎰</span>
				DESTINY ROULETTE
			</a>
		{/if}
		<div class="map-legal"><SiteFooter compact /></div>
	</div>
</div>

<style>
	.page-container {
		width: 100%;
		/* minus the booking countdown bar on top, if shown (+layout.svelte) */
		height: calc(100vh - var(--booking-bar-height, 0px));
		height: calc(100dvh - var(--booking-bar-height, 0px));
		background: #050505;
		overflow: hidden;
		position: relative;
		font-family: 'Inter', system-ui, sans-serif;
		display: flex;
		flex-direction: column;
	}

	.bottom-dock {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: max(8px, env(safe-area-inset-bottom));
		z-index: 100;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		/* The map stays clickable beside the boxes. */
		pointer-events: none;
	}
	.bottom-dock > * {
		pointer-events: auto;
	}

	.map-legal {
		padding: 0 0.6rem;
		background: rgba(5, 5, 5, 0.7);
		backdrop-filter: blur(8px);
		white-space: nowrap;
		border-radius: 14px;
	}

	.random-btn {
		background: #000;
		color: #fff;
		text-decoration: none;
		padding: 0.7rem 1.5rem;
		border-radius: 12px;
		font-weight: 900;
		font-size: 0.9rem;
		letter-spacing: 2px;
		border: 2px solid #f472b6;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		box-shadow: 0 0 25px rgba(244, 114, 182, 0.4);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.random-btn .icon {
		font-size: 1.2rem;
	}

	.random-btn:hover {
		transform: translateY(-5px) scale(1.05);
		border-color: #fff;
		letter-spacing: 3px;
		animation: btn-color-cycle 2s infinite linear;
	}

	@keyframes btn-color-cycle {
		0%,
		100% {
			border-color: #f472b6;
			box-shadow:
				0 0 25px #f472b6,
				0 0 45px rgba(244, 114, 182, 0.4);
		}
		25% {
			border-color: #2dd4bf;
			box-shadow:
				0 0 25px #2dd4bf,
				0 0 45px rgba(45, 212, 191, 0.4);
		}
		50% {
			border-color: #fb923c;
			box-shadow:
				0 0 25px #fb923c,
				0 0 45px rgba(251, 146, 60, 0.4);
		}
		75% {
			border-color: #a855f7;
			box-shadow:
				0 0 25px #a855f7,
				0 0 45px rgba(168, 85, 247, 0.4);
		}
	}

	/* The roulette button breathes: its glow sits on a pseudo-element whose
	   opacity animates (composited), not on the button's own box-shadow,
	   which would repaint the button over the map every frame. */
	.pulsing-laser {
		position: relative;
		isolation: isolate;
		animation: destiny-pulse 2s infinite;
	}
	.pulsing-laser::after {
		content: '';
		position: absolute;
		inset: -2px;
		z-index: -1;
		border-radius: inherit;
		box-shadow: 0 0 40px rgba(244, 114, 182, 0.7);
		opacity: 0;
		pointer-events: none;
		animation: destiny-glow 2s infinite;
	}

	@keyframes destiny-pulse {
		50% {
			transform: scale(1.02);
		}
	}
	@keyframes destiny-glow {
		50% {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulsing-laser,
		.pulsing-laser::after {
			animation: none;
		}
	}

	.map-container {
		width: 100%;
		height: 100%;
		flex: 1 1 auto;
		min-height: 0;
		transition: filter 0.5s ease;
	}

	/* Staging and Closed: a panel over the blurred map. */
	.phase-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 50;
		display: flex;
		/* Centred above the legal links; scrolls on very short screens. */
		padding: 2rem 1rem 5rem;
		overflow-y: auto;
		pointer-events: none;
	}

	.phase-panel {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: clamp(1.25rem, 4vw, 2rem);
		pointer-events: auto;
		background: rgba(0, 0, 0, 0.4);
		padding: clamp(1.25rem, 6vw, 3rem);
		border-radius: 24px;
		backdrop-filter: blur(2px);
		max-width: 100%;
	}

	/* The panel's gap spaces the ticket already. */
	.phase-panel :global(.pass-ticket) {
		margin-top: 0;
	}

	.phase-note {
		margin: 0;
		max-width: 22rem;
		text-align: center;
		font-size: 0.95rem;
		line-height: 1.5;
		color: #d4d4d4;
	}

	.special-needs-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0.5rem 1.25rem;
		border-radius: 12px;
		border: 1px solid #f472b6;
		background: rgba(10, 10, 10, 0.85);
		color: #f9a8d4;
		font-weight: 800;
		text-align: center;
		text-decoration: none;
	}
	.special-needs-cta:hover,
	.special-needs-cta:focus-visible {
		background: #f472b6;
		color: #111;
	}

	.timer-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-width: 100%;
	}

	.laser-text {
		font-weight: 900;
		letter-spacing: 4px;
		text-shadow: 0 0 10px currentColor;
		margin: 0;
		font-size: 1rem;
	}

	.laser-text.pink {
		color: #f472b6;
	}

	.laser-text.closed {
		color: #e5e5e5;
	}

	.panel-button {
		background: #111;
		border: 2px solid #2dd4bf;
		color: #2dd4bf;
		padding: 1rem 2rem;
		font-weight: 900;
		letter-spacing: 2px;
		border-radius: 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 1rem;
		transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		box-shadow: 0 0 20px rgba(45, 212, 191, 0.3);
		position: relative;
		overflow: hidden;
	}

	.panel-button:hover {
		background: #2dd4bf;
		color: #111;
		transform: scale(1.05);
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.6);
	}

	.panel-button:active {
		transform: scale(0.95);
	}

	.panel-button.smashed {
		animation: shake 0.1s infinite;
		border-color: #f472b6;
		color: #f472b6;
		box-shadow: 0 0 40px rgba(244, 114, 182, 0.8);
	}

	.warning-text {
		position: absolute;
		bottom: 2px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.65rem;
		white-space: nowrap;
		color: #f472b6;
		animation: pulse 0.5s infinite;
	}

	@keyframes shake {
		0% {
			transform: translate(2px, 2px) rotate(0deg);
		}
		25% {
			transform: translate(-2px, -2px) rotate(1deg);
		}
		50% {
			transform: translate(2px, -2px) rotate(-1deg);
		}
		75% {
			transform: translate(-2px, 2px) rotate(0deg);
		}
		100% {
			transform: translate(2px, 2px) rotate(0deg);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* Phones: the buttons get shorter. */
	@media (max-width: 640px) {
		.random-btn {
			font-size: 0.8rem;
			letter-spacing: 1.5px;
		}
		.panel-button {
			padding: 1rem 1.25rem;
		}
	}

	.loading {
		color: #2dd4bf;
		font-weight: 900;
		letter-spacing: 2px;
		text-transform: uppercase;
		display: flex;
		justify-content: center;
		align-items: center;
		height: 100%;
		text-shadow: 0 0 10px rgba(45, 212, 191, 0.5);
	}
</style>
