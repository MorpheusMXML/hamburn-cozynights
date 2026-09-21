<script lang="ts" module>
	/** Closed: once a guest looked around, back from a house the panel stays away. */
	let lookedAround = false;
</script>

<script lang="ts">
	import type { PageData } from './$types';
	import Map from '$lib/components/Map.svelte';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import PassTicket from '$lib/components/PassTicket.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	export let data: PageData;
	$: ({ houses, isBookingActive, phase, bookingUnlockAt } = data);

	// Closed: a panel like the one in Staging covers the blurred map until
	// the guest wants to look around (houses still open, read-only).
	let lookingAround = lookedAround;
	$: closedPanel = phase === 'closed' && !lookingAround;

	function lookAround() {
		lookingAround = lookedAround = true;
	}

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

<div class="page-container">
	<div class="header-overlay">
		<div class="logo-box">
			<span class="logo">Hamburn</span>
			<span class="tagline">Interactive Map</span>
		</div>

		<!-- The words in .long go on the smallest phones: the header must stay one row. -->
		{#if phase === 'live'}
			<div class="phase-badge live">🎪 LIVE <span class="long">BOOKING</span></div>
		{:else if phase === 'closed'}
			<div class="phase-badge closed">🔒 <span class="long">BOOKING</span> CLOSED</div>
		{:else}
			<div class="phase-badge staging">🛠 STAGING <span class="long">MODE</span></div>
		{/if}

		<div class="header-right">
			<div class="debug-counter">
				SENSORS: {houses?.length || 0}
			</div>
			{#if phase !== 'staging' && (data.specialNeeds.open || data.specialNeeds.requestSent)}
				<a
					class="help-link special-link"
					href="/special-needs"
					aria-label={data.specialNeeds.requestSent
						? 'My special-needs request'
						: 'Ask for a special-needs spot'}
				>
					<span class="help-icon" aria-hidden="true">♿</span>
					<span class="help-text"
						>{data.specialNeeds.requestSent ? 'My request' : 'Special-needs spot'}</span
					>
				</a>
			{/if}
			<a
				class="help-link"
				href="/docs/guide/"
				target="_blank"
				rel="noopener"
				aria-label="Help and FAQ (opens in a new tab)"
			>
				<span class="help-icon" aria-hidden="true">?</span>
				<span class="help-text">Help &amp; FAQ</span>
			</a>
		</div>
	</div>

	{#if data.houses}
		<div class="map-container">
			<Map
				houses={data.houses}
				isEditorMode={false}
				isBookingActive={data.isBookingActive}
				phase={data.phase}
				dimmed={closedPanel}
			/>
		</div>
	{:else}
		<div class="loading">Igniting Sensors...</div>
	{/if}

	{#if phase === 'staging'}
		<div class="phase-overlay">
			<div class="phase-panel">
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

				{#if data.specialNeeds.requestSent}
					<a class="special-needs-cta" href="/special-needs">
						<span aria-hidden="true">♿</span> See your special-needs request
					</a>
				{:else if data.specialNeeds.open}
					<a class="special-needs-cta" href="/special-needs">
						<span aria-hidden="true">♿</span> Need a special-needs spot? Ask the crew now
					</a>
				{/if}

				<button class="panel-button" class:smashed={isShaking} on:click={handleReloadSensors}>
					<span class="icon">📡</span>
					RELOAD SENSORS
					{#if clickCount > 5}
						<span class="warning-text">CALIBRATING INTENSELY!</span>
					{/if}
				</button>
			</div>
		</div>
	{:else if closedPanel}
		<div class="phase-overlay">
			<div class="phase-panel">
				<h2 class="laser-text closed">BOOKING CLOSED</h2>

				<p class="phase-note">
					Spots are final now: nothing can be booked, changed or released anymore.
					{#if data.noSpot}Your ticket holds no spot. If you need one, please contact the crew.{/if}
				</p>

				{#if data.pass}
					<PassTicket pass={data.pass} />
				{/if}

				{#if data.specialNeeds.requestSent}
					<a class="special-needs-cta" href="/special-needs">
						<span aria-hidden="true">♿</span> See your special-needs request
					</a>
				{/if}

				<button class="panel-button" on:click={lookAround}>
					<span class="icon">🗺️</span>
					LOOK AROUND
				</button>
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
	}

	.header-overlay {
		position: absolute;
		top: 20px;
		left: 20px;
		right: 20px;
		z-index: 100;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.75rem;
		pointer-events: none;
	}

	.logo-box {
		justify-self: start;
	}

	.header-right {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.help-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0 0.9rem;
		border-radius: 8px;
		border: 1px solid #333;
		background: rgba(10, 10, 10, 0.8);
		color: #b5b5b5;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		text-decoration: none;
		white-space: nowrap;
		pointer-events: auto;
		backdrop-filter: blur(10px);
	}

	.help-link:hover,
	.help-link:focus-visible {
		color: #fff;
		border-color: #2dd4bf;
	}

	.help-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		border: 1px solid currentColor;
		font-size: 0.8rem;
	}

	.debug-counter {
		background: rgba(10, 10, 10, 0.8);
		border: 1px solid #333;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		color: #8a8a8a;
		font-size: 0.7rem;
		font-weight: 900;
		letter-spacing: 1px;
		white-space: nowrap;
		backdrop-filter: blur(10px);
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

	.pulsing-laser {
		animation: destiny-pulse 2s infinite;
	}

	@keyframes destiny-pulse {
		0%,
		100% {
			box-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
			transform: scale(1);
		}
		50% {
			box-shadow: 0 0 40px rgba(244, 114, 182, 0.7);
			transform: scale(1.02);
		}
	}

	.logo-box {
		background: rgba(10, 10, 10, 0.9);
		padding: 1rem 1.5rem;
		border-radius: 12px;
		border: 1px solid #333;
		display: flex;
		flex-direction: column;
		pointer-events: auto;
		backdrop-filter: blur(10px);
		box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
	}

	.logo {
		font-size: 1.5rem;
		font-weight: 900;
		letter-spacing: -1px;
		background: linear-gradient(to right, #2dd4bf, #f472b6);
		background-clip: text;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		text-transform: uppercase;
	}

	.tagline {
		font-size: 0.65rem;
		font-weight: 900;
		color: #8a8a8a;
		letter-spacing: 2px;
		text-transform: uppercase;
	}

	.phase-badge {
		background: #111;
		color: #666;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-weight: 900;
		font-size: 0.7rem;
		letter-spacing: 1px;
		border: 1px solid #222;
		white-space: nowrap;
		pointer-events: auto;
		backdrop-filter: blur(10px);
	}

	.phase-badge.live {
		color: #f472b6;
		border-color: #f472b633;
		box-shadow: 0 0 15px rgba(244, 114, 182, 0.2);
	}

	.phase-badge.staging {
		color: #2dd4bf;
		border-color: #2dd4bf33;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.2);
	}

	.phase-badge.closed {
		color: #d4d4d4;
		border-color: #ffffff26;
		box-shadow: 0 0 15px rgba(255, 255, 255, 0.08);
	}

	.map-container {
		width: 100%;
		height: 100%;
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
		/* Centred between the header and the legal links; scrolls on very short screens. */
		padding: 6rem 1rem 5rem;
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

	.special-link {
		border-color: #f472b6;
		color: #f9a8d4;
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

	/* The header boxes never wrap; below these widths they don't fit next to
	   each other any more (checked by tests/layout at every width). First the
	   house counter (a gimmick) goes, then the links lose their text. */
	@media (max-width: 1200px) {
		.debug-counter {
			display: none;
		}
	}
	@media (max-width: 920px) {
		.help-text {
			display: none;
		}
		.help-link {
			width: 44px;
			padding: 0;
			justify-content: center;
			border-radius: 50%;
		}
	}

	/* Phones: the logo shrinks, the phase badge gets shorter. */
	@media (max-width: 640px) {
		.header-overlay {
			top: 12px;
			left: 12px;
			right: 12px;
			gap: 0.5rem;
			grid-template-columns: auto 1fr auto;
		}
		.logo-box {
			padding: 0.5rem 0.75rem;
		}
		.logo {
			font-size: 1.1rem;
		}
		.tagline {
			display: none;
		}
		.phase-badge {
			justify-self: center;
			padding: 0.5rem 0.6rem;
			font-size: 0.65rem;
		}
		.random-btn {
			font-size: 0.8rem;
			letter-spacing: 1.5px;
		}
		.panel-button {
			padding: 1rem 1.25rem;
		}
	}
	@media (max-width: 420px) {
		.phase-badge .long {
			display: none;
		}
		.header-right {
			gap: 0.5rem;
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
