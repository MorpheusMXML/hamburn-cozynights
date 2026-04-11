<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { PageData, ActionData } from './$types';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import SlotMachine from '$lib/components/SlotMachine.svelte';

	export let data: PageData;
	export let form: ActionData;

	// Modal State
	let showModal = false;
	let selectedBedId: string | null = null;
	let currentNameInput = '';
	let slotMachineRef: SlotMachine;
	let formElement: HTMLFormElement;
	let isAutoSpinning = false;
	let showSlotManually = false;
	let nameGenerated = false;
	let triggerFireworks = false;

	function openBookingModal(bedId: string, existingName?: string) {
		selectedBedId = bedId;
		currentNameInput = existingName || '';
		showModal = true;
		showSlotManually = false;
		isAutoSpinning = false;
		nameGenerated = false;
	}

	function closeModal() {
		showModal = false;
		selectedBedId = null;
		showSlotManually = false;
		isAutoSpinning = false;
		nameGenerated = false;
	}

	function handleBackdropKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeModal();
	}

	function handleSlotSelect(event: CustomEvent<string>) {
		currentNameInput = event.detail;
		if (isAutoSpinning) {
			nameGenerated = true;
		}
	}

	function respinName() {
		nameGenerated = false;
		currentNameInput = '';
		if (slotMachineRef) slotMachineRef.spin();
	}

	function cancelSlotSelection() {
		showSlotManually = false;
		isAutoSpinning = false;
		nameGenerated = false;
		currentNameInput = '';
	}

	async function handleFormSubmit(event: SubmitEvent) {
		const submitter = event.submitter as HTMLButtonElement;
		if (submitter?.formAction?.includes('unbookBed')) return;

		if (!currentNameInput || currentNameInput.trim() === '') {
			event.preventDefault();
			showSlotManually = true;
			isAutoSpinning = true;
			nameGenerated = false;
			await tick();
			if (slotMachineRef) slotMachineRef.spin();
		}
	}
</script>

<div class="container">
	<header>
		<div class="header-nav">
			<a href="/house/{data.room.house}" class="back-link">← Back to House</a>
			{#if !data.isBookingActive && data.bookingUnlockAt}
				<div class="timer-mini">
					<CountdownTimer targetDate={data.bookingUnlockAt} />
				</div>
			{/if}
		</div>
		<h1>{data.room.name} <small>#{data.room.room_number}</small></h1>
	</header>

	{#if !data.isBookingActive}
		<div class="booking-locked-banner">
			<div class="locked-icon">🎪</div>
			<div class="locked-content">
				<h3>Bookings open soon!</h3>
				<p>
					The Hamburn house is currently in the Staging Mode phase. Come back when the playa
					ignites! 🔥
				</p>
			</div>
		</div>
	{/if}

	{#if data.userBedId}
		{@const myBed = data.beds.find((b) => b.id === data.userBedId)}
		{#if !myBed}
			<div class="booking-warning-banner">
				<div class="warning-icon">⚠️</div>
				<div class="warning-content">
					<h3>You already have a booking!</h3>
					<p>
						You have already secured a spot in another room. To choose a new bed here, you must
						release your current reservation first.
					</p>
					{#if form?.error}
						<p class="error-msg">{form.error}</p>
					{/if}
					<form method="POST" action="?/unbookBed" use:enhance>
						<button type="submit" class="btn-unbook-banner">Release Current Spot</button>
					</form>
				</div>
			</div>
		{:else}
			<div class="booking-success-banner">
				<div class="success-icon">✨</div>
				<div class="success-content">
					<h3>Welcome Home!</h3>
					<p>You have successfully reserved bed <strong>{myBed.label}</strong> in this house.</p>
				</div>
			</div>
		{/if}
	{/if}

	<div class="beds-grid">
		{#each data.beds as bed}
			{@const isMyBed = bed.id === data.userBedId}
			{@const someoneElseBooked = bed.occupied && !isMyBed}
			{@const iHaveAnotherBooking = !!data.userBedId && !isMyBed}
			{@const isLocked = !data.isBookingActive}

			{#if someoneElseBooked}
				<div class="bed-card occupied">
					<div class="icon">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box occupied">
						<span class="status-text">Occupied</span>
						<span class="guest-name">
							{bed.expand?.order?.burner_name || 'Mystery Burner'}
						</span>
					</div>
				</div>
			{:else if isMyBed}
				<button
					class="bed-card mine {isLocked ? 'locked' : ''}"
					on:click={() => !isLocked && openBookingModal(bed.id, bed.expand?.order?.burner_name)}
					disabled={isLocked}
				>
					<div class="icon">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box my-status">
						<span class="status-text">Your Spot</span>
						<span class="guest-name">{bed.expand?.order?.burner_name}</span>
					</div>
					<small class="edit-hint">{isLocked ? 'Bookings Locked' : 'Click to modify'}</small>
				</button>
			{:else}
				<button
					class="bed-card free {iHaveAnotherBooking || isLocked ? 'disabled' : ''}"
					on:click={() => !iHaveAnotherBooking && !isLocked && openBookingModal(bed.id)}
					disabled={iHaveAnotherBooking || isLocked}
				>
					<div class="icon">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box free">
						<span>{isLocked ? 'Locked' : iHaveAnotherBooking ? 'Locked' : 'Available'}</span>
						<small
							>{isLocked
								? 'Phase: Staging Mode'
								: iHaveAnotherBooking
									? 'Release other spot first'
									: 'Grab it now!'}</small
						>
					</div>
				</button>
			{/if}
		{/each}
	</div>
</div>

{#if showModal}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="modal-backdrop" on:click={closeModal} role="presentation">
		<div class="modal" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="-1">
			<h2>{selectedBedId === data.userBedId ? 'Edit Your Spot' : 'Grab This Spot'}</h2>
			<p>Set your Burner Name (optional).</p>

			{#if form?.error}
				<div class="modal-error-banner">
					{form.error}
				</div>
			{/if}

			{#if showSlotManually}
				<SlotMachine bind:this={slotMachineRef} showButton={false} on:select={handleSlotSelect} />
			{/if}

			<form
				bind:this={formElement}
				id="booking-form"
				method="POST"
				action="?/bookBed"
				on:submit={handleFormSubmit}
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success' && (result.data as any)?.success) {
							triggerFireworks = true;
							setTimeout(() => {
								triggerFireworks = false;
							}, 5000);
							closeModal();
						}
						await update();
					};
				}}
			>
				<input type="hidden" name="bedId" value={selectedBedId} />

				<div class="form-group" class:hidden={showSlotManually}>
					<label for="guestName">Burner Name</label>
					<input
						type="text"
						name="guestName"
						id="guestName"
						bind:value={currentNameInput}
						placeholder="Leave empty for a surprise! 🎰"
					/>
				</div>

				{#if showSlotManually}
					<div class="slot-actions" in:fade>
						{#if nameGenerated}
							<div class="respin-row">
								<button type="button" class="btn-respin" on:click={respinName}>New Name 🎲</button>
								<button type="button" class="btn-cancel" on:click={cancelSlotSelection}
									>Cancel</button
								>
							</div>
							<button type="submit" class="btn-confirm-fate">Accept Fate & Book 🌵</button>
						{:else}
							<p class="auto-spin-hint">Rolling for your burner identity...</p>
						{/if}
					</div>
				{:else}
					<div class="actions">
						{#if selectedBedId === data.userBedId}
							<button type="submit" formaction="?/unbookBed" class="btn-unbook">Release</button>
						{/if}
						<button type="button" class="btn-cancel" on:click={closeModal}>Cancel</button>
						<button type="submit" class="btn-confirm">Save Spot</button>
					</div>
				{/if}
			</form>
		</div>
	</div>
{/if}

{#if triggerFireworks}
	<div class="fireworks-overlay" in:fade={{ duration: 1000 }} out:fade={{ duration: 1000 }}>
		<div class="pixel-fireworks">
			{#each Array(12) as _, i}
				<div
					class="firework"
					style="--left: {Math.random() * 100}%; --top: {Math.random() *
						80}%; --delay: {Math.random() * 2}s; --color: {[
						'#f472b6',
						'#2dd4bf',
						'#fb923c',
						'#a855f7'
					][Math.floor(Math.random() * 4)]}"
				></div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.container {
		max-width: 1000px;
		margin: 0 auto;
		padding: 2rem;
		color: #fff;
	}

	header {
		margin-bottom: 3rem;
	}
	.header-nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	.back-link {
		color: #2dd4bf;
		text-decoration: none;
		font-weight: 900;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 1px;
	}
	.back-link:hover {
		color: #fff;
	}

	.timer-mini {
		background: rgba(0, 0, 0, 0.5);
		padding: 0.5rem 1rem;
		border-radius: 99px;
		border: 1px solid #222;
	}

	h1 {
		font-size: 3.5rem;
		font-weight: 900;
		margin: 0;
		letter-spacing: -2px;
	}
	h1 small {
		color: #444;
		font-family: 'JetBrains Mono', monospace;
		font-size: 1.5rem;
		margin-left: 0.5rem;
	}

	.booking-locked-banner {
		background: #111;
		border: 1px solid #222;
		border-left: 4px solid #f472b6;
		padding: 2rem;
		border-radius: 20px;
		margin-bottom: 3rem;
		display: flex;
		align-items: center;
		gap: 2rem;
	}
	.locked-icon {
		font-size: 2.5rem;
	}
	.locked-content h3 {
		margin: 0;
		font-weight: 900;
		color: #f472b6;
	}
	.locked-content p {
		margin: 0.5rem 0 0 0;
		color: #666;
		font-size: 0.9rem;
	}

	.booking-warning-banner {
		background: #111;
		border: 1px solid #222;
		border-left: 4px solid #fb923c;
		padding: 2rem;
		border-radius: 20px;
		margin-bottom: 3rem;
		display: flex;
		align-items: center;
		gap: 2rem;
	}
	.warning-icon {
		font-size: 2.5rem;
	}
	.warning-content h3 {
		margin: 0;
		font-weight: 900;
		color: #fb923c;
	}
	.warning-content p {
		margin: 0.5rem 0 0 0;
		color: #666;
		font-size: 0.9rem;
	}
	.error-msg {
		color: #f87171;
		font-weight: bold;
		margin-top: 1rem;
		font-size: 0.8rem;
	}
	.btn-unbook-banner {
		background: #fb923c;
		border: none;
		color: #000;
		padding: 0.8rem 1.5rem;
		border-radius: 10px;
		font-weight: 900;
		cursor: pointer;
		margin-top: 1.5rem;
	}

	.booking-success-banner {
		background: #111;
		border: 1px solid #222;
		border-left: 4px solid #2dd4bf;
		padding: 2rem;
		border-radius: 20px;
		margin-bottom: 3rem;
		display: flex;
		align-items: center;
		gap: 2rem;
	}
	.success-icon {
		font-size: 2.5rem;
	}
	.success-content h3 {
		margin: 0;
		font-weight: 900;
		color: #2dd4bf;
	}
	.success-content p {
		margin: 0.5rem 0 0 0;
		color: #666;
		font-size: 0.9rem;
	}

	.beds-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.5rem;
	}

	.bed-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 1.5rem;
		display: flex;
		align-items: center;
		gap: 1.5rem;
		text-align: left;
		transition: all 0.2s;
		position: relative;
		overflow: hidden;
	}
	.bed-card.mine {
		border-color: #2dd4bf;
		background: rgba(45, 212, 191, 0.05);
		cursor: pointer;
	}
	.bed-card.mine:hover {
		transform: translateY(-3px);
		box-shadow: 0 10px 20px rgba(45, 212, 191, 0.1);
	}
	.bed-card.free {
		cursor: pointer;
	}
	.bed-card.free:hover:not(.disabled) {
		border-color: #f472b6;
		transform: translateY(-3px);
		box-shadow: 0 10px 20px rgba(244, 114, 182, 0.1);
	}
	.bed-card.disabled {
		opacity: 0.5;
		cursor: not-allowed;
		filter: grayscale(1);
	}
	.bed-card.occupied {
		opacity: 0.7;
	}
	.bed-card.locked {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.icon {
		font-size: 1.5rem;
	}
	.label {
		font-weight: 900;
		font-size: 1.25rem;
		flex: 1;
	}

	.status-box {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.status-text {
		font-size: 0.6rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #666;
	}
	.guest-name {
		font-weight: bold;
		font-size: 0.9rem;
		color: #fff;
	}
	.my-status .status-text {
		color: #2dd4bf;
	}
	.free span {
		font-weight: 900;
		color: #f472b6;
		font-size: 0.8rem;
	}
	.free small {
		font-size: 0.6rem;
		color: #666;
	}

	.edit-hint {
		position: absolute;
		bottom: 8px;
		right: 12px;
		font-size: 0.5rem;
		color: #444;
		font-weight: 900;
		text-transform: uppercase;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(15px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}
	.modal {
		background: #000;
		border: 1px solid #222;
		border-top: 4px solid #f472b6;
		border-radius: 32px;
		padding: 3rem;
		width: 100%;
		max-width: 500px;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
	}
	.modal h2 {
		margin: 0 0 0.5rem 0;
		font-weight: 900;
		color: #fff;
		font-size: 2rem;
		letter-spacing: -1px;
	}
	.modal p {
		color: #444;
		margin-bottom: 2rem;
		font-weight: 500;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 2rem;
	}
	.form-group.hidden {
		display: none;
	}
	.form-group label {
		font-size: 0.7rem;
		font-weight: 900;
		color: #333;
		letter-spacing: 2px;
		text-transform: uppercase;
	}
	.form-group input {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 16px;
		color: #fff;
		font-size: 1.1rem;
		font-family: 'JetBrains Mono', monospace;
		transition: all 0.2s;
	}
	.form-group input:focus {
		outline: none;
		border-color: #f472b6;
		box-shadow: 0 0 20px rgba(244, 114, 182, 0.2);
	}

	.actions {
		display: flex;
		gap: 1rem;
	}
	.actions.hidden {
		display: none;
	}
	.actions button {
		flex: 1;
		padding: 14px;
		border-radius: 12px;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-size: 0.9rem;
	}
	.btn-cancel {
		background: transparent;
		border: 2px solid #222;
		color: #444;
	}
	.btn-cancel:hover {
		border-color: #444;
		color: #fff;
	}
	.btn-confirm {
		background: #f472b6;
		border: none;
		color: #fff;
		box-shadow: 0 10px 20px rgba(244, 114, 182, 0.2);
	}
	.btn-confirm:hover {
		transform: translateY(-2px);
		box-shadow: 0 15px 30px rgba(244, 114, 182, 0.4);
	}
	.btn-unbook {
		background: transparent;
		border: 2px solid #f87171;
		color: #f87171;
	}
	.btn-unbook:hover {
		background: #f87171;
		color: #000;
	}

	.slot-actions {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 1.5rem;
	}
	.respin-row {
		display: flex;
		gap: 1rem;
	}
	.respin-row button {
		flex: 1;
		padding: 12px;
		border-radius: 12px;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 0.8rem;
		letter-spacing: 1px;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-respin {
		background: #0a0a0a;
		border: 2px solid #222;
		color: #444;
	}
	.btn-respin:hover {
		border-color: #666;
		color: #fff;
	}

	.btn-confirm-fate {
		background: linear-gradient(135deg, #2dd4bf, #0ea5e9);
		border: none;
		color: #000;
		padding: 1.5rem;
		border-radius: 16px;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 1.1rem;
		letter-spacing: 2px;
		cursor: pointer;
		transition: all 0.3s;
		box-shadow: 0 15px 30px rgba(45, 212, 191, 0.2);
	}
	.btn-confirm-fate:hover {
		transform: scale(1.02);
		box-shadow: 0 20px 40px rgba(45, 212, 191, 0.4);
	}

	.auto-spin-hint {
		color: #f472b6 !important;
		font-weight: 900;
		text-align: center;
		margin-top: 1rem;
		font-size: 0.8rem;
		letter-spacing: 2px;
		text-transform: uppercase;
		animation: pulse 1s infinite;
	}

	/* Fireworks Art */
	.fireworks-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 200;
		overflow: hidden;
		background: rgba(0, 0, 0, 0.2);
	}
	.pixel-fireworks {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.firework {
		position: absolute;
		left: var(--left);
		top: var(--top);
		width: 4px;
		height: 4px;
		background: transparent;
		box-shadow: 0 0 0 0 var(--color);
		animation: pixel-explode 1.5s ease-out forwards;
		animation-delay: var(--delay);
	}

	@keyframes pixel-explode {
		0% {
			transform: scale(1);
			box-shadow: 0 0 0 0 var(--color);
			opacity: 1;
		}
		50% {
			box-shadow:
				-20px -20px 0 2px var(--color),
				20px -20px 0 2px var(--color),
				-20px 20px 0 2px var(--color),
				20px 20px 0 2px var(--color),
				0 -30px 0 2px var(--color),
				0 30px 0 2px var(--color),
				-30px 0 0 2px var(--color),
				30px 0 0 2px var(--color);
			opacity: 1;
		}
		100% {
			box-shadow:
				-40px -40px 0 0 var(--color),
				40px -40px 0 0 var(--color),
				-40px 40px 0 0 var(--color),
				40px 40px 0 0 var(--color),
				0 -60px 0 0 var(--color),
				0 60px 0 0 var(--color),
				-60px 0 0 0 var(--color),
				60px 0 0 0 var(--color);
			opacity: 0;
			transform: scale(1.5);
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
</style>
