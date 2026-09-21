<script lang="ts">
	import { ownSpotNote } from '$lib/booking-phase';
	import { CHECKED_IN_NOTE } from '$lib/check-in';
	import BookingRulesNote from '$lib/components/BookingRulesNote.svelte';
	import NukeConfirm from '$lib/components/NukeConfirm.svelte';
	import { tick } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import SlotMachine from '$lib/components/SlotMachine.svelte';
	import SuccessFireworks from '$lib/components/SuccessFireworks.svelte';
	import type { PageData } from './$types';
	import { onDestroy } from 'svelte';
	import { fade, scale } from 'svelte/transition';

	export let data: PageData;
	$: ({ freeBeds, isBookingActive, userBed, spotFixed, checkedIn, phase, guestPhase } = data);

	// ☢ Nuke & Respin: the spot in the warning, and the one deleted for this
	// roll (the page says so until a new spot is booked).
	let nukeTarget: { id: string; label: string; roomName?: string; houseName?: string } | null =
		null;
	let nukedSpot: { id: string; label: string } | null = null;
	let freshSpots: Promise<void> = Promise.resolve();

	let isSpinning = false;
	let isBooking = false;
	let bookingError = '';
	let nameSelected = false;
	let selectedBed: any = null;
	let currentBedLabel = '???';
	let finalName = '';
	let showBookingSuccess = false;
	let slotMachineRef: SlotMachine;

	// Fireworks over the success card; their finale lights the card up for a moment.
	let showFireworks = false;
	let cardIgnite = false;
	let cardTimer: ReturnType<typeof setTimeout> | undefined;

	function igniteCard() {
		cardIgnite = true;
		clearTimeout(cardTimer);
		cardTimer = setTimeout(() => (cardIgnite = false), 1400);
	}

	onDestroy(() => clearTimeout(cardTimer));

	let bedIterations = 0;
	const maxBedIterations = 20; // Halved for snappier reveal
	let hasBedBeenSelected = false;

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';
	/** How long the nuke waits for the server before it gives up. */
	const NUKE_TIMEOUT_MS = 20000;

	function spinBed() {
		if (isSpinning || isBooking || freeBeds.length === 0) return;
		isSpinning = true;
		bookingError = '';
		nameSelected = false;
		hasBedBeenSelected = false;
		bedIterations = 0;
		showBookingSuccess = false;
		runBedSpin();
	}

	function runBedSpin() {
		if (freeBeds.length === 0) {
			isSpinning = false;
			return;
		}
		const randomIndex = Math.floor(Math.random() * freeBeds.length);
		selectedBed = freeBeds[randomIndex];
		currentBedLabel = selectedBed.label;
		bedIterations++;

		if (bedIterations < maxBedIterations) {
			setTimeout(runBedSpin, 40 + bedIterations * 4);
		} else {
			// Bed selected, show name section and roll for name
			hasBedBeenSelected = true;
			setTimeout(() => {
				slotMachineRef?.spin();
			}, 400); // Reduced anticipation delay
		}
	}

	function handleNameSelect(event: CustomEvent<string>) {
		finalName = event.detail;
		isSpinning = false;
		nameSelected = true;
	}

	function respinName() {
		if (isSpinning || isBooking) return;
		nameSelected = false;
		finalName = '';
		slotMachineRef?.spin();
	}

	/** Back to "roll the dice" with a fresh list of free spots. */
	async function resetMachine() {
		nameSelected = false;
		hasBedBeenSelected = false;
		selectedBed = null;
		currentBedLabel = '???';
		finalName = '';
		await invalidateAll();
	}

	function openNuke() {
		if (!userBed) return;
		nukeTarget = {
			id: userBed.id,
			label: userBed.label,
			roomName: userBed.roomName,
			houseName: userBed.houseName
		};
	}

	/**
	 * The warning's launch: deletes the booking right away. Resolves null once
	 * it is gone, else the message the warning shows. The free spots reload
	 * while the blast plays.
	 */
	async function nukeSpot(): Promise<string | null> {
		if (!nukeTarget) return null;
		const body = new FormData();
		// Only this spot: if the ticket holds another one by now, nothing is deleted.
		body.set('bedId', nukeTarget.id);
		// Bad reception must not leave the guest staring at "Launching…".
		const stop = new AbortController();
		const timer = setTimeout(() => stop.abort(), NUKE_TIMEOUT_MS);
		let result;
		try {
			const response = await fetch('?/releaseBed', {
				method: 'POST',
				body,
				cache: 'no-store',
				signal: stop.signal,
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			result = deserialize(await response.text());
		} catch {
			return stop.signal.aborted
				? 'The server did not answer. Reload the page and check whether your spot is still there.'
				: NO_CONNECTION;
		} finally {
			clearTimeout(timer);
		}
		if (result.type === 'failure') {
			return (
				(result.data as { error?: string } | undefined)?.error ||
				'Your spot could not be deleted. It is still yours.'
			);
		}
		if (result.type !== 'success') {
			return 'Your spot could not be deleted. It is still yours. Reload the page and try again.';
		}
		nukedSpot = { id: nukeTarget.id, label: nukeTarget.label };
		bookingError = '';
		freshSpots = invalidateAll().catch(() => {});
		return null;
	}

	/** The blast is over: roll a new spot from the fresh list of free ones. */
	async function afterNuke() {
		await freshSpots;
		nukeTarget = null;
		await tick();
		if (userBed) {
			// The spot is deleted, but the reload of the free spots failed: this
			// page still shows the old one, so ask for a reload instead of rolling.
			bookingError =
				'Your spot is deleted, but the free spots could not be loaded. Please reload the page, then roll the dice.';
			return;
		}
		spinBed();
	}
</script>

<svelte:head>
	<title>Destiny Roulette · CozyNights</title>
</svelte:head>

<div class="page-container">
	<div class="nav">
		<a href="/map" class="back-link">← Return to Map</a>
	</div>

	<div class="randomizer-box">
		<h1 class="laser-text pink">Luck of the Playa</h1>
		<p class="subtitle">Surrender to the dust. We'll find you a home.</p>

		{#if bookingError}
			<p class="error-msg" role="alert">{bookingError}</p>
		{/if}

		{#if nukedSpot && !userBed && !showBookingSuccess}
			<p class="nuked-note" role="status">
				☢ Spot {nukedSpot.label} is gone and you have no spot right now. Accept a new one before you leave.
			</p>
		{/if}

		{#if userBed && !showBookingSuccess}
			<div class="already-booked" in:fade>
				<span class="icon" aria-hidden="true">🏠</span>
				<p class="already-booked-title">You already have a home for the night</p>
				<div class="already-booked-card">
					<strong>{userBed.label}</strong>
					<span>{userBed.roomName} • {userBed.houseName}</span>
				</div>
				{#if checkedIn}
					<p class="hint">{CHECKED_IN_NOTE}</p>
				{:else if spotFixed}
					<p class="hint">
						The crew picked this spot for you because of your special-needs request, so only the
						crew can change it.
					</p>
				{:else if isBookingActive}
					<p class="hint">
						Feeling lucky? Nuke this spot and the roulette rolls you a new one. Your booking is
						deleted the moment you launch.
					</p>
				{:else}
					<p class="hint">{ownSpotNote(phase, guestPhase)}</p>
				{/if}
				<div class="already-booked-actions">
					<a href="/room/{userBed.roomId}" class="btn-goto">Visit My Room</a>
					{#if isBookingActive && !spotFixed && !checkedIn}
						<button type="button" class="nuke-btn" on:click={openNuke}>☢ Nuke &amp; Respin</button>
					{/if}
				</div>
			</div>
		{:else if !isBookingActive}
			<div class="empty-state">
				<span class="icon" aria-hidden="true">🔒</span>
				<p>
					{guestPhase === 'closed'
						? 'Booking is closed. The roulette is resting until the next burn.'
						: 'Booking is not open yet. Come back when Live Booking starts.'}
				</p>
			</div>
		{:else if freeBeds.length === 0 && !showBookingSuccess}
			<div class="empty-state">
				<span class="icon" aria-hidden="true">🏜️</span>
				<p>
					Every spot is taken right now. Check back later: a spot gets free again when someone
					releases theirs.
				</p>
			</div>
		{:else}
			<div class="machine-container">
				<div class="bed-display" class:spinning={isSpinning && !hasBedBeenSelected}>
					<div class="bed-label">
						<span class="prefix">SPOT</span>
						<span class="value" class:long={currentBedLabel.length > 5}>{currentBedLabel}</span>
					</div>
					{#if selectedBed && hasBedBeenSelected}
						<div class="bed-info" in:fade>
							{selectedBed.expand?.room?.name} • {selectedBed.expand?.room?.expand?.house?.name}
						</div>
					{/if}
					<div class="scan-line"></div>
				</div>

				{#if hasBedBeenSelected}
					<div class="name-section" in:fade={{ duration: 600 }}>
						<SlotMachine
							bind:this={slotMachineRef}
							autoSpin={false}
							showButton={false}
							on:select={handleNameSelect}
						/>
					</div>
				{/if}

				<!-- The confirm button is a real submit button (no requestSubmit(), which
				     older iOS Safari lacks). -->
				<form
					id="random-form"
					method="POST"
					action="?/bookRandom"
					use:enhance={() => {
						bookingError = '';
						isBooking = true;
						return async ({ result }) => {
							isBooking = false;
							if (result.type === 'success') {
								showBookingSuccess = true;
								showFireworks = true;
								await invalidateAll();
							} else if (result.type === 'failure') {
								bookingError =
									(result.data as { error?: string } | undefined)?.error ||
									'The booking did not go through. Please roll again.';
								// The spot is gone or the state changed: start over with fresh data.
								await resetMachine();
							} else if (result.type === 'error') {
								bookingError = NO_CONNECTION;
							}
						};
					}}
				>
					<input type="hidden" name="bedId" value={selectedBed?.id ?? ''} />
					<input type="hidden" name="guestName" value={finalName} />

					{#if nameSelected}
						<div class="selection-actions" in:fade>
							<button type="submit" class="confirm-btn" disabled={isBooking}>
								{isBooking ? 'BOOKING…' : 'Accept Fate & Book 🌵'}
							</button>
							<div class="respin-row">
								<button
									type="button"
									class="respin-btn secondary"
									on:click={respinName}
									disabled={isBooking}>New Name 🎲</button
								>
								<button
									type="button"
									class="respin-btn secondary"
									on:click={spinBed}
									disabled={isBooking}>Full Respin 🔥</button
								>
							</div>
						</div>
					{:else}
						<button type="button" class="main-spin-btn" on:click={spinBed} disabled={isSpinning}>
							{isSpinning ? 'CALCULATING FATE...' : 'ROLL THE DICE 🎲'}
						</button>
					{/if}
					<BookingRulesNote />
				</form>
			</div>
		{/if}
	</div>

	{#if nukeTarget}
		<NukeConfirm
			target={nukeTarget}
			launch={nukeSpot}
			on:abort={() => (nukeTarget = null)}
			on:done={afterNuke}
		/>
	{/if}

	{#if showBookingSuccess && selectedBed}
		<div class="success-overlay" in:fade>
			<div
				class="success-card"
				class:ignite={cardIgnite}
				in:scale
				role="dialog"
				aria-modal="true"
				aria-labelledby="fate-title"
			>
				<div class="sparkles" aria-hidden="true">✨✨✨</div>
				<h2 id="fate-title">Destiny Fulfilled!</h2>
				<p>You are now known as <strong>{finalName}</strong>.</p>
				<p>
					Your new home is spot <strong>{selectedBed.label}</strong> in
					<strong>{selectedBed.expand?.room?.name}</strong>
					({selectedBed.expand?.room?.expand?.house?.name}).
				</p>
				{#if nukedSpot}
					<p class="nuked-line">
						{nukedSpot.id === selectedBed.id
							? `Fate sent you straight back to spot ${nukedSpot.label}.`
							: `Spot ${nukedSpot.label} is history.`}
					</p>
				{/if}
				<div class="actions">
					<a href="/room/{selectedBed.room}" class="btn-goto">Visit My Room</a>
					<a href="/map" class="btn-map">Back to Map</a>
				</div>
			</div>
		</div>
		{#if showFireworks}
			<SuccessFireworks
				zIndex={1001}
				on:finale={igniteCard}
				on:done={() => (showFireworks = false)}
			/>
		{/if}
	{/if}
</div>

<style>
	.page-container {
		min-height: 100vh;
		min-height: 100dvh;
		background: #050505;
		color: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		font-family: 'Inter', sans-serif;
	}

	.nav {
		width: 100%;
		max-width: 800px;
		margin-bottom: clamp(0.75rem, 4vw, 2rem);
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding-right: 0.75rem;
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.randomizer-box {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: clamp(20px, 6vw, 32px);
		padding: clamp(1.25rem, 6vw, 4rem);
		width: 100%;
		max-width: 600px;
		text-align: center;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
		border-top: 4px solid #f472b6;
	}

	.laser-text {
		font-size: clamp(1.6rem, 8vw, 2.5rem);
		line-height: 1.15;
		font-weight: 900;
		margin: 0;
		letter-spacing: -1px;
		text-transform: uppercase;
	}
	.laser-text.pink {
		color: #f472b6;
		text-shadow: 0 0 20px rgba(244, 114, 182, 0.4);
	}

	.subtitle {
		color: #a3a3a3;
		margin: 0.5rem 0 clamp(1.5rem, 6vw, 3rem) 0;
		font-weight: 500;
	}

	.error-msg {
		margin: 0 0 1.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid #f87171;
		border-radius: 12px;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
		font-weight: 600;
		line-height: 1.45;
		text-align: left;
		overflow-wrap: anywhere;
	}

	.machine-container,
	.machine-container form {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 5vw, 2rem);
	}

	.bed-display {
		background: #000;
		border: 2px solid #333;
		border-radius: 20px;
		padding: clamp(1.25rem, 5vw, 2rem);
		position: relative;
		overflow: hidden;
		transition: all 0.3s;
	}
	.bed-display.spinning {
		border-color: #2dd4bf;
		box-shadow: 0 0 40px rgba(45, 212, 191, 0.2);
	}

	.bed-label {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.bed-label .prefix {
		font-size: 0.75rem;
		font-weight: 900;
		color: #8a8a8a;
		letter-spacing: 4px;
	}
	.bed-label .value {
		font-size: clamp(2.5rem, 14vw, 4.5rem);
		line-height: 1.1;
		font-weight: 900;
		font-family: 'JetBrains Mono', monospace;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	/* Spot labels can be whole phrases ("Upper Deck Window Side Left"). */
	.bed-label .value.long {
		font-size: clamp(1.25rem, 6vw, 2rem);
		min-height: 2.2em;
		display: flex;
		align-items: center;
	}

	.bed-info {
		margin-top: 1rem;
		color: #2dd4bf;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
		overflow-wrap: anywhere;
	}

	.scan-line {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 2px;
		background: rgba(45, 212, 191, 0.5);
		box-shadow: 0 0 10px #2dd4bf;
		animation: scan 2s linear infinite;
		opacity: 0;
	}
	.spinning .scan-line {
		opacity: 1;
	}

	@keyframes scan {
		0% {
			top: 0;
		}
		100% {
			top: 100%;
		}
	}

	.name-section {
		margin-top: 1rem;
	}

	.main-spin-btn {
		background: linear-gradient(135deg, #f472b6, #a855f7);
		border: none;
		color: #fff;
		padding: clamp(1.1rem, 4vw, 1.5rem);
		border-radius: 16px;
		font-size: clamp(1rem, 4.5vw, 1.2rem);
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 10px 20px rgba(244, 114, 182, 0.3);
	}
	.main-spin-btn:hover:not(:disabled) {
		transform: translateY(-4px);
		box-shadow: 0 15px 30px rgba(244, 114, 182, 0.5);
	}
	.main-spin-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.selection-actions {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.confirm-btn {
		background: #2dd4bf;
		color: #000;
		border: none;
		padding: 1.2rem 0.75rem;
		border-radius: 16px;
		font-size: clamp(0.95rem, 4.2vw, 1.1rem);
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.confirm-btn:disabled,
	.respin-btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.confirm-btn:hover {
		transform: scale(1.02);
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.4);
	}

	.respin-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.respin-btn {
		flex: 1 1 130px;
		min-height: 48px;
		background: #111;
		border: 2px solid #444;
		color: #b5b5b5;
		padding: 1rem 0.5rem;
		border-radius: 12px;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		text-transform: uppercase;
		font-size: 0.8rem;
	}
	.respin-btn:hover {
		border-color: #666;
		color: #fff;
	}

	/* Success Overlay */
	.success-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.9);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 1000;
		backdrop-filter: blur(10px);
	}
	.success-card {
		background: #0a0a0a;
		border: 2px solid #2dd4bf;
		border-radius: clamp(24px, 8vw, 40px);
		padding: clamp(1.5rem, 7vw, 4rem);
		text-align: center;
		width: 100%;
		max-width: 500px;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		box-shadow: 0 0 100px rgba(45, 212, 191, 0.3);
	}
	.sparkles {
		font-size: clamp(2rem, 9vw, 3rem);
		margin-bottom: 1rem;
	}
	/* The finale of the fireworks lights the card up for a moment. */
	.success-card.ignite {
		animation: card-ignite 1.4s ease-out;
	}

	@keyframes card-ignite {
		0% {
			border-color: #2dd4bf;
			box-shadow: 0 0 100px rgba(45, 212, 191, 0.3);
			transform: scale(1);
		}
		18% {
			border-color: #ffd27a;
			box-shadow:
				0 0 80px rgba(251, 146, 60, 0.6),
				0 0 160px rgba(255, 210, 122, 0.35);
			transform: scale(1.012);
		}
		100% {
			border-color: #2dd4bf;
			box-shadow: 0 0 100px rgba(45, 212, 191, 0.3);
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.success-card.ignite {
			animation: none;
		}
	}

	.success-card h2 {
		font-size: clamp(1.6rem, 8vw, 2.5rem);
		line-height: 1.15;
		font-weight: 900;
		color: #2dd4bf;
		margin-bottom: 1.5rem;
	}
	.success-card p {
		color: #b5b5b5;
		margin-bottom: 1rem;
		font-size: 1.05rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.success-card strong {
		color: #fff;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: clamp(1.5rem, 6vw, 3rem);
	}
	.actions a,
	.already-booked-actions .btn-goto {
		flex: 1 1 140px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.9rem 1rem;
		border-radius: 12px;
		font-weight: 900;
		text-align: center;
		text-decoration: none;
		transition: all 0.2s;
	}
	.btn-goto {
		background: #2dd4bf;
		color: #000;
	}
	.btn-map {
		background: transparent;
		border: 1px solid #444;
		color: #b5b5b5;
	}
	.btn-goto:hover {
		transform: scale(1.05);
	}

	.empty-state {
		padding: clamp(1.5rem, 8vw, 4rem) 0;
		color: #c4c4c4;
		line-height: 1.5;
	}
	.empty-state .icon {
		font-size: 4rem;
		display: block;
		margin-bottom: 1rem;
	}

	.already-booked {
		padding: 2rem 0;
		text-align: center;
	}
	.already-booked .icon {
		font-size: 3.5rem;
		display: block;
		margin-bottom: 1rem;
	}
	.already-booked-title {
		color: #fff;
		font-weight: 900;
		font-size: 1.1rem;
		margin: 0 0 1.5rem 0;
	}
	.already-booked-card {
		background: #000;
		border: 2px solid #2dd4bf;
		border-radius: 16px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		box-shadow: 0 0 30px rgba(45, 212, 191, 0.15);
	}
	.already-booked-card strong {
		font-size: 1.5rem;
		color: #2dd4bf;
	}
	.already-booked-card span {
		color: #a3a3a3;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		overflow-wrap: anywhere;
	}
	.already-booked-card strong {
		overflow-wrap: anywhere;
	}
	.already-booked .hint {
		color: #a3a3a3;
		font-size: 0.9rem;
		line-height: 1.45;
		margin: 1.5rem 0 0 0;
	}
	.already-booked-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}

	/* ☢ Nuke & Respin: hazard stripes, it deletes the booking. */
	.nuke-btn {
		flex: 1 1 140px;
		min-height: 48px;
		padding: 0.9rem 1rem;
		border-radius: 12px;
		border: 2px solid #ef4444;
		background:
			repeating-linear-gradient(-45deg, rgba(250, 204, 21, 0.16) 0 10px, transparent 10px 20px),
			#1a0505;
		color: #fecaca;
		font-weight: 900;
		letter-spacing: 1px;
		text-transform: uppercase;
		cursor: pointer;
	}
	.nuke-btn:hover {
		color: #fff;
		box-shadow: 0 0 24px rgba(239, 68, 68, 0.45);
	}
	.nuke-btn:focus-visible {
		outline: 3px solid #facc15;
		outline-offset: 3px;
	}

	.nuked-note {
		margin: 0 0 1.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid #ef4444;
		border-left-width: 4px;
		border-radius: 12px;
		background: rgba(239, 68, 68, 0.1);
		color: #fecaca;
		font-weight: 700;
		line-height: 1.45;
		text-align: left;
		overflow-wrap: anywhere;
	}
	.success-card .nuked-line {
		color: #fca5a5;
		font-weight: 700;
	}
</style>
