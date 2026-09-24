<script lang="ts">
	/**
	 * The details of one spot, folded away until the crew needs them: what kind
	 * of bed it is, whether there is a socket at it, and its label while the
	 * layout is unlocked. For a whole room of bunk beds, SPOT TYPES 🛏️ in the
	 * room panel is faster.
	 */
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import { BED_TYPES, featuresFor, readFeatures } from '$lib/accommodation';
	import { TEMPLATE_LIMITS } from '$lib/template';

	export let bed: {
		id: string;
		label?: string;
		bed_type?: string;
		features?: string[] | string;
	};
	/** The label belongs to the layout: only in Staging Mode. */
	export let canRename = false;

	let open = false;
	let error = '';
	let submitting = false;

	$: spotFeatures = featuresFor('spot');
	$: chosen = new Set(readFeatures(bed.features, 'spot'));
	$: name = bed.label || 'this spot';

	const handleSubmit: SubmitFunction = () => {
		error = '';
		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				toast(`🛏️ The details of ${name} are saved.`, 'success');
				open = false;
			} else if (result.type === 'failure') {
				error =
					(result.data as { message?: string } | undefined)?.message ||
					'The details were not saved. Reload the page and try again.';
			} else if (result.type === 'error') {
				error = 'The server could not be reached, so nothing was saved. Try again.';
				return;
			}
			await update({ reset: false });
		};
	};
</script>

<div class="spot-details">
	<button
		type="button"
		class="btn-toggle"
		aria-expanded={open}
		on:click={() => (open = !open)}
		title="What kind of bed this spot is"
	>
		<span aria-hidden="true">🏷️</span>
		<span class="btn-text">{open ? 'CLOSE' : 'DETAILS'}</span>
	</button>

	{#if open}
		<form method="POST" action="?/saveSpot" novalidate use:enhance={handleSubmit}>
			<input type="hidden" name="id" value={bed.id} />

			{#if canRename}
				<div class="field">
					<label for="label-{bed.id}">LABEL</label>
					<input
						type="text"
						id="label-{bed.id}"
						name="label"
						value={bed.label ?? ''}
						autocomplete="off"
						maxlength={TEMPLATE_LIMITS.bedLabelLength}
					/>
				</div>
			{/if}

			<div class="field">
				<label for="bed-type-{bed.id}">BED</label>
				<select id="bed-type-{bed.id}" name="bed_type" value={bed.bed_type ?? ''}>
					<option value="">Not specified</option>
					{#each BED_TYPES as type}
						<option value={type.value}>{type.label}</option>
					{/each}
				</select>
			</div>

			{#each spotFeatures as feature}
				<label class="check" title={feature.hint ?? ''}>
					<input
						type="checkbox"
						name="features"
						value={feature.value}
						checked={chosen.has(feature.value)}
					/>
					<span aria-hidden="true">{feature.icon}</span>
					{feature.label}
				</label>
			{/each}

			{#if error}<p class="field-error" role="alert">⚠️ {error}</p>{/if}

			<button type="submit" class="btn-save" disabled={submitting}>
				{submitting ? 'SAVING…' : 'SAVE'}
			</button>
		</form>
	{/if}
</div>

<style>
	.spot-details {
		/* The card is a flex row: take a line of its own under the buttons. */
		flex: 1 0 100%;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}

	.btn-toggle {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		color: #cfd6dd;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.btn-toggle:hover {
		border-color: rgba(0, 255, 224, 0.5);
		color: #eafcff;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		padding: 0.7rem;
		min-width: 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	label {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: #9aa;
		text-transform: uppercase;
	}

	input[type='text'],
	select {
		width: 100%;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		color: #eee;
		font: inherit;
		font-size: 0.85rem;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		color: #ddd;
		cursor: pointer;
		overflow-wrap: anywhere;
	}

	.check input {
		accent-color: #00ffe0;
		width: 1rem;
		height: 1rem;
		flex: none;
	}

	.field-error {
		margin: 0;
		font-size: 0.78rem;
		color: #ff6b8b;
	}

	.btn-save {
		background: linear-gradient(135deg, #00ffe0, #00b3ff);
		color: #04121a;
		border: none;
		border-radius: 8px;
		padding: 0.5rem 0.8rem;
		font-weight: 900;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: wait;
	}
</style>
