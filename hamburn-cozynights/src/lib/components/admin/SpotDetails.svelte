<script lang="ts">
	/**
	 * The details of one spot, folded away until the crew needs them: what kind
	 * of bed it is, and its label while the layout is unlocked. For a whole room
	 * of bunk beds, SPOT TYPES 🛏️ in the room panel is faster.
	 *
	 * A spot has no features of its own: it shows what it inherits from its
	 * room and house ("From the room and house"). A superuser can switch one of
	 * those off for this spot alone (`features_off`, src/lib/accommodation.ts);
	 * admins only see the chips. What the bed itself rules out — an upper bunk
	 * is never ♿ wheelchair accessible — is struck through, whoever looks.
	 */
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import { BED_TYPES, FEATURES, bedRulesOut, type Feature } from '$lib/accommodation';
	import { TEMPLATE_LIMITS } from '$lib/template';

	export let bed: {
		id: string;
		label?: string;
		bed_type?: string;
	};
	/** The label belongs to the layout: only in Staging Mode. */
	export let canRename = false;
	/** The other spot of the bunk bed this spot is part of; '' when it stands alone. */
	export let partnerLabel = '';
	/** Which level of the bunk bed this spot is; null when it stands alone. */
	export let level: 'lower' | 'upper' | null = null;
	/** What the spot inherits from its room and house (inheritedFeatures, room overrides applied). */
	export let inherited: Feature[] = [];
	/** What this spot switched off of that (`beds.features_off`, cleaned with readFeaturesOff). */
	export let featuresOff: Feature[] = [];
	/** A superuser may switch inherited features off and reset them; admins only look. */
	export let canOverride = false;

	let open = false;
	let error = '';
	let submitting = false;

	/**
	 * The bed the BED field shows: the stored one, until the crew picks another
	 * — so an ♿ chip is struck through as soon as "Upper bunk" is picked, not
	 * only after SAVE. A stored change (SAVE, stacking, swapping) wins again.
	 */
	let shownType = bed.bed_type ?? '';
	let storedType = shownType;
	$: if ((bed.bed_type ?? '') !== storedType) {
		storedType = bed.bed_type ?? '';
		shownType = storedType;
	}

	$: name = bed.label || 'this spot';
	$: inheritedSet = new Set(inherited);
	$: offSet = new Set(featuresOff);
	// What this bed can never be, whatever the room says: ♿ on an upper bunk.
	$: ruledOut = new Set(bedRulesOut(shownType));
	// The chips: what comes from above, plus an override whose feature the room
	// and house no longer have — otherwise it could never be seen or reset.
	$: fromAbove = FEATURES.filter(
		(feature) => inheritedSet.has(feature.value) || offSet.has(feature.value)
	);

	/**
	 * Unticks every "off here" box; saved, an empty list means "inherit
	 * everything again". The boxes are plain form fields, like in DetailsPanel,
	 * so nothing is stored until SAVE — the hidden box behind a struck-through
	 * ♿ chip included, so a reset clears that too.
	 */
	function resetOff(event: Event) {
		const form = (event.currentTarget as HTMLButtonElement).form;
		form
			?.querySelectorAll<HTMLInputElement>('input[name="features_off"]')
			.forEach((box) => (box.checked = false));
	}
	// A stacked spot's bed is set by the stacking: "lower bunk, below B2".
	$: stacked = !!partnerLabel;
	$: levelNote = level
		? `${level} bunk, ${level === 'lower' ? 'below' : 'above'} ${partnerLabel}`
		: `stacked with ${partnerLabel}`;

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
				<select
					id="bed-type-{bed.id}"
					name="bed_type"
					bind:value={shownType}
					disabled={stacked}
					aria-describedby={stacked ? `bed-type-note-${bed.id}` : undefined}
				>
					<option value="">Not specified</option>
					{#each BED_TYPES as type}
						<option value={type.value}>{type.label}</option>
					{/each}
				</select>
				{#if stacked}
					<!-- A disabled select is not submitted; the stored level goes along unchanged. -->
					<input type="hidden" name="bed_type" value={bed.bed_type ?? ''} />
					<p class="field-note" id="bed-type-note-{bed.id}">
						Set by the bunk bed: {levelNote}. Unstack it to change.
					</p>
				{/if}
			</div>

			<div class="field inherited">
				<span class="field-title">FROM THE ROOM AND HOUSE</span>
				{#if fromAbove.length === 0}
					<p class="field-hint">Nothing yet: the room and the house say nothing.</p>
				{:else}
					<ul class="chips" aria-label="Inherited from the room and house">
						{#each fromAbove as feature (feature.value)}
							{@const never = ruledOut.has(feature.value)}
							<li
								class="chip"
								class:off={!canOverride && offSet.has(feature.value)}
								class:never
								class:stale={!inheritedSet.has(feature.value)}
								title={never
									? 'An upper bunk is never wheelchair accessible.'
									: (feature.hint ?? '')}
							>
								<span aria-hidden="true">{feature.icon}</span>
								<span class="chip-label">{feature.label}</span>
								{#if canOverride}
									<!-- Hidden behind a struck-through chip, the box still carries what is
									     stored, so saving an upper bunk never changes its overrides. -->
									<label class="off-box" hidden={never}>
										<input
											type="checkbox"
											name="features_off"
											value={feature.value}
											checked={offSet.has(feature.value)}
										/>
										off here
									</label>
								{:else if offSet.has(feature.value) && !never}
									<span class="off-tag">off here</span>
								{/if}
								{#if never}
									<span class="never-tag">never on an upper bunk</span>
								{:else if !inheritedSet.has(feature.value)}
									<span class="stale-tag">not inherited now</span>
								{/if}
							</li>
						{/each}
					</ul>
					{#if canOverride}
						<div class="inherited-actions">
							<button type="button" class="btn-reset" on:click={resetOff}>RESET</button>
							<p class="field-hint">
								Superusers only: "off here" switches a feature off for this spot alone. Reset
								unticks them all; save to apply.
							</p>
						</div>
					{/if}
				{/if}
			</div>

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

	.field-error {
		margin: 0;
		font-size: 0.78rem;
		color: #ff6b8b;
	}

	/* What comes from the room and house: read-only chips, greyed so they don't look like boxes to tick. */
	.field-title {
		font-size: 0.62rem;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: #9aa;
		text-transform: uppercase;
	}

	.field-hint {
		margin: 0;
		font-size: 0.7rem;
		color: #8a8f98;
		line-height: 1.35;
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
		background: rgba(255, 255, 255, 0.05);
		border: 1px dashed rgba(255, 255, 255, 0.15);
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		font-size: 0.74rem;
		font-weight: 600;
		color: #aab3bd;
		min-width: 0;
	}

	.chip-label {
		overflow-wrap: anywhere;
	}

	/* Switched off here: struck through, whether stored (.off) or just ticked (:has). */
	.chip.off .chip-label,
	.chip:has(.off-box input:checked) .chip-label,
	.chip.never .chip-label {
		text-decoration: line-through;
		opacity: 0.55;
	}

	.chip.stale {
		border-style: dotted;
	}

	.off-box {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: none;
		color: #ffb86b;
		cursor: pointer;
	}

	.off-box input {
		accent-color: #ffb86b;
		width: 0.85rem;
		height: 0.85rem;
		flex: none;
	}

	/* The display above would win over the hidden attribute. */
	.off-box[hidden] {
		display: none;
	}

	.off-tag,
	.never-tag,
	.stale-tag {
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.off-tag {
		color: #ffb86b;
	}

	.stale-tag {
		color: #8a8f98;
	}

	.never-tag {
		color: #cfd6dd;
	}

	.inherited-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.7rem;
	}

	.btn-reset {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 184, 107, 0.5);
		border-radius: 8px;
		padding: 0.3rem 0.55rem;
		color: #ffb86b;
		font-size: 0.64rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.btn-reset:hover {
		border-color: #ffb86b;
		color: #ffd9b3;
	}

	select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.field-note {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		color: #2dd4bf;
		overflow-wrap: anywhere;
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
