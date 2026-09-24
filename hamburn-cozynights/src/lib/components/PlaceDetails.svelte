<script lang="ts">
	/**
	 * What a house or room is like, for guests: its kind, its features and what
	 * the crew wrote about it. Empty when nobody filled anything in — the app
	 * never invents a detail (src/lib/accommodation.ts).
	 */
	import { featureEntry, houseKindEntry, roomKindEntry } from '$lib/accommodation';

	export let level: 'house' | 'room';
	export let kind = '';
	export let features: string[] = [];
	export let description = '';
	/** Smaller chips without the description, for a card in a list. */
	export let compact = false;

	$: entry = level === 'house' ? houseKindEntry(kind) : roomKindEntry(kind);
	$: chips = features.map(featureEntry).filter((feature) => !!feature);
	$: empty = !entry && chips.length === 0 && !description;
</script>

{#if !empty}
	<div class="place" class:compact>
		{#if entry || chips.length > 0}
			<ul class="chips">
				{#if entry}
					<li class="chip kind"><span aria-hidden="true">{entry.icon}</span> {entry.label}</li>
				{/if}
				{#each chips as feature}
					<li class="chip" title={feature?.hint ?? ''}>
						<span aria-hidden="true">{feature?.icon}</span>
						{feature?.label}
					</li>
				{/each}
			</ul>
		{/if}
		{#if description && !compact}
			<p class="description">{description}</p>
		{/if}
	</div>
{/if}

<style>
	.place {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	/* The chips wrap with the same 0.35 rem gap in every direction. The list
	   has no padding or margin of its own, so the card's padding is the only
	   thing between a chip and the card edge, on house and room cards alike. */
	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		min-width: 0;
		max-width: 100%;
	}

	.chip {
		box-sizing: border-box;
		max-width: 100%;
		min-width: 0;
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		font-size: 0.78rem;
		line-height: 1.4;
		color: #dbe3ea;
		background: rgba(255, 255, 255, 0.04);
		overflow-wrap: anywhere;
	}

	.chip.kind {
		border-color: rgba(0, 255, 224, 0.45);
		color: #b8fff4;
	}

	.compact .chip {
		font-size: 0.7rem;
		padding: 0.1rem 0.5rem;
	}

	.description {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: #b9c2cb;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
</style>
