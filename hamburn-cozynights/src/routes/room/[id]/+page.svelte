<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { PageData, ActionData } from './$types';
	import CountdownTimer from '$lib/components/CountdownTimer.svelte';
	import SlotMachine from '$lib/components/SlotMachine.svelte';
	import { confirmDialog, dialogQueue, toast } from '$lib/dialogs';

	export let data: PageData;
	export let form: ActionData;

	// Modal State
	let showModal = false;
	let modalEl: HTMLDivElement;
	let selectedBedId: string | null = null;
	let currentNameInput = '';
	let slotMachineRef: SlotMachine;
	let isAutoSpinning = false;
	let showSlotManually = false;
	let nameGenerated = false;
	let triggerFireworks = false;

	// `form` only matters without JavaScript; with it, the enhance callbacks
	// below report errors where the guest is looking (modal or banner).
	let modalError = '';
	let bannerError = form?.error ?? '';
	let isSaving = false;

	const NO_CONNECTION =
		'We could not reach the server, so nothing was changed. Check your internet connection and try again.';

	$: selectedBed = data.beds.find((b) => b.id === selectedBedId);
	$: roomTitle = `${data.room.name || 'Room'} #${data.room.room_number}`;

	// The page behind an open modal must not scroll along on phones.
	$: if (typeof document !== 'undefined') {
		document.body.style.overflow = showModal ? 'hidden' : '';
	}
	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = '';
	});

	async function openBookingModal(bedId: string, existingName?: string) {
		selectedBedId = bedId;
		currentNameInput = existingName || '';
		modalError = '';
		showModal = true;
		showSlotManually = false;
		isAutoSpinning = false;
		nameGenerated = false;
		await tick();
		modalEl?.focus();
	}

	function closeModal() {
		showModal = false;
		selectedBedId = null;
		showSlotManually = false;
		isAutoSpinning = false;
		nameGenerated = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		// An open confirm dialog sits on top of the modal and gets the Escape key first.
		if (event.key === 'Escape' && showModal && $dialogQueue.length === 0) closeModal();
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

	/** No burner name given: the slot machine rolls one before anything is booked. */
	async function rollBurnerName() {
		showSlotManually = true;
		isAutoSpinning = true;
		nameGenerated = false;
		await tick();
		if (slotMachineRef) slotMachineRef.spin();
	}

	function confirmRelease() {
		return confirmDialog(
			'Your spot becomes free for everyone else right away. You can then pick a new one.',
			{
				title: 'Release your spot?',
				tone: 'warning',
				confirmLabel: 'Release spot',
				cancelLabel: 'Keep my spot'
			}
		);
	}

	function failureMessage(result: { data?: Record<string, unknown> }, fallback: string) {
		return typeof result.data?.error === 'string' ? result.data.error : fallback;
	}
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<svelte:head>
	<title>{roomTitle} · CozyNights</title>
</svelte:head>

<div class="container">
	<header>
		<div class="header-nav">
			<a href="/house/{data.room.house}" class="back-link">← Back to House</a>
			{#if !data.isBookingActive && data.bookingUnlockAt}
				<CountdownTimer
					compact
					targetDate={data.bookingUnlockAt}
					on:elapsed={() => invalidateAll()}
				/>
			{/if}
		</div>
		<h1>{data.room.name || 'Room'} <small>#{data.room.room_number}</small></h1>
	</header>

	{#if !data.isBookingActive}
		<div class="booking-locked-banner" role="status">
			<div class="locked-icon" aria-hidden="true">🎪</div>
			<div class="locked-content">
				<h3>Bookings open soon!</h3>
				<p>
					Booking is not open yet. You can look around; spots can be picked as soon as Live Booking
					starts. 🔥
				</p>
			</div>
		</div>
	{/if}

	{#if data.userBedId}
		{@const myBed = data.beds.find((b) => b.id === data.userBedId)}
		{#if !myBed}
			<div class="booking-warning-banner">
				<div class="warning-icon" aria-hidden="true">⚠️</div>
				<div class="warning-content">
					<h3>You already have a spot</h3>
					{#if data.isBookingActive}
						<p>
							Your spot is in another room. One ticket code is one spot: to pick one here, release
							your current spot first.
						</p>
						{#if bannerError}
							<p class="error-msg" role="alert">{bannerError}</p>
						{/if}
						<form
							method="POST"
							action="?/unbookBed"
							use:enhance={async ({ cancel }) => {
								if (!(await confirmRelease())) {
									cancel();
									return;
								}
								bannerError = '';
								isSaving = true;

								return async ({ result, update }) => {
									isSaving = false;
									if (result.type === 'failure') {
										bannerError = failureMessage(
											result,
											'Your spot could not be released. Please try again.'
										);
										return;
									}
									if (result.type === 'error') {
										bannerError = NO_CONNECTION;
										return;
									}
									if (result.type === 'success') {
										toast('Your spot is released. Pick a new one!', 'success');
									}
									await update();
								};
							}}
						>
							<button type="submit" class="btn-unbook-banner" disabled={isSaving}>
								{isSaving ? 'Releasing…' : 'Release Current Spot'}
							</button>
						</form>
					{:else}
						<p>It stays reserved for you. Changes are possible again once booking is open.</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="booking-success-banner">
				<div class="success-icon" aria-hidden="true">✨</div>
				<div class="success-content">
					<h3>Welcome Home!</h3>
					<p>
						Spot <strong>{myBed.label}</strong> in this room is yours.
						{#if data.isBookingActive}Tap it to change your burner name or to release it.{/if}
					</p>
				</div>
			</div>
		{/if}
	{/if}

	{#if data.beds.length === 0}
		<p class="empty-state">This room has no spots yet. Go back and pick another room.</p>
	{/if}

	<div class="beds-grid">
		{#each data.beds as bed}
			{@const isMyBed = bed.id === data.userBedId}
			{@const someoneElseBooked = bed.occupied && !isMyBed}
			{@const iHaveAnotherBooking = !!data.userBedId && !isMyBed}
			{@const isLocked = !data.isBookingActive}

			{#if someoneElseBooked}
				<div class="bed-card occupied">
					<div class="icon" aria-hidden="true">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box occupied">
						<span class="status-text">Occupied</span>
						<span class="guest-name">
							{bed.burnerName || 'Mystery Burner'}
						</span>
					</div>
				</div>
			{:else if isMyBed}
				<button
					class="bed-card mine {isLocked ? 'locked' : ''}"
					on:click={() => !isLocked && openBookingModal(bed.id, bed.burnerName)}
					disabled={isLocked}
				>
					<div class="icon" aria-hidden="true">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box my-status">
						<span class="status-text">Your Spot</span>
						<span class="guest-name">{bed.burnerName}</span>
						<small class="edit-hint"
							>{isLocked ? 'Booking closed' : 'Tap to change or release'}</small
						>
					</div>
				</button>
			{:else if !bed.bookable}
				<div class="bed-card occupied">
					<div class="icon" aria-hidden="true">🔒</div>
					<span class="label">{bed.label}</span>
					<div class="status-box occupied">
						<span class="status-text">Not available</span>
						<span class="guest-name">Reserved by the crew</span>
					</div>
				</div>
			{:else}
				<button
					class="bed-card free {iHaveAnotherBooking || isLocked ? 'disabled' : ''}"
					on:click={() => !iHaveAnotherBooking && !isLocked && openBookingModal(bed.id)}
					disabled={iHaveAnotherBooking || isLocked}
				>
					<div class="icon" aria-hidden="true">🛏️</div>
					<span class="label">{bed.label}</span>
					<div class="status-box free">
						<span
							>{isLocked ? 'Not open yet' : iHaveAnotherBooking ? 'Unavailable' : 'Available'}</span
						>
						<small
							>{isLocked
								? 'Booking opens soon'
								: iHaveAnotherBooking
									? 'Release your other spot first'
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
		<div
			class="modal"
			bind:this={modalEl}
			on:click|stopPropagation
			role="dialog"
			aria-modal="true"
			aria-labelledby="booking-modal-title"
			tabindex="-1"
		>
			<h2 id="booking-modal-title">
				{selectedBedId === data.userBedId ? 'Edit Your Spot' : 'Grab This Spot'}
			</h2>
			<p>
				{#if selectedBed}Spot <strong>{selectedBed.label}</strong>.{/if}
				Set your Burner Name (optional). Everyone in this room can see it.
			</p>

			{#if modalError}
				<div class="modal-error-banner" role="alert">
					{modalError}
				</div>
			{/if}

			{#if showSlotManually}
				<SlotMachine bind:this={slotMachineRef} showButton={false} on:select={handleSlotSelect} />
			{/if}

			<!-- novalidate + own checks: browser validation bubbles follow the browser
			     language. Whether a click books, releases or first rolls a name is
			     decided in the submit function; cancel() is the only reliable way to
			     stop an enhanced form. -->
			<form
				id="booking-form"
				method="POST"
				action="?/bookBed"
				novalidate
				use:enhance={async ({ action, formData, cancel }) => {
					const releasing = action.search.includes('unbookBed');
					if (releasing) {
						if (!(await confirmRelease())) {
							cancel();
							return;
						}
					} else if (!currentNameInput.trim()) {
						cancel();
						rollBurnerName();
						return;
					} else {
						formData.set('guestName', currentNameInput.trim());
					}
					modalError = '';
					isSaving = true;

					return async ({ result, update }) => {
						isSaving = false;
						if (result.type === 'failure') {
							modalError = failureMessage(
								result,
								'That did not work and nothing was changed. Please try again.'
							);
							// Someone may have been faster: show the room as it is now.
							await invalidateAll();
							return;
						}
						if (result.type === 'error') {
							modalError = NO_CONNECTION;
							return;
						}
						if (result.type === 'success') {
							if (releasing) {
								toast('Your spot is released.', 'success');
							} else {
								triggerFireworks = true;
								setTimeout(() => {
									triggerFireworks = false;
								}, 5000);
							}
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
						placeholder="Your burner name"
						maxlength="80"
						autocomplete="off"
						autocapitalize="words"
						enterkeyhint="done"
						aria-describedby="guestName-hint"
					/>
					<small id="guestName-hint" class="field-hint"
						>Leave it empty and the slot machine rolls one for you 🎰</small
					>
				</div>

				{#if showSlotManually}
					<div class="slot-actions" in:fade>
						{#if nameGenerated}
							<div class="respin-row">
								<button type="button" class="btn-respin" on:click={respinName} disabled={isSaving}
									>New Name 🎲</button
								>
								<button
									type="button"
									class="btn-cancel"
									on:click={cancelSlotSelection}
									disabled={isSaving}>Cancel</button
								>
							</div>
							<button type="submit" class="btn-confirm-fate" disabled={isSaving}>
								{isSaving ? 'Booking…' : 'Accept Fate & Book 🌵'}
							</button>
						{:else}
							<p class="auto-spin-hint">Rolling for your burner identity...</p>
						{/if}
					</div>
				{:else}
					<!-- "Save" comes first in the DOM: Enter in the name field triggers the
					     form's first submit button, and that must not be "Release". -->
					<div class="actions">
						<button type="submit" class="btn-confirm" disabled={isSaving}>
							{isSaving ? 'Saving…' : 'Save Spot'}
						</button>
						<button type="button" class="btn-cancel" on:click={closeModal}>Cancel</button>
						{#if selectedBedId === data.userBedId}
							<button type="submit" formaction="?/unbookBed" class="btn-unbook" disabled={isSaving}
								>Release</button
							>
						{/if}
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
		padding: clamp(1rem, 4vw, 2rem);
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
		color: #fff;
	}

	header {
		margin-bottom: clamp(1.5rem, 6vw, 3rem);
	}
	.header-nav {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-bottom: 1rem;
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
	.back-link:hover {
		color: #fff;
	}

	h1 {
		font-size: clamp(2rem, 9vw, 3.5rem);
		line-height: 1.1;
		font-weight: 900;
		margin: 0;
		letter-spacing: -0.03em;
		overflow-wrap: anywhere;
	}
	h1 small {
		color: #8a8a8a;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.45em;
		letter-spacing: 0;
		margin-left: 0.5rem;
		white-space: nowrap;
	}

	.booking-locked-banner,
	.booking-warning-banner,
	.booking-success-banner {
		background: #111;
		border: 1px solid #222;
		padding: clamp(1rem, 5vw, 2rem);
		border-radius: 20px;
		margin-bottom: clamp(1.5rem, 6vw, 3rem);
		display: flex;
		align-items: flex-start;
		gap: clamp(0.75rem, 4vw, 2rem);
	}
	.booking-locked-banner {
		border-left: 4px solid #f472b6;
	}
	.booking-warning-banner {
		border-left: 4px solid #fb923c;
	}
	.booking-success-banner {
		border-left: 4px solid #2dd4bf;
	}
	.locked-icon,
	.warning-icon,
	.success-icon {
		font-size: clamp(1.75rem, 8vw, 2.5rem);
		line-height: 1;
	}
	.locked-content,
	.warning-content,
	.success-content {
		min-width: 0;
	}
	.locked-content h3,
	.warning-content h3,
	.success-content h3 {
		margin: 0;
		font-weight: 900;
	}
	.locked-content h3 {
		color: #f472b6;
	}
	.warning-content h3 {
		color: #fb923c;
	}
	.success-content h3 {
		color: #2dd4bf;
	}
	.locked-content p,
	.warning-content p,
	.success-content p {
		margin: 0.5rem 0 0 0;
		color: #b5b5b5;
		font-size: 0.95rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.success-content strong {
		color: #fff;
	}
	.warning-content .error-msg {
		color: #fecaca;
		font-weight: bold;
		margin-top: 1rem;
	}
	.btn-unbook-banner {
		background: #fb923c;
		border: none;
		color: #000;
		min-height: 44px;
		padding: 0.8rem 1.5rem;
		border-radius: 10px;
		font-weight: 900;
		cursor: pointer;
		margin-top: 1.25rem;
	}
	.btn-unbook-banner:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.empty-state {
		color: #b5b5b5;
		line-height: 1.5;
	}

	.beds-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
		gap: clamp(0.75rem, 3vw, 1.5rem);
	}

	.bed-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 16px;
		padding: clamp(1rem, 4vw, 1.5rem);
		min-width: 0;
		min-height: 72px;
		display: flex;
		align-items: center;
		gap: clamp(0.75rem, 3vw, 1.5rem);
		text-align: left;
		color: inherit;
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
		opacity: 0.6;
		cursor: not-allowed;
		filter: grayscale(1);
	}
	.bed-card.occupied {
		opacity: 0.8;
	}
	.bed-card.locked {
		opacity: 0.7;
		cursor: not-allowed;
	}
	.bed-card:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	/* Long spot labels and burner names wrap inside the card instead of pushing
	   the status out of it. */
	.label {
		font-weight: 900;
		font-size: 1.25rem;
		line-height: 1.2;
		flex: 1 1 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.status-box {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		text-align: right;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 60%;
		overflow-wrap: anywhere;
	}
	.status-text {
		font-size: 0.7rem;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: 1px;
		color: #9a9a9a;
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
		font-size: 0.85rem;
	}
	.free small {
		font-size: 0.7rem;
		color: #9a9a9a;
	}

	.edit-hint {
		margin-top: 0.25rem;
		font-size: 0.7rem;
		color: #9a9a9a;
		font-weight: 900;
		text-transform: uppercase;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(15px);
		display: flex;
		align-items: center;
		justify-content: center;
		overscroll-behavior: contain;
		z-index: 100;
	}
	.modal {
		background: #000;
		border: 1px solid #222;
		border-top: 4px solid #f472b6;
		border-radius: clamp(20px, 6vw, 32px);
		padding: clamp(1.25rem, 6vw, 3rem);
		width: 100%;
		max-width: 500px;
		max-height: calc(100vh - 2rem);
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8);
	}
	.modal:focus {
		outline: none;
	}
	.modal h2 {
		margin: 0 0 0.5rem 0;
		font-weight: 900;
		color: #fff;
		font-size: clamp(1.5rem, 7vw, 2rem);
		letter-spacing: -1px;
	}
	.modal p {
		color: #a3a3a3;
		margin: 0 0 1.5rem;
		font-weight: 500;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.modal p strong {
		color: #fff;
	}

	.modal-error-banner {
		margin-bottom: 1.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid #f87171;
		border-radius: 12px;
		background: rgba(248, 113, 113, 0.1);
		color: #fecaca;
		font-weight: 600;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.form-group.hidden {
		display: none;
	}
	.form-group label {
		font-size: 0.75rem;
		font-weight: 900;
		color: #a3a3a3;
		letter-spacing: 2px;
		text-transform: uppercase;
	}
	.form-group input {
		width: 100%;
		min-width: 0;
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 12px;
		padding: 16px;
		color: #fff;
		font-size: 1.1rem;
		font-family: 'JetBrains Mono', monospace;
		transition: all 0.2s;
	}
	.form-group input::placeholder {
		color: #777;
		opacity: 1;
	}
	.form-group input:focus {
		outline: none;
		border-color: #f472b6;
		box-shadow: 0 0 20px rgba(244, 114, 182, 0.2);
	}
	.field-hint {
		color: #a3a3a3;
		font-size: 0.85rem;
		line-height: 1.4;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}
	.actions button {
		flex: 1;
		min-height: 48px;
		padding: 14px 10px;
		border-radius: 12px;
		font-weight: 900;
		cursor: pointer;
		transition: all 0.2s;
		text-transform: uppercase;
		letter-spacing: 1px;
		font-size: 0.9rem;
	}
	.actions button:disabled,
	.slot-actions button:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	/* Visual order "Release · Cancel · Save"; the DOM order starts with Save. */
	.actions .btn-unbook {
		order: 1;
	}
	.actions .btn-cancel {
		order: 2;
	}
	.actions .btn-confirm {
		order: 3;
	}
	.btn-cancel {
		background: transparent;
		border: 2px solid #444;
		color: #b5b5b5;
	}
	.btn-cancel:hover {
		border-color: #888;
		color: #fff;
	}
	.btn-confirm {
		background: #f472b6;
		border: none;
		color: #000;
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
		gap: 0.75rem;
	}
	.respin-row button {
		flex: 1;
		min-height: 48px;
		padding: 12px 8px;
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
		border: 2px solid #444;
		color: #b5b5b5;
	}
	.btn-respin:hover {
		border-color: #888;
		color: #fff;
	}

	.btn-confirm-fate {
		background: linear-gradient(135deg, #2dd4bf, #0ea5e9);
		border: none;
		color: #000;
		padding: clamp(1rem, 4vw, 1.5rem);
		border-radius: 16px;
		font-weight: 900;
		text-transform: uppercase;
		font-size: clamp(0.95rem, 4vw, 1.1rem);
		letter-spacing: clamp(1px, 0.4vw, 2px);
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

	/* Phones: three buttons don't fit in one row. Save on top, Release last. */
	@media (max-width: 480px) {
		.actions {
			flex-direction: column;
		}
		.actions .btn-confirm {
			order: 1;
		}
		.actions .btn-unbook {
			order: 3;
		}
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
