<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import { revealInvalid } from '$lib/field-alert';
	import { TEMPLATE_LIMITS } from '$lib/template';
	import { lockAttrs, type LockHint } from '$lib/layout-lock';

	/** The layout is locked: the fields are read-only and say why when tried. */
	export let lock: LockHint | null = null;

	type FieldErrors = { name?: string; room_number?: string; amount_beds?: string };

	let errors: FieldErrors = {};
	let formError = '';
	let submitting = false;

	const isWholeNumber = (value: string) => /^\d{1,6}$/.test(value);

	// The form is `novalidate`: the browser's own validation bubbles follow the
	// browser language, these messages are always English. The server checks
	// the same rules again.
	function validate(formData: FormData): FieldErrors {
		const found: FieldErrors = {};
		const name = String(formData.get('name') ?? '').trim();
		const roomNumber = String(formData.get('room_number') ?? '').trim();
		const beds = String(formData.get('amount_beds') ?? '').trim();

		if (!name) {
			found.name = 'Enter a name for the room.';
		} else if (name.length > TEMPLATE_LIMITS.roomNameLength) {
			found.name = `The name is too long. Use at most ${TEMPLATE_LIMITS.roomNameLength} characters.`;
		}
		if (
			!isWholeNumber(roomNumber) ||
			Number(roomNumber) < 1 ||
			Number(roomNumber) > TEMPLATE_LIMITS.roomNumber
		) {
			found.room_number = `Enter a whole number from 1 to ${TEMPLATE_LIMITS.roomNumber}.`;
		}
		if (beds !== '' && (!isWholeNumber(beds) || Number(beds) > TEMPLATE_LIMITS.bedsPerRoom)) {
			found.amount_beds = `Enter a whole number from 0 to ${TEMPLATE_LIMITS.bedsPerRoom}, or leave it empty.`;
		}
		return found;
	}

	const handleSubmit: SubmitFunction = ({ formData, formElement, cancel }) => {
		if (lock) {
			// LockHintHost stops the clicks; this is the net for anything else.
			cancel();
			return;
		}
		formError = '';
		errors = validate(formData);
		const firstInvalid = Object.keys(errors)[0];
		if (firstInvalid) {
			cancel();
			revealInvalid(formElement);
			return;
		}

		const name = String(formData.get('name') ?? '').trim();
		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				toast(`🚪 Room "${name}" was added.`, 'success');
				await update();
			} else if (result.type === 'failure') {
				const data = result.data as { message?: string; errors?: FieldErrors } | undefined;
				errors = data?.errors ?? {};
				formError =
					Object.keys(errors).length > 0
						? ''
						: data?.message || 'The room was not added. Reload the page and try again.';
				// The server said no to a field: point at it like the check above.
				revealInvalid(formElement);
			} else if (result.type === 'error') {
				formError =
					'The room was not added because the server could not be reached. Check your connection and try again.';
			} else {
				await update();
			}
		};
	};
</script>

<div class="form-card">
	<form
		method="POST"
		action="?/createRoom"
		class="admin-form"
		novalidate
		use:enhance={handleSubmit}
	>
		<div class="form-group">
			<label for="room-name">ROOM DESIGNATION (NAME)</label>
			<input
				type="text"
				id="room-name"
				name="name"
				placeholder="e.g. Skyline Sanctuary"
				autocomplete="off"
				maxlength={TEMPLATE_LIMITS.roomNameLength}
				aria-invalid={!!errors.name}
				aria-describedby={errors.name ? 'room-name-error' : undefined}
				on:input={() => (errors = { ...errors, name: undefined })}
				readonly={!!lock}
				{...lockAttrs(lock)}
			/>
			{#if errors.name}
				<p class="field-error" id="room-name-error" role="alert">{errors.name}</p>
			{/if}
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="room-number">ROOM #</label>
				<input
					type="text"
					inputmode="numeric"
					id="room-number"
					name="room_number"
					placeholder="101"
					autocomplete="off"
					aria-invalid={!!errors.room_number}
					aria-describedby={errors.room_number ? 'room-number-error' : undefined}
					on:input={() => (errors = { ...errors, room_number: undefined })}
					readonly={!!lock}
					{...lockAttrs(lock)}
				/>
				{#if errors.room_number}
					<p class="field-error" id="room-number-error" role="alert">{errors.room_number}</p>
				{/if}
			</div>

			<div class="form-group">
				<label for="room-beds">BED CAPACITY 🛌</label>
				<input
					type="text"
					inputmode="numeric"
					id="room-beds"
					name="amount_beds"
					placeholder="0"
					autocomplete="off"
					aria-invalid={!!errors.amount_beds}
					aria-describedby={errors.amount_beds ? 'room-beds-error' : undefined}
					on:input={() => (errors = { ...errors, amount_beds: undefined })}
					readonly={!!lock}
					{...lockAttrs(lock)}
				/>
				{#if errors.amount_beds}
					<p class="field-error" id="room-beds-error" role="alert">{errors.amount_beds}</p>
				{/if}
			</div>
		</div>

		{#if formError}
			<p class="form-error" role="alert">{formError}</p>
		{/if}

		<button
			type="submit"
			class="btn-ignite"
			class:disabled={submitting}
			disabled={submitting}
			{...lockAttrs(lock)}
		>
			{submitting ? 'IGNITING…' : 'IGNITE ROOM ✨'}
		</button>
	</form>
</div>

<style>
	.form-card {
		background: transparent;
	}

	.admin-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.form-row {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 0.5rem;
	}
	/* Only the fields in a row share it. On the name field (a direct child of
	   the column form) the same flex-basis was a 140 px HEIGHT: an empty band
	   between the name and ROOM #. */
	.form-row > .form-group {
		flex: 1 1 140px;
	}

	label {
		font-size: 0.65rem;
		font-weight: 900;
		color: #888;
		letter-spacing: 1px;
	}

	input {
		padding: 0.8rem;
		background: #1a1a1a;
		border: 1px solid #333;
		color: white;
		border-radius: 8px;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		min-width: 0;
		transition: all 0.3s;
	}
	input:focus {
		outline: none;
		border-color: #2dd4bf;
		box-shadow: 0 0 10px rgba(45, 212, 191, 0.2);
	}

	.btn-ignite {
		background: #2dd4bf;
		color: #000;
		padding: 1rem;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 900;
		margin-top: 0.5rem;
		font-size: 0.8rem;
		letter-spacing: 1px;
		transition: all 0.2s;
		box-shadow: 0 0 15px rgba(45, 212, 191, 0.3);
	}
	.btn-ignite:hover:not(.disabled) {
		transform: scale(1.02);
		box-shadow: 0 0 25px rgba(45, 212, 191, 0.5);
	}
	.btn-ignite.disabled {
		opacity: 0.3;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}
</style>
