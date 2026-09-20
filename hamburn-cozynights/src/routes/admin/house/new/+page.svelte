<script lang="ts">
	import type { PageData, SubmitFunction } from './$types';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';

	export let data: PageData;
	$: ({ x, y, isLayoutLocked, phase } = data);

	type Failure = { error?: string; field?: string };
	// Without JavaScript the failed action's result arrives here.
	export let form: Failure | null = null;

	let name = '';
	let bedCount = '4';
	let nameError = '';
	let bedCountError = '';
	let formError = '';
	let submitting = false;

	$: showFailure(form);

	function showFailure(failure: Failure | null | undefined) {
		nameError = bedCountError = formError = '';
		if (!failure?.error) return;
		if (failure.field === 'name') nameError = failure.error;
		else if (failure.field === 'bedCount') bedCountError = failure.error;
		else formError = failure.error;
	}

	// The form is `novalidate`: the browser's own validation bubbles follow the
	// browser language, these messages are always English. The server checks
	// the same rules again.
	const handleSubmit: SubmitFunction = ({ formElement, cancel }) => {
		showFailure(null);
		if (!name.trim()) nameError = 'Enter a name for the house.';
		// Same limit as the server (TEMPLATE_LIMITS.bedsPerRoom = 50); the old
		// /^\d{1,2}$/ let 51–99 through and the save then failed on the server.
		const beds = Number(bedCount.trim());
		if (
			bedCount.trim() !== '' &&
			(!/^\d{1,2}$/.test(bedCount.trim()) || !Number.isInteger(beds) || beds > 50)
		) {
			bedCountError = 'Enter a whole number from 0 to 50, or leave it empty.';
		}
		if (nameError || bedCountError) {
			cancel();
			revealInvalid(formElement);
			return;
		}

		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				toast(`🛖 "${name.trim()}" was created. Drag its pin to the right place.`, 'success');
				await goto('/admin', { invalidateAll: true });
			} else if (result.type === 'failure') {
				showFailure(result.data as Failure);
				revealInvalid(formElement);
			} else if (result.type === 'error') {
				formError =
					'The house was not created because the server could not be reached. Check your connection and try again.';
			} else {
				await update();
			}
		};
	};
</script>

<svelte:head>
	<title>New house · CozyNights</title>
</svelte:head>

<div class="edit-container">
	<nav class="breadcrumbs" aria-label="Breadcrumb">
		<a href="/admin">Control Center</a> <span class="sep">/</span>
		<span class="current">New house</span>
	</nav>
	<h1>Add New House 🛖</h1>
	<p class="coords-display">Location: 📍 X: {x} / Y: {y}</p>
	<p class="hint">You can drag the pin to another place on the Control Center map afterwards.</p>

	{#if isLayoutLocked}
		<div class="lockdown-notice" role="status">
			🔒 {phase === 'closed' ? 'Booking is closed' : 'Live Booking is active'}, so houses cannot be
			added. A superuser can switch back to Staging Mode in the <a href="/admin">Control Center</a>.
		</div>
	{/if}

	<form method="POST" action="?/create" class="edit-form" novalidate use:enhance={handleSubmit}>
		<input type="hidden" name="x" value={x} />
		<input type="hidden" name="y" value={y} />

		<div class="form-group">
			<label for="name">House name</label>
			<input
				type="text"
				id="name"
				name="name"
				bind:value={name}
				placeholder="e.g. Eagle's Nest"
				autocomplete="off"
				maxlength="100"
				aria-invalid={!!nameError}
				aria-describedby={nameError ? 'name-error' : undefined}
				on:input={() => (nameError = '')}
				disabled={isLayoutLocked}
			/>
			{#if nameError}
				<p class="field-error" id="name-error" role="alert">{nameError}</p>
			{/if}
		</div>

		<div class="form-group">
			<label for="bedCount">Initial capacity (beds)</label>
			<input
				type="text"
				inputmode="numeric"
				id="bedCount"
				name="bedCount"
				bind:value={bedCount}
				placeholder="0"
				autocomplete="off"
				aria-invalid={!!bedCountError}
				aria-describedby={bedCountError ? 'bedcount-error' : 'bedcount-hint'}
				on:input={() => (bedCountError = '')}
				disabled={isLayoutLocked}
			/>
			<p class="hint" id="bedcount-hint">
				Creates a first room "Main Module" with this many active spots. Enter 0 to add rooms later.
			</p>
			{#if bedCountError}
				<p class="field-error" id="bedcount-error" role="alert">{bedCountError}</p>
			{/if}
		</div>

		{#if formError}
			<p class="form-error" role="alert">{formError}</p>
		{/if}

		<div class="actions">
			<a href="/admin" class="btn-cancel">Cancel</a>
			<button type="submit" class="btn-save" disabled={isLayoutLocked || submitting}>
				{submitting ? 'Saving…' : 'Save House'}
			</button>
		</div>
	</form>
</div>

<style>
	.edit-container {
		max-width: 600px;
		margin: 4rem auto;
		padding: 2rem;
		background: #111;
		border-radius: 12px;
		border: 1px solid #333;
		box-sizing: border-box;
	}
	.breadcrumbs {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 1px;
		color: #666;
		text-transform: uppercase;
		margin-bottom: 1rem;
	}
	.breadcrumbs a {
		color: #2dd4bf;
		text-decoration: none;
	}
	.breadcrumbs .current {
		color: #f472b6;
	}
	.sep {
		margin: 0 0.5rem;
		color: #333;
	}
	h1 {
		margin: 0 0 1rem;
		font-size: clamp(1.5rem, 6vw, 2rem);
	}
	.coords-display {
		color: #4ade80;
		font-family: monospace;
		background: rgba(74, 222, 128, 0.1);
		padding: 0.5rem;
		border-radius: 4px;
		display: inline-block;
		margin: 0;
	}
	.hint {
		margin: 0.5rem 0 0;
		color: #888;
		font-size: 0.8rem;
		line-height: 1.4;
	}
	.lockdown-notice {
		background: rgba(251, 146, 60, 0.08);
		border: 1px solid rgba(251, 146, 60, 0.3);
		color: #fb923c;
		padding: 1rem;
		border-radius: 12px;
		font-weight: 700;
		font-size: 0.85rem;
		line-height: 1.5;
		margin-top: 1.5rem;
	}
	.lockdown-notice a {
		color: #fdba74;
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-top: 2rem;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	label {
		font-weight: 700;
		font-size: 0.9rem;
	}
	input {
		background: #222;
		border: 1px solid #444;
		color: white;
		padding: 0.8rem;
		border-radius: 6px;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		min-width: 0;
	}
	input:focus {
		outline: none;
		border-color: #2dd4bf;
	}
	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.field-error {
		font-size: 0.85rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: flex-end;
		align-items: center;
	}
	.btn-save {
		background: #22c55e;
		color: #03150a;
		border: none;
		min-height: 44px;
		padding: 0.8rem 1.5rem;
		border-radius: 6px;
		cursor: pointer;
		font-weight: bold;
		font-size: 0.95rem;
	}
	.btn-save:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.btn-cancel {
		color: #aaa;
		text-decoration: none;
		padding: 0.8rem;
		min-height: 44px;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
	}

	@media (max-width: 640px) {
		.edit-container {
			margin: 1rem auto;
			padding: 1.25rem 1rem;
		}
	}
</style>
