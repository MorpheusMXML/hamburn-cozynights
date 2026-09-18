<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import { TEMPLATE_LIMITS } from '$lib/template';

	export let roomId: string;
	export let disabled = false;

	let error = '';
	let submitting = false;

	// The form is `novalidate`: the browser's own validation bubbles follow the
	// browser language, these messages are always English. The server checks
	// the same rules again.
	const handleSubmit: SubmitFunction = ({ formData, formElement, cancel }) => {
		const label = String(formData.get('label') ?? '').trim();
		error = '';
		if (!label) {
			error = 'Enter a label for the spot, for example "B1" or "Top Bunk".';
		} else if (label.length > TEMPLATE_LIMITS.bedLabelLength) {
			error = `The label is too long. Use at most ${TEMPLATE_LIMITS.bedLabelLength} characters.`;
		}
		if (error) {
			cancel();
			formElement.querySelector<HTMLInputElement>('[name="label"]')?.focus();
			return;
		}

		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				toast(`🛌 Spot "${label}" was added. It is active right away.`, 'success');
				await update();
			} else if (result.type === 'failure') {
				const data = result.data as { message?: string } | undefined;
				error = data?.message || 'The spot was not added. Reload the page and try again.';
			} else if (result.type === 'error') {
				error =
					'The spot was not added because the server could not be reached. Check your connection and try again.';
			} else {
				await update();
			}
		};
	};
</script>

<form method="POST" action="?/createBed" class="add-bed-form" novalidate use:enhance={handleSubmit}>
	<input type="hidden" name="roomId" value={roomId} />

	<div class="input-row">
		<input
			type="text"
			name="label"
			placeholder="e.g. B1 or Top Bunk"
			aria-label="Spot label"
			autocomplete="off"
			maxlength={TEMPLATE_LIMITS.bedLabelLength}
			class:error={!!error}
			aria-invalid={!!error}
			aria-describedby={error ? 'add-bed-error' : undefined}
			on:input={() => (error = '')}
			{disabled}
		/>
		<button
			type="submit"
			class="btn-add"
			disabled={disabled || submitting}
			class:disabled={disabled || submitting}
		>
			IGNITE ⚡️
		</button>
	</div>
	{#if error}
		<p class="field-error" id="add-bed-error" role="alert">⚠️ {error}</p>
	{/if}
</form>

<style>
	.add-bed-form {
		width: 100%;
	}
	.input-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	input {
		flex: 1 1 10rem;
		min-width: 0;
		min-height: 44px;
		box-sizing: border-box;
		background: #1a1a1a;
		border: 1px solid #333;
		color: white;
		padding: 0.6rem 1rem;
		border-radius: 8px;
		/* 16px: iOS Safari zooms into smaller fields */
		font-size: 1rem;
		transition: all 0.3s;
	}
	input:focus {
		outline: none;
		border-color: #fb923c;
		box-shadow: 0 0 10px rgba(251, 146, 60, 0.2);
	}
	input.error {
		border-color: #f87171;
	}
	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field-error {
		margin: 0.75rem 0 0;
		color: #f87171;
		font-size: 0.8rem;
		font-weight: 700;
		line-height: 1.4;
	}

	.btn-add {
		flex: 0 0 auto;
		min-height: 44px;
		background: #fb923c;
		color: #000;
		border: none;
		padding: 0 1.5rem;
		border-radius: 8px;
		font-weight: 900;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-add:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 5px 15px rgba(251, 146, 60, 0.3);
	}
	.btn-add.disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
</style>
