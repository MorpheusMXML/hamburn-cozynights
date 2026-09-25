<script lang="ts">
	/**
	 * What a house or room is like: its kind, its features and a free text for
	 * whatever only this camp knows. Guests see all of it when they pick a spot,
	 * and the ♿ picker matches requests with it (src/lib/accommodation.ts).
	 *
	 * Details can be changed in every phase — they describe the place, they don't
	 * move a booking. The name is part of the layout, so the field is only shown
	 * (and only sent) while the layout is unlocked.
	 *
	 * A room also shows what it inherits from its house ("From the house"). A
	 * superuser can switch an inherited feature off for this room alone
	 * (`features_off`, src/lib/accommodation.ts); admins only see the chips.
	 */
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/dialogs';
	import {
		DESCRIPTION_MAX,
		FEATURES,
		HOUSE_KINDS,
		ROOM_KINDS,
		featureLabel,
		featuresFor,
		type Feature,
		type FeatureEntry
	} from '$lib/accommodation';

	export let level: 'house' | 'room';
	export let action: string;
	export let kind: string = '';
	export let features: string[] = [];
	export let description: string = '';
	/** The name, when it may be changed here; leave it undefined to hide the field. */
	export let name: string | undefined = undefined;
	export let nameHint = '';
	export let nameMax = 100;
	/** What a room inherits from its house (inheritedFeatures); a house has nothing above it. */
	export let inherited: Feature[] = [];
	/** What this room switched off of that (`rooms.features_off`, cleaned with readFeaturesOff). */
	export let featuresOff: Feature[] = [];
	/** A superuser may switch inherited features off and reset them; admins only look. */
	export let canOverride = false;

	let error = '';
	let submitting = false;

	$: kinds = level === 'house' ? HOUSE_KINDS : ROOM_KINDS;
	$: available = featuresFor(level);
	$: chosen = new Set(features as Feature[]);
	$: left = DESCRIPTION_MAX - description.length;
	// The pairs that rule each other out, for the hint under the boxes.
	$: pairs = available
		.filter((feature) => feature.opposite && feature.value < feature.opposite)
		.map((feature) => `${feature.label} / ${featureLabel(feature.opposite)}`);
	$: inheritedSet = new Set(inherited);
	$: offSet = new Set(featuresOff);
	// The chips: what comes from the house, plus an override whose feature the
	// house no longer has — it would otherwise be invisible and impossible to
	// reset. Catalogue order, like every other list of features.
	$: fromAbove = FEATURES.filter(
		(feature) => inheritedSet.has(feature.value) || offSet.has(feature.value)
	);

	/**
	 * Two features that say the opposite ("Heated", "No heating") can't both
	 * be true: ticking one clears the other, so the form can never send both.
	 * The server refuses such a pair anyway (parseDetailsForm); this keeps the
	 * boxes honest before anything is sent. Ticking a feature also clears its
	 * "off here" box: a room can't claim a feature and switch it off at once.
	 */
	function tickOne(event: Event, feature: FeatureEntry) {
		const box = event.currentTarget as HTMLInputElement;
		if (!box.checked) return;
		if (feature.opposite) {
			const other = box.form?.querySelector<HTMLInputElement>(
				`input[name="features"][value="${feature.opposite}"]`
			);
			if (other) other.checked = false;
		}
		const off = box.form?.querySelector<HTMLInputElement>(
			`input[name="features_off"][value="${feature.value}"]`
		);
		if (off) off.checked = false;
	}

	/** The other way round: "off here" clears the room's own box of the same feature. */
	function offOne(event: Event, feature: FeatureEntry) {
		const box = event.currentTarget as HTMLInputElement;
		if (!box.checked) return;
		const own = box.form?.querySelector<HTMLInputElement>(
			`input[name="features"][value="${feature.value}"]`
		);
		if (own) own.checked = false;
	}

	/**
	 * Unticks every "off here" box. Nothing is sent until SAVE: an empty
	 * features_off list then means "inherit everything again" (the action
	 * always writes the list a superuser posts, also an empty one).
	 */
	function resetOff(event: Event) {
		const form = (event.currentTarget as HTMLButtonElement).form;
		form
			?.querySelectorAll<HTMLInputElement>('input[name="features_off"]')
			.forEach((box) => (box.checked = false));
	}

	const handleSubmit: SubmitFunction = () => {
		error = '';
		submitting = true;
		return async ({ result, update }) => {
			submitting = false;
			if (result.type === 'success') {
				toast(`🏷️ The details of this ${level} are saved.`, 'success');
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

<form method="POST" {action} class="details-form" novalidate use:enhance={handleSubmit}>
	{#if name !== undefined}
		<div class="form-group">
			<label for="{level}-name">NAME</label>
			<input
				type="text"
				id="{level}-name"
				name="name"
				bind:value={name}
				autocomplete="off"
				maxlength={nameMax}
			/>
			{#if nameHint}<p class="hint">{nameHint}</p>{/if}
		</div>
	{/if}

	<div class="form-group">
		<label for="{level}-kind">KIND</label>
		<select id="{level}-kind" name="kind" bind:value={kind}>
			<option value="">Not specified</option>
			{#each kinds as entry}
				<option value={entry.value}>{entry.icon} {entry.label}</option>
			{/each}
		</select>
		{#if kinds.find((entry) => entry.value === kind)?.hint}
			<p class="hint">{kinds.find((entry) => entry.value === kind)?.hint}</p>
		{/if}
	</div>

	{#if level === 'room'}
		<fieldset class="features inherited">
			<legend>FROM THE HOUSE</legend>
			{#if fromAbove.length === 0}
				<p class="hint">The house says nothing yet, so this room inherits nothing.</p>
			{:else}
				<ul class="chips" aria-label="Inherited from the house">
					{#each fromAbove as feature (feature.value)}
						<li
							class="chip"
							class:off={!canOverride && offSet.has(feature.value)}
							class:stale={!inheritedSet.has(feature.value)}
							title={feature.hint ?? ''}
						>
							<span class="chip-icon" aria-hidden="true">{feature.icon}</span>
							<span class="chip-label">{feature.label}</span>
							{#if canOverride}
								<label class="off-box">
									<input
										type="checkbox"
										name="features_off"
										value={feature.value}
										checked={offSet.has(feature.value)}
										on:change={(event) => offOne(event, feature)}
									/>
									off here
								</label>
							{:else if offSet.has(feature.value)}
								<span class="off-tag">off here</span>
							{/if}
							{#if !inheritedSet.has(feature.value)}
								<span class="stale-tag">not from the house now</span>
							{/if}
						</li>
					{/each}
				</ul>
				{#if canOverride}
					<div class="inherited-actions">
						<button type="button" class="btn-reset" on:click={resetOff}>RESET TO HOUSE</button>
						<p class="hint">
							Superusers only: "off here" switches a feature off for this room and its spots. Reset
							unticks them all; save to apply.
						</p>
					</div>
				{:else}
					<p class="hint">A superuser can switch one of these off for this room alone.</p>
				{/if}
			{/if}
		</fieldset>
	{/if}

	<fieldset class="features">
		<legend>FEATURES</legend>
		{#each available as feature}
			<label class="check" title={feature.hint ?? ''}>
				<input
					type="checkbox"
					name="features"
					value={feature.value}
					checked={chosen.has(feature.value)}
					on:change={(event) => tickOne(event, feature)}
				/>
				<span class="check-icon" aria-hidden="true">{feature.icon}</span>
				<span class="check-label">{feature.label}</span>
			</label>
		{/each}
		<p class="hint">
			A spot inherits what its room and its house say. Leave a box empty when you don't know: the
			app never guesses.{#if pairs.length > 0}
				{' '}{pairs.join(', ')}: one or the other, never both — ticking one clears the other.{/if}
		</p>
	</fieldset>

	<div class="form-group">
		<label for="{level}-description">DESCRIPTION</label>
		<textarea
			id="{level}-description"
			name="description"
			bind:value={description}
			rows="3"
			maxlength={DESCRIPTION_MAX}
			placeholder={level === 'house'
				? 'e.g. Showers and toilets in the wash house, 50 m along the path.'
				: 'e.g. Up a narrow staircase, the window faces the lake.'}
		></textarea>
		<p class="hint">Guests read this. {left} characters left.</p>
	</div>

	{#if error}
		<p class="field-error" role="alert">⚠️ {error}</p>
	{/if}

	<button type="submit" class="btn-save" disabled={submitting}>
		{submitting ? 'SAVING…' : 'SAVE DETAILS 🏷️'}
	</button>
</form>

<style>
	.details-form {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	label,
	legend {
		font-size: 0.65rem;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: #9aa;
		text-transform: uppercase;
	}

	input[type='text'],
	select,
	textarea {
		width: 100%;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 0.6rem 0.7rem;
		color: #eee;
		font: inherit;
		font-size: 0.9rem;
	}

	textarea {
		resize: vertical;
		min-height: 4.5rem;
	}

	input[type='text']:focus,
	select:focus,
	textarea:focus {
		outline: 2px solid rgba(0, 255, 224, 0.6);
		outline-offset: 1px;
	}

	.features {
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		padding: 0.7rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
		letter-spacing: 0;
		text-transform: none;
		color: #ddd;
		cursor: pointer;
	}

	.check input {
		accent-color: #00ffe0;
		width: 1rem;
		height: 1rem;
		flex: none;
	}

	.check-label {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	/* What comes from the house: read-only chips, greyed so they don't look like boxes to tick. */
	.inherited {
		border-style: dashed;
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-wrap: wrap;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 999px;
		padding: 0.25rem 0.65rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: #aab3bd;
		min-width: 0;
	}

	.chip-label {
		overflow-wrap: anywhere;
	}

	/* Switched off here: struck through, whether stored (.off) or just ticked (:has). */
	.chip.off .chip-label,
	.chip:has(.off-box input:checked) .chip-label {
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
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0;
		text-transform: none;
		color: #ffb86b;
		cursor: pointer;
	}

	.off-box input {
		accent-color: #ffb86b;
		width: 0.9rem;
		height: 0.9rem;
		flex: none;
	}

	.off-tag,
	.stale-tag {
		font-size: 0.66rem;
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

	.inherited-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.8rem;
	}

	.btn-reset {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 184, 107, 0.5);
		border-radius: 8px;
		padding: 0.35rem 0.6rem;
		color: #ffb86b;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.btn-reset:hover {
		border-color: #ffb86b;
		color: #ffd9b3;
	}

	.hint {
		margin: 0;
		font-size: 0.72rem;
		color: #8a8f98;
		line-height: 1.35;
	}

	.field-error {
		margin: 0;
		font-size: 0.8rem;
		color: #ff6b8b;
	}

	.btn-save {
		background: linear-gradient(135deg, #00ffe0, #00b3ff);
		color: #04121a;
		border: none;
		border-radius: 8px;
		padding: 0.7rem 1rem;
		font-weight: 900;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.btn-save:disabled {
		opacity: 0.6;
		cursor: wait;
	}
</style>
