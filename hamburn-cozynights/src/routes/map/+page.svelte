<script lang="ts">
	import type { PageData } from './$types';
	import Map from '$lib/components/Map.svelte';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	export let data: PageData;
	$: ({ houses, isBookingActive, bookingUnlockAt } = data);

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

		{#if isBookingActive}
			<div class="phase-badge live">🎪 LIVE BOOKING</div>
		{:else}
			<div class="phase-badge staging">🛠 STAGING MODE</div>
		{/if}

		<div class="header-right">
			<div class="debug-counter">
				SENSORS: {houses?.length || 0}
			</div>
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
			<Map houses={data.houses} isEditorMode={false} isBookingActive={data.isBookingActive} />
		</div>

		{#if isBookingActive}
			<div class="floating-action-bar">
				<a href="/random-bed" class="random-btn pulsing-laser">
					<span class="icon">🎰</span>
					DESTINY ROULETTE
				</a>
			</div>
		{/if}
	{:else}
		<div class="loading">Igniting Sensors...</div>
	{/if}

	{#if !isBookingActive}
		<div class="staging-overlay">
			<div class="staging-center-content">
				{#if bookingUnlockAt}
					<div class="timer-wrapper">
						<h2 class="laser-text pink">IGNITION IN</h2>
						<CountdownTimer targetDate={bookingUnlockAt} on:elapsed={() => invalidateAll()} />
					</div>
				{/if}

				<p class="staging-note">
					Booking is not open yet. {bookingUnlockAt
						? 'This page unlocks by itself when the countdown ends.'
						: 'The crew is still setting up the houses. Check back soon.'}
				</p>

				<button class="reload-button" class:smashed={isShaking} on:click={handleReloadSensors}>
					<span class="icon">📡</span>
					RELOAD SENSORS
					{#if clickCount > 5}
						<span class="warning-text">CALIBRATING INTENSELY!</span>
					{/if}
				</button>
			</div>
		</div>
	{/if}
	<div class="map-legal"><SiteFooter compact /></div>
</div>

<style>
	.page-container {
		width: 100%;
		height: 100vh;
		height: 100dvh;
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

	.map-legal {
		position: absolute;
		left: 50%;
		bottom: max(8px, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 100;
		padding: 0 0.6rem;
		border-radius: 999px;
		background: rgba(5, 5, 5, 0.7);
		backdrop-filter: blur(8px);
		white-space: nowrap;
		border-radius: 14px;
	}

	.floating-action-bar {
		position: absolute;
		/* Above the legal links row. */
		bottom: calc(max(8px, env(safe-area-inset-bottom)) + 36px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		pointer-events: auto;
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

	.map-container {
		width: 100%;
		height: 100%;
		transition: filter 0.5s ease;
	}

	.staging-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		z-index: 50;
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 0 1rem;
		pointer-events: none;
	}

	.staging-center-content {
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

	.staging-note {
		margin: 0;
		max-width: 22rem;
		text-align: center;
		font-size: 0.95rem;
		line-height: 1.5;
		color: #d4d4d4;
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

	.reload-button {
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

	.reload-button:hover {
		background: #2dd4bf;
		color: #111;
		transform: scale(1.05);
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.6);
	}

	.reload-button:active {
		transform: scale(0.95);
	}

	.reload-button.smashed {
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

	/* Phones: the three header boxes don't fit next to each other. The logo
	   shrinks, the house counter (a gimmick) goes, help becomes a round "?". */
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
		.debug-counter,
		.help-text {
			display: none;
		}
		.help-link {
			width: 44px;
			padding: 0;
			justify-content: center;
			border-radius: 50%;
		}
		.random-btn {
			font-size: 0.8rem;
			letter-spacing: 1.5px;
		}
		.reload-button {
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
